use std::collections::BTreeSet;

use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::create_row,
    state::AppState,
};

const MUTATION_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

#[derive(Debug, Clone, Copy)]
struct TableConfig {
    org_column: &'static str,
    can_create: bool,
    can_update: bool,
    can_delete: bool,
}

#[derive(Debug, Clone)]
pub struct AgentConversationMessage {
    pub role: String,
    pub content: String,
}

pub struct RunAiAgentChatParams<'a> {
    pub org_id: &'a str,
    pub role: &'a str,
    pub message: &'a str,
    pub conversation: &'a [AgentConversationMessage],
    pub allow_mutations: bool,
    pub confirm_write: bool,
    pub agent_name: &'a str,
    pub agent_prompt: Option<&'a str>,
    pub allowed_tools: Option<&'a [String]>,
}

pub fn list_supported_tables() -> Vec<String> {
    let mut tables = vec![
        "application_events",
        "application_submissions",
        "audit_logs",
        "calendar_blocks",
        "collection_records",
        "expenses",
        "guests",
        "integration_events",
        "lease_charges",
        "leases",
        "integrations",
        "listings",
        "message_logs",
        "message_templates",
        "organization_invites",
        "organizations",
        "owner_statements",
        "pricing_templates",
        "properties",
        "reservations",
        "tasks",
        "units",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect::<Vec<_>>();

    tables.sort();
    tables
}

pub fn agent_capabilities(role: &str, allow_mutations: bool) -> Map<String, Value> {
    let role_value = normalize_role(role);
    let mut payload = Map::new();
    payload.insert(
        "tables".to_string(),
        Value::Array(
            list_supported_tables()
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    payload.insert("role".to_string(), Value::String(role_value.clone()));
    payload.insert(
        "mutations_enabled".to_string(),
        Value::Bool(mutations_allowed(&role_value, allow_mutations, false)),
    );
    payload
}

pub async fn run_ai_agent_chat(
    state: &AppState,
    params: RunAiAgentChatParams<'_>,
) -> AppResult<Map<String, Value>> {
    if !state.config.ai_agent_enabled {
        return Err(AppError::ServiceUnavailable(
            "AI agent is disabled in this environment.".to_string(),
        ));
    }

    let role_value = normalize_role(params.role);
    let base_prompt = params
        .agent_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "You are {} for Casaora, a property-management platform in Paraguay.",
                params.agent_name
            )
        });

    let system_prompt = format!(
        "{base_prompt} Use tools for all data-backed answers. Keep replies concise and action-oriented. Current org_id is {}. Current user role is {}. Never access data outside this organization. When a user asks to create/update/delete data, call the matching tool. If a write tool returns an error, explain why and propose a safe next action.",
        params.org_id,
        role_value,
    );

    let mut messages = vec![json!({"role": "system", "content": system_prompt})];
    let context_start = params.conversation.len().saturating_sub(12);
    for item in &params.conversation[context_start..] {
        let role_name = item.role.trim().to_ascii_lowercase();
        let content = item.content.trim();
        if matches!(role_name.as_str(), "user" | "assistant") && !content.is_empty() {
            messages.push(json!({
                "role": role_name,
                "content": truncate_chars(content, 4000),
            }));
        }
    }
    messages.push(json!({
        "role": "user",
        "content": truncate_chars(params.message.trim(), 4000),
    }));

    let mut tool_trace: Vec<Value> = Vec::new();
    let mut fallback_used = false;
    let mut model_used = String::new();
    let tool_definitions = tool_definitions(params.allowed_tools);

    let max_steps = std::cmp::max(1, state.config.ai_agent_max_tool_steps);
    for _ in 0..max_steps {
        let (completion, call_model, call_fallback) =
            call_openai_chat_completion(state, &messages, Some(&tool_definitions)).await?;
        model_used = call_model;
        fallback_used = fallback_used || call_fallback;

        let assistant_message = completion
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(Value::as_object)
            .and_then(|choice| choice.get("message"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        let assistant_text = extract_content_text(assistant_message.get("content"));
        let tool_calls = assistant_message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if !tool_calls.is_empty() {
            messages.push(json!({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": tool_calls.clone(),
            }));

            for call in tool_calls {
                let call_id = call
                    .as_object()
                    .and_then(|obj| obj.get("id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool-call")
                    .to_string();

                let function_payload = call
                    .as_object()
                    .and_then(|obj| obj.get("function"))
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();

                let tool_name = function_payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();

                let raw_arguments = function_payload.get("arguments").cloned();
                let mut arguments = Map::new();

                let tool_result = match parse_tool_arguments(raw_arguments) {
                    Ok(parsed) => {
                        arguments = parsed.clone();
                        match execute_tool(
                            state,
                            &tool_name,
                            &parsed,
                            ToolContext {
                                org_id: params.org_id,
                                role: &role_value,
                                allow_mutations: params.allow_mutations,
                                confirm_write: params.confirm_write,
                                allowed_tools: params.allowed_tools,
                            },
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(error) => {
                                json!({ "ok": false, "error": tool_error_detail(state, &error) })
                            }
                        }
                    }
                    Err(error) => {
                        json!({ "ok": false, "error": error.detail_message() })
                    }
                };

                tool_trace.push(json!({
                    "tool": tool_name,
                    "args": arguments,
                    "ok": tool_result
                        .as_object()
                        .and_then(|obj| obj.get("ok"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    "preview": preview_result(&tool_result),
                }));

                let tool_payload = serde_json::to_string(&tool_result).unwrap_or_else(|_| {
                    "{\"ok\":false,\"error\":\"Could not serialize tool result.\"}".to_string()
                });
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": truncate_chars(&tool_payload, 12000),
                }));
            }
            continue;
        }

        if !assistant_text.is_empty() {
            return Ok(build_agent_result(
                assistant_text,
                tool_trace,
                mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
                model_used,
                fallback_used,
            ));
        }

        break;
    }

    let (final_completion, final_model, final_fallback) =
        call_openai_chat_completion(state, &messages, None).await?;
    if !final_model.trim().is_empty() {
        model_used = final_model;
    }
    fallback_used = fallback_used || final_fallback;

    let final_text = final_completion
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(Value::as_object)
        .and_then(|choice| choice.get("message"))
        .and_then(Value::as_object)
        .and_then(|message| message.get("content"))
        .map(|content| extract_content_text(Some(content)))
        .unwrap_or_default();

    let reply = if final_text.is_empty() {
        "I completed the tool calls but could not generate a final answer. Please rephrase the request.".to_string()
    } else {
        final_text
    };

    Ok(build_agent_result(
        reply,
        tool_trace,
        mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
        model_used,
        fallback_used,
    ))
}

fn build_agent_result(
    reply: String,
    tool_trace: Vec<Value>,
    mutations_enabled: bool,
    model_used: String,
    fallback_used: bool,
) -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert("reply".to_string(), Value::String(reply));
    payload.insert("tool_trace".to_string(), Value::Array(tool_trace));
    payload.insert(
        "mutations_enabled".to_string(),
        Value::Bool(mutations_enabled),
    );
    payload.insert("model_used".to_string(), Value::String(model_used));
    payload.insert("fallback_used".to_string(), Value::Bool(fallback_used));
    payload
}

async fn call_openai_chat_completion(
    state: &AppState,
    messages: &[Value],
    tools: Option<&[Value]>,
) -> AppResult<(Value, String, bool)> {
    let api_key = state
        .config
        .openai_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable(
                "OPENAI_API_KEY is missing. Configure it in backend environment variables."
                    .to_string(),
            )
        })?;

    let model_chain = state.config.openai_model_chain();
    if model_chain.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "No OpenAI model is configured.".to_string(),
        ));
    }

    let mut last_error: Option<AppError> = None;
    let mut fallback_used = false;

    for (index, model_name) in model_chain.iter().enumerate() {
        let mut payload = Map::new();
        payload.insert("model".to_string(), Value::String(model_name.to_string()));
        payload.insert("messages".to_string(), Value::Array(messages.to_vec()));
        payload.insert("temperature".to_string(), Value::from(0.1));
        if let Some(tools) = tools {
            payload.insert("tools".to_string(), Value::Array(tools.to_vec()));
            payload.insert("tool_choice".to_string(), Value::String("auto".to_string()));
        }

        let response = match state
            .http_client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(
                state.config.ai_agent_timeout_seconds,
            ))
            .json(&payload)
            .send()
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, model = %model_name, "AI provider is unreachable");
                last_error = Some(AppError::Dependency(
                    "AI provider is unreachable.".to_string(),
                ));
                if index < model_chain.len() - 1 {
                    fallback_used = true;
                    continue;
                }
                return Err(last_error.take().unwrap_or_else(|| {
                    AppError::Dependency("AI provider is unreachable.".to_string())
                }));
            }
        };

        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            let detail = if state.config.is_production() {
                "AI provider request failed.".to_string()
            } else {
                let error_body = body_text.trim();
                let reason = if error_body.is_empty() {
                    status.canonical_reason().unwrap_or("unknown")
                } else {
                    error_body
                };
                format!(
                    "AI provider request failed ({}) on model '{}': {}",
                    status.as_u16(),
                    model_name,
                    reason
                )
            };
            last_error = Some(AppError::Dependency(detail));
            if index < model_chain.len() - 1 {
                fallback_used = true;
                continue;
            }
            return Err(last_error.take().unwrap_or_else(|| {
                AppError::Dependency("AI provider request failed.".to_string())
            }));
        }

        let parsed: Value = match serde_json::from_str(&body_text) {
            Ok(value) => value,
            Err(_) => {
                last_error = Some(AppError::Dependency(
                    "AI provider returned an invalid JSON response.".to_string(),
                ));
                if index < model_chain.len() - 1 {
                    fallback_used = true;
                    continue;
                }
                return Err(last_error.take().unwrap_or_else(|| {
                    AppError::Dependency(
                        "AI provider returned an invalid JSON response.".to_string(),
                    )
                }));
            }
        };

        if !parsed.is_object() {
            last_error = Some(AppError::Dependency(
                "AI provider response is malformed.".to_string(),
            ));
            if index < model_chain.len() - 1 {
                fallback_used = true;
                continue;
            }
            return Err(last_error.take().unwrap_or_else(|| {
                AppError::Dependency("AI provider response is malformed.".to_string())
            }));
        }

        return Ok((parsed, model_name.to_string(), fallback_used || index > 0));
    }

    Err(last_error
        .unwrap_or_else(|| AppError::Dependency("AI provider request failed.".to_string())))
}

fn extract_content_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }

    if let Some(parts) = content.as_array() {
        let chunks = parts
            .iter()
            .filter_map(Value::as_object)
            .filter_map(|part| part.get("text"))
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        return chunks.join("\n");
    }

    String::new()
}

fn tool_definitions(allowed_tools: Option<&[String]>) -> Vec<Value> {
    let definitions = vec![
        json!({
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": "List database tables that the agent can access.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_org_snapshot",
                "description": "Get high-level counts for leasing and operations tables.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_rows",
                "description": "List rows from a table with optional filters.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "filters": {
                            "type": "object",
                            "description": "Simple filters. Values can be scalar/list or {op, value}."
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                        "order_by": {"type": "string"},
                        "ascending": {"type": "boolean"}
                    },
                    "required": ["table"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_row",
                "description": "Get one row by id from a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_row",
                "description": "Create one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "payload": {"type": "object"}
                    },
                    "required": ["table", "payload"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "update_row",
                "description": "Update one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "payload": {"type": "object"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id", "payload"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "delete_row",
                "description": "Delete one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id"]
                }
            }
        }),
    ];

    let Some(allowed_tools) = allowed_tools else {
        return definitions;
    };

    let allowed = allowed_tools
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();
    if allowed.is_empty() {
        return definitions;
    }

    definitions
        .into_iter()
        .filter(|definition| {
            definition
                .as_object()
                .and_then(|obj| obj.get("function"))
                .and_then(Value::as_object)
                .and_then(|obj| obj.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|name| allowed.contains(name))
        })
        .collect()
}

struct ToolContext<'a> {
    org_id: &'a str,
    role: &'a str,
    allow_mutations: bool,
    confirm_write: bool,
    allowed_tools: Option<&'a [String]>,
}

async fn execute_tool(
    state: &AppState,
    tool_name: &str,
    args: &Map<String, Value>,
    context: ToolContext<'_>,
) -> AppResult<Value> {
    if let Some(allowed_tools) = context.allowed_tools {
        let allowed = allowed_tools
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<BTreeSet<_>>();
        if !allowed.is_empty() && !allowed.contains(tool_name) {
            return Ok(json!({
                "ok": false,
                "error": format!("Tool '{}' is not enabled for this agent.", tool_name),
            }));
        }
    }

    match tool_name {
        "list_tables" => Ok(json!({ "ok": true, "tables": list_supported_tables() })),
        "get_org_snapshot" => tool_get_org_snapshot(state, context.org_id).await,
        "list_rows" => tool_list_rows(state, context.org_id, args).await,
        "get_row" => tool_get_row(state, context.org_id, args).await,
        "create_row" => {
            tool_create_row(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        "update_row" => {
            tool_update_row(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        "delete_row" => {
            tool_delete_row(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        _ => Ok(json!({
            "ok": false,
            "error": format!("Unknown tool: {tool_name}"),
        })),
    }
}

async fn tool_list_rows(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    let org_column = table_cfg.org_column;
    let limit = coerce_limit(args.get("limit"), 30);
    let order_by = args
        .get("order_by")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("created_at");
    let ascending = args
        .get("ascending")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let filters = normalize_json_object(args.get("filters"), "filters")?;

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let order_name = validate_identifier(order_by)?;

    let mut query = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ");
    query.push(table_name).push(" t WHERE 1=1");
    query
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(org_column)
        .push(") = ")
        .push_bind(org_id);

    for (key, value) in filters {
        let column = key.trim();
        if column.is_empty() || column == org_column {
            continue;
        }
        apply_filter(&mut query, column, &value)?;
    }

    query.push(" ORDER BY t.").push(order_name);
    if ascending {
        query.push(" ASC");
    } else {
        query.push(" DESC");
    }
    query.push(" LIMIT ").push_bind(limit);

    let rows = query
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;

    let data = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "table": table,
        "rows": data,
    }))
}

async fn tool_get_row(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    let org_column = table_cfg.org_column;

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let row = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(org_column)
        .push(") = ")
        .push_bind(org_id)
        .push(" LIMIT 1")
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;

    let payload = row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten());
    if let Some(row) = payload {
        return Ok(json!({ "ok": true, "table": table, "row": row }));
    }

    Ok(json!({
        "ok": false,
        "error": format!("No record found in {table}."),
    }))
}

async fn tool_create_row(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) = assert_mutation_allowed(role, allow_mutations, confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_create {
        return Ok(json!({
            "ok": false,
            "error": format!("Create is not allowed for table '{}'.", table),
        }));
    }

    let mut payload = normalize_json_object(args.get("payload"), "payload")?;
    payload = sanitize_mutation_payload(payload);
    payload.insert(
        table_cfg.org_column.to_string(),
        Value::String(org_id.to_string()),
    );

    let pool = db_pool(state)?;
    let created = create_row(pool, &table, &payload).await?;

    Ok(json!({
        "ok": true,
        "table": table,
        "row": created,
    }))
}

async fn tool_update_row(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) = assert_mutation_allowed(role, allow_mutations, confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_update {
        return Ok(json!({
            "ok": false,
            "error": format!("Update is not allowed for table '{}'.", table),
        }));
    }

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let payload = normalize_json_object(args.get("payload"), "payload")?;
    let mut safe_payload = sanitize_mutation_payload(payload);
    safe_payload.remove(table_cfg.org_column);
    if safe_payload.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "No updatable fields provided.",
        }));
    }

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let mut keys = safe_payload.keys().cloned().collect::<Vec<_>>();
    keys.sort_unstable();
    for key in &keys {
        let _ = validate_identifier(key)?;
    }

    let mut query = QueryBuilder::<Postgres>::new("UPDATE ");
    query.push(table_name).push(" t SET ");
    {
        let mut separated = query.separated(", ");
        for key in &keys {
            let col = validate_identifier(key)?;
            separated.push(col);
            separated.push_unseparated(" = r.");
            separated.push_unseparated(col);
        }
    }
    query
        .push(" FROM jsonb_populate_record(NULL::")
        .push(table_name)
        .push(", ");
    query.push_bind(Value::Object(safe_payload.clone()));
    query
        .push(") r WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(org_id)
        .push(" RETURNING row_to_json(t) AS row");

    let row = query
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;

    if let Some(row) = row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten()) {
        return Ok(json!({ "ok": true, "table": table, "row": row }));
    }

    Ok(json!({
        "ok": false,
        "error": format!("No matching row found for update in '{}'.", table),
    }))
}

async fn tool_delete_row(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) = assert_mutation_allowed(role, allow_mutations, confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_delete {
        return Ok(json!({
            "ok": false,
            "error": format!("Delete is not allowed for table '{}'.", table),
        }));
    }

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let existing = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(org_id)
        .push(" LIMIT 1")
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?
        .and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten());

    let Some(existing) = existing else {
        return Ok(json!({
            "ok": false,
            "error": format!("No matching row found for delete in '{}'.", table),
        }));
    };

    QueryBuilder::<Postgres>::new("DELETE FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(org_id)
        .build()
        .execute(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;

    Ok(json!({ "ok": true, "table": table, "row": existing }))
}

async fn tool_get_org_snapshot(state: &AppState, org_id: &str) -> AppResult<Value> {
    let tracked_tables = [
        "properties",
        "units",
        "reservations",
        "tasks",
        "application_submissions",
        "leases",
        "collection_records",
        "listings",
    ];

    let pool = db_pool(state)?;
    let mut summary = Map::new();

    for table in tracked_tables {
        let cfg = table_config(table)?;
        let table_name = validate_identifier(table)?;

        let row = QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint AS count FROM ")
            .push(table_name)
            .push(" t WHERE (to_jsonb(t) ->> ")
            .push_bind(cfg.org_column)
            .push(") = ")
            .push_bind(org_id)
            .build()
            .fetch_one(pool)
            .await
            .map_err(|error| supabase_error(state, &error))?;

        let count = row.try_get::<i64, _>("count").unwrap_or(0);
        summary.insert(table.to_string(), Value::from(count));
    }

    Ok(json!({ "ok": true, "summary": summary }))
}

fn apply_filter(
    query: &mut QueryBuilder<'_, Postgres>,
    column: &str,
    value: &Value,
) -> AppResult<()> {
    let column_name = validate_identifier(column)?.to_string();

    if let Some(spec) = value.as_object() {
        let op = spec
            .get("op")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("eq")
            .to_ascii_lowercase();
        let operand = spec.get("value").cloned().unwrap_or(Value::Null);

        match op.as_str() {
            "eq" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") = ")
                    .push_bind(render_scalar(&operand));
            }
            "neq" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") <> ")
                    .push_bind(render_scalar(&operand));
            }
            "gt" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") > ")
                    .push_bind(render_scalar(&operand));
            }
            "gte" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") >= ")
                    .push_bind(render_scalar(&operand));
            }
            "lt" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") < ")
                    .push_bind(render_scalar(&operand));
            }
            "lte" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") <= ")
                    .push_bind(render_scalar(&operand));
            }
            "ilike" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") ILIKE ")
                    .push_bind(render_scalar(&operand));
            }
            "in" => {
                if let Some(items) = operand.as_array() {
                    let values = items.iter().map(render_scalar).collect::<Vec<_>>();
                    if !values.is_empty() {
                        query
                            .push(" AND (to_jsonb(t) ->> ")
                            .push_bind(column_name.clone())
                            .push(") = ANY(")
                            .push_bind(values)
                            .push(")");
                    }
                } else {
                    query
                        .push(" AND (to_jsonb(t) ->> ")
                        .push_bind(column_name.clone())
                        .push(") = ")
                        .push_bind(render_scalar(&operand));
                }
            }
            _ => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") = ")
                    .push_bind(render_scalar(&operand));
            }
        }

        return Ok(());
    }

    if let Some(items) = value.as_array() {
        let values = items.iter().map(render_scalar).collect::<Vec<_>>();
        if !values.is_empty() {
            query
                .push(" AND (to_jsonb(t) ->> ")
                .push_bind(column_name.clone())
                .push(") = ANY(")
                .push_bind(values)
                .push(")");
        }
        return Ok(());
    }

    query
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(column_name)
        .push(") = ")
        .push_bind(render_scalar(value));

    Ok(())
}

fn normalize_table(value: Option<&Value>) -> AppResult<String> {
    let table = value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if table.is_empty() {
        return Err(AppError::BadRequest("table is required.".to_string()));
    }
    let _ = table_config(&table)?;
    Ok(table)
}

fn table_config(table: &str) -> AppResult<TableConfig> {
    let config = match table.trim() {
        "organizations" => TableConfig {
            org_column: "id",
            can_create: false,
            can_update: true,
            can_delete: false,
        },
        "audit_logs" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "organization_invites"
        | "properties"
        | "units"
        | "integrations"
        | "guests"
        | "reservations"
        | "calendar_blocks"
        | "tasks"
        | "expenses"
        | "owner_statements"
        | "pricing_templates"
        | "listings"
        | "application_submissions"
        | "application_events"
        | "leases"
        | "lease_charges"
        | "collection_records"
        | "message_templates"
        | "message_logs"
        | "integration_events" => TableConfig {
            org_column: "organization_id",
            can_create: true,
            can_update: true,
            can_delete: true,
        },
        _ => {
            return Err(AppError::BadRequest(format!(
                "Table '{table}' is not allowed for AI access."
            )));
        }
    };

    Ok(config)
}

fn normalize_json_object(value: Option<&Value>, field_name: &str) -> AppResult<Map<String, Value>> {
    let Some(value) = value else {
        return Ok(Map::new());
    };
    if let Some(object) = value.as_object() {
        return Ok(object.clone());
    }
    Err(AppError::BadRequest(format!(
        "{field_name} must be an object."
    )))
}

fn coerce_limit(value: Option<&Value>, default: i64) -> i64 {
    let parsed = value
        .and_then(|item| {
            item.as_i64().or_else(|| {
                item.as_u64()
                    .and_then(|number| i64::try_from(number).ok())
                    .or_else(|| {
                        item.as_f64().and_then(|number| {
                            if number.is_finite() {
                                Some(number as i64)
                            } else {
                                None
                            }
                        })
                    })
                    .or_else(|| {
                        item.as_str()
                            .and_then(|text| text.trim().parse::<i64>().ok())
                    })
            })
        })
        .unwrap_or(default);
    parsed.clamp(1, 200)
}

fn assert_mutation_allowed(
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
) -> (bool, String) {
    if !allow_mutations {
        return (
            false,
            "Mutations are disabled. Enable write mode to create/update/delete rows.".to_string(),
        );
    }
    if !confirm_write {
        return (
            false,
            "Write confirmation is required. Confirm this action before running mutations."
                .to_string(),
        );
    }

    let role_value = normalize_role(role);
    if !MUTATION_ROLES.contains(&role_value.as_str()) {
        return (
            false,
            format!("Role '{}' is read-only for AI mutations.", role_value),
        );
    }

    (true, "ok".to_string())
}

fn mutations_allowed(role: &str, allow_mutations: bool, confirm_write: bool) -> bool {
    assert_mutation_allowed(role, allow_mutations, confirm_write).0
}

fn parse_tool_arguments(raw_arguments: Option<Value>) -> AppResult<Map<String, Value>> {
    let Some(raw_arguments) = raw_arguments else {
        return Ok(Map::new());
    };

    if let Some(object) = raw_arguments.as_object() {
        return Ok(object.clone());
    }

    if let Some(raw) = raw_arguments.as_str() {
        let text = raw.trim();
        if text.is_empty() {
            return Ok(Map::new());
        }

        let parsed: Value = serde_json::from_str(text)
            .map_err(|_| AppError::BadRequest("Invalid tool arguments payload.".to_string()))?;
        if let Some(object) = parsed.as_object() {
            return Ok(object.clone());
        }
    }

    Err(AppError::BadRequest(
        "Invalid tool arguments payload.".to_string(),
    ))
}

fn preview_result(result: &Value) -> String {
    let Some(result_obj) = result.as_object() else {
        return "ok".to_string();
    };

    if !result_obj
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return result_obj
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Operation failed.".to_string());
    }

    if let Some(row) = result_obj.get("row").and_then(Value::as_object) {
        if let Some(id_value) = row.get("id").and_then(Value::as_str) {
            let trimmed = id_value.trim();
            if !trimmed.is_empty() {
                return format!("row={trimmed}");
            }
        }
        return "row updated".to_string();
    }

    if let Some(rows) = result_obj.get("rows").and_then(Value::as_array) {
        return format!("rows={}", rows.len());
    }

    if result_obj.get("summary").is_some() {
        return "snapshot ready".to_string();
    }

    if let Some(tables) = result_obj.get("tables").and_then(Value::as_array) {
        return format!("tables={}", tables.len());
    }

    "ok".to_string()
}

fn sanitize_mutation_payload(payload: Map<String, Value>) -> Map<String, Value> {
    let mut next_payload = payload;
    next_payload.remove("id");
    next_payload.remove("created_at");
    next_payload.remove("updated_at");
    next_payload
}

fn render_scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn validate_identifier(identifier: &str) -> AppResult<&str> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Identifier cannot be empty.".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        || trimmed
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_digit())
    {
        return Err(AppError::BadRequest(format!(
            "Invalid identifier '{trimmed}'."
        )));
    }
    Ok(trimmed)
}

fn normalize_role(role: &str) -> String {
    let value = role.trim().to_ascii_lowercase();
    if value.is_empty() {
        return "viewer".to_string();
    }
    value
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let mut result = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            break;
        }
        result.push(ch);
    }
    result
}

fn tool_error_detail(state: &AppState, error: &AppError) -> String {
    match error {
        AppError::BadRequest(_)
        | AppError::Forbidden(_)
        | AppError::NotFound(_)
        | AppError::Conflict(_)
        | AppError::Unauthorized(_)
        | AppError::UnprocessableEntity(_)
        | AppError::Gone(_) => error.detail_message(),
        _ => {
            if state.config.is_production() {
                "Tool execution failed.".to_string()
            } else {
                format!("Tool execution failed: {}", error.detail_message())
            }
        }
    }
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn supabase_error(_state: &AppState, error: &sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Database query failed");
    AppError::Dependency("External service request failed.".to_string())
}
