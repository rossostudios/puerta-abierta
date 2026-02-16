use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit, remove_nulls, serialize_to_map, validate_input, CreateGuestInput, GuestPath,
        GuestsQuery, UpdateGuestInput,
    },
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/guests",
            axum::routing::get(list_guests).post(create_guest),
        )
        .route(
            "/guests/{guest_id}",
            axum::routing::get(get_guest)
                .patch(update_guest)
                .delete(delete_guest),
        )
        .route(
            "/guests/{guest_id}/verification",
            axum::routing::post(submit_verification).patch(review_verification),
        )
        .route(
            "/public/guest-verification/{guest_id}",
            axum::routing::post(public_submit_verification),
        )
}

async fn list_guests(
    State(state): State<AppState>,
    Query(query): Query<GuestsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    let rows = list_rows(
        pool,
        "guests",
        Some(&filters),
        clamp_limit(query.limit),
        0,
        "created_at",
        false,
    )
    .await?;
    Ok(Json(json!({ "data": rows })))
}

async fn create_guest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateGuestInput>,
) -> AppResult<impl IntoResponse> {
    validate_input(&payload)?;
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "operator"],
    )
    .await?;
    let pool = db_pool(&state)?;
    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "guests", &record).await?;
    let entity_id = value_str(&created, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "guests",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;
    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_guest(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let row = get_row(pool, "guests", &path.guest_id, "id").await?;
    let org_id = value_str(&row, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;
    Ok(Json(row))
}

async fn update_guest(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateGuestInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "guests", &path.guest_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;
    let patch = remove_nulls(serialize_to_map(&payload));
    let updated = update_row(pool, "guests", &path.guest_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "guests",
        Some(&path.guest_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;
    Ok(Json(updated))
}

async fn delete_guest(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "guests", &path.guest_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;
    let deleted = delete_row(pool, "guests", &path.guest_id, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "guests",
        Some(&path.guest_id),
        Some(deleted.clone()),
        None,
    )
    .await;
    Ok(Json(deleted))
}

// ── Guest Verification ──────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct SubmitVerificationInput {
    id_document_url: String,
    selfie_url: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReviewVerificationInput {
    verification_status: String, // "verified" or "rejected"
    notes: Option<String>,
}

/// Admin submits verification documents on behalf of a guest.
async fn submit_verification(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    headers: HeaderMap,
    Json(payload): Json<SubmitVerificationInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "guests", &path.guest_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let mut patch = serde_json::Map::new();
    patch.insert(
        "id_document_url".to_string(),
        Value::String(payload.id_document_url),
    );
    if let Some(selfie) = payload.selfie_url {
        patch.insert("selfie_url".to_string(), Value::String(selfie));
    }
    patch.insert(
        "verification_status".to_string(),
        Value::String("pending".to_string()),
    );

    let updated = update_row(pool, "guests", &path.guest_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "verification_submit",
        "guests",
        Some(&path.guest_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

/// Admin reviews (approve/reject) a guest verification.
async fn review_verification(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    headers: HeaderMap,
    Json(payload): Json<ReviewVerificationInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "guests", &path.guest_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    if !matches!(payload.verification_status.as_str(), "verified" | "rejected") {
        return Err(AppError::BadRequest(
            "verification_status must be 'verified' or 'rejected'.".to_string(),
        ));
    }

    let mut patch = serde_json::Map::new();
    patch.insert(
        "verification_status".to_string(),
        Value::String(payload.verification_status.clone()),
    );
    if payload.verification_status == "verified" {
        patch.insert(
            "verified_at".to_string(),
            Value::String(chrono::Utc::now().to_rfc3339()),
        );
    }

    let updated = update_row(pool, "guests", &path.guest_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "verification_review",
        "guests",
        Some(&path.guest_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

/// Public endpoint for guests to submit their own verification documents.
async fn public_submit_verification(
    State(state): State<AppState>,
    Path(path): Path<GuestPath>,
    Json(payload): Json<SubmitVerificationInput>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let record = get_row(pool, "guests", &path.guest_id, "id").await?;
    let current_status = value_str(&record, "verification_status");
    if current_status == "verified" {
        return Err(AppError::BadRequest(
            "Guest is already verified.".to_string(),
        ));
    }

    let mut patch = serde_json::Map::new();
    patch.insert(
        "id_document_url".to_string(),
        Value::String(payload.id_document_url),
    );
    if let Some(selfie) = payload.selfie_url {
        patch.insert("selfie_url".to_string(), Value::String(selfie));
    }
    patch.insert(
        "verification_status".to_string(),
        Value::String("pending".to_string()),
    );

    let updated = update_row(pool, "guests", &path.guest_id, &patch, "id").await?;
    Ok(Json(updated))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn value_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
