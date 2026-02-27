use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    services::agent_specs::default_max_steps_for_slug,
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
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    is_active: Option<Option<bool>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    model_override: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    max_steps_override: Option<Option<i32>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    allow_mutations_default: Option<Option<bool>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    guardrail_overrides: Option<Option<Value>>,
}

fn deserialize_patch_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
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
        "SELECT
            a.slug,
            a.name,
            a.description,
            a.icon_key,
            COALESCE(o.is_active, a.is_active) AS is_active,
            o.model_override,
            o.max_steps_override,
            o.allow_mutations_default,
            a.created_at::text AS created_at,
            a.updated_at::text AS updated_at,
            o.updated_at::text AS overrides_updated_at
         FROM ai_agents a
         LEFT JOIN agent_runtime_overrides o
           ON o.organization_id = $1::uuid
          AND o.agent_slug = a.slug
         ORDER BY a.name",
    )
    .bind(&query.org_id)
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
                "model_override": r.try_get::<Option<String>, _>("model_override").unwrap_or(None),
                "max_steps_override": r.try_get::<Option<i32>, _>("max_steps_override").unwrap_or(None),
                "allow_mutations_default": r.try_get::<Option<bool>, _>("allow_mutations_default").unwrap_or(None),
                "default_max_steps": default_max_steps_for_slug(&r.try_get::<String, _>("slug").unwrap_or_default()),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
                "overrides_updated_at": r.try_get::<Option<String>, _>("overrides_updated_at").unwrap_or(None),
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
        "SELECT
            a.slug,
            a.name,
            a.description,
            a.icon_key,
            a.is_active AS baseline_is_active,
            COALESCE(o.is_active, a.is_active) AS is_active,
            o.model_override,
            o.max_steps_override,
            o.allow_mutations_default,
            o.guardrail_overrides,
            a.created_at::text AS created_at,
            a.updated_at::text AS updated_at,
            o.updated_at::text AS overrides_updated_at
         FROM ai_agents a
         LEFT JOIN agent_runtime_overrides o
           ON o.organization_id = $1::uuid
          AND o.agent_slug = a.slug
         WHERE a.slug = $2
         LIMIT 1",
    )
    .bind(&query.org_id)
    .bind(&path.agent_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match row {
        Some(r) => {
            let slug = r.try_get::<String, _>("slug").unwrap_or_default();
            Ok(Json(json!({
                "slug": slug,
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<String, _>("description").unwrap_or_default(),
                "icon_key": r.try_get::<String, _>("icon_key").unwrap_or_default(),
                "baseline_is_active": r.try_get::<bool, _>("baseline_is_active").unwrap_or(false),
                "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
                "model_override": r.try_get::<Option<String>, _>("model_override").unwrap_or(None),
                "max_steps_override": r.try_get::<Option<i32>, _>("max_steps_override").unwrap_or(None),
                "allow_mutations_default": r.try_get::<Option<bool>, _>("allow_mutations_default").unwrap_or(None),
                "guardrail_overrides": r.try_get::<Option<Value>, _>("guardrail_overrides").unwrap_or(None),
                "default_max_steps": default_max_steps_for_slug(&slug),
                "prompt_source": "code",
                "tools_source": "code",
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
                "overrides_updated_at": r.try_get::<Option<String>, _>("overrides_updated_at").unwrap_or(None),
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
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM ai_agents WHERE slug = $1)")
            .bind(&path.agent_slug)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Database query failed");
                AppError::Dependency("External service request failed.".to_string())
            })?;
    if !exists {
        return Err(AppError::NotFound("Agent not found.".to_string()));
    }

    if payload.is_active.is_none()
        && payload.model_override.is_none()
        && payload.max_steps_override.is_none()
        && payload.allow_mutations_default.is_none()
        && payload.guardrail_overrides.is_none()
    {
        return Ok(Json(json!({ "ok": true, "message": "No changes." })));
    }

    if let Some(Some(max_steps)) = payload.max_steps_override {
        if !(1..=24).contains(&max_steps) {
            return Err(AppError::BadRequest(
                "max_steps_override must be between 1 and 24.".to_string(),
            ));
        }
    }
    if let Some(Some(guardrails)) = payload.guardrail_overrides.as_ref() {
        if !guardrails.is_object() {
            return Err(AppError::BadRequest(
                "guardrail_overrides must be a JSON object.".to_string(),
            ));
        }
    }

    let update_is_active = payload.is_active.is_some();
    let update_model_override = payload.model_override.is_some();
    let update_max_steps_override = payload.max_steps_override.is_some();
    let update_allow_mutations_default = payload.allow_mutations_default.is_some();
    let update_guardrail_overrides = payload.guardrail_overrides.is_some();

    let is_active_value = payload.is_active.flatten();
    let model_override_value = payload
        .model_override
        .as_ref()
        .and_then(|value| value.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let max_steps_override_value = payload.max_steps_override.flatten();
    let allow_mutations_default_value = payload.allow_mutations_default.flatten();
    let guardrail_overrides_value = payload
        .guardrail_overrides
        .as_ref()
        .map(|value| value.clone().unwrap_or_else(|| json!({})));

    let upserted = sqlx::query(
        "INSERT INTO agent_runtime_overrides (
            organization_id,
            agent_slug,
            is_active,
            model_override,
            max_steps_override,
            allow_mutations_default,
            guardrail_overrides,
            updated_by
         ) VALUES (
            $1::uuid,
            $2,
            $3,
            $4,
            $5,
            $6,
            COALESCE($7, '{}'::jsonb),
            $8::uuid
         )
         ON CONFLICT (organization_id, agent_slug)
         DO UPDATE SET
            is_active = CASE
              WHEN $9::boolean THEN EXCLUDED.is_active
              ELSE agent_runtime_overrides.is_active
            END,
            model_override = CASE
              WHEN $10::boolean THEN EXCLUDED.model_override
              ELSE agent_runtime_overrides.model_override
            END,
            max_steps_override = CASE
              WHEN $11::boolean THEN EXCLUDED.max_steps_override
              ELSE agent_runtime_overrides.max_steps_override
            END,
            allow_mutations_default = CASE
              WHEN $12::boolean THEN EXCLUDED.allow_mutations_default
              ELSE agent_runtime_overrides.allow_mutations_default
            END,
            guardrail_overrides = CASE
              WHEN $13::boolean THEN EXCLUDED.guardrail_overrides
              ELSE agent_runtime_overrides.guardrail_overrides
            END,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
         RETURNING agent_slug",
    )
    .bind(&payload.org_id)
    .bind(&path.agent_slug)
    .bind(is_active_value)
    .bind(model_override_value)
    .bind(max_steps_override_value)
    .bind(allow_mutations_default_value)
    .bind(guardrail_overrides_value)
    .bind(&user_id)
    .bind(update_is_active)
    .bind(update_model_override)
    .bind(update_max_steps_override)
    .bind(update_allow_mutations_default)
    .bind(update_guardrail_overrides)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    if upserted.is_none() {
        return Err(AppError::NotFound("Agent not found.".to_string()));
    }

    Ok(Json(json!({
        "ok": true,
        "slug": path.agent_slug,
        "org_id": payload.org_id,
    })))
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
    let period = query.period.clamp(1, 90);
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
