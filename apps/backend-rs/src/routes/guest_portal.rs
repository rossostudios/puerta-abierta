use axum::{
    extract::State,
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
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/guest/request-access",
            axum::routing::post(request_access),
        )
        .route("/public/guest/verify", axum::routing::post(verify_token))
        .route("/guest/itinerary", axum::routing::get(guest_itinerary))
        .route("/guest/messages", axum::routing::get(guest_messages).post(guest_send_message))
        .route("/guest/checkin-info", axum::routing::get(guest_checkin_info))
}

#[derive(Debug, serde::Deserialize)]
struct RequestAccessInput {
    email: Option<String>,
    phone_e164: Option<String>,
    reservation_id: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct VerifyTokenInput {
    token: String,
}

#[derive(Debug, serde::Deserialize)]
struct SendMessageInput {
    body: String,
}

/// Generate a magic link token for a guest. Sends via WhatsApp or email.
async fn request_access(
    State(state): State<AppState>,
    Json(payload): Json<RequestAccessInput>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;

    let email = payload.email.as_deref().map(|e| e.trim().to_lowercase());
    let phone = payload.phone_e164.as_deref().map(str::trim);

    if email.as_deref().unwrap_or("").is_empty() && phone.unwrap_or("").is_empty() {
        return Err(AppError::BadRequest(
            "email or phone_e164 is required.".to_string(),
        ));
    }

    // Find a confirmed reservation for this guest
    let reservation = if let Some(ref res_id) = payload.reservation_id {
        let res = get_row(pool, "reservations", res_id, "id").await?;
        // Verify guest identity matches
        let guest_id = val_str(&res, "guest_id");
        if !guest_id.is_empty() {
            let guest = get_row(pool, "guests", &guest_id, "id").await.ok();
            let guest_email = guest.as_ref().map(|g| val_str(g, "email")).unwrap_or_default();
            let guest_phone = guest.as_ref().map(|g| val_str(g, "phone_e164")).unwrap_or_default();

            let email_match = email.as_deref().map_or(false, |e| !e.is_empty() && e == guest_email);
            let phone_match = phone.map_or(false, |p| !p.is_empty() && p == guest_phone);

            if !email_match && !phone_match {
                return Err(AppError::NotFound(
                    "No reservation found matching your credentials.".to_string(),
                ));
            }
            Some((res, guest_id))
        } else {
            return Err(AppError::NotFound(
                "No reservation found matching your credentials.".to_string(),
            ));
        }
    } else {
        // Search for a recent reservation by guest email or phone
        let guests = if let Some(ref e) = email {
            let mut f = Map::new();
            f.insert("email".to_string(), Value::String(e.clone()));
            list_rows(pool, "guests", Some(&f), 10, 0, "created_at", false).await.unwrap_or_default()
        } else {
            let mut f = Map::new();
            f.insert("phone_e164".to_string(), Value::String(phone.unwrap_or("").to_string()));
            list_rows(pool, "guests", Some(&f), 10, 0, "created_at", false).await.unwrap_or_default()
        };

        let mut found: Option<(Value, String)> = None;
        for guest in &guests {
            let guest_id = val_str(guest, "id");
            if guest_id.is_empty() {
                continue;
            }
            let mut f = Map::new();
            f.insert("guest_id".to_string(), Value::String(guest_id.clone()));
            if let Ok(reservations) = list_rows(pool, "reservations", Some(&f), 5, 0, "check_in_date", false).await {
                if let Some(res) = reservations.into_iter().find(|r| {
                    let status = val_str(r, "status");
                    status == "confirmed" || status == "pending"
                }) {
                    found = Some((res, guest_id));
                    break;
                }
            }
        }
        found
    };

    let (reservation, guest_id) = reservation.ok_or_else(|| {
        AppError::NotFound("No active reservation found for your credentials.".to_string())
    })?;

    let reservation_id = val_str(&reservation, "id");

    // Generate a random token
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let mut record = Map::new();
    record.insert("reservation_id".to_string(), Value::String(reservation_id));
    record.insert("guest_id".to_string(), Value::String(guest_id));
    record.insert("token_hash".to_string(), Value::String(token_hash));
    if let Some(ref e) = email {
        record.insert("email".to_string(), Value::String(e.clone()));
    }
    if let Some(p) = phone {
        record.insert("phone_e164".to_string(), Value::String(p.to_string()));
    }

    create_row(pool, "guest_access_tokens", &record).await?;

    // Queue a message with the magic link
    let app_base_url = std::env::var("NEXT_PUBLIC_APP_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let magic_link = format!("{app_base_url}/guest/login?token={raw_token}");

    let org_id = val_str(&reservation, "organization_id");
    if !org_id.is_empty() {
        if let Some(p) = phone.filter(|s| !s.is_empty()) {
            let mut msg = Map::new();
            msg.insert("organization_id".to_string(), Value::String(org_id));
            msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
            msg.insert("recipient".to_string(), Value::String(p.to_string()));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let mut payload_map = Map::new();
            payload_map.insert(
                "body".to_string(),
                Value::String(format!(
                    "Tu enlace al portal de huésped de Casaora: {magic_link}\n\nEste enlace expira en 30 días."
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
        })),
    ))
}

/// Verify a guest magic link token.
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

    let token_record = get_row(pool, "guest_access_tokens", &token_hash, "token_hash")
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
    let _ = update_row(pool, "guest_access_tokens", &token_id, &patch, "id").await;

    let reservation_id = val_str(&token_record, "reservation_id");
    let guest_id = val_str(&token_record, "guest_id");

    Ok(Json(json!({
        "authenticated": true,
        "reservation_id": reservation_id,
        "guest_id": guest_id,
        "token_hash": token_hash,
    })))
}

/// Get guest itinerary — reservation details, property info, unit info.
async fn guest_itinerary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, reservation_id, guest_id) = require_guest(&state, &headers).await?;

    let reservation = get_row(pool, "reservations", &reservation_id, "id").await?;
    let guest = get_row(pool, "guests", &guest_id, "id").await.ok();

    let unit_id = val_str(&reservation, "unit_id");
    let unit = if !unit_id.is_empty() {
        get_row(pool, "units", &unit_id, "id").await.ok()
    } else {
        None
    };

    let property_id = unit
        .as_ref()
        .map(|u| val_str(u, "property_id"))
        .unwrap_or_default();
    let property = if !property_id.is_empty() {
        get_row(pool, "properties", &property_id, "id").await.ok()
    } else {
        None
    };

    Ok(Json(json!({
        "reservation": reservation,
        "guest": guest,
        "unit": unit,
        "property": property,
    })))
}

/// Get message history for this guest.
async fn guest_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, _reservation_id, guest_id) = require_guest(&state, &headers).await?;

    let guest = get_row(pool, "guests", &guest_id, "id").await?;
    let guest_phone = val_str(&guest, "phone_e164");
    let org_id = val_str(&guest, "organization_id");

    if guest_phone.is_empty() {
        return Ok(Json(json!({ "data": [] })));
    }

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));
    filters.insert("recipient".to_string(), Value::String(guest_phone));

    let rows = list_rows(pool, "message_logs", Some(&filters), 200, 0, "created_at", true).await?;

    Ok(Json(json!({ "data": rows })))
}

/// Send a message as a guest (creates a message_log entry).
async fn guest_send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageInput>,
) -> AppResult<impl IntoResponse> {
    let (pool, reservation_id, guest_id) = require_guest(&state, &headers).await?;

    let body = payload.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("body is required.".to_string()));
    }

    let guest = get_row(pool, "guests", &guest_id, "id").await?;
    let reservation = get_row(pool, "reservations", &reservation_id, "id").await?;
    let org_id = val_str(&reservation, "organization_id");
    let guest_name = val_str(&guest, "full_name");
    let guest_phone = val_str(&guest, "phone_e164");

    let mut msg = Map::new();
    msg.insert("organization_id".to_string(), Value::String(org_id));
    msg.insert("channel".to_string(), Value::String("guest_portal".to_string()));
    msg.insert(
        "recipient".to_string(),
        Value::String(if !guest_phone.is_empty() {
            guest_phone
        } else {
            val_str(&guest, "email")
        }),
    );
    msg.insert("status".to_string(), Value::String("delivered".to_string()));
    msg.insert(
        "scheduled_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );

    let mut payload_map = Map::new();
    payload_map.insert("body".to_string(), Value::String(body.to_string()));
    payload_map.insert("direction".to_string(), Value::String("inbound".to_string()));
    payload_map.insert("sender_name".to_string(), Value::String(guest_name));
    payload_map.insert("guest_id".to_string(), Value::String(guest_id));
    payload_map.insert("reservation_id".to_string(), Value::String(reservation_id));
    msg.insert("payload".to_string(), Value::Object(payload_map));

    let created = create_row(pool, "message_logs", &msg).await?;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

/// Get check-in information for the guest's reservation.
async fn guest_checkin_info(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, reservation_id, _guest_id) = require_guest(&state, &headers).await?;

    let reservation = get_row(pool, "reservations", &reservation_id, "id").await?;

    let unit_id = val_str(&reservation, "unit_id");
    let unit = if !unit_id.is_empty() {
        get_row(pool, "units", &unit_id, "id").await.ok()
    } else {
        None
    };

    let property_id = unit
        .as_ref()
        .map(|u| val_str(u, "property_id"))
        .unwrap_or_default();
    let property = if !property_id.is_empty() {
        get_row(pool, "properties", &property_id, "id").await.ok()
    } else {
        None
    };

    // Extract check-in specific fields
    let checkin_info = json!({
        "check_in_date": reservation.as_object().and_then(|o| o.get("check_in_date")).cloned().unwrap_or(Value::Null),
        "check_out_date": reservation.as_object().and_then(|o| o.get("check_out_date")).cloned().unwrap_or(Value::Null),
        "status": reservation.as_object().and_then(|o| o.get("status")).cloned().unwrap_or(Value::Null),
        "property_name": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("name")).cloned().unwrap_or(Value::Null),
        "property_address": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("address")).cloned().unwrap_or(Value::Null),
        "property_city": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("city")).cloned().unwrap_or(Value::Null),
        "property_lat": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("latitude")).cloned().unwrap_or(Value::Null),
        "property_lng": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("longitude")).cloned().unwrap_or(Value::Null),
        "unit_name": unit.as_ref().and_then(Value::as_object).and_then(|o| o.get("name")).cloned().unwrap_or(Value::Null),
        "wifi_network": unit.as_ref().and_then(Value::as_object).and_then(|o| o.get("wifi_network")).cloned().unwrap_or(Value::Null),
        "wifi_password": unit.as_ref().and_then(Value::as_object).and_then(|o| o.get("wifi_password")).cloned().unwrap_or(Value::Null),
        "check_in_instructions": unit.as_ref().and_then(Value::as_object).and_then(|o| o.get("check_in_instructions")).cloned().unwrap_or(Value::Null),
        "house_rules": unit.as_ref().and_then(Value::as_object).and_then(|o| o.get("house_rules")).cloned().unwrap_or(Value::Null),
        "emergency_contact": property.as_ref().and_then(Value::as_object).and_then(|o| o.get("emergency_contact")).cloned().unwrap_or(Value::Null),
    });

    Ok(Json(checkin_info))
}

/// Authenticate a guest from the x-guest-token header.
async fn require_guest<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
) -> AppResult<(&'a sqlx::PgPool, String, String)> {
    let pool = db_pool(state)?;

    let raw_token = headers
        .get("x-guest-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing x-guest-token header.".to_string()))?;

    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let token_record = get_row(pool, "guest_access_tokens", &token_hash, "token_hash")
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

    let reservation_id = val_str(&token_record, "reservation_id");
    let guest_id = val_str(&token_record, "guest_id");

    if reservation_id.is_empty() || guest_id.is_empty() {
        return Err(AppError::Unauthorized("Invalid token.".to_string()));
    }

    Ok((pool, reservation_id, guest_id))
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
