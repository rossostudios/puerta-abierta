use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    schemas::{
        clamp_limit_in_range, NotificationPath, NotificationsQuery, ReadAllNotificationsInput,
    },
    services::notification_center::{
        deactivate_push_token, list_for_user, mark_all_read, mark_read,
        purge_expired_notifications, unread_count, upsert_push_token,
    },
    state::AppState,
    tenancy::assert_org_member,
};

#[derive(Debug, Clone, Deserialize)]
struct UnreadCountQuery {
    org_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RetentionInput {
    retention_days: Option<i64>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/notifications", axum::routing::get(list_notifications))
        .route(
            "/notifications/unread-count",
            axum::routing::get(get_unread_count),
        )
        .route(
            "/notifications/{notification_id}/read",
            axum::routing::post(mark_notification_read),
        )
        .route(
            "/notifications/read-all",
            axum::routing::post(mark_notifications_read_all),
        )
        .route(
            "/internal/notifications-retention",
            axum::routing::post(run_notifications_retention),
        )
        .route(
            "/push-tokens",
            axum::routing::post(register_push_token),
        )
        .route(
            "/push-tokens/deactivate",
            axum::routing::post(deactivate_push_token_handler),
        )
}

async fn list_notifications(
    State(state): State<AppState>,
    Query(query): Query<NotificationsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = db_pool(&state)?;
    let result = list_for_user(
        pool,
        &query.org_id,
        &user_id,
        query.status.as_deref(),
        query.category.as_deref(),
        query.cursor.as_deref(),
        clamp_limit_in_range(query.limit, 1, 100),
    )
    .await?;

    Ok(Json(json!({
        "data": result.data,
        "next_cursor": result.next_cursor,
    })))
}

async fn get_unread_count(
    State(state): State<AppState>,
    Query(query): Query<UnreadCountQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = db_pool(&state)?;
    let total = unread_count(pool, &query.org_id, &user_id).await?;

    Ok(Json(json!({ "unread": total })))
}

async fn mark_notification_read(
    State(state): State<AppState>,
    Path(path): Path<NotificationPath>,
    Query(query): Query<UnreadCountQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = db_pool(&state)?;
    let updated = mark_read(pool, &query.org_id, &user_id, &path.notification_id).await?;

    let Some(updated) = updated else {
        return Err(AppError::NotFound("Notification not found.".to_string()));
    };

    Ok(Json(updated))
}

async fn mark_notifications_read_all(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ReadAllNotificationsInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.org_id).await?;

    let pool = db_pool(&state)?;
    let updated = mark_all_read(pool, &payload.org_id, &user_id).await?;

    Ok(Json(json!({ "updated": updated })))
}

async fn run_notifications_retention(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<RetentionInput>>,
) -> AppResult<impl IntoResponse> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let expected_key = state.config.internal_api_key.as_deref().unwrap_or_default();

    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;
    let retention_days = payload
        .and_then(|Json(input)| input.retention_days)
        .unwrap_or(180);
    let result = purge_expired_notifications(pool, retention_days).await?;

    Ok(Json(json!({
        "retention_days": retention_days,
        "user_notifications_deleted": result.user_notifications_deleted,
        "notification_events_deleted": result.notification_events_deleted,
    })))
}

// ---------------------------------------------------------------------------
// Push token endpoints
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct RegisterPushTokenInput {
    organization_id: String,
    token: String,
    #[serde(default = "default_platform")]
    platform: String,
    device_id: Option<String>,
}
fn default_platform() -> String {
    "expo".to_string()
}

#[derive(Debug, Clone, Deserialize)]
struct DeactivatePushTokenInput {
    token: String,
}

async fn register_push_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RegisterPushTokenInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.organization_id).await?;
    let pool = db_pool(&state)?;

    let result = upsert_push_token(
        pool,
        &payload.organization_id,
        &user_id,
        &payload.token,
        &payload.platform,
        payload.device_id.as_deref(),
    )
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(result)))
}

async fn deactivate_push_token_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<DeactivatePushTokenInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    deactivate_push_token(pool, &user_id, &payload.token).await?;

    Ok(Json(json!({ "ok": true })))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}
