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
    let pattern = format!("%{}%", query.replace(['%', '_'], ""));

    let rows = sqlx::query(
        "SELECT
            kc.id::text AS id,
            kc.document_id::text AS document_id,
            kc.chunk_index,
            kc.content,
            kc.metadata,
            kd.title,
            kd.source_url
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
    .map_err(|error| supabase_error(state, &error))?;

    let mut hits = Vec::with_capacity(rows.len());
    for row in rows {
        hits.push(json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
            "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "source_url": row.try_get::<Option<String>, _>("source_url").ok().flatten(),
            "content": row.try_get::<String, _>("content").unwrap_or_default(),
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
