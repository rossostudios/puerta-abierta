use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, update_row},
    services::audit::write_audit_log,
    state::AppState,
    tenancy::assert_org_role,
};

#[derive(Deserialize)]
pub struct ReservationIdPath {
    pub reservation_id: String,
}

#[derive(Deserialize)]
pub struct CollectDepositInput {
    pub reservation_id: String,
    pub amount: f64,
    #[serde(default = "default_currency")]
    pub currency: String,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct HoldDepositInput {
    pub reservation_id: String,
    pub note: Option<String>,
}

fn default_currency() -> String {
    "PYG".to_string()
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/deposits/reservation/{reservation_id}",
            axum::routing::get(get_deposit_status),
        )
        .route("/deposits/collect", axum::routing::post(collect_deposit))
        .route("/deposits/hold", axum::routing::post(hold_deposit))
        .route(
            "/deposits/release/{reservation_id}",
            axum::routing::post(release_deposit),
        )
        .route(
            "/deposits/forfeit/{reservation_id}",
            axum::routing::post(forfeit_deposit),
        )
}

async fn get_deposit_status(
    State(state): State<AppState>,
    Path(path): Path<ReservationIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(
        &state,
        &user_id,
        &org_id,
        &["owner_admin", "operator", "accountant"],
    )
    .await?;

    let events = crate::repository::table_service::list_rows(
        pool,
        "escrow_events",
        Some(&json_map(&[(
            "reservation_id",
            Value::String(path.reservation_id.clone()),
        )])),
        100,
        0,
        "created_at",
        true,
    )
    .await?;

    Ok(Json(json!({
        "reservation_id": path.reservation_id,
        "deposit_status": reservation.get("deposit_status").cloned().unwrap_or(Value::Null),
        "deposit_amount": reservation.get("deposit_amount").cloned().unwrap_or(Value::Null),
        "deposit_currency": reservation.get("deposit_currency").cloned().unwrap_or(Value::Null),
        "events": events,
    })))
}

async fn collect_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CollectDepositInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &payload.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let current_status = value_str(&reservation, "deposit_status");
    if current_status != "none" && current_status != "pending" {
        return Err(AppError::UnprocessableEntity(format!(
            "Cannot collect deposit: current status is '{current_status}', expected 'none' or 'pending'."
        )));
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("collected".to_string()),
    );
    patch.insert("deposit_amount".to_string(), json!(payload.amount));
    patch.insert(
        "deposit_currency".to_string(),
        Value::String(payload.currency.clone()),
    );

    let updated = update_row(pool, "reservations", &payload.reservation_id, &patch, "id").await?;

    let event = insert_escrow_event(
        pool,
        &org_id,
        &payload.reservation_id,
        "collected",
        Some(payload.amount),
        &payload.currency,
        payload.note.as_deref(),
        &user_id,
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "collect_deposit",
        "reservations",
        Some(&payload.reservation_id),
        Some(reservation),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({
        "reservation": updated,
        "event": event,
    })))
}

async fn hold_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<HoldDepositInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &payload.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let current_status = value_str(&reservation, "deposit_status");
    if current_status != "collected" {
        return Err(AppError::UnprocessableEntity(format!(
            "Cannot hold deposit: current status is '{current_status}', expected 'collected'."
        )));
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("held".to_string()),
    );
    let updated = update_row(pool, "reservations", &payload.reservation_id, &patch, "id").await?;

    let amount = reservation.get("deposit_amount").and_then(Value::as_f64);
    let currency = value_str(&reservation, "deposit_currency");

    let event = insert_escrow_event(
        pool,
        &org_id,
        &payload.reservation_id,
        "held",
        amount,
        if currency.is_empty() {
            "PYG"
        } else {
            &currency
        },
        payload.note.as_deref(),
        &user_id,
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "hold_deposit",
        "reservations",
        Some(&payload.reservation_id),
        Some(reservation),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({
        "reservation": updated,
        "event": event,
    })))
}

async fn release_deposit(
    State(state): State<AppState>,
    Path(path): Path<ReservationIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let current_status = value_str(&reservation, "deposit_status");
    if current_status != "held" && current_status != "collected" {
        return Err(AppError::UnprocessableEntity(format!(
            "Cannot release deposit: current status is '{current_status}', expected 'held' or 'collected'."
        )));
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("released".to_string()),
    );
    let updated = update_row(pool, "reservations", &path.reservation_id, &patch, "id").await?;

    let amount = reservation.get("deposit_amount").and_then(Value::as_f64);
    let currency = value_str(&reservation, "deposit_currency");

    let event = insert_escrow_event(
        pool,
        &org_id,
        &path.reservation_id,
        "released",
        amount,
        if currency.is_empty() {
            "PYG"
        } else {
            &currency
        },
        Some("Manual release by operator."),
        &user_id,
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "release_deposit",
        "reservations",
        Some(&path.reservation_id),
        Some(reservation),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({
        "reservation": updated,
        "event": event,
    })))
}

async fn forfeit_deposit(
    State(state): State<AppState>,
    Path(path): Path<ReservationIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let current_status = value_str(&reservation, "deposit_status");
    if current_status != "held" && current_status != "collected" {
        return Err(AppError::UnprocessableEntity(format!(
            "Cannot forfeit deposit: current status is '{current_status}', expected 'held' or 'collected'."
        )));
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("forfeited".to_string()),
    );
    let updated = update_row(pool, "reservations", &path.reservation_id, &patch, "id").await?;

    let amount = reservation.get("deposit_amount").and_then(Value::as_f64);
    let currency = value_str(&reservation, "deposit_currency");

    let event = insert_escrow_event(
        pool,
        &org_id,
        &path.reservation_id,
        "forfeited",
        amount,
        if currency.is_empty() {
            "PYG"
        } else {
            &currency
        },
        Some("Deposit forfeited."),
        &user_id,
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "forfeit_deposit",
        "reservations",
        Some(&path.reservation_id),
        Some(reservation),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({
        "reservation": updated,
        "event": event,
    })))
}

#[allow(clippy::too_many_arguments)]
async fn insert_escrow_event(
    pool: &sqlx::PgPool,
    org_id: &str,
    reservation_id: &str,
    event_type: &str,
    amount: Option<f64>,
    currency: &str,
    note: Option<&str>,
    performed_by: &str,
) -> AppResult<Value> {
    let mut payload = Map::new();
    payload.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    payload.insert(
        "reservation_id".to_string(),
        Value::String(reservation_id.to_string()),
    );
    payload.insert(
        "event_type".to_string(),
        Value::String(event_type.to_string()),
    );
    if let Some(amount) = amount {
        payload.insert("amount".to_string(), json!(amount));
    }
    payload.insert("currency".to_string(), Value::String(currency.to_string()));
    if let Some(note) = note {
        payload.insert("note".to_string(), Value::String(note.to_string()));
    }
    payload.insert(
        "performed_by".to_string(),
        Value::String(performed_by.to_string()),
    );

    create_row(pool, "escrow_events", &payload).await
}

pub async fn auto_release_deposit_on_checkout(pool: &sqlx::PgPool, reservation: &Value) {
    let deposit_status = reservation
        .as_object()
        .and_then(|obj| obj.get("deposit_status"))
        .and_then(Value::as_str)
        .unwrap_or("none");

    if deposit_status != "held" {
        return;
    }

    let reservation_id = reservation
        .as_object()
        .and_then(|obj| obj.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let org_id = reservation
        .as_object()
        .and_then(|obj| obj.get("organization_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    if reservation_id.is_empty() || org_id.is_empty() {
        return;
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("released".to_string()),
    );
    let _ = update_row(pool, "reservations", reservation_id, &patch, "id").await;

    let amount = reservation
        .as_object()
        .and_then(|obj| obj.get("deposit_amount"))
        .and_then(Value::as_f64);
    let currency = reservation
        .as_object()
        .and_then(|obj| obj.get("deposit_currency"))
        .and_then(Value::as_str)
        .unwrap_or("PYG");

    let mut event = Map::new();
    event.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    event.insert(
        "reservation_id".to_string(),
        Value::String(reservation_id.to_string()),
    );
    event.insert(
        "event_type".to_string(),
        Value::String("auto_released".to_string()),
    );
    if let Some(amount) = amount {
        event.insert("amount".to_string(), json!(amount));
    }
    event.insert("currency".to_string(), Value::String(currency.to_string()));
    event.insert(
        "note".to_string(),
        Value::String("Auto-released on checkout.".to_string()),
    );
    event.insert(
        "created_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    let _ = create_row(pool, "escrow_events", &event).await;
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database is not configured. Set DATABASE_URL.".to_string())
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

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}
