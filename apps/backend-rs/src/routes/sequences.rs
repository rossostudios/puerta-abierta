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
    schemas::clamp_limit_in_range,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/communication-sequences",
            axum::routing::get(list_sequences).post(create_sequence),
        )
        .route(
            "/communication-sequences/{sequence_id}",
            axum::routing::get(get_sequence)
                .patch(update_sequence)
                .delete(delete_sequence),
        )
        .route(
            "/communication-sequences/{sequence_id}/steps",
            axum::routing::get(list_steps).post(create_step),
        )
        .route(
            "/sequence-steps/{step_id}",
            axum::routing::patch(update_step).delete(delete_step),
        )
        .route(
            "/sequence-enrollments",
            axum::routing::get(list_enrollments),
        )
}

#[derive(Debug, serde::Deserialize)]
struct SequencesQuery {
    org_id: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Debug, serde::Deserialize)]
struct SequencePath {
    sequence_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct StepPath {
    step_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct CreateSequenceInput {
    organization_id: String,
    name: String,
    trigger_type: String,
    is_active: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateSequenceInput {
    name: Option<String>,
    trigger_type: Option<String>,
    is_active: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
struct CreateStepInput {
    step_order: i32,
    delay_hours: Option<i32>,
    channel: Option<String>,
    subject: Option<String>,
    body_template: String,
    template_id: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateStepInput {
    step_order: Option<i32>,
    delay_hours: Option<i32>,
    channel: Option<String>,
    subject: Option<String>,
    body_template: Option<String>,
    template_id: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct EnrollmentsQuery {
    org_id: String,
    #[serde(default)]
    entity_type: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    200
}

async fn list_sequences(
    State(state): State<AppState>,
    Query(query): Query<SequencesQuery>,
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
        "communication_sequences",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_sequence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateSequenceInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin", "operator"]).await?;
    let pool = db_pool(&state)?;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id),
    );
    record.insert("name".to_string(), Value::String(payload.name));
    record.insert(
        "trigger_type".to_string(),
        Value::String(payload.trigger_type),
    );
    if let Some(active) = payload.is_active {
        record.insert("is_active".to_string(), Value::Bool(active));
    }

    let created = create_row(pool, "communication_sequences", &record).await?;
    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_sequence(
    State(state): State<AppState>,
    Path(path): Path<SequencePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    // Include steps
    let mut step_filters = Map::new();
    step_filters.insert(
        "sequence_id".to_string(),
        Value::String(path.sequence_id.clone()),
    );
    let steps = list_rows(pool, "sequence_steps", Some(&step_filters), 50, 0, "step_order", true)
        .await?;

    let mut result = record.as_object().cloned().unwrap_or_default();
    result.insert("steps".to_string(), Value::Array(steps));

    Ok(Json(Value::Object(result)))
}

async fn update_sequence(
    State(state): State<AppState>,
    Path(path): Path<SequencePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateSequenceInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let mut patch = Map::new();
    if let Some(name) = payload.name {
        patch.insert("name".to_string(), Value::String(name));
    }
    if let Some(trigger_type) = payload.trigger_type {
        patch.insert("trigger_type".to_string(), Value::String(trigger_type));
    }
    if let Some(active) = payload.is_active {
        patch.insert("is_active".to_string(), Value::Bool(active));
    }

    let updated = update_row(pool, "communication_sequences", &path.sequence_id, &patch, "id").await?;
    Ok(Json(updated))
}

async fn delete_sequence(
    State(state): State<AppState>,
    Path(path): Path<SequencePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let deleted = delete_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    Ok(Json(deleted))
}

async fn list_steps(
    State(state): State<AppState>,
    Path(path): Path<SequencePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let sequence = get_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    let org_id = value_str(&sequence, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut filters = Map::new();
    filters.insert(
        "sequence_id".to_string(),
        Value::String(path.sequence_id.clone()),
    );
    let rows = list_rows(pool, "sequence_steps", Some(&filters), 50, 0, "step_order", true).await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_step(
    State(state): State<AppState>,
    Path(path): Path<SequencePath>,
    headers: HeaderMap,
    Json(payload): Json<CreateStepInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let sequence = get_row(pool, "communication_sequences", &path.sequence_id, "id").await?;
    let org_id = value_str(&sequence, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let mut record = Map::new();
    record.insert("sequence_id".to_string(), Value::String(path.sequence_id));
    record.insert(
        "step_order".to_string(),
        Value::Number(serde_json::Number::from(payload.step_order)),
    );
    record.insert(
        "delay_hours".to_string(),
        Value::Number(serde_json::Number::from(payload.delay_hours.unwrap_or(0))),
    );
    record.insert(
        "channel".to_string(),
        Value::String(payload.channel.unwrap_or_else(|| "whatsapp".to_string())),
    );
    if let Some(subject) = payload.subject {
        record.insert("subject".to_string(), Value::String(subject));
    }
    record.insert(
        "body_template".to_string(),
        Value::String(payload.body_template),
    );
    if let Some(template_id) = payload.template_id {
        record.insert("template_id".to_string(), Value::String(template_id));
    }

    let created = create_row(pool, "sequence_steps", &record).await?;
    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn update_step(
    State(state): State<AppState>,
    Path(path): Path<StepPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateStepInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let step = get_row(pool, "sequence_steps", &path.step_id, "id").await?;
    let sequence_id = value_str(&step, "sequence_id");
    let sequence = get_row(pool, "communication_sequences", &sequence_id, "id").await?;
    let org_id = value_str(&sequence, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let mut patch = Map::new();
    if let Some(order) = payload.step_order {
        patch.insert("step_order".to_string(), Value::Number(serde_json::Number::from(order)));
    }
    if let Some(delay) = payload.delay_hours {
        patch.insert("delay_hours".to_string(), Value::Number(serde_json::Number::from(delay)));
    }
    if let Some(channel) = payload.channel {
        patch.insert("channel".to_string(), Value::String(channel));
    }
    if let Some(subject) = payload.subject {
        patch.insert("subject".to_string(), Value::String(subject));
    }
    if let Some(body) = payload.body_template {
        patch.insert("body_template".to_string(), Value::String(body));
    }
    if let Some(tid) = payload.template_id {
        patch.insert("template_id".to_string(), Value::String(tid));
    }

    let updated = update_row(pool, "sequence_steps", &path.step_id, &patch, "id").await?;
    Ok(Json(updated))
}

async fn delete_step(
    State(state): State<AppState>,
    Path(path): Path<StepPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let step = get_row(pool, "sequence_steps", &path.step_id, "id").await?;
    let sequence_id = value_str(&step, "sequence_id");
    let sequence = get_row(pool, "communication_sequences", &sequence_id, "id").await?;
    let org_id = value_str(&sequence, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let deleted = delete_row(pool, "sequence_steps", &path.step_id, "id").await?;
    Ok(Json(deleted))
}

async fn list_enrollments(
    State(state): State<AppState>,
    Query(query): Query<EnrollmentsQuery>,
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
    if let Some(entity_type) = query.entity_type.as_deref().filter(|s| !s.is_empty()) {
        filters.insert("entity_type".to_string(), Value::String(entity_type.to_string()));
    }
    if let Some(status) = query.status.as_deref().filter(|s| !s.is_empty()) {
        filters.insert("status".to_string(), Value::String(status.to_string()));
    }

    let rows = list_rows(
        pool,
        "sequence_enrollments",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
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
