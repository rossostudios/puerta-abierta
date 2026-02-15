use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    services::audit::write_audit_log,
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/platform/organizations", axum::routing::get(list_all_orgs))
        .route(
            "/platform/organizations/{org_id}/suspend",
            axum::routing::post(suspend_org),
        )
        .route("/platform/stats", axum::routing::get(platform_stats))
}

#[derive(Debug, serde::Deserialize)]
struct PlatformOrgsQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    100
}

#[derive(Debug, serde::Deserialize)]
struct PlatformOrgPath {
    org_id: String,
}

/// Verify the caller is a platform admin.
async fn require_platform_admin(state: &AppState, user_id: &str) -> AppResult<()> {
    let pool = state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database not configured.".to_string())
    })?;

    match get_row(pool, "platform_admins", user_id, "user_id").await {
        Ok(_) => Ok(()),
        Err(_) => Err(AppError::Forbidden(
            "Platform admin access required.".to_string(),
        )),
    }
}

/// List all organizations (platform admin only).
async fn list_all_orgs(
    State(state): State<AppState>,
    Query(query): Query<PlatformOrgsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    require_platform_admin(&state, &user_id).await?;
    let pool = db_pool(&state)?;

    let orgs = list_rows(
        pool,
        "organizations",
        None,
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    // Enrich each org with subscription + member count
    let mut enriched = Vec::with_capacity(orgs.len());
    for org in orgs {
        let org_id = val_str(&org, "id");
        let mut org_obj = org;

        if !org_id.is_empty() {
            let mut sub_filter = Map::new();
            sub_filter.insert("organization_id".to_string(), Value::String(org_id.clone()));

            let subs = list_rows(pool, "org_subscriptions", Some(&sub_filter), 1, 0, "created_at", false)
                .await
                .unwrap_or_default();
            let sub = subs.into_iter().next();

            let members = list_rows(pool, "organization_members", Some(&sub_filter), 1000, 0, "id", true)
                .await
                .unwrap_or_default();

            let properties = list_rows(pool, "properties", Some(&sub_filter), 1000, 0, "id", true)
                .await
                .unwrap_or_default();

            if let Some(obj) = org_obj.as_object_mut() {
                obj.insert("subscription".to_string(), sub.unwrap_or(Value::Null));
                obj.insert("member_count".to_string(), json!(members.len()));
                obj.insert("property_count".to_string(), json!(properties.len()));
            }
        }

        enriched.push(org_obj);
    }

    Ok(Json(json!({ "data": enriched })))
}

/// Suspend an organization (platform admin only).
async fn suspend_org(
    State(state): State<AppState>,
    Path(path): Path<PlatformOrgPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    require_platform_admin(&state, &user_id).await?;
    let pool = db_pool(&state)?;

    let existing = get_row(pool, "organizations", &path.org_id, "id").await?;

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("suspended".to_string()));

    let updated = update_row(pool, "organizations", &path.org_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user_id),
        "suspend",
        "organizations",
        Some(&path.org_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

/// Platform-level stats (KPIs).
async fn platform_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    require_platform_admin(&state, &user_id).await?;
    let pool = db_pool(&state)?;

    let all_orgs = list_rows(pool, "organizations", None, 10000, 0, "id", true).await.unwrap_or_default();
    let all_subs = list_rows(pool, "org_subscriptions", None, 10000, 0, "id", true).await.unwrap_or_default();
    let all_users = list_rows(pool, "app_users", None, 100000, 0, "id", true).await.unwrap_or_default();

    let active_subs = all_subs
        .iter()
        .filter(|s| {
            let status = val_str(s, "status");
            matches!(status.as_str(), "active" | "trialing")
        })
        .count();

    let trialing = all_subs
        .iter()
        .filter(|s| val_str(s, "status") == "trialing")
        .count();

    let cancelled = all_subs
        .iter()
        .filter(|s| val_str(s, "status") == "cancelled")
        .count();

    Ok(Json(json!({
        "total_organizations": all_orgs.len(),
        "total_users": all_users.len(),
        "total_subscriptions": all_subs.len(),
        "active_subscriptions": active_subs,
        "trialing_subscriptions": trialing,
        "cancelled_subscriptions": cancelled,
        "conversion_rate": if all_subs.is_empty() { 0.0 } else { active_subs as f64 / all_subs.len() as f64 },
    })))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
