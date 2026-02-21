use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::create_row,
    state::AppState,
};

/// SSE event types sent during streaming agent execution.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AgentStreamEvent {
    #[serde(rename = "status")]
    Status { message: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        name: String,
        args: Map<String, Value>,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        name: String,
        preview: String,
        ok: bool,
    },
    #[serde(rename = "token")]
    Token { text: String },
    #[serde(rename = "done")]
    Done {
        content: String,
        tool_trace: Vec<Value>,
        model_used: Option<String>,
        fallback_used: bool,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

const MUTATION_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];
const MUTATION_TOOLS: &[&str] = &["create_row", "update_row", "delete_row"];
const AI_AGENT_DISABLED_MESSAGE: &str = "AI agent is disabled in this environment.";

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
    pub agent_slug: Option<&'a str>,
    pub chat_id: Option<&'a str>,
    pub requested_by_user_id: Option<&'a str>,
    pub preferred_model: Option<&'a str>,
}

pub fn list_supported_tables() -> Vec<String> {
    let mut tables = vec![
        "agent_approval_policies",
        "agent_approvals",
        "anomaly_alerts",
        "application_events",
        "application_submissions",
        "audit_logs",
        "calendar_blocks",
        "collection_records",
        "escrow_events",
        "expenses",
        "guests",
        "integration_events",
        "knowledge_chunks",
        "knowledge_documents",
        "lease_charges",
        "leases",
        "integrations",
        "listings",
        "maintenance_requests",
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
            AI_AGENT_DISABLED_MESSAGE.to_string(),
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
        let (completion, call_model, call_fallback) = call_openai_chat_completion(
            state,
            &messages,
            Some(&tool_definitions),
            params.preferred_model,
        )
        .await?;
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
                                agent_slug: params.agent_slug,
                                chat_id: params.chat_id,
                                requested_by_user_id: params.requested_by_user_id,
                                approved_execution: false,
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
        call_openai_chat_completion(state, &messages, None, params.preferred_model).await?;
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

/// Execute a tool call that was previously approved in the approval queue.
pub async fn execute_approved_tool(
    state: &AppState,
    org_id: &str,
    tool_name: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    execute_tool(
        state,
        tool_name,
        args,
        ToolContext {
            org_id,
            role: "operator",
            allow_mutations: true,
            confirm_write: true,
            allowed_tools: None,
            agent_slug: Some("system"),
            chat_id: None,
            requested_by_user_id: None,
            approved_execution: true,
        },
    )
    .await
}

/// Streaming variant of `run_ai_agent_chat` that sends progress events through a channel.
pub async fn run_ai_agent_chat_streaming(
    state: &AppState,
    params: RunAiAgentChatParams<'_>,
    tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
) -> AppResult<Map<String, Value>> {
    if !state.config.ai_agent_enabled {
        let message = AI_AGENT_DISABLED_MESSAGE.to_string();
        let _ = tx
            .send(AgentStreamEvent::Error {
                message: message.clone(),
            })
            .await;
        let _ = tx
            .send(AgentStreamEvent::Done {
                content: message.clone(),
                tool_trace: Vec::new(),
                model_used: None,
                fallback_used: false,
            })
            .await;

        return Ok(disabled_stream_payload());
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

    let _ = tx
        .send(AgentStreamEvent::Status {
            message: "Thinking...".to_string(),
        })
        .await;

    let max_steps = std::cmp::max(1, state.config.ai_agent_max_tool_steps);
    for _ in 0..max_steps {
        let (completion, call_model, call_fallback) = call_openai_chat_completion(
            state,
            &messages,
            Some(&tool_definitions),
            params.preferred_model,
        )
        .await?;
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

                let _ = tx
                    .send(AgentStreamEvent::ToolCall {
                        name: tool_name.clone(),
                        args: arguments.clone(),
                    })
                    .await;

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
                                agent_slug: params.agent_slug,
                                chat_id: params.chat_id,
                                requested_by_user_id: params.requested_by_user_id,
                                approved_execution: false,
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

                let preview = preview_result(&tool_result);
                let ok = tool_result
                    .as_object()
                    .and_then(|obj| obj.get("ok"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                let _ = tx
                    .send(AgentStreamEvent::ToolResult {
                        name: tool_name.clone(),
                        preview: preview.clone(),
                        ok,
                    })
                    .await;

                tool_trace.push(json!({
                    "tool": tool_name,
                    "args": arguments,
                    "ok": ok,
                    "preview": preview,
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
            let _ = tx
                .send(AgentStreamEvent::Token {
                    text: assistant_text.clone(),
                })
                .await;
            let _ = tx
                .send(AgentStreamEvent::Done {
                    content: assistant_text.clone(),
                    tool_trace: tool_trace.clone(),
                    model_used: if model_used.trim().is_empty() {
                        None
                    } else {
                        Some(model_used.clone())
                    },
                    fallback_used,
                })
                .await;
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
        call_openai_chat_completion(state, &messages, None, params.preferred_model).await?;
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

    let _ = tx
        .send(AgentStreamEvent::Token {
            text: reply.clone(),
        })
        .await;
    let _ = tx
        .send(AgentStreamEvent::Done {
            content: reply.clone(),
            tool_trace: tool_trace.clone(),
            model_used: if model_used.trim().is_empty() {
                None
            } else {
                Some(model_used.clone())
            },
            fallback_used,
        })
        .await;

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

fn disabled_stream_payload() -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert(
        "reply".to_string(),
        Value::String(AI_AGENT_DISABLED_MESSAGE.to_string()),
    );
    payload.insert("tool_trace".to_string(), Value::Array(Vec::new()));
    payload.insert("mutations_enabled".to_string(), Value::Bool(false));
    payload.insert("model_used".to_string(), Value::Null);
    payload.insert("fallback_used".to_string(), Value::Bool(false));
    payload
}

async fn call_openai_chat_completion(
    state: &AppState,
    messages: &[Value],
    tools: Option<&[Value]>,
    preferred_model: Option<&str>,
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

    let model_chain = with_preferred_model(state.config.openai_model_chain(), preferred_model);
    if model_chain.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "No OpenAI model is configured.".to_string(),
        ));
    }
    let chat_completions_url = state.config.openai_chat_completions_url();

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
            .post(&chat_completions_url)
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

fn with_preferred_model(model_chain: Vec<String>, preferred_model: Option<&str>) -> Vec<String> {
    let preferred = preferred_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    if preferred.is_empty() {
        return model_chain;
    }

    if !model_chain.iter().any(|model| model == preferred) {
        return model_chain;
    }

    let mut next = Vec::with_capacity(model_chain.len());
    next.push(preferred.to_string());
    for model in model_chain {
        if model != preferred {
            next.push(model);
        }
    }
    next
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
        json!({
            "type": "function",
            "function": {
                "name": "delegate_to_agent",
                "description": "Delegate a question to another AI agent by slug. Use when the user's request falls outside your specialization.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_slug": {"type": "string", "description": "Slug of the target agent (e.g. 'price-optimizer', 'maintenance-triage')."},
                        "message": {"type": "string", "description": "The question or task to send to the target agent."}
                    },
                    "required": ["agent_slug", "message"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_occupancy_forecast",
                "description": "Get predicted occupancy rates for upcoming months based on historical reservation data.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months_ahead": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3, "description": "Number of months to forecast (default 3)."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_anomaly_alerts",
                "description": "Get active anomaly alerts for the organization (revenue drops, expense spikes, occupancy cliffs, etc.).",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_today_ops_brief",
                "description": "Get today's operations brief with arrivals, departures, overdue tasks, and open maintenance workload.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_lease_risk_summary",
                "description": "Summarize lease risk, including near-term expirations and active delinquencies.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_collections_risk",
                "description": "Summarize collection risk for overdue or partially paid records.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_owner_statement_summary",
                "description": "Summarize owner statements by status for the current reporting month.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search organization knowledge base chunks by natural language query.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8}
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "send_message",
                "description": "Send a message to a guest or contact via WhatsApp, email, or SMS. The message is queued and sent asynchronously.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "enum": ["whatsapp", "email", "sms"], "description": "Message channel."},
                        "recipient": {"type": "string", "description": "Phone number (E.164) for WhatsApp/SMS, or email address."},
                        "body": {"type": "string", "description": "The message body text."},
                        "guest_id": {"type": "string", "description": "Optional guest UUID for tracking."}
                    },
                    "required": ["channel", "recipient", "body"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_staff_availability",
                "description": "Get current task load per staff member to determine who is available for new assignments.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_maintenance_task",
                "description": "Create a maintenance task from a maintenance request with urgency assessment, assignee, and checklist.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short task title."},
                        "description": {"type": "string", "description": "Detailed description including triage reasoning."},
                        "priority": {"type": "string", "enum": ["critical", "high", "medium", "low"], "description": "Urgency level."},
                        "assigned_to_user_id": {"type": "string", "description": "UUID of the staff member to assign to."},
                        "maintenance_request_id": {"type": "string", "description": "UUID of the originating maintenance request."},
                        "unit_id": {"type": "string", "description": "UUID of the unit where work is needed."},
                        "checklist": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional checklist items for the task."
                        }
                    },
                    "required": ["title", "description", "priority"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_revenue_analytics",
                "description": "Get revenue analytics including RevPAN, ADR, occupancy rate, and total revenue for recent months.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months": {"type": "integer", "minimum": 1, "maximum": 12, "default": 3, "description": "Number of months to analyze."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_seasonal_demand",
                "description": "Get historical booking patterns and seasonal demand data for pricing optimization.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months_ahead": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "generate_owner_statement",
                "description": "Generate a draft owner statement for a specific month, compiling reservations, expenses, management fees, and IVA.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "owner_id": {"type": "string", "description": "UUID of the property owner."},
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format."}
                    },
                    "required": ["owner_id", "period_month"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "reconcile_collections",
                "description": "Match payments received against expected collection amounts, flagging discrepancies.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format."}
                    },
                    "required": ["period_month"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "categorize_expense",
                "description": "Categorize an expense into a standard PMS category and suggest allocation to property/unit.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expense_id": {"type": "string"},
                        "description": {"type": "string"},
                        "amount": {"type": "number"},
                        "suggested_category": {"type": "string", "enum": ["maintenance", "utilities", "cleaning", "management_fee", "insurance", "taxes", "supplies", "marketing", "other"]}
                    },
                    "required": ["expense_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "recall_memory",
                "description": "Recall stored memories for context. Search by key, entity, or context type.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search term to find relevant memories."},
                        "entity_id": {"type": "string", "description": "Optional entity ID (guest ID, unit ID) to filter memories."},
                        "context_type": {"type": "string", "description": "Optional context type filter: general, guest_preference, property_insight, financial_pattern."},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "store_memory",
                "description": "Store a key fact in agent memory for future reference. Memories persist across conversations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "memory_key": {"type": "string", "description": "A short descriptive key for the memory (e.g., 'guest_juan_preference')."},
                        "memory_value": {"type": "string", "description": "The fact to remember."},
                        "context_type": {"type": "string", "enum": ["general", "guest_preference", "property_insight", "financial_pattern"], "default": "general"},
                        "entity_id": {"type": "string", "description": "Optional entity ID this memory relates to."},
                        "expires_days": {"type": "integer", "minimum": 1, "maximum": 365, "default": 90, "description": "Days until this memory expires."}
                    },
                    "required": ["memory_key", "memory_value"]
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
    agent_slug: Option<&'a str>,
    chat_id: Option<&'a str>,
    requested_by_user_id: Option<&'a str>,
    approved_execution: bool,
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
        "create_row" => tool_create_row(state, &context, args).await,
        "update_row" => tool_update_row(state, &context, args).await,
        "delete_row" => tool_delete_row(state, &context, args).await,
        "delegate_to_agent" => {
            tool_delegate_to_agent(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        "get_occupancy_forecast" => tool_get_occupancy_forecast(state, context.org_id, args).await,
        "get_anomaly_alerts" => tool_get_anomaly_alerts(state, context.org_id).await,
        "get_today_ops_brief" => tool_get_today_ops_brief(state, context.org_id).await,
        "get_lease_risk_summary" => tool_get_lease_risk_summary(state, context.org_id).await,
        "get_collections_risk" => tool_get_collections_risk(state, context.org_id).await,
        "get_owner_statement_summary" => {
            tool_get_owner_statement_summary(state, context.org_id).await
        }
        "search_knowledge" => tool_search_knowledge(state, context.org_id, args).await,
        "send_message" => tool_send_message(state, context.org_id, args).await,
        "get_staff_availability" => tool_get_staff_availability(state, context.org_id).await,
        "create_maintenance_task" => {
            tool_create_maintenance_task(state, context.org_id, args).await
        }
        "get_revenue_analytics" => {
            tool_get_revenue_analytics(state, context.org_id, args).await
        }
        "get_seasonal_demand" => {
            tool_get_seasonal_demand(state, context.org_id, args).await
        }
        "generate_owner_statement" => {
            tool_generate_owner_statement(state, context.org_id, args).await
        }
        "reconcile_collections" => {
            tool_reconcile_collections(state, context.org_id, args).await
        }
        "categorize_expense" => {
            tool_categorize_expense(state, context.org_id, args).await
        }
        "recall_memory" => {
            tool_recall_memory(state, context.org_id, context.agent_slug, args).await
        }
        "store_memory" => {
            tool_store_memory(state, context.org_id, context.agent_slug, args).await
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

/// Check if an approval is required by policy and enqueue it.
/// Returns Some(json) for pending approval, or None to proceed immediately.
async fn maybe_create_approval(
    state: &AppState,
    context: &ToolContext<'_>,
    tool_name: &str,
    args: &Map<String, Value>,
) -> AppResult<Option<Value>> {
    if context.approved_execution {
        return Ok(None);
    }
    if !is_mutation_tool(tool_name) {
        return Ok(None);
    }
    if !approval_required_by_policy(state, context.org_id, tool_name).await {
        return Ok(None);
    }

    let pool = match state.db_pool.as_ref() {
        Some(pool) => pool,
        None => return Ok(None),
    };

    let approval = sqlx::query(
        "INSERT INTO agent_approvals (
            organization_id,
            chat_id,
            agent_slug,
            tool_name,
            tool_args,
            status,
            requested_by
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'pending', $6::uuid)
         RETURNING id::text AS id",
    )
    .bind(context.org_id)
    .bind(context.chat_id)
    .bind(context.agent_slug.unwrap_or("system"))
    .bind(tool_name)
    .bind(Value::Object(args.clone()))
    .bind(context.requested_by_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let approval_id = approval
        .and_then(|row| row.try_get::<Option<String>, _>("id").ok().flatten())
        .unwrap_or_default();

    Ok(Some(json!({
        "ok": true,
        "status": "pending_approval",
        "approval_id": approval_id,
        "tool": tool_name,
        "message": "This action requires human approval and has been queued.",
    })))
}

fn is_mutation_tool(tool_name: &str) -> bool {
    MUTATION_TOOLS.contains(&tool_name)
}

async fn approval_required_by_policy(state: &AppState, org_id: &str, tool_name: &str) -> bool {
    if !is_mutation_tool(tool_name) {
        return false;
    }

    let Some(pool) = state.db_pool.as_ref() else {
        return true;
    };

    let row = sqlx::query(
        "SELECT approval_mode, enabled
         FROM agent_approval_policies
         WHERE organization_id = $1::uuid
           AND tool_name = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(tool_name)
    .fetch_optional(pool)
    .await;

    let Ok(row) = row else {
        return true;
    };

    let Some(row) = row else {
        return true;
    };

    let enabled = row.try_get::<bool, _>("enabled").unwrap_or(true);
    if !enabled {
        return false;
    }

    let mode = row
        .try_get::<String, _>("approval_mode")
        .unwrap_or_else(|_| "required".to_string());
    mode.trim().eq_ignore_ascii_case("required")
}

async fn tool_create_row(
    state: &AppState,
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
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

    if let Some(approval) = maybe_create_approval(state, context, "create_row", args).await? {
        return Ok(approval);
    }

    let mut payload = normalize_json_object(args.get("payload"), "payload")?;
    payload = sanitize_mutation_payload(payload);
    payload.insert(
        table_cfg.org_column.to_string(),
        Value::String(context.org_id.to_string()),
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
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
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

    if let Some(approval) = maybe_create_approval(state, context, "update_row", args).await? {
        return Ok(approval);
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
        .push_bind(context.org_id)
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
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
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

    if let Some(approval) = maybe_create_approval(state, context, "delete_row", args).await? {
        return Ok(approval);
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
        .push_bind(context.org_id)
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
        .push_bind(context.org_id)
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

async fn tool_delegate_to_agent(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let agent_slug = args
        .get("agent_slug")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if agent_slug.is_empty() {
        return Ok(json!({ "ok": false, "error": "agent_slug is required." }));
    }

    let message = args
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if message.is_empty() {
        return Ok(json!({ "ok": false, "error": "message is required." }));
    }

    // Look up target agent
    let pool = db_pool(state)?;
    let agent_row = sqlx::query_as::<_, (String, String, Option<String>, Option<Value>)>(
        "SELECT slug, name, system_prompt, allowed_tools FROM ai_agents WHERE slug = $1 AND is_active = true LIMIT 1"
    )
    .bind(agent_slug)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to look up delegate agent");
        AppError::Dependency("Failed to look up delegate agent.".to_string())
    })?;

    let Some((slug, name, system_prompt, allowed_tools_json)) = agent_row else {
        return Ok(
            json!({ "ok": false, "error": format!("Agent '{}' not found or inactive.", agent_slug) }),
        );
    };

    // Prevent delegation to tools that include delegate_to_agent (no chaining)
    let target_tools: Vec<String> = allowed_tools_json
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(ToOwned::to_owned))
        .filter(|t| t != "delegate_to_agent")
        .collect();

    let params = RunAiAgentChatParams {
        org_id,
        role,
        message,
        conversation: &[],
        allow_mutations,
        confirm_write,
        agent_name: &name,
        agent_prompt: system_prompt.as_deref(),
        allowed_tools: Some(&target_tools),
        agent_slug: Some(&slug),
        chat_id: None,
        requested_by_user_id: None,
        preferred_model: None,
    };

    match Box::pin(run_ai_agent_chat(state, params)).await {
        Ok(result) => {
            let reply = result
                .get("reply")
                .and_then(Value::as_str)
                .unwrap_or("No response from delegate agent.")
                .to_string();
            Ok(json!({
                "ok": true,
                "delegated_to": slug,
                "reply": reply,
            }))
        }
        Err(error) => Ok(json!({
            "ok": false,
            "error": format!("Delegation to '{}' failed: {}", slug, error.detail_message()),
        })),
    }
}

async fn tool_get_occupancy_forecast(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let months_ahead = coerce_limit(args.get("months_ahead"), 3).clamp(1, 6);
    let pool = db_pool(state)?;

    // Get total units
    let unit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid")
            .bind(org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    if unit_count == 0 {
        return Ok(json!({
            "ok": true,
            "months": [],
            "message": "No units found to forecast.",
        }));
    }

    // Get monthly reservation nights for past 12 months
    let rows = sqlx::query(
        "SELECT
            to_char(date_trunc('month', check_in_date::date), 'YYYY-MM') AS month,
            SUM(GREATEST((LEAST(check_out_date::date, (date_trunc('month', check_in_date::date) + interval '1 month')::date) - check_in_date::date), 0)) AS nights
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date::date >= (CURRENT_DATE - interval '12 months')
         GROUP BY date_trunc('month', check_in_date::date)
         ORDER BY month DESC
         LIMIT 12"
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Forecast query failed");
        AppError::Dependency("Forecast query failed.".to_string())
    })?;

    let mut monthly_occ: Vec<f64> = Vec::new();
    for row in &rows {
        let nights: i64 = row.try_get("nights").unwrap_or(0);
        let days_in_month = 30.0_f64;
        let occ = (nights as f64) / (unit_count as f64 * days_in_month);
        monthly_occ.push(occ.clamp(0.0, 1.0));
    }

    // Simple moving average for forecast
    let avg_occ = if monthly_occ.is_empty() {
        0.0
    } else {
        monthly_occ.iter().sum::<f64>() / monthly_occ.len() as f64
    };

    let today = chrono::Utc::now().date_naive();
    let mut forecast_months: Vec<Value> = Vec::new();
    for i in 1..=months_ahead {
        let future_month = today + chrono::Duration::days(i * 30);
        let month_label = future_month.format("%Y-%m").to_string();
        let predicted_units = (avg_occ * unit_count as f64).round() as i64;
        let pct = (avg_occ * 10000.0).round() / 100.0;
        forecast_months.push(json!({
            "month": month_label,
            "predicted_occupancy_pct": pct,
            "units_occupied": predicted_units,
            "total_units": unit_count,
        }));
    }

    Ok(json!({
        "ok": true,
        "historical_avg_occupancy_pct": (avg_occ * 10000.0).round() / 100.0,
        "months": forecast_months,
    }))
}

async fn tool_get_anomaly_alerts(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM anomaly_alerts t
         WHERE organization_id = $1::uuid
           AND is_dismissed = false
         ORDER BY detected_at DESC
         LIMIT 50",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Anomaly alerts query failed");
        AppError::Dependency("Anomaly alerts query failed.".to_string())
    })?;

    let alerts = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "alerts": alerts,
        "count": alerts.len(),
    }))
}

async fn tool_get_today_ops_brief(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let arrivals = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM reservations
         WHERE organization_id = $1::uuid
           AND check_in_date = current_date
           AND status IN ('confirmed', 'checked_in')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let departures = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM reservations
         WHERE organization_id = $1::uuid
           AND check_out_date = current_date
           AND status IN ('confirmed', 'checked_in')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let overdue_tasks = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM tasks
         WHERE organization_id = $1::uuid
           AND status IN ('todo', 'in_progress')
           AND due_at IS NOT NULL
           AND due_at < now()",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let open_maintenance = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM maintenance_requests
         WHERE organization_id = $1::uuid
           AND status NOT IN ('completed', 'cancelled')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    Ok(json!({
        "ok": true,
        "today": {
            "arrivals": arrivals,
            "departures": departures,
            "overdue_tasks": overdue_tasks,
            "open_maintenance_requests": open_maintenance,
        }
    }))
}

async fn tool_get_lease_risk_summary(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let expiring_30d = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status IN ('active', 'delinquent')
           AND ends_on BETWEEN current_date AND (current_date + interval '30 days')::date",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let delinquent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status = 'delinquent'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let overdue_collections = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM collection_records
         WHERE organization_id = $1::uuid
           AND due_date < current_date
           AND status IN ('scheduled', 'pending', 'late')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    Ok(json!({
        "ok": true,
        "lease_risk": {
            "expiring_in_30_days": expiring_30d,
            "delinquent_leases": delinquent,
            "overdue_collection_records": overdue_collections,
        }
    }))
}

async fn tool_get_collections_risk(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let row = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE due_date < current_date
                AND status IN ('scheduled', 'pending', 'late')
            )::bigint AS overdue_count,
            COUNT(*) FILTER (WHERE status = 'late')::bigint AS late_count,
            COALESCE(
              SUM(
                CASE
                  WHEN due_date < current_date
                    AND status IN ('scheduled', 'pending', 'late')
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS overdue_amount
         FROM collection_records
         WHERE organization_id = $1::uuid",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let overdue_count = row.try_get::<i64, _>("overdue_count").unwrap_or(0);
    let late_count = row.try_get::<i64, _>("late_count").unwrap_or(0);
    let overdue_amount = row
        .try_get::<Option<f64>, _>("overdue_amount")
        .ok()
        .flatten()
        .unwrap_or(0.0);

    Ok(json!({
        "ok": true,
        "collections_risk": {
            "overdue_count": overdue_count,
            "late_count": late_count,
            "overdue_amount": ((overdue_amount * 100.0).round() / 100.0),
        }
    }))
}

async fn tool_get_owner_statement_summary(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT status::text, COUNT(*)::bigint AS total
         FROM owner_statements
         WHERE organization_id = $1::uuid
           AND period_start <= current_date
           AND period_end >= date_trunc('month', current_date)::date
         GROUP BY status",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let mut summary = Map::new();
    let mut total = 0_i64;
    for row in rows {
        let status = row
            .try_get::<String, _>("status")
            .unwrap_or_else(|_| "unknown".to_string());
        let count = row.try_get::<i64, _>("total").unwrap_or(0);
        total += count;
        summary.insert(status, Value::from(count));
    }

    Ok(json!({
        "ok": true,
        "current_period_total": total,
        "by_status": summary,
    }))
}

async fn tool_search_knowledge(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if query.is_empty() {
        return Ok(json!({ "ok": false, "error": "query is required." }));
    }

    let limit = coerce_limit(args.get("limit"), 8).clamp(1, 20);
    let pool = db_pool(state)?;

    // Try vector similarity search first, fall back to ILIKE if embedding fails
    let embedding_result = crate::services::embeddings::embed_query(
        &state.http_client,
        &state.config,
        query,
    )
    .await;

    let rows = if let Ok(query_embedding) = embedding_result {
        sqlx::query(
            "SELECT
                kc.id::text AS id,
                kc.document_id::text AS document_id,
                kc.chunk_index,
                kc.content,
                kc.metadata,
                kd.title,
                kd.source_url,
                1 - (kc.embedding <=> $2::vector) AS similarity
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kd.id = kc.document_id
             WHERE kc.organization_id = $1::uuid
               AND kd.organization_id = $1::uuid
               AND kc.embedding IS NOT NULL
             ORDER BY kc.embedding <=> $2::vector
             LIMIT $3",
        )
        .bind(org_id)
        .bind(&query_embedding)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?
    } else {
        // Fallback to ILIKE text search for chunks without embeddings
        let pattern = format!("%{}%", query.replace(['%', '_'], ""));
        sqlx::query(
            "SELECT
                kc.id::text AS id,
                kc.document_id::text AS document_id,
                kc.chunk_index,
                kc.content,
                kc.metadata,
                kd.title,
                kd.source_url,
                0.0::float8 AS similarity
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kd.id = kc.document_id
             WHERE kc.organization_id = $1::uuid
               AND kd.organization_id = $1::uuid
               AND kc.content ILIKE $2
             ORDER BY kc.updated_at DESC, kc.created_at DESC
             LIMIT $3",
        )
        .bind(org_id)
        .bind(pattern)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?
    };

    let mut hits = Vec::with_capacity(rows.len());
    for row in rows {
        hits.push(json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
            "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "source_url": row.try_get::<Option<String>, _>("source_url").ok().flatten(),
            "content": row.try_get::<String, _>("content").unwrap_or_default(),
            "similarity": row.try_get::<f64, _>("similarity").unwrap_or(0.0),
            "metadata": row
                .try_get::<Option<Value>, _>("metadata")
                .ok()
                .flatten()
                .unwrap_or_else(|| Value::Object(Map::new())),
        }));
    }

    Ok(json!({
        "ok": true,
        "query": query,
        "count": hits.len(),
        "hits": hits,
    }))
}

// ---------------------------------------------------------------------------
// Tool: send_message — queue an outbound message (WhatsApp/email/SMS)
// ---------------------------------------------------------------------------

async fn tool_send_message(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let channel = args
        .get("channel")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("whatsapp");
    let recipient = args
        .get("recipient")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let body = args
        .get("body")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if recipient.is_empty() || body.is_empty() {
        return Ok(json!({ "ok": false, "error": "recipient and body are required." }));
    }
    if !matches!(channel, "whatsapp" | "email" | "sms") {
        return Ok(json!({ "ok": false, "error": "channel must be whatsapp, email, or sms." }));
    }

    let pool = db_pool(state)?;
    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String(channel.to_string()));
    msg.insert(
        "recipient".to_string(),
        Value::String(recipient.to_string()),
    );
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );

    let mut payload = Map::new();
    payload.insert("body".to_string(), Value::String(body.to_string()));
    payload.insert("ai_generated".to_string(), Value::Bool(true));
    if let Some(guest_id) = args.get("guest_id").and_then(Value::as_str) {
        payload.insert(
            "guest_id".to_string(),
            Value::String(guest_id.to_string()),
        );
    }
    msg.insert("payload".to_string(), Value::Object(payload));

    let created = create_row(pool, "message_logs", &msg).await?;
    let msg_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "message_id": msg_id,
        "status": "queued",
        "channel": channel,
        "recipient": recipient,
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_staff_availability — task load per assignable staff member
// ---------------------------------------------------------------------------

async fn tool_get_staff_availability(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT
            u.id::text AS user_id,
            u.full_name,
            u.email,
            om.role,
            COALESCE(open_tasks.count, 0) AS open_task_count
         FROM organization_members om
         JOIN app_users u ON u.id = om.user_id
         LEFT JOIN (
            SELECT assigned_to_user_id, COUNT(*)::int AS count
            FROM tasks
            WHERE organization_id = $1::uuid
              AND status IN ('todo', 'in_progress')
            GROUP BY assigned_to_user_id
         ) open_tasks ON open_tasks.assigned_to_user_id = om.user_id
         WHERE om.organization_id = $1::uuid
           AND om.role IN ('operator', 'owner_admin')
         ORDER BY open_task_count ASC, u.full_name ASC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let mut staff = Vec::with_capacity(rows.len());
    for row in &rows {
        staff.push(json!({
            "user_id": row.try_get::<String, _>("user_id").unwrap_or_default(),
            "full_name": row.try_get::<String, _>("full_name").unwrap_or_default(),
            "email": row.try_get::<String, _>("email").unwrap_or_default(),
            "role": row.try_get::<String, _>("role").unwrap_or_default(),
            "open_task_count": row.try_get::<i32, _>("open_task_count").unwrap_or(0),
        }));
    }

    Ok(json!({
        "ok": true,
        "staff": staff,
        "count": staff.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: create_maintenance_task — create a task from a maintenance request
// ---------------------------------------------------------------------------

async fn tool_create_maintenance_task(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let priority = args
        .get("priority")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("medium");

    if title.is_empty() {
        return Ok(json!({ "ok": false, "error": "title is required." }));
    }

    let pool = db_pool(state)?;

    let mut task = Map::new();
    task.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    task.insert("title".to_string(), Value::String(title.to_string()));
    task.insert(
        "description".to_string(),
        Value::String(description.to_string()),
    );
    task.insert("priority".to_string(), Value::String(priority.to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert("category".to_string(), Value::String("maintenance".to_string()));

    if let Some(assigned) = args.get("assigned_to_user_id").and_then(Value::as_str) {
        task.insert(
            "assigned_to_user_id".to_string(),
            Value::String(assigned.to_string()),
        );
    }
    if let Some(unit_id) = args.get("unit_id").and_then(Value::as_str) {
        task.insert("unit_id".to_string(), Value::String(unit_id.to_string()));
    }
    if let Some(mr_id) = args.get("maintenance_request_id").and_then(Value::as_str) {
        task.insert(
            "maintenance_request_id".to_string(),
            Value::String(mr_id.to_string()),
        );
    }

    let created = create_row(pool, "tasks", &task).await?;
    let task_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Create checklist items if provided
    if let Some(checklist) = args.get("checklist").and_then(Value::as_array) {
        for (index, item) in checklist.iter().enumerate() {
            if let Some(text) = item.as_str() {
                let mut ci = Map::new();
                ci.insert(
                    "organization_id".to_string(),
                    Value::String(org_id.to_string()),
                );
                ci.insert(
                    "task_id".to_string(),
                    Value::String(task_id.to_string()),
                );
                ci.insert("title".to_string(), Value::String(text.to_string()));
                ci.insert("sort_order".to_string(), json!(index as i32));
                ci.insert("is_done".to_string(), Value::Bool(false));
                let _ = create_row(pool, "task_items", &ci).await;
            }
        }
    }

    // Update maintenance request status to in_progress if linked
    if let Some(mr_id) = args.get("maintenance_request_id").and_then(Value::as_str) {
        sqlx::query(
            "UPDATE maintenance_requests SET status = 'in_progress', updated_at = now()
             WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'open'",
        )
        .bind(mr_id)
        .bind(org_id)
        .execute(pool)
        .await
        .ok();
    }

    Ok(json!({
        "ok": true,
        "task_id": task_id,
        "title": title,
        "priority": priority,
        "status": "todo",
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_revenue_analytics — RevPAN, ADR, occupancy for pricing agent
// ---------------------------------------------------------------------------

async fn tool_get_revenue_analytics(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let days = args
        .get("days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 365);

    let unit_id = args.get("unit_id").and_then(Value::as_str);

    // Revenue and booking metrics
    let revenue_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               COUNT(*)::bigint AS total_reservations,
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(AVG(nightly_rate), 0)::float8 AS avg_daily_rate,
               COALESCE(SUM(platform_fee), 0)::float8 AS total_platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS total_cleaning_fees,
               COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS total_room_nights
             FROM reservations
             WHERE organization_id = $1::uuid
               AND unit_id = $2::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= current_date - ($3::int || ' days')::interval",
        )
        .bind(org_id)
        .bind(uid)
        .bind(days as i32)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               COUNT(*)::bigint AS total_reservations,
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(AVG(nightly_rate), 0)::float8 AS avg_daily_rate,
               COALESCE(SUM(platform_fee), 0)::float8 AS total_platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS total_cleaning_fees,
               COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS total_room_nights
             FROM reservations
             WHERE organization_id = $1::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= current_date - ($2::int || ' days')::interval",
        )
        .bind(org_id)
        .bind(days as i32)
        .fetch_one(pool)
        .await
    };

    let row = revenue_query.map_err(|e| supabase_error(state, &e))?;
    let total_reservations = row.try_get::<i64, _>("total_reservations").unwrap_or(0);
    let gross_revenue = row.try_get::<f64, _>("gross_revenue").unwrap_or(0.0);
    let avg_daily_rate = row.try_get::<f64, _>("avg_daily_rate").unwrap_or(0.0);
    let total_room_nights = row.try_get::<i64, _>("total_room_nights").unwrap_or(0);

    // Count available units for occupancy calculation
    let unit_count_row = sqlx::query(
        "SELECT COUNT(*)::bigint AS cnt FROM units WHERE organization_id = $1::uuid AND is_active = true",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let active_units = unit_count_row.try_get::<i64, _>("cnt").unwrap_or(1).max(1);
    let available_nights = active_units * days;
    let occupancy_rate = if available_nights > 0 {
        (total_room_nights as f64 / available_nights as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    let rev_pan = if available_nights > 0 {
        gross_revenue / available_nights as f64
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "period_days": days,
        "total_reservations": total_reservations,
        "gross_revenue": (gross_revenue * 100.0).round() / 100.0,
        "avg_daily_rate": (avg_daily_rate * 100.0).round() / 100.0,
        "total_room_nights": total_room_nights,
        "active_units": active_units,
        "available_nights": available_nights,
        "occupancy_rate_pct": (occupancy_rate * 100.0).round() / 100.0,
        "rev_pan": (rev_pan * 100.0).round() / 100.0,
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_seasonal_demand — historical booking patterns for pricing agent
// ---------------------------------------------------------------------------

async fn tool_get_seasonal_demand(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let months_back = args
        .get("months_back")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(3, 24);

    let rows = sqlx::query(
        "SELECT
           date_trunc('month', check_in_date)::date AS month,
           COUNT(*)::bigint AS bookings,
           COALESCE(SUM(total_amount), 0)::float8 AS revenue,
           COALESCE(AVG(nightly_rate), 0)::float8 AS avg_rate,
           COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS room_nights
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= (current_date - ($2::int || ' months')::interval)::date
         GROUP BY 1
         ORDER BY 1",
    )
    .bind(org_id)
    .bind(months_back as i32)
    .fetch_all(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let months: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "month": r.try_get::<chrono::NaiveDate, _>("month")
                    .map(|d| d.to_string())
                    .unwrap_or_default(),
                "bookings": r.try_get::<i64, _>("bookings").unwrap_or(0),
                "revenue": r.try_get::<f64, _>("revenue").unwrap_or(0.0),
                "avg_rate": r.try_get::<f64, _>("avg_rate").unwrap_or(0.0),
                "room_nights": r.try_get::<i64, _>("room_nights").unwrap_or(0),
            })
        })
        .collect();

    // Identify peak and low months
    let peak_month = months
        .iter()
        .max_by(|a, b| {
            let a_rn = a.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            let b_rn = b.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            a_rn.cmp(&b_rn)
        })
        .and_then(|v| v.get("month").and_then(Value::as_str))
        .unwrap_or("N/A");

    let low_month = months
        .iter()
        .filter(|v| v.get("bookings").and_then(Value::as_i64).unwrap_or(0) > 0)
        .min_by(|a, b| {
            let a_rn = a.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            let b_rn = b.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            a_rn.cmp(&b_rn)
        })
        .and_then(|v| v.get("month").and_then(Value::as_str))
        .unwrap_or("N/A");

    Ok(json!({
        "ok": true,
        "months_analyzed": months.len(),
        "peak_month": peak_month,
        "low_month": low_month,
        "monthly_data": months,
    }))
}

// ---------------------------------------------------------------------------
// Tool: generate_owner_statement — draft monthly statement for finance agent
// ---------------------------------------------------------------------------

async fn tool_generate_owner_statement(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let period_start = args
        .get("period_start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let period_end = args
        .get("period_end")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if period_start.is_empty() || period_end.is_empty() {
        return Ok(json!({ "ok": false, "error": "period_start and period_end (YYYY-MM-DD) are required." }));
    }

    let unit_id = args.get("unit_id").and_then(Value::as_str);
    let currency = args
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("USD");

    // Reservation revenue for period
    let rev_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(SUM(platform_fee), 0)::float8 AS platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS cleaning_fees,
               COALESCE(SUM(tax_amount), 0)::float8 AS taxes_collected,
               COUNT(*)::bigint AS reservation_count
             FROM reservations
             WHERE organization_id = $1::uuid
               AND unit_id = $4::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= $2::date
               AND check_in_date < $3::date",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(uid)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(SUM(platform_fee), 0)::float8 AS platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS cleaning_fees,
               COALESCE(SUM(tax_amount), 0)::float8 AS taxes_collected,
               COUNT(*)::bigint AS reservation_count
             FROM reservations
             WHERE organization_id = $1::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= $2::date
               AND check_in_date < $3::date",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_one(pool)
        .await
    };

    let rev_row = rev_query.map_err(|e| supabase_error(state, &e))?;
    let gross_revenue = rev_row.try_get::<f64, _>("gross_revenue").unwrap_or(0.0);
    let platform_fees = rev_row.try_get::<f64, _>("platform_fees").unwrap_or(0.0);
    let cleaning_fees = rev_row.try_get::<f64, _>("cleaning_fees").unwrap_or(0.0);
    let taxes_collected = rev_row.try_get::<f64, _>("taxes_collected").unwrap_or(0.0);
    let reservation_count = rev_row.try_get::<i64, _>("reservation_count").unwrap_or(0);

    // Expenses for period
    let exp_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               category::text,
               COALESCE(SUM(amount), 0)::float8 AS total,
               COUNT(*)::bigint AS cnt
             FROM expenses
             WHERE organization_id = $1::uuid
               AND unit_id = $4::uuid
               AND expense_date >= $2::date
               AND expense_date < $3::date
               AND approval_status != 'rejected'
             GROUP BY category",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(uid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               category::text,
               COALESCE(SUM(amount), 0)::float8 AS total,
               COUNT(*)::bigint AS cnt
             FROM expenses
             WHERE organization_id = $1::uuid
               AND expense_date >= $2::date
               AND expense_date < $3::date
               AND approval_status != 'rejected'
             GROUP BY category",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_all(pool)
        .await
    };

    let exp_rows = exp_query.map_err(|e| supabase_error(state, &e))?;
    let mut expense_breakdown = Map::new();
    let mut total_expenses = 0.0_f64;
    for row in &exp_rows {
        let cat = row
            .try_get::<String, _>("category")
            .unwrap_or_else(|_| "other".to_string());
        let amt = row.try_get::<f64, _>("total").unwrap_or(0.0);
        total_expenses += amt;
        expense_breakdown.insert(cat, json!(amt));
    }

    // Compute IVA (10% on service/management fees)
    let management_fee = gross_revenue * 0.15; // 15% default management fee
    let iva_rate = 10.0;
    let iva_amount = management_fee * iva_rate / 100.0;

    let net_payout = gross_revenue - platform_fees - total_expenses - management_fee - iva_amount;

    // Insert draft statement
    let insert_result = sqlx::query(
        "INSERT INTO owner_statements (
           organization_id, unit_id, period_start, period_end, currency,
           gross_revenue, platform_fees, operating_expenses, taxes_collected,
           service_fees, net_payout, status, iva_rate, iva_amount, tax_summary
         ) VALUES (
           $1::uuid, $2, $3::date, $4::date, $5,
           $6, $7, $8, $9,
           $10, $11, 'draft', $12, $13, $14::jsonb
         ) RETURNING id",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(period_start)
    .bind(period_end)
    .bind(currency)
    .bind(gross_revenue)
    .bind(platform_fees)
    .bind(total_expenses)
    .bind(taxes_collected)
    .bind(management_fee)
    .bind(net_payout)
    .bind(iva_rate)
    .bind(iva_amount)
    .bind(json!({
        "management_fee": management_fee,
        "iva_rate_pct": iva_rate,
        "iva_on_management": iva_amount,
    }))
    .fetch_one(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let statement_id = insert_result
        .try_get::<sqlx::types::Uuid, _>("id")
        .map(|u| u.to_string())
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "statement_id": statement_id,
        "period": format!("{} to {}", period_start, period_end),
        "reservation_count": reservation_count,
        "gross_revenue": (gross_revenue * 100.0).round() / 100.0,
        "platform_fees": (platform_fees * 100.0).round() / 100.0,
        "cleaning_fees": (cleaning_fees * 100.0).round() / 100.0,
        "total_expenses": (total_expenses * 100.0).round() / 100.0,
        "expense_breakdown": expense_breakdown,
        "management_fee": (management_fee * 100.0).round() / 100.0,
        "iva_amount": (iva_amount * 100.0).round() / 100.0,
        "taxes_collected": (taxes_collected * 100.0).round() / 100.0,
        "net_payout": (net_payout * 100.0).round() / 100.0,
        "currency": currency,
        "status": "draft",
    }))
}

// ---------------------------------------------------------------------------
// Tool: reconcile_collections — match payments vs expected for finance agent
// ---------------------------------------------------------------------------

async fn tool_reconcile_collections(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let period_start = args
        .get("period_start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let period_end = args
        .get("period_end")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if period_start.is_empty() || period_end.is_empty() {
        return Ok(json!({ "ok": false, "error": "period_start and period_end (YYYY-MM-DD) are required." }));
    }

    // Reservation-based expected vs collected
    let res_row = sqlx::query(
        "SELECT
           COUNT(*)::bigint AS total_reservations,
           COALESCE(SUM(total_amount), 0)::float8 AS expected_total,
           COALESCE(SUM(amount_paid), 0)::float8 AS collected_total
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= $2::date
           AND check_in_date < $3::date",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let expected_total = res_row.try_get::<f64, _>("expected_total").unwrap_or(0.0);
    let collected_total = res_row.try_get::<f64, _>("collected_total").unwrap_or(0.0);
    let total_reservations = res_row.try_get::<i64, _>("total_reservations").unwrap_or(0);
    let shortfall = expected_total - collected_total;

    // Collection records status breakdown (lease collections)
    let coll_rows = sqlx::query(
        "SELECT
           status::text,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(amount), 0)::float8 AS total
         FROM collection_records
         WHERE organization_id = $1::uuid
           AND due_date >= $2::date
           AND due_date < $3::date
         GROUP BY status",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let mut collection_status = Map::new();
    for row in &coll_rows {
        let status = row
            .try_get::<String, _>("status")
            .unwrap_or_else(|_| "unknown".to_string());
        let cnt = row.try_get::<i64, _>("cnt").unwrap_or(0);
        let total = row.try_get::<f64, _>("total").unwrap_or(0.0);
        collection_status.insert(
            status,
            json!({ "count": cnt, "amount": (total * 100.0).round() / 100.0 }),
        );
    }

    // Flag unpaid reservations
    let unpaid_rows = sqlx::query(
        "SELECT id, check_in_date::text, total_amount::float8, amount_paid::float8,
                (total_amount - amount_paid)::float8 AS outstanding
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= $2::date
           AND check_in_date < $3::date
           AND amount_paid < total_amount
         ORDER BY (total_amount - amount_paid) DESC
         LIMIT 20",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let discrepancies: Vec<Value> = unpaid_rows
        .iter()
        .map(|r| {
            json!({
                "reservation_id": r.try_get::<sqlx::types::Uuid, _>("id")
                    .map(|u| u.to_string()).unwrap_or_default(),
                "check_in_date": r.try_get::<String, _>("check_in_date").unwrap_or_default(),
                "total_amount": r.try_get::<f64, _>("total_amount").unwrap_or(0.0),
                "amount_paid": r.try_get::<f64, _>("amount_paid").unwrap_or(0.0),
                "outstanding": r.try_get::<f64, _>("outstanding").unwrap_or(0.0),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "period": format!("{} to {}", period_start, period_end),
        "reservations": {
            "total": total_reservations,
            "expected": (expected_total * 100.0).round() / 100.0,
            "collected": (collected_total * 100.0).round() / 100.0,
            "shortfall": (shortfall * 100.0).round() / 100.0,
        },
        "lease_collections": collection_status,
        "discrepancies": discrepancies,
        "discrepancy_count": discrepancies.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: categorize_expense — classify expense into PMS categories
// ---------------------------------------------------------------------------

async fn tool_categorize_expense(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let expense_id = args
        .get("expense_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let category = args
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if expense_id.is_empty() || category.is_empty() {
        return Ok(json!({ "ok": false, "error": "expense_id and category are required." }));
    }

    let valid_categories = [
        "maintenance",
        "cleaning",
        "utilities",
        "insurance",
        "taxes",
        "management_fee",
        "supplies",
        "marketing",
        "professional_services",
        "other",
    ];

    if !valid_categories.contains(&category) {
        return Ok(json!({
            "ok": false,
            "error": format!("Invalid category. Must be one of: {}", valid_categories.join(", ")),
        }));
    }

    let result = sqlx::query(
        "UPDATE expenses SET category = $3::expense_category, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid
         RETURNING id, category::text, amount::float8, vendor_name, expense_date::text",
    )
    .bind(expense_id)
    .bind(org_id)
    .bind(category)
    .fetch_optional(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    match result {
        Some(row) => Ok(json!({
            "ok": true,
            "expense_id": row.try_get::<sqlx::types::Uuid, _>("id")
                .map(|u| u.to_string()).unwrap_or_default(),
            "category": row.try_get::<String, _>("category").unwrap_or_default(),
            "amount": row.try_get::<f64, _>("amount").unwrap_or(0.0),
            "vendor_name": row.try_get::<Option<String>, _>("vendor_name").unwrap_or(None),
            "expense_date": row.try_get::<String, _>("expense_date").unwrap_or_default(),
        })),
        None => Ok(json!({ "ok": false, "error": "Expense not found." })),
    }
}

// ---------------------------------------------------------------------------
// Tool: recall_memory — retrieve stored memories for context
// ---------------------------------------------------------------------------

async fn tool_recall_memory(
    state: &AppState,
    org_id: &str,
    agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let query_text = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let entity_id = args.get("entity_id").and_then(Value::as_str);
    let context_type = args.get("context_type").and_then(Value::as_str);
    let limit = coerce_limit(args.get("limit"), 10).clamp(1, 20);

    let slug = agent_slug.unwrap_or("supervisor");

    let rows = if let Some(eid) = entity_id {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND entity_id = $4
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $5",
        )
        .bind(org_id)
        .bind(slug)
        .bind(query_text)
        .bind(eid)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if !query_text.is_empty() {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND (memory_key ILIKE '%' || $2 || '%' OR memory_value ILIKE '%' || $2 || '%')
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $3",
        )
        .bind(org_id)
        .bind(query_text)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if let Some(ct) = context_type {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND context_type = $2
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $3",
        )
        .bind(org_id)
        .bind(ct)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $2",
        )
        .bind(org_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    };

    let rows = rows.map_err(|e| supabase_error(state, &e))?;

    let memories: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "key": r.try_get::<String, _>("memory_key").unwrap_or_default(),
                "value": r.try_get::<String, _>("memory_value").unwrap_or_default(),
                "context_type": r.try_get::<String, _>("context_type").unwrap_or_default(),
                "entity_id": r.try_get::<Option<String>, _>("entity_id").unwrap_or(None),
                "confidence": r.try_get::<f64, _>("confidence").unwrap_or(0.0),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "memories": memories,
        "count": memories.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: store_memory — persist a key fact for future reference
// ---------------------------------------------------------------------------

async fn tool_store_memory(
    state: &AppState,
    org_id: &str,
    agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let memory_key = args
        .get("memory_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let memory_value = args
        .get("memory_value")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if memory_key.is_empty() || memory_value.is_empty() {
        return Ok(json!({ "ok": false, "error": "memory_key and memory_value are required." }));
    }

    let context_type = args
        .get("context_type")
        .and_then(Value::as_str)
        .unwrap_or("general");
    let entity_id = args.get("entity_id").and_then(Value::as_str);
    let expires_days = args
        .get("expires_days")
        .and_then(Value::as_i64)
        .unwrap_or(90)
        .clamp(1, 365);

    let slug = agent_slug.unwrap_or("supervisor");

    // Upsert: update if same key+agent exists, insert otherwise
    let result = sqlx::query(
        "INSERT INTO agent_memory (organization_id, agent_slug, memory_key, memory_value, context_type, entity_id, expires_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now() + ($7::int || ' days')::interval)
         ON CONFLICT (organization_id, agent_slug, memory_key)
            WHERE false  -- no unique constraint yet, so always insert
         DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = now()
         RETURNING id",
    )
    .bind(org_id)
    .bind(slug)
    .bind(memory_key)
    .bind(memory_value)
    .bind(context_type)
    .bind(entity_id)
    .bind(expires_days as i32)
    .fetch_one(pool)
    .await
    .map_err(|e| supabase_error(state, &e))?;

    let memory_id = result
        .try_get::<sqlx::types::Uuid, _>("id")
        .map(|u| u.to_string())
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "memory_id": memory_id,
        "key": memory_key,
        "expires_days": expires_days,
    }))
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
        "audit_logs" | "agent_approvals" | "agent_approval_policies" | "anomaly_alerts" => {
            TableConfig {
                org_column: "organization_id",
                can_create: false,
                can_update: false,
                can_delete: false,
            }
        }
        "knowledge_documents" | "knowledge_chunks" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "escrow_events" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "maintenance_requests" => TableConfig {
            org_column: "organization_id",
            can_create: true,
            can_update: true,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::Value;

    use super::{
        run_ai_agent_chat_streaming, AgentStreamEvent, RunAiAgentChatParams,
        AI_AGENT_DISABLED_MESSAGE,
    };
    use crate::{
        config::AppConfig,
        state::{AppState, OrgMembershipCache, PublicListingsCache, ReportResponseCache},
    };

    fn disabled_ai_state() -> AppState {
        let mut config = AppConfig::from_env();
        config.ai_agent_enabled = false;

        AppState {
            config: Arc::new(config),
            db_pool: None,
            http_client: reqwest::Client::new(),
            jwks_cache: None,
            org_membership_cache: OrgMembershipCache::new(30, 1000),
            public_listings_cache: PublicListingsCache::new(15, 500),
            report_response_cache: ReportResponseCache::new(20, 500),
        }
    }

    #[tokio::test]
    async fn streaming_disabled_emits_error_then_done_and_returns_payload() {
        let state = disabled_ai_state();
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        let params = RunAiAgentChatParams {
            org_id: "11111111-1111-1111-1111-111111111111",
            role: "viewer",
            message: "health check",
            conversation: &[],
            allow_mutations: false,
            confirm_write: false,
            agent_name: "Operations Copilot",
            agent_prompt: None,
            allowed_tools: None,
            agent_slug: None,
            chat_id: None,
            requested_by_user_id: None,
            preferred_model: None,
        };

        let payload = run_ai_agent_chat_streaming(&state, params, tx)
            .await
            .expect("disabled stream should return a fallback payload");

        match rx.recv().await {
            Some(AgentStreamEvent::Error { message }) => {
                assert_eq!(message, AI_AGENT_DISABLED_MESSAGE);
            }
            other => panic!("expected error event first, got {:?}", other),
        }

        match rx.recv().await {
            Some(AgentStreamEvent::Done {
                content,
                tool_trace,
                model_used,
                fallback_used,
            }) => {
                assert_eq!(content, AI_AGENT_DISABLED_MESSAGE);
                assert!(tool_trace.is_empty());
                assert!(model_used.is_none());
                assert!(!fallback_used);
            }
            other => panic!("expected done event second, got {:?}", other),
        }

        assert!(rx.recv().await.is_none());
        assert_eq!(
            payload.get("reply").and_then(Value::as_str),
            Some(AI_AGENT_DISABLED_MESSAGE)
        );
        assert_eq!(
            payload
                .get("tool_trace")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        assert_eq!(
            payload.get("mutations_enabled").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(payload.get("model_used"), Some(&Value::Null));
        assert_eq!(
            payload.get("fallback_used").and_then(Value::as_bool),
            Some(false)
        );
    }
}
