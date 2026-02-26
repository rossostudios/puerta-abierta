use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};

use crate::{
    auth::require_user_id,
    error::AppResult,
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CancellationPoliciesQuery,
        CancellationPolicyPath, CreateCancellationPolicyInput, UpdateCancellationPolicyInput,
    },
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/cancellation-policies",
            axum::routing::get(list_cancellation_policies).post(create_cancellation_policy),
        )
        .route(
            "/cancellation-policies/{policy_id}",
            axum::routing::get(get_cancellation_policy).patch(update_cancellation_policy),
        )
}

async fn list_cancellation_policies(
    State(state): State<AppState>,
    Query(query): Query<CancellationPoliciesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = serde_json::Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );

    let rows = list_rows(
        pool,
        "cancellation_policies",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_cancellation_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateCancellationPolicyInput>,
) -> AppResult<impl IntoResponse> {
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
    let created = create_row(pool, "cancellation_policies", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "cancellation_policies",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_cancellation_policy(
    State(state): State<AppState>,
    Path(path): Path<CancellationPolicyPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "cancellation_policies", &path.policy_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn update_cancellation_policy(
    State(state): State<AppState>,
    Path(path): Path<CancellationPolicyPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateCancellationPolicyInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "cancellation_policies", &path.policy_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    if patch.is_empty() {
        return Ok(Json(record));
    }

    let updated = update_row(pool, "cancellation_policies", &path.policy_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "cancellation_policies",
        Some(&path.policy_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        crate::error::AppError::Dependency(
            "Database is not configured. Set DATABASE_URL (legacy SUPABASE_DB_URL is also supported).".to_string(),
        )
    })
}

fn value_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
