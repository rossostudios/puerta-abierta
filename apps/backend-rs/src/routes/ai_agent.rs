use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{
    auth::require_user_id,
    error::AppResult,
    services::{
        ai_agent::{
            agent_capabilities, run_ai_agent_chat, AgentConversationMessage, RunAiAgentChatParams,
        },
        audit::write_audit_log,
    },
    state::AppState,
    tenancy::assert_org_member,
};

#[derive(Debug, Clone, Deserialize)]
struct AgentCapabilitiesQuery {
    org_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentConversationInput {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentChatInput {
    org_id: String,
    message: String,
    #[serde(default)]
    conversation: Vec<AgentConversationInput>,
    #[serde(default)]
    allow_mutations: bool,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/agent/capabilities",
            axum::routing::get(get_agent_capabilities),
        )
        .route("/agent/chat", axum::routing::post(ai_agent_chat))
}

async fn get_agent_capabilities(
    State(state): State<AppState>,
    Query(query): Query<AgentCapabilitiesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    let role = membership
        .as_object()
        .and_then(|obj| obj.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("viewer")
        .to_string();

    let capabilities = agent_capabilities(&role, false);
    let mut payload = Map::new();
    payload.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    payload.extend(capabilities);

    Ok(Json(Value::Object(payload)))
}

async fn ai_agent_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AgentChatInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &payload.org_id).await?;
    let role = membership
        .as_object()
        .and_then(|obj| obj.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("viewer")
        .to_string();

    let conversation = payload
        .conversation
        .iter()
        .map(|item| AgentConversationMessage {
            role: item.role.clone(),
            content: item.content.clone(),
        })
        .collect::<Vec<_>>();

    let result = run_ai_agent_chat(
        &state,
        RunAiAgentChatParams {
            org_id: &payload.org_id,
            role: &role,
            message: &payload.message,
            conversation: &conversation,
            allow_mutations: payload.allow_mutations,
            confirm_write: false,
            agent_name: "Operations Copilot",
            agent_prompt: None,
            allowed_tools: None,
            agent_slug: None,
            chat_id: None,
            requested_by_user_id: Some(&user_id),
            preferred_model: None,
        },
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.org_id),
        Some(&user_id),
        "agent.chat",
        "ai_agent",
        None,
        None,
        Some(serde_json::json!({
            "role": role,
            "allow_mutations": payload.allow_mutations,
            "tool_trace_count": tool_trace_count(&result),
        })),
    )
    .await;

    // Record usage event for metering
    if let Some(pool) = state.db_pool.as_ref() {
        crate::services::metering::record_usage_event(pool, &payload.org_id, "agent_call", 1).await;
    }

    let mut response = Map::new();
    response.insert(
        "organization_id".to_string(),
        Value::String(payload.org_id.clone()),
    );
    response.insert("role".to_string(), Value::String(role));
    response.extend(result);

    Ok(Json(Value::Object(response)))
}

fn tool_trace_count(result: &Map<String, Value>) -> usize {
    result
        .get("tool_trace")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}
