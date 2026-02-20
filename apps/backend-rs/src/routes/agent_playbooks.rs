use axum::{extract::State, http::HeaderMap, Json};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    services::{
        ai_agent::{run_ai_agent_chat, RunAiAgentChatParams},
        notification_center::{emit_event, EmitNotificationEventInput},
    },
    state::AppState,
};

#[derive(Debug, Clone, Deserialize)]
struct RunAgentPlaybookInput {
    org_id: String,
    message: String,
    #[serde(default)]
    playbook_name: Option<String>,
    #[serde(default)]
    agent_slug: Option<String>,
    #[serde(default)]
    allow_mutations: Option<bool>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route(
        "/internal/agent-playbooks/run",
        axum::routing::post(run_agent_playbook),
    )
}

async fn run_agent_playbook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RunAgentPlaybookInput>,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    validate_internal_api_key(
        state.config.is_production(),
        state.config.internal_api_key.as_deref(),
        api_key,
    )?;

    let org_id = payload.org_id.trim();
    let message = payload.message.trim();
    if org_id.is_empty() || message.is_empty() {
        return Err(AppError::BadRequest(
            "org_id and message are required.".to_string(),
        ));
    }

    let (agent_slug, agent_name, agent_prompt, allowed_tools) =
        resolve_agent_profile(&state, payload.agent_slug.as_deref()).await?;

    let result = run_ai_agent_chat(
        &state,
        RunAiAgentChatParams {
            org_id,
            role: "owner_admin",
            message,
            conversation: &[],
            allow_mutations: payload.allow_mutations.unwrap_or(false),
            confirm_write: false,
            agent_name: &agent_name,
            agent_prompt: agent_prompt.as_deref(),
            allowed_tools: allowed_tools.as_deref(),
            agent_slug: Some(&agent_slug),
            chat_id: None,
            requested_by_user_id: None,
        },
    )
    .await?;

    if let Some(pool) = state.db_pool.as_ref() {
        let mut event_payload = Map::new();
        event_payload.insert("agent_slug".to_string(), Value::String(agent_slug.clone()));
        if let Some(name) = payload.playbook_name.as_deref() {
            event_payload.insert(
                "playbook_name".to_string(),
                Value::String(name.trim().to_string()),
            );
        }

        let title = payload
            .playbook_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("Playbook completed: {}", value))
            .unwrap_or_else(|| "Playbook completed".to_string());

        let body = result
            .get("reply")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Agent playbook execution finished.".to_string());

        let _ = emit_event(
            pool,
            EmitNotificationEventInput {
                organization_id: org_id.to_string(),
                event_type: "agent_playbook_ready".to_string(),
                category: "operations".to_string(),
                severity: "info".to_string(),
                title,
                body,
                link_path: Some("/app/chats".to_string()),
                source_table: None,
                source_id: None,
                actor_user_id: None,
                payload: event_payload,
                dedupe_key: None,
                occurred_at: None,
                fallback_roles: vec![],
            },
        )
        .await;
    }

    Ok(Json(json!({
        "ok": true,
        "organization_id": org_id,
        "agent_slug": agent_slug,
        "result": result,
    })))
}

async fn resolve_agent_profile(
    state: &AppState,
    preferred_slug: Option<&str>,
) -> AppResult<(String, String, Option<String>, Option<Vec<String>>)> {
    let requested_slug = preferred_slug
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("morning-brief");

    let Some(pool) = state.db_pool.as_ref() else {
        return Ok((
            requested_slug.to_string(),
            "Operations Copilot".to_string(),
            None,
            None,
        ));
    };

    let row = sqlx::query(
        "SELECT slug, name, system_prompt, allowed_tools
         FROM ai_agents
         WHERE slug = $1
           AND is_active = TRUE
         LIMIT 1",
    )
    .bind(requested_slug)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to resolve playbook agent profile");
        AppError::Dependency("Failed to resolve playbook agent profile.".to_string())
    })?;

    let Some(row) = row else {
        return Ok((
            requested_slug.to_string(),
            "Operations Copilot".to_string(),
            None,
            None,
        ));
    };

    let slug = row
        .try_get::<String, _>("slug")
        .unwrap_or_else(|_| requested_slug.to_string());
    let name = row
        .try_get::<String, _>("name")
        .unwrap_or_else(|_| "Operations Copilot".to_string());
    let prompt = row
        .try_get::<Option<String>, _>("system_prompt")
        .ok()
        .flatten();
    let allowed_tools = row
        .try_get::<Option<Value>, _>("allowed_tools")
        .ok()
        .flatten()
        .and_then(|value| value.as_array().cloned())
        .map(|items| {
            items
                .into_iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        });

    Ok((slug, name, prompt, allowed_tools))
}

fn validate_internal_api_key(
    is_production: bool,
    expected_key: Option<&str>,
    provided_key: &str,
) -> AppResult<()> {
    let expected = expected_key.map(str::trim).unwrap_or_default();

    if is_production && expected.is_empty() {
        return Err(AppError::Dependency(
            "INTERNAL_API_KEY must be set in production to run agent playbooks.".to_string(),
        ));
    }

    if !expected.is_empty() && provided_key != expected {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    Ok(())
}
