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
        ai_agent::{execute_tool, tool_definitions, ToolContext},
        audit::write_audit_log,
    },
    state::AppState,
    tenancy::assert_org_member,
};

#[derive(Debug, Clone, Deserialize)]
struct AgentOrgQuery {
    org_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ToolDefinitionsQuery {
    org_id: String,
    #[serde(default)]
    agent_slug: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ExecuteToolInput {
    org_id: String,
    tool_name: String,
    #[serde(default)]
    args: Map<String, Value>,
    #[serde(default)]
    allow_mutations: Option<bool>,
    #[serde(default)]
    confirm_write: Option<bool>,
    #[serde(default)]
    agent_slug: Option<String>,
    #[serde(default)]
    chat_id: Option<String>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/agent/tool-definitions",
            axum::routing::get(get_tool_definitions),
        )
        .route(
            "/agent/execute-tool",
            axum::routing::post(post_execute_tool),
        )
}

/// GET /v1/agent/tool-definitions
/// Returns available tools as AI SDK 6 compatible JSON schema.
/// Optionally filters by agent slug to return only allowed tools.
async fn get_tool_definitions(
    State(state): State<AppState>,
    Query(query): Query<ToolDefinitionsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    // If agent_slug provided, look up its allowed_tools from the database
    let allowed_tools = if let Some(slug) = &query.agent_slug {
        fetch_agent_allowed_tools(&state, &query.org_id, slug).await
    } else {
        None
    };

    let definitions = tool_definitions(allowed_tools.as_deref());

    // Convert OpenAI function calling format to AI SDK 6 tool format
    let sdk_tools: Vec<Value> = definitions
        .into_iter()
        .filter_map(|def| {
            let obj = def.as_object()?;
            let func = obj.get("function")?.as_object()?;
            let name = func.get("name")?.as_str()?;
            let description = func
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            let parameters = func
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));

            // Determine if this tool requires approval (mutations)
            let needs_approval = matches!(
                name,
                "create_row"
                    | "update_row"
                    | "delete_row"
                    | "send_message"
                    | "apply_pricing_recommendation"
                    | "advance_application_stage"
                    | "escalate_maintenance"
                    | "auto_assign_maintenance"
                    | "select_vendor"
                    | "abstract_lease_document"
            );

            Some(serde_json::json!({
                "name": name,
                "description": description,
                "parameters": parameters,
                "needsApproval": needs_approval,
            }))
        })
        .collect();

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "tools": sdk_tools,
        "count": sdk_tools.len(),
    })))
}

/// POST /v1/agent/execute-tool
/// Accepts tool name + args, executes with approval check, returns result.
/// This is the tool execution endpoint used by the Next.js AI SDK 6 orchestrator.
async fn post_execute_tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ExecuteToolInput>,
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

    let allow_mutations = payload.allow_mutations.unwrap_or(true);
    let confirm_write = payload.confirm_write.unwrap_or(true);

    // Look up allowed tools if agent_slug is specified
    let allowed_tools = if let Some(slug) = &payload.agent_slug {
        fetch_agent_allowed_tools(&state, &payload.org_id, slug).await
    } else {
        None
    };

    let result = execute_tool(
        &state,
        &payload.tool_name,
        &payload.args,
        ToolContext {
            org_id: &payload.org_id,
            role: &role,
            allow_mutations,
            confirm_write,
            allowed_tools: allowed_tools.as_deref(),
            agent_slug: payload.agent_slug.as_deref(),
            chat_id: payload.chat_id.as_deref(),
            requested_by_user_id: Some(&user_id),
            approved_execution: false,
        },
    )
    .await;

    let (tool_result, ok) = match result {
        Ok(value) => {
            let ok = value
                .as_object()
                .and_then(|obj| obj.get("ok"))
                .and_then(Value::as_bool)
                .unwrap_or(true);
            (value, ok)
        }
        Err(error) => {
            let detail = format!("{error}");
            (serde_json::json!({ "ok": false, "error": detail }), false)
        }
    };

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.org_id),
        Some(&user_id),
        "agent.execute_tool",
        "ai_agent",
        None,
        None,
        Some(serde_json::json!({
            "tool_name": payload.tool_name,
            "ok": ok,
            "role": role,
            "agent_slug": payload.agent_slug,
        })),
    )
    .await;

    // Record usage event
    if let Some(pool) = state.db_pool.as_ref() {
        crate::services::metering::record_usage_event(pool, &payload.org_id, "tool_execution", 1)
            .await;
    }

    Ok(Json(serde_json::json!({
        "organization_id": payload.org_id,
        "tool_name": payload.tool_name,
        "ok": ok,
        "result": tool_result,
    })))
}

/// Fetch allowed_tools for an agent by slug from the database.
async fn fetch_agent_allowed_tools(
    state: &AppState,
    org_id: &str,
    agent_slug: &str,
) -> Option<Vec<String>> {
    let pool = state.db_pool.as_ref()?;
    let row = sqlx::query_scalar::<_, Option<Vec<String>>>(
        "SELECT allowed_tools FROM ai_agents WHERE (organization_id = $1 OR organization_id IS NULL) AND slug = $2 AND is_active = true ORDER BY organization_id DESC NULLS LAST LIMIT 1"
    )
    .bind(org_id)
    .bind(agent_slug)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten();

    row
}
