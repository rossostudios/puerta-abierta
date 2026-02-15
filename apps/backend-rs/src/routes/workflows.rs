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
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const WORKFLOW_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/workflow-rules",
            axum::routing::get(list_workflow_rules).post(create_workflow_rule),
        )
        .route(
            "/workflow-rules/{rule_id}",
            axum::routing::get(get_workflow_rule)
                .patch(update_workflow_rule)
                .delete(delete_workflow_rule),
        )
}

#[derive(Debug, serde::Deserialize)]
struct WorkflowRulesQuery {
    org_id: String,
    is_active: Option<bool>,
    trigger_event: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    200
}

#[derive(Debug, serde::Deserialize)]
struct WorkflowRulePath {
    rule_id: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct CreateWorkflowRuleInput {
    organization_id: String,
    name: String,
    trigger_event: String,
    action_type: String,
    #[serde(default)]
    action_config: serde_json::Value,
    #[serde(default)]
    delay_minutes: i32,
    #[serde(default = "default_true")]
    is_active: bool,
}
fn default_true() -> bool {
    true
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct UpdateWorkflowRuleInput {
    name: Option<String>,
    trigger_event: Option<String>,
    action_type: Option<String>,
    action_config: Option<serde_json::Value>,
    delay_minutes: Option<i32>,
    is_active: Option<bool>,
}

async fn list_workflow_rules(
    State(state): State<AppState>,
    Query(query): Query<WorkflowRulesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(query.org_id.clone()));
    if let Some(active) = query.is_active {
        filters.insert("is_active".to_string(), Value::Bool(active));
    }
    if let Some(trigger) = non_empty_opt(query.trigger_event.as_deref()) {
        filters.insert("trigger_event".to_string(), Value::String(trigger));
    }

    let rows = list_rows(
        pool,
        "workflow_rules",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        true,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn get_workflow_rule(
    State(state): State<AppState>,
    Path(path): Path<WorkflowRulePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "workflow_rules", &path.rule_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn create_workflow_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateWorkflowRuleInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, WORKFLOW_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut record = Map::new();
    record.insert("organization_id".to_string(), Value::String(payload.organization_id.clone()));
    record.insert("name".to_string(), Value::String(payload.name));
    record.insert("trigger_event".to_string(), Value::String(payload.trigger_event));
    record.insert("action_type".to_string(), Value::String(payload.action_type));
    record.insert("action_config".to_string(), payload.action_config);
    record.insert("delay_minutes".to_string(), json!(payload.delay_minutes));
    record.insert("is_active".to_string(), Value::Bool(payload.is_active));

    let created = create_row(pool, "workflow_rules", &record).await?;
    let entity_id = val_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "workflow_rules",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn update_workflow_rule(
    State(state): State<AppState>,
    Path(path): Path<WorkflowRulePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateWorkflowRuleInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let existing = get_row(pool, "workflow_rules", &path.rule_id, "id").await?;
    let org_id = val_str(&existing, "organization_id");
    assert_org_role(&state, &user_id, &org_id, WORKFLOW_EDIT_ROLES).await?;

    let mut patch = Map::new();
    if let Some(name) = payload.name {
        patch.insert("name".to_string(), Value::String(name));
    }
    if let Some(trigger_event) = payload.trigger_event {
        patch.insert("trigger_event".to_string(), Value::String(trigger_event));
    }
    if let Some(action_type) = payload.action_type {
        patch.insert("action_type".to_string(), Value::String(action_type));
    }
    if let Some(action_config) = payload.action_config {
        patch.insert("action_config".to_string(), action_config);
    }
    if let Some(delay_minutes) = payload.delay_minutes {
        patch.insert("delay_minutes".to_string(), json!(delay_minutes));
    }
    if let Some(is_active) = payload.is_active {
        patch.insert("is_active".to_string(), Value::Bool(is_active));
    }

    if patch.is_empty() {
        return Ok(Json(existing));
    }

    let updated = update_row(pool, "workflow_rules", &path.rule_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "workflow_rules",
        Some(&path.rule_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn delete_workflow_rule(
    State(state): State<AppState>,
    Path(path): Path<WorkflowRulePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "workflow_rules", &path.rule_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, WORKFLOW_EDIT_ROLES).await?;

    delete_row(pool, "workflow_rules", &path.rule_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "workflow_rules",
        Some(&path.rule_id),
        Some(record),
        None,
    )
    .await;

    Ok(Json(json!({ "deleted": true })))
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

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}
