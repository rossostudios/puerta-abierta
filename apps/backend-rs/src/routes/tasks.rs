use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CompleteTaskInput, CreateTaskInput,
        CreateTaskItemInput, TaskItemPath, TaskItemsQuery, TaskPath, TasksQuery, UpdateTaskInput,
        UpdateTaskItemInput,
    },
    services::{audit::write_audit_log, enrichment::enrich_tasks, workflows::fire_trigger},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const TASK_ITEM_UPDATE_ROLES: &[&str] = &["owner_admin", "operator", "cleaner"];
const TASK_ITEM_MANAGE_ROLES: &[&str] = &["owner_admin", "operator"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/tasks", axum::routing::get(list_tasks).post(create_task))
        .route(
            "/tasks/{task_id}",
            axum::routing::get(get_task).patch(update_task),
        )
        .route(
            "/tasks/{task_id}/complete",
            axum::routing::post(complete_task),
        )
        .route(
            "/tasks/{task_id}/items",
            axum::routing::get(list_task_items).post(create_task_item),
        )
        .route(
            "/tasks/{task_id}/items/{item_id}",
            axum::routing::patch(update_task_item).delete(delete_task_item),
        )
}

async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<TasksQuery>,
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
    if let Some(status) = non_empty_opt(query.status.as_deref()) {
        filters.insert("status".to_string(), Value::String(status));
    }
    if let Some(assigned_user_id) = non_empty_opt(query.assigned_user_id.as_deref()) {
        filters.insert(
            "assigned_user_id".to_string(),
            Value::String(assigned_user_id),
        );
    }
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        filters.insert("property_id".to_string(), Value::String(property_id));
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        filters.insert("reservation_id".to_string(), Value::String(reservation_id));
    }

    let rows = list_rows(
        pool,
        "tasks",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    let mut flagged = Vec::with_capacity(rows.len());
    for row in rows {
        flagged.push(flag_sla_breach(pool, row).await);
    }

    let enriched = enrich_tasks(pool, flagged, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateTaskInput>,
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
    let created = create_row(pool, "tasks", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "tasks",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_task(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let flagged = flag_sla_breach(pool, record).await;
    let mut enriched = enrich_tasks(pool, vec![flagged], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_task(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateTaskInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    let previous_status = value_str(&record, "status");
    let updated = update_row(pool, "tasks", &path.task_id, &patch, "id").await?;
    let next_status = value_str(&updated, "status");

    if should_emit_task_completed(&previous_status, &next_status) {
        let ctx = build_task_workflow_context(&path.task_id, &updated);
        fire_trigger(
            pool,
            &org_id,
            "task_completed",
            &ctx,
            state.config.workflow_engine_mode,
        )
        .await;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "tasks",
        Some(&path.task_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn complete_task(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    headers: HeaderMap,
    payload: Option<Json<CompleteTaskInput>>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(
        &state,
        &user_id,
        &org_id,
        &["owner_admin", "operator", "cleaner"],
    )
    .await?;

    let previous_status = value_str(&record, "status");

    let missing_required = list_rows(
        pool,
        "task_items",
        Some(&json_map(&[
            ("task_id", Value::String(path.task_id.clone())),
            ("is_required", Value::Bool(true)),
            ("is_completed", Value::Bool(false)),
        ])),
        2000,
        0,
        "sort_order",
        true,
    )
    .await?;

    if !missing_required.is_empty() {
        let labels = missing_required
            .iter()
            .filter_map(|row| row.as_object())
            .filter_map(|obj| obj.get("label").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();

        let preview = labels
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        let mut suffix = if preview.is_empty() {
            String::new()
        } else {
            format!(" Missing: {preview}")
        };
        if labels.len() > 5 {
            suffix = if suffix.is_empty() {
                format!(" (+{} more)", labels.len() - 5)
            } else {
                format!("{suffix} (+{} more)", labels.len() - 5)
            };
        }

        return Err(AppError::BadRequest(format!(
            "Complete required checklist items before completing this task.{suffix}"
        )));
    }

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("done".to_string()));
    patch.insert(
        "completed_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    patch.insert(
        "completion_notes".to_string(),
        payload
            .and_then(|item| item.0.completion_notes)
            .map(Value::String)
            .unwrap_or(Value::Null),
    );

    let updated = update_row(pool, "tasks", &path.task_id, &patch, "id").await?;
    let next_status = value_str(&updated, "status");

    if should_emit_task_completed(&previous_status, &next_status) {
        let ctx = build_task_workflow_context(&path.task_id, &updated);
        fire_trigger(
            pool,
            &org_id,
            "task_completed",
            &ctx,
            state.config.workflow_engine_mode,
        )
        .await;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "complete",
        "tasks",
        Some(&path.task_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn list_task_items(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Query(query): Query<TaskItemsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let task = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&task, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let rows = list_rows(
        pool,
        "task_items",
        Some(&json_map(&[(
            "task_id",
            Value::String(path.task_id.clone()),
        )])),
        clamp_limit_in_range(query.limit, 1, 2000),
        0,
        "sort_order",
        true,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_task_item(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    headers: HeaderMap,
    Json(payload): Json<CreateTaskItemInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let task = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&task, "organization_id");
    assert_org_role(&state, &user_id, &org_id, TASK_ITEM_MANAGE_ROLES).await?;

    let label = payload.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::BadRequest("label is required.".to_string()));
    }

    let sort_order = if let Some(value) = payload.sort_order {
        if value <= 0 {
            return Err(AppError::BadRequest(
                "sort_order must be greater than 0.".to_string(),
            ));
        }
        value
    } else {
        next_sort_order(pool, &path.task_id).await?
    };

    let mut record = Map::new();
    record.insert("task_id".to_string(), Value::String(path.task_id.clone()));
    record.insert("sort_order".to_string(), json!(sort_order));
    record.insert("label".to_string(), Value::String(label));
    record.insert("is_required".to_string(), Value::Bool(payload.is_required));
    record.insert("is_completed".to_string(), Value::Bool(false));

    let created = create_row(pool, "task_items", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "create",
        "task_items",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn update_task_item(
    State(state): State<AppState>,
    Path(path): Path<TaskItemPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateTaskItemInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let task = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&task, "organization_id");
    assert_org_role(&state, &user_id, &org_id, TASK_ITEM_UPDATE_ROLES).await?;

    let existing = get_row(pool, "task_items", &path.item_id, "id").await?;
    if value_str(&existing, "task_id") != path.task_id {
        return Err(AppError::NotFound(
            "task_items record not found.".to_string(),
        ));
    }

    let mut patch = remove_nulls(serialize_to_map(&payload));

    if let Some(label) = patch.get("label").and_then(Value::as_str) {
        let next_label = label.trim().to_string();
        if next_label.is_empty() {
            return Err(AppError::BadRequest("label cannot be empty.".to_string()));
        }
        patch.insert("label".to_string(), Value::String(next_label));
    }

    if patch.contains_key("sort_order") {
        let Some(order) = patch.get("sort_order").and_then(value_as_i64) else {
            return Err(AppError::BadRequest(
                "sort_order must be an integer.".to_string(),
            ));
        };
        if order <= 0 {
            return Err(AppError::BadRequest(
                "sort_order must be greater than 0.".to_string(),
            ));
        }
        patch.insert("sort_order".to_string(), json!(order));
    }

    // photo_urls is serialized as a Vec<String>; convert to JSON array for JSONB column
    if let Some(urls) = patch.get("photo_urls") {
        if let Some(arr) = urls.as_array() {
            for url in arr {
                if !url.is_string() {
                    return Err(AppError::BadRequest(
                        "photo_urls must be an array of strings.".to_string(),
                    ));
                }
            }
        }
    }

    let updated = update_row(pool, "task_items", &path.item_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "task_items",
        Some(&path.item_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn delete_task_item(
    State(state): State<AppState>,
    Path(path): Path<TaskItemPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let task = get_task_record(pool, &path.task_id).await?;
    let org_id = value_str(&task, "organization_id");
    assert_org_role(&state, &user_id, &org_id, TASK_ITEM_MANAGE_ROLES).await?;

    let existing = get_row(pool, "task_items", &path.item_id, "id").await?;
    if value_str(&existing, "task_id") != path.task_id {
        return Err(AppError::NotFound(
            "task_items record not found.".to_string(),
        ));
    }

    let deleted = delete_row(pool, "task_items", &path.item_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "task_items",
        Some(&path.item_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}

async fn get_task_record(pool: &sqlx::PgPool, task_id: &str) -> AppResult<Value> {
    let record = get_row(pool, "tasks", task_id, "id").await?;
    if value_str(&record, "organization_id").is_empty() {
        return Err(AppError::Internal(
            "Task is missing organization_id.".to_string(),
        ));
    }
    Ok(record)
}

async fn next_sort_order(pool: &sqlx::PgPool, task_id: &str) -> AppResult<i32> {
    let rows = list_rows(
        pool,
        "task_items",
        Some(&json_map(&[(
            "task_id",
            Value::String(task_id.to_string()),
        )])),
        1,
        0,
        "sort_order",
        false,
    )
    .await?;

    if rows.is_empty() {
        return Ok(1);
    }

    let value = rows
        .first()
        .and_then(|row| row.as_object())
        .and_then(|obj| obj.get("sort_order"))
        .and_then(value_as_i64)
        .unwrap_or(0)
        .max(0)
        + 1;

    Ok(value as i32)
}

async fn flag_sla_breach(pool: &sqlx::PgPool, task: Value) -> Value {
    let Some(obj) = task.as_object() else {
        return task;
    };

    let status = value_string(obj.get("status")).unwrap_or_default();
    if status == "done" || status == "cancelled" {
        return task;
    }
    if has_truthy_value(obj.get("sla_breached_at")) {
        return task;
    }

    let Some(sla_due_at) = parse_iso_datetime(obj.get("sla_due_at")) else {
        return task;
    };

    if sla_due_at.with_timezone(&Utc) <= Utc::now() {
        let task_id = value_string(obj.get("id")).unwrap_or_default();
        if task_id.is_empty() {
            return task;
        }

        let mut patch = Map::new();
        patch.insert(
            "sla_breached_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );

        if let Ok(updated) = update_row(pool, "tasks", &task_id, &patch, "id").await {
            return updated;
        }
    }

    task
}

fn parse_iso_datetime(value: Option<&Value>) -> Option<DateTime<chrono::FixedOffset>> {
    let mut text = value_string(value)?;
    if text.ends_with('Z') {
        text.truncate(text.len().saturating_sub(1));
        text.push_str("+00:00");
    }
    DateTime::parse_from_rfc3339(&text).ok()
}

fn has_truthy_value(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => !text.trim().is_empty(),
        Some(Value::Number(number)) => number.as_i64().is_some_and(|item| item != 0),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::Object(object)) => !object.is_empty(),
        _ => false,
    }
}

fn should_emit_task_completed(previous_status: &str, next_status: &str) -> bool {
    let previous = previous_status.trim().to_ascii_lowercase();
    let next = next_status.trim().to_ascii_lowercase();
    matches!(previous.as_str(), "todo" | "in_progress") && next == "done"
}

fn build_task_workflow_context(task_id: &str, task: &Value) -> Map<String, Value> {
    let mut context = Map::new();
    context.insert("task_id".to_string(), Value::String(task_id.to_string()));

    if let Some(obj) = task.as_object() {
        for key in [
            "property_id",
            "unit_id",
            "reservation_id",
            "assigned_user_id",
            "priority",
            "title",
            "type",
            "status",
        ] {
            if let Some(value) = obj.get(key) {
                if !value.is_null() {
                    context.insert(key.to_string(), value.clone());
                }
            }
        }
    }

    context
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
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

fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::{build_task_workflow_context, should_emit_task_completed};
    use serde_json::json;

    #[test]
    fn task_completed_emits_only_on_transition_to_done() {
        assert!(should_emit_task_completed("todo", "done"));
        assert!(should_emit_task_completed("in_progress", "done"));
        assert!(!should_emit_task_completed("done", "done"));
        assert!(!should_emit_task_completed("cancelled", "done "));
        assert!(!should_emit_task_completed("todo", "in_progress"));
    }

    #[test]
    fn build_task_workflow_context_includes_non_null_fields() {
        let task = json!({
            "title": "Fix sink",
            "type": "maintenance",
            "priority": "high",
            "status": "done",
            "property_id": "p1",
            "unit_id": null
        });

        let context = build_task_workflow_context("t1", &task);
        assert_eq!(
            context.get("task_id").and_then(|value| value.as_str()),
            Some("t1")
        );
        assert_eq!(
            context.get("title").and_then(|value| value.as_str()),
            Some("Fix sink")
        );
        assert_eq!(
            context.get("status").and_then(|value| value.as_str()),
            Some("done")
        );
        assert_eq!(context.get("unit_id"), None);
    }
}
