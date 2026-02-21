use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const AGENT_ADMIN_ROLES: &[&str] = &["owner_admin", "operator"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/ai-agents", axum::routing::get(list_agents))
        .route(
            "/ai-agents/{agent_slug}",
            axum::routing::get(get_agent).patch(update_agent),
        )
        .route(
            "/ai-agents/dashboard/stats",
            axum::routing::get(dashboard_stats),
        )
}

#[derive(Debug, Deserialize)]
struct OrgQuery {
    org_id: String,
}

#[derive(Debug, Deserialize)]
struct AgentSlugPath {
    agent_slug: String,
}

#[derive(Debug, Deserialize)]
struct UpdateAgentInput {
    org_id: String,
    system_prompt: Option<String>,
    allowed_tools: Option<Vec<String>>,
    is_active: Option<bool>,
}

async fn list_agents(
    State(state): State<AppState>,
    Query(query): Query<OrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT slug, name, description, icon_key, is_active,
                array_length(string_to_array(allowed_tools::text, ','), 1) AS tool_count,
                created_at::text, updated_at::text
         FROM ai_agents
         ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "slug": r.try_get::<String, _>("slug").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<String, _>("description").unwrap_or_default(),
                "icon_key": r.try_get::<String, _>("icon_key").unwrap_or_default(),
                "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn get_agent(
    State(state): State<AppState>,
    Path(path): Path<AgentSlugPath>,
    Query(query): Query<OrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let row = sqlx::query(
        "SELECT slug, name, description, icon_key, system_prompt,
                allowed_tools::text, is_active, created_at::text, updated_at::text
         FROM ai_agents WHERE slug = $1 LIMIT 1",
    )
    .bind(&path.agent_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match row {
        Some(r) => {
            let tools_str = r.try_get::<String, _>("allowed_tools").unwrap_or_default();
            let tools: Vec<String> = serde_json::from_str(&tools_str).unwrap_or_default();
            Ok(Json(json!({
                "slug": r.try_get::<String, _>("slug").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<String, _>("description").unwrap_or_default(),
                "icon_key": r.try_get::<String, _>("icon_key").unwrap_or_default(),
                "system_prompt": r.try_get::<Option<String>, _>("system_prompt").unwrap_or(None),
                "allowed_tools": tools,
                "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
            })))
        }
        None => Err(AppError::NotFound("Agent not found.".to_string())),
    }
}

async fn update_agent(
    State(state): State<AppState>,
    Path(path): Path<AgentSlugPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateAgentInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, AGENT_ADMIN_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut updates = Vec::new();
    let mut bind_idx = 2;

    if payload.system_prompt.is_some() {
        updates.push(format!("system_prompt = ${bind_idx}"));
        bind_idx += 1;
    }
    if payload.allowed_tools.is_some() {
        updates.push(format!("allowed_tools = ${bind_idx}::jsonb"));
        bind_idx += 1;
    }
    if payload.is_active.is_some() {
        updates.push(format!("is_active = ${bind_idx}"));
        // bind_idx += 1; // unused after this
    }

    if updates.is_empty() {
        return Ok(Json(json!({ "ok": true, "message": "No changes." })));
    }

    updates.push("updated_at = now()".to_string());
    let set_clause = updates.join(", ");
    let query_str = format!(
        "UPDATE ai_agents SET {set_clause} WHERE slug = $1 RETURNING slug, name, is_active"
    );

    let mut q = sqlx::query(&query_str).bind(&path.agent_slug);
    if let Some(ref prompt) = payload.system_prompt {
        q = q.bind(prompt);
    }
    if let Some(ref tools) = payload.allowed_tools {
        q = q.bind(json!(tools));
    }
    if let Some(active) = payload.is_active {
        q = q.bind(active);
    }

    let result = q
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    match result {
        Some(r) => Ok(Json(json!({
            "ok": true,
            "slug": r.try_get::<String, _>("slug").unwrap_or_default(),
            "name": r.try_get::<String, _>("name").unwrap_or_default(),
            "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
        }))),
        None => Err(AppError::NotFound("Agent not found.".to_string())),
    }
}

async fn dashboard_stats(
    State(state): State<AppState>,
    Query(query): Query<OrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    // Active agents count
    let agents_row = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE is_active)::bigint AS active
         FROM ai_agents",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    let total_agents = agents_row.try_get::<i64, _>("total").unwrap_or(0);
    let active_agents = agents_row.try_get::<i64, _>("active").unwrap_or(0);

    // Approvals stats (last 24h)
    let approvals_row = sqlx::query(
        "SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE status = 'pending')::bigint AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::bigint AS approved,
           COUNT(*) FILTER (WHERE status = 'rejected')::bigint AS rejected
         FROM agent_approvals
         WHERE organization_id = $1::uuid
           AND created_at >= now() - interval '24 hours'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    // Recent activity
    let recent_rows = sqlx::query(
        "SELECT agent_slug, tool_name, status, created_at::text, reasoning
         FROM agent_approvals
         WHERE organization_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 20",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    let recent_activity: Vec<Value> = recent_rows
        .iter()
        .map(|r| {
            json!({
                "agent_slug": r.try_get::<Option<String>, _>("agent_slug").unwrap_or(None),
                "tool_name": r.try_get::<String, _>("tool_name").unwrap_or_default(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "reasoning": r.try_get::<Option<String>, _>("reasoning").unwrap_or(None),
            })
        })
        .collect();

    // Agent memory count
    let memory_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM agent_memory
         WHERE organization_id = $1::uuid AND (expires_at IS NULL OR expires_at > now())",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    Ok(Json(json!({
        "agents": {
            "total": total_agents,
            "active": active_agents,
        },
        "approvals_24h": {
            "total": approvals_row.try_get::<i64, _>("total").unwrap_or(0),
            "pending": approvals_row.try_get::<i64, _>("pending").unwrap_or(0),
            "approved": approvals_row.try_get::<i64, _>("approved").unwrap_or(0),
            "rejected": approvals_row.try_get::<i64, _>("rejected").unwrap_or(0),
        },
        "memory_count": memory_count,
        "recent_activity": recent_activity,
    })))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}
