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
            "/ai-agents/dashboard/stats",
            axum::routing::get(dashboard_stats),
        )
        .route(
            "/ai-agents/dashboard/analytics",
            axum::routing::get(dashboard_analytics),
        )
        .route(
            "/ai-agents/{agent_slug}",
            axum::routing::get(get_agent).patch(update_agent),
        )
}

#[derive(Debug, Deserialize)]
struct OrgQuery {
    org_id: String,
}

#[derive(Debug, Deserialize)]
struct AnalyticsQuery {
    org_id: String,
    #[serde(default = "default_period")]
    period: i32,
}
fn default_period() -> i32 {
    7
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

    let result = q.fetch_optional(pool).await.map_err(|e| {
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

    // Active agents count — filter to agents that have activity in the requesting org
    let agents_row = sqlx::query(
        "SELECT COUNT(DISTINCT a.slug)::bigint AS total,
                COUNT(DISTINCT a.slug) FILTER (WHERE a.is_active)::bigint AS active
         FROM ai_agents a
         WHERE EXISTS (
           SELECT 1 FROM ai_chats c
           WHERE c.agent_id = a.id
             AND c.organization_id = $1::uuid
         )",
    )
    .bind(&query.org_id)
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
        "SELECT agent_slug, tool_name, status, created_at::text, review_note
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
                "reasoning": r.try_get::<Option<String>, _>("review_note").unwrap_or(None),
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

async fn dashboard_analytics(
    State(state): State<AppState>,
    Query(query): Query<AnalyticsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;
    let period = query.period.max(1).min(90);
    let interval_str = format!("{} days", period);

    // Query 1 — Per-agent stats from agent_traces
    let agent_rows = sqlx::query(
        "SELECT agent_slug,
           COUNT(*)::int AS total_runs,
           COUNT(*) FILTER (WHERE success)::int AS successful_runs,
           (COUNT(*) FILTER (WHERE success)::numeric / NULLIF(COUNT(*), 0) * 100)::float8 AS success_rate,
           COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
           COALESCE(SUM(prompt_tokens * 0.000005 + completion_tokens * 0.000015), 0)::float8 AS estimated_cost_usd,
           COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avg_latency_ms
         FROM agent_traces
         WHERE organization_id = $1::uuid AND created_at >= now() - $2::interval
         GROUP BY agent_slug ORDER BY total_runs DESC",
    )
    .bind(&query.org_id)
    .bind(&interval_str)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Query 2 — Human override % from agent_approvals
    let approval_rows = sqlx::query(
        "SELECT agent_slug,
           COUNT(*) FILTER (WHERE status IN ('approved','executed'))::int AS approved,
           COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
           COUNT(*)::int AS total_reviewed
         FROM agent_approvals
         WHERE organization_id = $1::uuid AND created_at >= now() - $2::interval
           AND status IN ('approved','executed','rejected')
         GROUP BY agent_slug",
    )
    .bind(&query.org_id)
    .bind(&interval_str)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Build approval lookup by slug
    let mut approval_map: std::collections::HashMap<String, (i32, i32, i32)> =
        std::collections::HashMap::new();
    for r in &approval_rows {
        let slug = r
            .try_get::<Option<String>, _>("agent_slug")
            .unwrap_or(None)
            .unwrap_or_default();
        let approved = r.try_get::<i32, _>("approved").unwrap_or(0);
        let rejected = r.try_get::<i32, _>("rejected").unwrap_or(0);
        let total = r.try_get::<i32, _>("total_reviewed").unwrap_or(0);
        approval_map.insert(slug, (approved, rejected, total));
    }

    // Merge agent stats with approval data
    let agents: Vec<Value> = agent_rows
        .iter()
        .map(|r| {
            let slug = r.try_get::<String, _>("agent_slug").unwrap_or_default();
            let (_, rejected, total_reviewed) =
                approval_map.get(&slug).copied().unwrap_or((0, 0, 0));
            let override_pct = if total_reviewed > 0 {
                (rejected as f64 / total_reviewed as f64) * 100.0
            } else {
                0.0
            };
            json!({
                "slug": slug,
                "total_runs": r.try_get::<i32, _>("total_runs").unwrap_or(0),
                "successful_runs": r.try_get::<i32, _>("successful_runs").unwrap_or(0),
                "success_rate": r.try_get::<f64, _>("success_rate").unwrap_or(0.0),
                "total_tokens": r.try_get::<i64, _>("total_tokens").unwrap_or(0),
                "estimated_cost_usd": r.try_get::<f64, _>("estimated_cost_usd").unwrap_or(0.0),
                "avg_latency_ms": r.try_get::<i32, _>("avg_latency_ms").unwrap_or(0),
                "human_override_pct": (override_pct * 10.0).round() / 10.0,
            })
        })
        .collect();

    // Query 3 — Most-used tools from agent_traces.tool_calls JSONB
    let tool_rows = sqlx::query(
        "SELECT tool->>'name' AS tool_name,
           COUNT(*)::int AS call_count,
           COUNT(*) FILTER (WHERE (tool->>'ok')::boolean IS NOT FALSE)::int AS success_count
         FROM agent_traces, jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb)) AS tool
         WHERE organization_id = $1::uuid AND created_at >= now() - $2::interval
         GROUP BY tool->>'name' ORDER BY call_count DESC LIMIT 20",
    )
    .bind(&query.org_id)
    .bind(&interval_str)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let top_tools: Vec<Value> = tool_rows
        .iter()
        .map(|r| {
            let calls = r.try_get::<i32, _>("call_count").unwrap_or(0);
            let successes = r.try_get::<i32, _>("success_count").unwrap_or(0);
            let rate = if calls > 0 {
                (successes as f64 / calls as f64) * 100.0
            } else {
                0.0
            };
            json!({
                "name": r.try_get::<String, _>("tool_name").unwrap_or_default(),
                "calls": calls,
                "success_rate": (rate * 10.0).round() / 10.0,
            })
        })
        .collect();

    // Query 4 — Daily cost trend
    let trend_rows = sqlx::query(
        "SELECT DATE(created_at)::text AS date,
           COALESCE(SUM(prompt_tokens * 0.000005 + completion_tokens * 0.000015), 0)::float8 AS cost_usd,
           COALESCE(SUM(total_tokens), 0)::bigint AS token_count
         FROM agent_traces
         WHERE organization_id = $1::uuid AND created_at >= now() - $2::interval
         GROUP BY DATE(created_at) ORDER BY date",
    )
    .bind(&query.org_id)
    .bind(&interval_str)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let cost_trend: Vec<Value> = trend_rows
        .iter()
        .map(|r| {
            json!({
                "date": r.try_get::<String, _>("date").unwrap_or_default(),
                "cost_usd": r.try_get::<f64, _>("cost_usd").unwrap_or(0.0),
                "token_count": r.try_get::<i64, _>("token_count").unwrap_or(0),
            })
        })
        .collect();

    Ok(Json(json!({
        "period_days": period,
        "agents": agents,
        "top_tools": top_tools,
        "cost_trend": cost_trend,
    })))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Database is not configured. Set DATABASE_URL (legacy SUPABASE_DB_URL is also supported).".to_string(),
        )
    })
}
