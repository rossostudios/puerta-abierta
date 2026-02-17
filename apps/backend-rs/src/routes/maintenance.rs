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
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const MAINTENANCE_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/maintenance-requests",
            axum::routing::get(list_maintenance_requests),
        )
        .route(
            "/maintenance-requests/{request_id}",
            axum::routing::get(get_maintenance_request).patch(update_maintenance_request),
        )
        .route(
            "/public/maintenance-request",
            axum::routing::post(public_create_maintenance_request),
        )
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct MaintenanceRequestsQuery {
    org_id: String,
    status: Option<String>,
    property_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    200
}

#[derive(Debug, serde::Deserialize)]
struct MaintenanceRequestPath {
    request_id: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct UpdateMaintenanceRequestInput {
    status: Option<String>,
    resolution_notes: Option<String>,
    assigned_user_id: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct PublicMaintenanceInput {
    property_code: Option<String>,
    org_id: Option<String>,
    tenant_name: String,
    tenant_phone: Option<String>,
    tenant_email: Option<String>,
    category: Option<String>,
    title: String,
    description: Option<String>,
    urgency: Option<String>,
}

async fn list_maintenance_requests(
    State(state): State<AppState>,
    Query(query): Query<MaintenanceRequestsQuery>,
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
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        filters.insert("property_id".to_string(), Value::String(property_id));
    }

    let rows = list_rows(
        pool,
        "maintenance_requests",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn get_maintenance_request(
    State(state): State<AppState>,
    Path(path): Path<MaintenanceRequestPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "maintenance_requests", &path.request_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn update_maintenance_request(
    State(state): State<AppState>,
    Path(path): Path<MaintenanceRequestPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateMaintenanceRequestInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let existing = get_row(pool, "maintenance_requests", &path.request_id, "id").await?;
    let org_id = val_str(&existing, "organization_id");
    assert_org_role(&state, &user_id, &org_id, MAINTENANCE_EDIT_ROLES).await?;

    let mut patch = Map::new();
    if let Some(status) = &payload.status {
        patch.insert("status".to_string(), Value::String(status.clone()));
        match status.as_str() {
            "acknowledged" => {
                patch.insert(
                    "acknowledged_at".to_string(),
                    Value::String(chrono::Utc::now().to_rfc3339()),
                );
            }
            "scheduled" => {
                patch.insert(
                    "scheduled_at".to_string(),
                    Value::String(chrono::Utc::now().to_rfc3339()),
                );
            }
            "completed" | "closed" => {
                patch.insert(
                    "completed_at".to_string(),
                    Value::String(chrono::Utc::now().to_rfc3339()),
                );
            }
            _ => {}
        }
    }
    if let Some(notes) = &payload.resolution_notes {
        patch.insert("resolution_notes".to_string(), Value::String(notes.clone()));
    }

    if patch.is_empty() {
        return Ok(Json(existing));
    }

    let updated = update_row(pool, "maintenance_requests", &path.request_id, &patch, "id").await?;

    // Also update the linked task status if it exists
    let task_id = val_str(&updated, "task_id");
    if !task_id.is_empty() {
        if let Some(status) = &payload.status {
            let task_status = match status.as_str() {
                "acknowledged" | "scheduled" => "in_progress",
                "in_progress" => "in_progress",
                "completed" | "closed" => "done",
                _ => "",
            };
            if !task_status.is_empty() {
                let mut task_patch = Map::new();
                task_patch.insert("status".to_string(), Value::String(task_status.to_string()));
                if task_status == "done" {
                    task_patch.insert(
                        "completed_at".to_string(),
                        Value::String(chrono::Utc::now().to_rfc3339()),
                    );
                }
                let _ = update_row(pool, "tasks", &task_id, &task_patch, "id").await;
            }
        }
    }

    // Notify tenant of status changes via WhatsApp
    if let Some(status) = &payload.status {
        let tenant_phone = val_str(&updated, "submitted_by_phone");
        let tenant_name = val_str(&updated, "submitted_by_name");
        let title = val_str(&updated, "title");

        if !tenant_phone.is_empty() && !org_id.is_empty() {
            let body = match status.as_str() {
                "acknowledged" => Some(format!(
                    "✅ Solicitud recibida\n\n\
                     Hola {tenant_name}, tu solicitud de mantenimiento \"{title}\" fue recibida.\n\
                     Estamos revisándola y te contactaremos pronto.\n\
                     — Casaora"
                )),
                "scheduled" => Some(format!(
                    "📅 Mantenimiento programado\n\n\
                     Hola {tenant_name}, el mantenimiento \"{title}\" fue programado.\n\
                     Te contactaremos con los detalles de fecha y hora.\n\
                     — Casaora"
                )),
                "completed" | "closed" => {
                    let resolution = payload.resolution_notes.as_deref().unwrap_or("");
                    let notes_part = if resolution.is_empty() {
                        String::new()
                    } else {
                        format!("\nNotas: {resolution}")
                    };
                    Some(format!(
                        "🔧 Mantenimiento completado\n\n\
                         Hola {tenant_name}, el mantenimiento \"{title}\" fue completado.{notes_part}\n\n\
                         Si tienes algún problema, envía una nueva solicitud.\n\
                         — Casaora"
                    ))
                }
                _ => None,
            };

            if let Some(body) = body {
                let mut msg = Map::new();
                msg.insert("organization_id".to_string(), Value::String(org_id.clone()));
                msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
                msg.insert("recipient".to_string(), Value::String(tenant_phone));
                msg.insert("status".to_string(), Value::String("queued".to_string()));
                msg.insert(
                    "scheduled_at".to_string(),
                    Value::String(chrono::Utc::now().to_rfc3339()),
                );
                let mut pl = Map::new();
                pl.insert("body".to_string(), Value::String(body));
                pl.insert(
                    "reminder_type".to_string(),
                    Value::String(format!("maintenance_{status}")),
                );
                pl.insert(
                    "maintenance_request_id".to_string(),
                    Value::String(path.request_id.clone()),
                );
                msg.insert("payload".to_string(), Value::Object(pl));
                let _ = create_row(pool, "message_logs", &msg).await;
            }
        }
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "maintenance_requests",
        Some(&path.request_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

/// Public endpoint for tenants without accounts — property manager shares a URL.
async fn public_create_maintenance_request(
    State(state): State<AppState>,
    Json(payload): Json<PublicMaintenanceInput>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;

    // Resolve organization from property_code or org_id
    let org_id = if let Some(org_id) = non_empty_opt(payload.org_id.as_deref()) {
        org_id
    } else if let Some(property_code) = non_empty_opt(payload.property_code.as_deref()) {
        // Look up property by code
        let mut filters = Map::new();
        filters.insert("code".to_string(), Value::String(property_code));
        let properties = list_rows(
            pool,
            "properties",
            Some(&filters),
            1,
            0,
            "created_at",
            false,
        )
        .await?;
        let property = properties
            .first()
            .ok_or_else(|| AppError::NotFound("Property not found.".to_string()))?;
        val_str(property, "organization_id")
    } else {
        return Err(AppError::BadRequest(
            "org_id or property_code is required.".to_string(),
        ));
    };

    let mut record = Map::new();
    record.insert("organization_id".to_string(), Value::String(org_id.clone()));
    record.insert(
        "category".to_string(),
        Value::String(payload.category.unwrap_or_else(|| "general".to_string())),
    );
    record.insert("title".to_string(), Value::String(payload.title));
    if let Some(desc) = payload.description {
        record.insert("description".to_string(), Value::String(desc));
    }
    record.insert(
        "urgency".to_string(),
        Value::String(payload.urgency.unwrap_or_else(|| "medium".to_string())),
    );
    record.insert(
        "submitted_by_name".to_string(),
        Value::String(payload.tenant_name),
    );
    if let Some(phone) = payload.tenant_phone {
        record.insert("submitted_by_phone".to_string(), Value::String(phone));
    }
    if let Some(email) = payload.tenant_email {
        record.insert("submitted_by_email".to_string(), Value::String(email));
    }

    let created = create_row(pool, "maintenance_requests", &record).await?;

    // Auto-create a task
    let mr_id = val_str(&created, "id");
    let mut task = Map::new();
    task.insert("organization_id".to_string(), Value::String(org_id));
    task.insert("type".to_string(), Value::String("maintenance".to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert("priority".to_string(), Value::String("medium".to_string()));
    task.insert(
        "title".to_string(),
        Value::String(format!("Maintenance: {}", val_str(&created, "title"))),
    );

    if let Ok(task_created) = create_row(pool, "tasks", &task).await {
        let task_id = val_str(&task_created, "id");
        if !task_id.is_empty() {
            let mut mr_patch = Map::new();
            mr_patch.insert("task_id".to_string(), Value::String(task_id));
            let _ = update_row(pool, "maintenance_requests", &mr_id, &mr_patch, "id").await;
        }
    }

    Ok((axum::http::StatusCode::CREATED, Json(created)))
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
