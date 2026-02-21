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

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/reviews", axum::routing::get(list_reviews))
        .route(
            "/reviews/{review_id}",
            axum::routing::get(get_review).patch(update_review),
        )
        .route(
            "/reviews/{review_id}/publish-response",
            axum::routing::post(publish_response),
        )
}

#[derive(Debug, Deserialize)]
struct ReviewsQuery {
    org_id: String,
    response_status: Option<String>,
    platform: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ReviewPath {
    review_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateReviewInput {
    org_id: String,
    response_text: Option<String>,
    response_status: Option<String>,
    ai_suggested_response: Option<String>,
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database is not configured.".to_string())
    })
}

async fn list_reviews(
    State(state): State<AppState>,
    Query(query): Query<ReviewsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let limit = query.limit.unwrap_or(50).min(200);
    let offset = query.offset.unwrap_or(0).max(0);

    let mut sql = String::from(
        "SELECT r.id::text, r.guest_name, r.platform, r.rating, r.review_text,
                r.response_text, r.response_status, r.ai_suggested_response,
                r.responded_at::text, r.review_date::text, r.created_at::text,
                res.guest_name AS reservation_guest_name,
                p.name AS property_name
         FROM reviews r
         LEFT JOIN reservations res ON res.id = r.reservation_id
         LEFT JOIN units u ON u.id = res.unit_id
         LEFT JOIN properties p ON p.id = u.property_id
         WHERE r.organization_id = $1::uuid",
    );

    let mut bind_idx = 2;

    if let Some(ref status) = query.response_status {
        sql.push_str(&format!(" AND r.response_status = ${bind_idx}"));
        bind_idx += 1;
    }
    if let Some(ref platform) = query.platform {
        sql.push_str(&format!(" AND r.platform = ${bind_idx}"));
        // bind_idx += 1;
    }

    sql.push_str(" ORDER BY r.review_date DESC");
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let mut q = sqlx::query(&sql).bind(&query.org_id);
    if let Some(ref status) = query.response_status {
        q = q.bind(status);
    }
    if let Some(ref platform) = query.platform {
        q = q.bind(platform);
    }

    let rows = q.fetch_all(pool).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to list reviews");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "guest_name": r.try_get::<Option<String>, _>("guest_name").unwrap_or(None)
                    .or(r.try_get::<Option<String>, _>("reservation_guest_name").unwrap_or(None)),
                "platform": r.try_get::<String, _>("platform").unwrap_or_default(),
                "rating": r.try_get::<Option<i16>, _>("rating").unwrap_or(None),
                "review_text": r.try_get::<Option<String>, _>("review_text").unwrap_or(None),
                "response_text": r.try_get::<Option<String>, _>("response_text").unwrap_or(None),
                "response_status": r.try_get::<String, _>("response_status").unwrap_or_default(),
                "ai_suggested_response": r.try_get::<Option<String>, _>("ai_suggested_response").unwrap_or(None),
                "responded_at": r.try_get::<Option<String>, _>("responded_at").unwrap_or(None),
                "review_date": r.try_get::<Option<String>, _>("review_date").unwrap_or(None),
                "property_name": r.try_get::<Option<String>, _>("property_name").unwrap_or(None),
                "created_at": r.try_get::<Option<String>, _>("created_at").unwrap_or(None),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn get_review(
    State(state): State<AppState>,
    Path(path): Path<ReviewPath>,
    Query(query): Query<ReviewsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let row = sqlx::query(
        "SELECT r.*, res.guest_name AS reservation_guest_name
         FROM reviews r
         LEFT JOIN reservations res ON res.id = r.reservation_id
         WHERE r.id = $1::uuid AND r.organization_id = $2::uuid",
    )
    .bind(&path.review_id)
    .bind(&query.org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to get review");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match row {
        Some(r) => Ok(Json(json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "guest_name": r.try_get::<Option<String>, _>("guest_name").unwrap_or(None),
            "platform": r.try_get::<String, _>("platform").unwrap_or_default(),
            "rating": r.try_get::<Option<i16>, _>("rating").unwrap_or(None),
            "review_text": r.try_get::<Option<String>, _>("review_text").unwrap_or(None),
            "response_text": r.try_get::<Option<String>, _>("response_text").unwrap_or(None),
            "response_status": r.try_get::<String, _>("response_status").unwrap_or_default(),
            "ai_suggested_response": r.try_get::<Option<String>, _>("ai_suggested_response").unwrap_or(None),
        }))),
        None => Err(AppError::NotFound("Review not found.".to_string())),
    }
}

async fn update_review(
    State(state): State<AppState>,
    Path(path): Path<ReviewPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateReviewInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, &["owner_admin", "operator"]).await?;
    let pool = db_pool(&state)?;

    let mut updates = Vec::new();
    let mut bind_idx = 3;

    if payload.response_text.is_some() {
        updates.push(format!("response_text = ${bind_idx}"));
        bind_idx += 1;
    }
    if payload.response_status.is_some() {
        updates.push(format!("response_status = ${bind_idx}"));
        bind_idx += 1;
    }
    if payload.ai_suggested_response.is_some() {
        updates.push(format!("ai_suggested_response = ${bind_idx}"));
        // bind_idx += 1;
    }

    if updates.is_empty() {
        return Ok(Json(json!({ "ok": true, "message": "No changes." })));
    }

    updates.push("updated_at = now()".to_string());
    let set_clause = updates.join(", ");
    let query_str = format!(
        "UPDATE reviews SET {set_clause} WHERE id = $1::uuid AND organization_id = $2::uuid RETURNING id::text"
    );

    let mut q = sqlx::query(&query_str)
        .bind(&path.review_id)
        .bind(&payload.org_id);

    if let Some(ref text) = payload.response_text {
        q = q.bind(text);
    }
    if let Some(ref status) = payload.response_status {
        q = q.bind(status);
    }
    if let Some(ref ai_resp) = payload.ai_suggested_response {
        q = q.bind(ai_resp);
    }

    let result = q.fetch_optional(pool).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to update review");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match result {
        Some(_) => Ok(Json(json!({ "ok": true, "review_id": path.review_id }))),
        None => Err(AppError::NotFound("Review not found.".to_string())),
    }
}

async fn publish_response(
    State(state): State<AppState>,
    Path(path): Path<ReviewPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateReviewInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, &["owner_admin", "operator"]).await?;
    let pool = db_pool(&state)?;

    let result = sqlx::query(
        "UPDATE reviews SET
           response_status = 'published',
           responded_at = now(),
           updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid
         RETURNING id::text",
    )
    .bind(&path.review_id)
    .bind(&payload.org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to publish response");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match result {
        Some(_) => Ok(Json(json!({
            "ok": true,
            "review_id": path.review_id,
            "response_status": "published",
        }))),
        None => Err(AppError::NotFound("Review not found.".to_string())),
    }
}
