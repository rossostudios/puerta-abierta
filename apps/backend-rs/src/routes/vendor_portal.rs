use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    services::token_hash::{hash_token, hash_token_sha1},
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/vendor/request-access",
            axum::routing::post(request_access),
        )
        .route("/public/vendor/verify", axum::routing::post(verify_token))
        .route("/vendor/jobs", axum::routing::get(list_jobs))
        .route(
            "/vendor/jobs/{task_id}",
            axum::routing::get(get_job).patch(update_job),
        )
        .route(
            "/vendor/jobs/{task_id}/complete",
            axum::routing::post(complete_job),
        )
}

#[derive(Debug, Deserialize)]
struct RequestAccessInput {
    vendor_name: String,
    vendor_phone: Option<String>,
    vendor_email: Option<String>,
    organization_id: String,
}

#[derive(Debug, Deserialize)]
struct VerifyTokenInput {
    token: String,
}

#[derive(Debug, Deserialize)]
struct TaskIdPath {
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateJobInput {
    status: Option<String>,
    notes: Option<String>,
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
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

/// Generate a vendor access token (called by admin to invite a vendor).
async fn request_access(
    State(state): State<AppState>,
    Json(payload): Json<RequestAccessInput>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;
    let name = payload.vendor_name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest(
            "vendor_name is required.".to_string(),
        ));
    }

    // Verify org exists
    let _ = get_row(pool, "organizations", &payload.organization_id, "id")
        .await
        .map_err(|_| AppError::NotFound("Organization not found.".to_string()))?;

    // Generate token
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash_val = hash_token(&raw_token);

    let mut record = Map::new();
    record.insert("vendor_name".to_string(), Value::String(name.to_string()));
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    record.insert("token_hash".to_string(), Value::String(token_hash_val));
    if let Some(ref phone) = payload.vendor_phone {
        record.insert("vendor_phone".to_string(), Value::String(phone.clone()));
    }
    if let Some(ref email) = payload.vendor_email {
        record.insert("vendor_email".to_string(), Value::String(email.clone()));
    }

    create_row(pool, "vendor_access_tokens", &record).await?;

    let app_base_url = std::env::var("NEXT_PUBLIC_APP_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let magic_link = format!("{app_base_url}/vendor/{raw_token}");

    // Queue WhatsApp notification if phone provided
    if let Some(ref phone) = payload.vendor_phone {
        let msg_body = format!(
            "Hola {name}, tiene trabajos asignados. Acceda aquí: {magic_link}"
        );
        let mut msg_record = Map::new();
        msg_record.insert(
            "organization_id".to_string(),
            Value::String(payload.organization_id.clone()),
        );
        msg_record.insert(
            "channel".to_string(),
            Value::String("whatsapp".to_string()),
        );
        msg_record.insert(
            "direction".to_string(),
            Value::String("outbound".to_string()),
        );
        msg_record.insert("to_address".to_string(), Value::String(phone.clone()));
        msg_record.insert("body".to_string(), Value::String(msg_body));
        msg_record.insert("status".to_string(), Value::String("queued".to_string()));
        let _ = create_row(pool, "message_logs", &msg_record).await;
    }

    Ok(Json(json!({
        "message": "Vendor access link generated.",
        "vendor_name": name,
        "link": magic_link,
    })))
}

/// Verify a vendor access token.
async fn verify_token(
    State(state): State<AppState>,
    Json(payload): Json<VerifyTokenInput>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;
    let raw_token = payload.token.trim();
    if raw_token.is_empty() {
        return Err(AppError::BadRequest("token is required.".to_string()));
    }

    let token_record = match get_row(
        pool,
        "vendor_access_tokens",
        &hash_token(raw_token),
        "token_hash",
    )
    .await
    {
        Ok(record) => record,
        Err(_) => get_row(
            pool,
            "vendor_access_tokens",
            &hash_token_sha1(raw_token),
            "token_hash",
        )
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?,
    };

    // Check expiry
    if let Some(expires_at) = token_record
        .as_object()
        .and_then(|o| o.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                return Err(AppError::Unauthorized(
                    "Token has expired. Request a new access link.".to_string(),
                ));
            }
        }
    }

    // Update last_used_at
    let token_id = val_str(&token_record, "id");
    let mut patch = Map::new();
    patch.insert(
        "last_used_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    let _ = update_row(pool, "vendor_access_tokens", &token_id, &patch, "id").await;

    let org_id = val_str(&token_record, "organization_id");
    let vendor_name = val_str(&token_record, "vendor_name");

    Ok(Json(json!({
        "authenticated": true,
        "organization_id": org_id,
        "vendor_name": vendor_name,
    })))
}

/// Auth helper — extract org_id + vendor_name from x-vendor-token header.
async fn require_vendor<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
) -> AppResult<(&'a sqlx::PgPool, String, String)> {
    let pool = db_pool(state)?;

    let raw_token = headers
        .get("x-vendor-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Unauthorized("Missing x-vendor-token header.".to_string())
        })?;

    let token_record = match get_row(
        pool,
        "vendor_access_tokens",
        &hash_token(raw_token),
        "token_hash",
    )
    .await
    {
        Ok(record) => record,
        Err(_) => get_row(
            pool,
            "vendor_access_tokens",
            &hash_token_sha1(raw_token),
            "token_hash",
        )
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?,
    };

    if let Some(expires_at) = token_record
        .as_object()
        .and_then(|o| o.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                return Err(AppError::Unauthorized("Token has expired.".to_string()));
            }
        }
    }

    let org_id = val_str(&token_record, "organization_id");
    let vendor_name = val_str(&token_record, "vendor_name");
    if org_id.is_empty() {
        return Err(AppError::Unauthorized("Invalid token.".to_string()));
    }

    Ok((pool, org_id, vendor_name))
}

/// List maintenance tasks assigned as vendor jobs.
async fn list_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id, _vendor_name) = require_vendor(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.clone()),
    );
    filters.insert(
        "type".to_string(),
        Value::String("maintenance".to_string()),
    );

    let rows = list_rows(pool, "tasks", Some(&filters), 100, 0, "due_at", true).await?;

    // Enrich with property/unit info
    let mut jobs = Vec::new();
    for row in &rows {
        let property_id = val_str(row, "property_id");
        let unit_id = val_str(row, "unit_id");

        let property_name = if !property_id.is_empty() {
            get_row(pool, "properties", &property_id, "id")
                .await
                .ok()
                .map(|p| val_str(&p, "name"))
                .unwrap_or_default()
        } else {
            String::new()
        };

        let unit_name = if !unit_id.is_empty() {
            get_row(pool, "units", &unit_id, "id")
                .await
                .ok()
                .map(|u| val_str(&u, "name"))
                .unwrap_or_default()
        } else {
            String::new()
        };

        jobs.push(json!({
            "id": val_str(row, "id"),
            "title": val_str(row, "title"),
            "description": val_str(row, "description"),
            "status": val_str(row, "status"),
            "priority": val_str(row, "priority"),
            "due_at": val_str(row, "due_at"),
            "property_name": property_name,
            "unit_name": unit_name,
            "created_at": val_str(row, "created_at"),
        }));
    }

    Ok(Json(json!({
        "organization_id": org_id,
        "data": jobs,
    })))
}

/// Get a single job (task) detail with checklist items.
async fn get_job(
    State(state): State<AppState>,
    Path(path): Path<TaskIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id, _) = require_vendor(&state, &headers).await?;

    let task = get_row(pool, "tasks", &path.task_id, "id")
        .await
        .map_err(|_| AppError::NotFound("Job not found.".to_string()))?;

    // Verify same org
    if val_str(&task, "organization_id") != org_id {
        return Err(AppError::Forbidden("Access denied.".to_string()));
    }

    // Load checklist items
    let mut item_filters = Map::new();
    item_filters.insert(
        "task_id".to_string(),
        Value::String(path.task_id.clone()),
    );
    let items =
        list_rows(pool, "task_items", Some(&item_filters), 200, 0, "sort_order", true).await?;

    Ok(Json(json!({
        "id": val_str(&task, "id"),
        "title": val_str(&task, "title"),
        "description": val_str(&task, "description"),
        "status": val_str(&task, "status"),
        "priority": val_str(&task, "priority"),
        "due_at": val_str(&task, "due_at"),
        "items": items,
    })))
}

/// Update a job — status change or add notes.
async fn update_job(
    State(state): State<AppState>,
    Path(path): Path<TaskIdPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateJobInput>,
) -> AppResult<Json<Value>> {
    let (pool, org_id, vendor_name) = require_vendor(&state, &headers).await?;

    let task = get_row(pool, "tasks", &path.task_id, "id")
        .await
        .map_err(|_| AppError::NotFound("Job not found.".to_string()))?;

    if val_str(&task, "organization_id") != org_id {
        return Err(AppError::Forbidden("Access denied.".to_string()));
    }

    let mut patch = Map::new();
    if let Some(ref status) = payload.status {
        patch.insert("status".to_string(), Value::String(status.clone()));
    }
    if let Some(ref notes) = payload.notes {
        patch.insert("completion_notes".to_string(), Value::String(notes.clone()));
    }

    if patch.is_empty() {
        return Ok(Json(json!({ "ok": true, "message": "No changes." })));
    }

    update_row(pool, "tasks", &path.task_id, &patch, "id").await?;

    // Write audit log
    crate::services::audit::write_audit_log(
        Some(pool),
        Some(&org_id),
        None,
        "task_updated_by_vendor",
        "tasks",
        Some(&path.task_id),
        None,
        Some(json!({ "vendor_name": vendor_name, "changes": patch })),
    )
    .await;

    Ok(Json(json!({ "ok": true, "task_id": path.task_id })))
}

/// Mark a job as complete.
async fn complete_job(
    State(state): State<AppState>,
    Path(path): Path<TaskIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id, vendor_name) = require_vendor(&state, &headers).await?;

    let task = get_row(pool, "tasks", &path.task_id, "id")
        .await
        .map_err(|_| AppError::NotFound("Job not found.".to_string()))?;

    if val_str(&task, "organization_id") != org_id {
        return Err(AppError::Forbidden("Access denied.".to_string()));
    }

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("done".to_string()));
    patch.insert(
        "completed_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    patch.insert(
        "completed_by_name".to_string(),
        Value::String(vendor_name.clone()),
    );

    update_row(pool, "tasks", &path.task_id, &patch, "id").await?;

    // Notify org via audit log
    crate::services::audit::write_audit_log(
        Some(pool),
        Some(&org_id),
        None,
        "task_completed_by_vendor",
        "tasks",
        Some(&path.task_id),
        None,
        Some(json!({ "vendor_name": vendor_name })),
    )
    .await;

    Ok(Json(json!({
        "ok": true,
        "task_id": path.task_id,
        "status": "done",
        "completed_by": vendor_name,
    })))
}
