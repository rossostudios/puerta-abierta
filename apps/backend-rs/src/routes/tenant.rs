use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde_json::{json, Map, Value};
use sha1::Digest;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/tenant/request-access",
            axum::routing::post(request_access),
        )
        .route(
            "/public/tenant/verify",
            axum::routing::post(verify_token),
        )
        .route("/tenant/me", axum::routing::get(tenant_me))
        .route("/tenant/payments", axum::routing::get(tenant_payments))
        .route(
            "/tenant/maintenance-requests",
            axum::routing::get(tenant_list_maintenance)
                .post(tenant_create_maintenance),
        )
}

#[derive(Debug, serde::Deserialize)]
struct RequestAccessInput {
    email: String,
}

#[derive(Debug, serde::Deserialize)]
struct VerifyTokenInput {
    token: String,
}

#[derive(Debug, serde::Deserialize)]
struct TenantPaymentsQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    200
}

#[derive(Debug, serde::Deserialize)]
struct CreateMaintenanceInput {
    category: Option<String>,
    title: String,
    description: Option<String>,
    urgency: Option<String>,
    photo_urls: Option<Vec<String>>,
}

/// Generate a magic link token for a tenant. Sends via WhatsApp/email.
async fn request_access(
    State(state): State<AppState>,
    Json(payload): Json<RequestAccessInput>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() {
        return Err(AppError::BadRequest("email is required.".to_string()));
    }

    // Find active leases for this email
    let mut filters = Map::new();
    filters.insert("tenant_email".to_string(), Value::String(email.clone()));
    let leases = list_rows(pool, "leases", Some(&filters), 10, 0, "created_at", false).await?;

    let active_lease = leases.iter().find(|l| {
        let status = val_str(l, "lease_status");
        status == "active" || status == "draft"
    });

    let lease = active_lease.ok_or_else(|| {
        AppError::NotFound("No active lease found for this email.".to_string())
    })?;

    let lease_id = val_str(lease, "id");

    // Generate a random token
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let mut record = Map::new();
    record.insert("lease_id".to_string(), Value::String(lease_id));
    record.insert("email".to_string(), Value::String(email.clone()));
    record.insert("token_hash".to_string(), Value::String(token_hash));

    if let Some(phone) = lease
        .as_object()
        .and_then(|o| o.get("tenant_phone_e164"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        record.insert("phone_e164".to_string(), Value::String(phone.to_string()));
    }

    create_row(pool, "tenant_access_tokens", &record).await?;

    // Queue a message with the magic link
    let app_base_url = std::env::var("NEXT_PUBLIC_APP_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let magic_link = format!("{app_base_url}/tenant/login?token={raw_token}");

    let org_id = val_str(lease, "organization_id");
    if !org_id.is_empty() {
        let tenant_phone = val_str(lease, "tenant_phone_e164");
        if !tenant_phone.is_empty() {
            let mut msg = Map::new();
            msg.insert("organization_id".to_string(), Value::String(org_id));
            msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
            msg.insert("recipient".to_string(), Value::String(tenant_phone));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let mut payload_map = Map::new();
            payload_map.insert(
                "body".to_string(),
                Value::String(format!(
                    "Tu enlace de acceso a Puerta Abierta: {magic_link}\n\nEste enlace expira en 24 horas."
                )),
            );
            msg.insert("payload".to_string(), Value::Object(payload_map));
            let _ = create_row(pool, "message_logs", &msg).await;
        }
    }

    Ok((
        axum::http::StatusCode::OK,
        Json(json!({
            "message": "Access link sent to your registered contact.",
            "email": email,
        })),
    ))
}

/// Verify a magic link token. Returns a short-lived JWT-like response.
async fn verify_token(
    State(state): State<AppState>,
    Json(payload): Json<VerifyTokenInput>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;
    let raw_token = payload.token.trim();
    if raw_token.is_empty() {
        return Err(AppError::BadRequest("token is required.".to_string()));
    }

    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let token_record = get_row(
        pool,
        "tenant_access_tokens",
        &token_hash,
        "token_hash",
    )
    .await
    .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?;

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
    let _ = update_row(pool, "tenant_access_tokens", &token_id, &patch, "id").await;

    let lease_id = val_str(&token_record, "lease_id");
    let email = val_str(&token_record, "email");

    Ok(Json(json!({
        "authenticated": true,
        "lease_id": lease_id,
        "email": email,
        "token_hash": token_hash,
    })))
}

/// Get tenant dashboard data — lease summary, property info.
async fn tenant_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let lease = get_row(pool, "leases", &lease_id, "id").await?;

    let property_id = val_str(&lease, "property_id");
    let unit_id = val_str(&lease, "unit_id");

    let property = if !property_id.is_empty() {
        get_row(pool, "properties", &property_id, "id").await.ok()
    } else {
        None
    };

    let unit = if !unit_id.is_empty() {
        get_row(pool, "units", &unit_id, "id").await.ok()
    } else {
        None
    };

    // Get upcoming collections
    let mut filters = Map::new();
    filters.insert("lease_id".to_string(), Value::String(lease_id.clone()));
    let collections = list_rows(pool, "collection_records", Some(&filters), 12, 0, "due_date", true).await?;

    let next_payment = collections.iter().find(|c| {
        let status = val_str(c, "status");
        status != "paid" && status != "waived"
    });

    Ok(Json(json!({
        "lease": lease,
        "property": property,
        "unit": unit,
        "next_payment": next_payment,
        "total_upcoming_payments": collections.iter().filter(|c| {
            let s = val_str(c, "status");
            s != "paid" && s != "waived"
        }).count(),
    })))
}

/// List tenant's payment history.
async fn tenant_payments(
    State(state): State<AppState>,
    Query(query): Query<TenantPaymentsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert("lease_id".to_string(), Value::String(lease_id));

    let rows = list_rows(
        pool,
        "collection_records",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "due_date",
        false,
    )
    .await?;

    // Enrich with payment instruction links
    let mut enriched = Vec::with_capacity(rows.len());
    for row in rows {
        let collection_id = val_str(&row, "id");
        let payment_link = if !collection_id.is_empty() {
            let mut pi_filters = Map::new();
            pi_filters.insert(
                "collection_record_id".to_string(),
                Value::String(collection_id),
            );
            pi_filters.insert("status".to_string(), Value::String("active".to_string()));
            list_rows(pool, "payment_instructions", Some(&pi_filters), 1, 0, "created_at", false)
                .await
                .ok()
                .and_then(|rows| rows.into_iter().next())
                .and_then(|pi| {
                    pi.as_object()
                        .and_then(|o| o.get("reference_code"))
                        .and_then(Value::as_str)
                        .map(|rc| rc.to_string())
                })
        } else {
            None
        };

        let mut row_obj = row
            .as_object()
            .cloned()
            .unwrap_or_default();
        if let Some(ref_code) = payment_link {
            row_obj.insert(
                "payment_link_reference".to_string(),
                Value::String(ref_code),
            );
        }
        enriched.push(Value::Object(row_obj));
    }

    Ok(Json(json!({ "data": enriched })))
}

/// List tenant's maintenance requests.
async fn tenant_list_maintenance(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert("lease_id".to_string(), Value::String(lease_id));

    let rows = list_rows(
        pool,
        "maintenance_requests",
        Some(&filters),
        100,
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

/// Create a maintenance request as a tenant.
async fn tenant_create_maintenance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateMaintenanceInput>,
) -> AppResult<impl IntoResponse> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let lease = get_row(pool, "leases", &lease_id, "id").await?;
    let org_id = val_str(&lease, "organization_id");
    let property_id = val_str(&lease, "property_id");
    let unit_id = val_str(&lease, "unit_id");

    let mut record = Map::new();
    record.insert("organization_id".to_string(), Value::String(org_id.clone()));
    record.insert("lease_id".to_string(), Value::String(lease_id));
    if !property_id.is_empty() {
        record.insert("property_id".to_string(), Value::String(property_id.clone()));
    }
    if !unit_id.is_empty() {
        record.insert("unit_id".to_string(), Value::String(unit_id.clone()));
    }
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
    if let Some(photos) = payload.photo_urls {
        record.insert(
            "photo_urls".to_string(),
            Value::Array(photos.into_iter().map(Value::String).collect()),
        );
    }
    record.insert(
        "submitted_by_name".to_string(),
        Value::String(val_str(&lease, "tenant_full_name")),
    );
    record.insert(
        "submitted_by_email".to_string(),
        Value::String(val_str(&lease, "tenant_email")),
    );
    record.insert(
        "submitted_by_phone".to_string(),
        Value::String(val_str(&lease, "tenant_phone_e164")),
    );

    let created = create_row(pool, "maintenance_requests", &record).await?;
    let mr_id = val_str(&created, "id");

    // Auto-create a task linked to this maintenance request
    let mut task = Map::new();
    task.insert("organization_id".to_string(), Value::String(org_id));
    if !property_id.is_empty() {
        task.insert("property_id".to_string(), Value::String(property_id));
    }
    if !unit_id.is_empty() {
        task.insert("unit_id".to_string(), Value::String(unit_id));
    }
    task.insert(
        "type".to_string(),
        Value::String("maintenance".to_string()),
    );
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert(
        "priority".to_string(),
        Value::String(
            val_str(&created, "urgency")
                .replace("emergency", "urgent")
                .replace("low", "low")
                .replace("medium", "medium")
                .replace("high", "high"),
        ),
    );
    task.insert(
        "title".to_string(),
        Value::String(format!(
            "Maintenance: {}",
            val_str(&created, "title")
        )),
    );
    task.insert(
        "description".to_string(),
        Value::String(val_str(&created, "description")),
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

/// Authenticate a tenant from the x-tenant-token header.
async fn require_tenant<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
) -> AppResult<(&'a sqlx::PgPool, String)> {
    let pool = db_pool(state)?;

    let raw_token = headers
        .get("x-tenant-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Unauthorized("Missing x-tenant-token header.".to_string())
        })?;

    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let token_record = get_row(pool, "tenant_access_tokens", &token_hash, "token_hash")
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?;

    // Check expiry
    if let Some(expires_at) = token_record
        .as_object()
        .and_then(|o| o.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                return Err(AppError::Unauthorized(
                    "Token has expired.".to_string(),
                ));
            }
        }
    }

    let lease_id = val_str(&token_record, "lease_id");
    if lease_id.is_empty() {
        return Err(AppError::Unauthorized("Invalid token.".to_string()));
    }

    Ok((pool, lease_id))
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

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}
