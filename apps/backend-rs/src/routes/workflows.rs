use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    services::{audit::write_audit_log, workflows::process_workflow_jobs},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const WORKFLOW_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];

#[derive(Debug, Clone, Copy, Serialize)]
struct TriggerMetadata {
    value: &'static str,
    label_en: &'static str,
    label_es: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct ActionMetadata {
    value: &'static str,
    label_en: &'static str,
    label_es: &'static str,
}

const WORKFLOW_TRIGGER_METADATA: &[TriggerMetadata] = &[
    TriggerMetadata {
        value: "reservation_confirmed",
        label_en: "Reservation confirmed",
        label_es: "Reserva confirmada",
    },
    TriggerMetadata {
        value: "checked_in",
        label_en: "Checked in",
        label_es: "Check-in",
    },
    TriggerMetadata {
        value: "checked_out",
        label_en: "Checked out",
        label_es: "Check-out",
    },
    TriggerMetadata {
        value: "lease_created",
        label_en: "Lease created",
        label_es: "Contrato creado",
    },
    TriggerMetadata {
        value: "lease_activated",
        label_en: "Lease activated",
        label_es: "Contrato activado",
    },
    TriggerMetadata {
        value: "collection_overdue",
        label_en: "Collection overdue",
        label_es: "Cobro vencido",
    },
    TriggerMetadata {
        value: "application_received",
        label_en: "Application received",
        label_es: "Aplicacion recibida",
    },
    TriggerMetadata {
        value: "maintenance_submitted",
        label_en: "Maintenance submitted",
        label_es: "Mantenimiento recibido",
    },
    TriggerMetadata {
        value: "task_completed",
        label_en: "Task completed",
        label_es: "Tarea completada",
    },
    TriggerMetadata {
        value: "payment_received",
        label_en: "Payment received",
        label_es: "Pago recibido",
    },
    TriggerMetadata {
        value: "lease_expiring",
        label_en: "Lease expiring",
        label_es: "Contrato por vencer",
    },
];

const WORKFLOW_ACTION_METADATA: &[ActionMetadata] = &[
    ActionMetadata {
        value: "create_task",
        label_en: "Create task",
        label_es: "Crear tarea",
    },
    ActionMetadata {
        value: "assign_task_round_robin",
        label_en: "Assign task (round robin)",
        label_es: "Asignar tarea (rotativa)",
    },
    ActionMetadata {
        value: "send_notification",
        label_en: "Send notification",
        label_es: "Enviar notificacion",
    },
    ActionMetadata {
        value: "send_whatsapp",
        label_en: "Send WhatsApp",
        label_es: "Enviar WhatsApp",
    },
    ActionMetadata {
        value: "update_status",
        label_en: "Update status",
        label_es: "Actualizar estado",
    },
    ActionMetadata {
        value: "create_expense",
        label_en: "Create expense",
        label_es: "Crear gasto",
    },
];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/workflow-rules",
            axum::routing::get(list_workflow_rules).post(create_workflow_rule),
        )
        .route(
            "/workflow-rules/metadata",
            axum::routing::get(workflow_rules_metadata),
        )
        .route(
            "/workflow-rules/{rule_id}",
            axum::routing::get(get_workflow_rule)
                .patch(update_workflow_rule)
                .delete(delete_workflow_rule),
        )
        .route(
            "/workflow-rules/{rule_id}/runs",
            axum::routing::get(list_workflow_rule_runs),
        )
        .route(
            "/internal/process-workflow-jobs",
            axum::routing::post(process_workflow_jobs_endpoint),
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
struct WorkflowMetadataQuery {
    org_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct WorkflowRunsQuery {
    #[serde(default = "default_runs_limit")]
    limit: i64,
}

fn default_runs_limit() -> i64 {
    50
}

#[derive(Debug, serde::Deserialize)]
struct InternalProcessQuery {
    limit: Option<i64>,
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
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
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

async fn workflow_rules_metadata(
    State(state): State<AppState>,
    Query(query): Query<WorkflowMetadataQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    Ok(Json(json!({
        "engine_mode": state.config.workflow_engine_mode.as_str(),
        "triggers": WORKFLOW_TRIGGER_METADATA,
        "actions": WORKFLOW_ACTION_METADATA,
        "config_schema_hints": {
            "create_task": {
                "fields": ["title", "type", "priority", "assigned_role", "assigned_user_id"],
                "legacy_aliases": {"task_type": "type", "title_template": "title"}
            },
            "assign_task_round_robin": {
                "fields": ["title", "type", "priority", "assigned_role"],
                "legacy_aliases": {"task_type": "type", "title_template": "title"}
            },
            "send_notification": {
                "fields": ["channel", "recipient", "recipient_field", "subject", "body", "template_id"],
                "legacy_aliases": {"template": "template_id", "message": "body"}
            },
            "send_whatsapp": {
                "fields": ["recipient", "recipient_field", "body", "template_id", "whatsapp_template_name"],
                "legacy_aliases": {"template": "template_id", "message": "body"}
            },
            "update_status": {
                "fields": ["entity_type", "entity_id", "target_status", "cancel_reason"],
                "legacy_aliases": {"status": "target_status", "entity": "entity_type"}
            },
            "create_expense": {
                "fields": ["category", "amount", "currency", "description", "payment_method"],
                "legacy_aliases": {"value": "amount", "amount_minor": "amount", "amount_cents": "amount"}
            }
        }
    })))
}

async fn list_workflow_rule_runs(
    State(state): State<AppState>,
    Path(path): Path<WorkflowRulePath>,
    Query(query): Query<WorkflowRunsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let rule = get_row(pool, "workflow_rules", &path.rule_id, "id").await?;
    let org_id = val_str(&rule, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let rows = sqlx::query_scalar::<_, Value>(
        r#"
        SELECT row_to_json(t)
        FROM (
          SELECT
            a.id,
            a.workflow_job_id,
            a.attempt_number,
            a.status,
            a.reason,
            a.normalized_action_config,
            a.context_snapshot,
            a.started_at,
            a.finished_at,
            a.created_at,
            j.trigger_event,
            j.action_type,
            j.run_at,
            j.dedupe_key
          FROM workflow_job_attempts a
          JOIN workflow_jobs j ON j.id = a.workflow_job_id
          WHERE j.workflow_rule_id = $1::uuid
          ORDER BY a.created_at DESC
          LIMIT $2
        ) t
        "#,
    )
    .bind(&path.rule_id)
    .bind(clamp_limit_in_range(query.limit, 1, 200))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

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
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        WORKFLOW_EDIT_ROLES,
    )
    .await?;
    let pool = db_pool(&state)?;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    record.insert("name".to_string(), Value::String(payload.name));
    record.insert(
        "trigger_event".to_string(),
        Value::String(payload.trigger_event),
    );
    record.insert(
        "action_type".to_string(),
        Value::String(payload.action_type),
    );
    record.insert("action_config".to_string(), payload.action_config);
    record.insert(
        "delay_minutes".to_string(),
        json!(payload.delay_minutes.max(0)),
    );
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
        patch.insert("delay_minutes".to_string(), json!(delay_minutes.max(0)));
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

async fn process_workflow_jobs_endpoint(
    State(state): State<AppState>,
    Query(query): Query<InternalProcessQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    validate_internal_api_key_for_processor(
        state.config.is_production(),
        state.config.internal_api_key.as_deref(),
        api_key,
    )?;

    if !state.config.workflow_queue_enabled() {
        return Ok(Json(json!({
            "mode": state.config.workflow_engine_mode.as_str(),
            "picked": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "retried": 0
        })));
    }

    let pool = db_pool(&state)?;
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let summary = process_workflow_jobs(pool, limit).await;

    Ok(Json(json!({
        "mode": state.config.workflow_engine_mode.as_str(),
        "picked": summary.picked,
        "succeeded": summary.succeeded,
        "failed": summary.failed,
        "skipped": summary.skipped,
        "retried": summary.retried
    })))
}

fn validate_internal_api_key_for_processor(
    is_production: bool,
    expected_key: Option<&str>,
    provided_key: &str,
) -> AppResult<()> {
    let expected = expected_key.map(str::trim).unwrap_or_default();

    if is_production && expected.is_empty() {
        return Err(AppError::Dependency(
            "INTERNAL_API_KEY must be set in production to process workflow jobs.".to_string(),
        ));
    }

    if !expected.is_empty() && provided_key != expected {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::validate_internal_api_key_for_processor;
    use crate::error::AppError;

    #[test]
    fn rejects_missing_internal_key_in_production() {
        let result = validate_internal_api_key_for_processor(true, None, "");
        assert!(matches!(result, Err(AppError::Dependency(_))));
    }

    #[test]
    fn rejects_invalid_key_when_expected_is_set() {
        let result = validate_internal_api_key_for_processor(true, Some("secret"), "wrong");
        assert!(matches!(result, Err(AppError::Unauthorized(_))));
    }

    #[test]
    fn accepts_valid_key_when_expected_is_set() {
        let result = validate_internal_api_key_for_processor(true, Some("secret"), "secret");
        assert!(result.is_ok());
    }

    #[test]
    fn allows_missing_key_outside_production() {
        let result = validate_internal_api_key_for_processor(false, None, "");
        assert!(result.is_ok());
    }
}
