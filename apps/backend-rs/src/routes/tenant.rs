use axum::{
    extract::{Path, Query, State},
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
    services::workflows::fire_trigger,
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/tenant/request-access",
            axum::routing::post(request_access),
        )
        .route("/public/tenant/verify", axum::routing::post(verify_token))
        .route("/tenant/me", axum::routing::get(tenant_me))
        .route("/tenant/payments", axum::routing::get(tenant_payments))
        .route(
            "/tenant/payments/{collection_id}/submit",
            axum::routing::post(tenant_submit_payment),
        )
        .route(
            "/tenant/payment-instructions/{collection_id}",
            axum::routing::get(tenant_payment_instructions),
        )
        .route(
            "/tenant/maintenance-requests",
            axum::routing::get(tenant_list_maintenance).post(tenant_create_maintenance),
        )
        .route("/tenant/documents", axum::routing::get(tenant_documents))
        .route("/tenant/messages", axum::routing::get(tenant_messages))
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
struct SubmitPaymentInput {
    payment_method: Option<String>,
    payment_reference: Option<String>,
    receipt_url: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct CollectionIdPath {
    collection_id: String,
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

    let lease = active_lease
        .ok_or_else(|| AppError::NotFound("No active lease found for this email.".to_string()))?;

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
                    "Tu enlace de acceso a Casaora: {magic_link}\n\nEste enlace expira en 24 horas."
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
async fn tenant_me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Value>> {
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
    let collections = list_rows(
        pool,
        "collection_records",
        Some(&filters),
        12,
        0,
        "due_date",
        true,
    )
    .await?;

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
            list_rows(
                pool,
                "payment_instructions",
                Some(&pi_filters),
                1,
                0,
                "created_at",
                false,
            )
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

        let mut row_obj = row.as_object().cloned().unwrap_or_default();
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

/// Get payment instructions for a specific collection.
async fn tenant_payment_instructions(
    State(state): State<AppState>,
    Path(path): Path<CollectionIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    // Verify the collection belongs to this tenant's lease
    let collection = get_row(pool, "collection_records", &path.collection_id, "id").await?;
    if val_str(&collection, "lease_id") != lease_id {
        return Err(AppError::Forbidden(
            "This collection does not belong to your lease.".to_string(),
        ));
    }

    // Fetch payment instructions for this collection
    let mut pi_filters = Map::new();
    pi_filters.insert(
        "collection_record_id".to_string(),
        Value::String(path.collection_id.clone()),
    );
    pi_filters.insert("status".to_string(), Value::String("active".to_string()));
    let instructions = list_rows(
        pool,
        "payment_instructions",
        Some(&pi_filters),
        10,
        0,
        "created_at",
        false,
    )
    .await?;

    // Also fetch org bank details for manual transfer
    let org_id = val_str(&collection, "organization_id");
    let org = if !org_id.is_empty() {
        get_row(pool, "organizations", &org_id, "id").await.ok()
    } else {
        None
    };

    let bank_details = org
        .as_ref()
        .and_then(Value::as_object)
        .map(|o| {
            json!({
                "bank_name": o.get("bank_name").cloned().unwrap_or(Value::Null),
                "bank_account_number": o.get("bank_account_number").cloned().unwrap_or(Value::Null),
                "bank_account_holder": o.get("bank_account_holder").cloned().unwrap_or(Value::Null),
                "bank_ruc": o.get("ruc").cloned().unwrap_or(Value::Null),
            })
        })
        .unwrap_or(Value::Null);

    Ok(Json(json!({
        "collection": collection,
        "payment_instructions": instructions,
        "bank_details": bank_details,
    })))
}

/// Submit a payment reference/receipt for a collection.
/// This notifies the property manager for confirmation.
async fn tenant_submit_payment(
    State(state): State<AppState>,
    Path(path): Path<CollectionIdPath>,
    headers: HeaderMap,
    Json(payload): Json<SubmitPaymentInput>,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    // Verify the collection belongs to this tenant's lease
    let collection = get_row(pool, "collection_records", &path.collection_id, "id").await?;
    if val_str(&collection, "lease_id") != lease_id {
        return Err(AppError::Forbidden(
            "This collection does not belong to your lease.".to_string(),
        ));
    }

    let status = val_str(&collection, "status");
    if status == "paid" || status == "waived" {
        return Err(AppError::BadRequest(
            "This collection has already been settled.".to_string(),
        ));
    }

    // Update the collection with payment submission info
    let mut patch = Map::new();
    if let Some(ref method) = payload.payment_method {
        patch.insert(
            "payment_method".to_string(),
            Value::String(method.clone()),
        );
    }
    if let Some(ref reference) = payload.payment_reference {
        patch.insert(
            "payment_reference".to_string(),
            Value::String(reference.clone()),
        );
    }
    if let Some(ref notes) = payload.notes {
        patch.insert("notes".to_string(), Value::String(notes.clone()));
    }

    // Store receipt URL in notes or a dedicated field
    if let Some(ref receipt_url) = payload.receipt_url {
        let existing_notes = val_str(&collection, "notes");
        let updated_notes = if existing_notes.is_empty() {
            format!("Comprobante: {receipt_url}")
        } else {
            format!("{existing_notes}\nComprobante: {receipt_url}")
        };
        patch.insert("notes".to_string(), Value::String(updated_notes));
    }

    let updated = if !patch.is_empty() {
        update_row(pool, "collection_records", &path.collection_id, &patch, "id").await?
    } else {
        collection.clone()
    };

    // Notify the property manager that a payment was submitted
    let org_id = val_str(&collection, "organization_id");
    let lease = get_row(pool, "leases", &lease_id, "id").await.ok();
    let tenant_name = lease
        .as_ref()
        .map(|l| val_str(l, "tenant_full_name"))
        .unwrap_or_default();
    let amount = collection
        .as_object()
        .and_then(|o| o.get("amount"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let currency = val_str(&collection, "currency");
    let due_date = val_str(&collection, "due_date");

    let amount_display = if currency == "PYG" {
        format!("₲{}", amount as i64)
    } else {
        format!("${:.2}", amount)
    };

    // Find owner_admin members to notify
    if !org_id.is_empty() {
        let mut member_filters = Map::new();
        member_filters.insert(
            "organization_id".to_string(),
            Value::String(org_id.clone()),
        );
        member_filters.insert("role".to_string(), Value::String("owner_admin".to_string()));

        if let Ok(members) = list_rows(pool, "organization_members", Some(&member_filters), 5, 0, "created_at", true).await {
            for member in &members {
                let user_id = val_str(member, "user_id");
                if user_id.is_empty() {
                    continue;
                }
                if let Ok(user) = get_row(pool, "app_users", &user_id, "id").await {
                    let owner_phone = val_str(&user, "phone_e164");
                    if !owner_phone.is_empty() {
                        let ref_info = payload.payment_reference.as_deref().unwrap_or("sin referencia");
                        let body = format!(
                            "💰 Pago reportado\n\n\
                             {tenant_name} reportó un pago de {amount_display} (vencimiento: {due_date}).\n\
                             Referencia: {ref_info}\n\n\
                             Confirma o rechaza en tu panel de administración.\n\
                             — Casaora"
                        );

                        let mut msg = Map::new();
                        msg.insert(
                            "organization_id".to_string(),
                            Value::String(org_id.clone()),
                        );
                        msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
                        msg.insert("recipient".to_string(), Value::String(owner_phone));
                        msg.insert("status".to_string(), Value::String("queued".to_string()));
                        msg.insert(
                            "scheduled_at".to_string(),
                            Value::String(Utc::now().to_rfc3339()),
                        );
                        let mut pl = Map::new();
                        pl.insert("body".to_string(), Value::String(body));
                        pl.insert(
                            "reminder_type".to_string(),
                            Value::String("payment_submitted".to_string()),
                        );
                        pl.insert(
                            "collection_id".to_string(),
                            Value::String(path.collection_id.clone()),
                        );
                        msg.insert("payload".to_string(), Value::Object(pl));
                        let _ = create_row(pool, "message_logs", &msg).await;
                    }
                }
            }
        }
    }

    Ok(Json(json!({
        "message": "Pago reportado exitosamente. Tu administrador será notificado para confirmar.",
        "collection": updated,
    })))
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
        record.insert(
            "property_id".to_string(),
            Value::String(property_id.clone()),
        );
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
    task.insert("organization_id".to_string(), Value::String(org_id.clone()));
    if !property_id.is_empty() {
        task.insert("property_id".to_string(), Value::String(property_id.clone()));
    }
    if !unit_id.is_empty() {
        task.insert("unit_id".to_string(), Value::String(unit_id.clone()));
    }
    task.insert("type".to_string(), Value::String("maintenance".to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert(
        "priority".to_string(),
        Value::String(val_str(&created, "urgency").replace("emergency", "urgent")),
    );
    task.insert(
        "title".to_string(),
        Value::String(format!("Maintenance: {}", val_str(&created, "title"))),
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

    // Fire maintenance_submitted workflow trigger
    if !org_id.is_empty() {
        let mut ctx = serde_json::Map::new();
        ctx.insert(
            "maintenance_request_id".to_string(),
            Value::String(mr_id),
        );
        ctx.insert("property_id".to_string(), Value::String(property_id));
        ctx.insert("unit_id".to_string(), Value::String(unit_id));
        ctx.insert(
            "tenant_full_name".to_string(),
            Value::String(val_str(&lease, "tenant_full_name")),
        );
        ctx.insert(
            "tenant_phone_e164".to_string(),
            Value::String(val_str(&lease, "tenant_phone_e164")),
        );
        ctx.insert("title".to_string(), Value::String(val_str(&created, "title")));
        fire_trigger(pool, &org_id, "maintenance_submitted", &ctx).await;
    }

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

/// List documents for this tenant's lease.
async fn tenant_documents(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let lease = get_row(pool, "leases", &lease_id, "id").await?;
    let org_id = val_str(&lease, "organization_id");

    // Fetch documents linked to this lease
    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));
    filters.insert("entity_type".to_string(), Value::String("lease".to_string()));
    filters.insert("entity_id".to_string(), Value::String(lease_id));

    let rows = list_rows(pool, "documents", Some(&filters), 100, 0, "created_at", false).await?;

    Ok(Json(json!({ "data": rows })))
}

/// List message history for this tenant.
async fn tenant_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, lease_id) = require_tenant(&state, &headers).await?;

    let lease = get_row(pool, "leases", &lease_id, "id").await?;
    let tenant_phone = val_str(&lease, "tenant_phone_e164");
    let org_id = val_str(&lease, "organization_id");

    if tenant_phone.is_empty() {
        return Ok(Json(json!({ "data": [] })));
    }

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));
    filters.insert("recipient".to_string(), Value::String(tenant_phone));

    let rows = list_rows(pool, "message_logs", Some(&filters), 200, 0, "created_at", false).await?;

    Ok(Json(json!({ "data": rows })))
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
        .ok_or_else(|| AppError::Unauthorized("Missing x-tenant-token header.".to_string()))?;

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
                return Err(AppError::Unauthorized("Token has expired.".to_string()));
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
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}
