use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, CreatePaymentInstructionInput, PaymentInstructionPath,
        PaymentInstructionsQuery, PaymentReferencePath,
    },
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const PAYMENT_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/collections/{collection_id}/payment-link",
            axum::routing::post(create_payment_link),
        )
        .route(
            "/payment-instructions",
            axum::routing::get(list_payment_instructions),
        )
        .route(
            "/payment-instructions/{instruction_id}",
            axum::routing::get(get_payment_instruction),
        )
        .route(
            "/public/payment/{reference_code}",
            axum::routing::get(get_public_payment_info),
        )
}

async fn create_payment_link(
    State(state): State<AppState>,
    Path(path): Path<CollectionIdPath>,
    headers: HeaderMap,
    Json(payload): Json<CreatePaymentInstructionInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let collection = get_row(pool, "collection_records", &path.collection_id, "id").await?;
    let org_id = value_str(&collection, "organization_id");
    assert_org_role(&state, &user_id, &org_id, PAYMENT_EDIT_ROLES).await?;

    let lease_id = value_str(&collection, "lease_id");
    let amount = collection
        .as_object()
        .and_then(|obj| obj.get("amount"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .unwrap_or(0.0);
    let currency = value_str(&collection, "currency");

    // Fetch org bank details as defaults
    let org = get_row(pool, "organizations", &org_id, "id").await?;
    let bank_name = non_empty_opt(payload.bank_name.as_deref())
        .or_else(|| value_str_opt(&org, "bank_name"));
    let account_number = non_empty_opt(payload.account_number.as_deref())
        .or_else(|| value_str_opt(&org, "bank_account_number"));
    let account_holder = non_empty_opt(payload.account_holder.as_deref())
        .or_else(|| value_str_opt(&org, "bank_account_holder"));
    let qr_payload_url = non_empty_opt(payload.qr_payload_url.as_deref())
        .or_else(|| value_str_opt(&org, "qr_image_url"));

    // Fetch tenant info from lease
    let lease = get_row(pool, "leases", &lease_id, "id").await?;
    let tenant_name = value_str_opt(&lease, "tenant_full_name");
    let tenant_phone = value_str_opt(&lease, "tenant_phone_e164");

    let mut record = Map::new();
    record.insert("organization_id".to_string(), Value::String(org_id.clone()));
    record.insert(
        "collection_record_id".to_string(),
        Value::String(path.collection_id.clone()),
    );
    record.insert("lease_id".to_string(), Value::String(lease_id));
    record.insert(
        "payment_method".to_string(),
        Value::String(
            non_empty_opt(payload.payment_method.as_deref())
                .unwrap_or_else(|| "bank_transfer".to_string()),
        ),
    );
    if let Some(v) = bank_name {
        record.insert("bank_name".to_string(), Value::String(v));
    }
    if let Some(v) = account_number {
        record.insert("account_number".to_string(), Value::String(v));
    }
    if let Some(v) = account_holder {
        record.insert("account_holder".to_string(), Value::String(v));
    }
    if let Some(v) = qr_payload_url {
        record.insert("qr_payload_url".to_string(), Value::String(v));
    }
    record.insert(
        "amount".to_string(),
        Value::Number(serde_json::Number::from_f64(amount).unwrap_or(serde_json::Number::from(0))),
    );
    record.insert(
        "currency".to_string(),
        Value::String(if currency.is_empty() {
            "PYG".to_string()
        } else {
            currency
        }),
    );
    if let Some(v) = tenant_name {
        record.insert("tenant_name".to_string(), Value::String(v));
    }
    if let Some(v) = tenant_phone {
        record.insert("tenant_phone_e164".to_string(), Value::String(v));
    }
    if let Some(notes) = payload.notes.as_deref().and_then(|s| non_empty_opt(Some(s))) {
        record.insert("notes".to_string(), Value::String(notes));
    }
    record.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let created = create_row(pool, "payment_instructions", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "create",
        "payment_instructions",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn list_payment_instructions(
    State(state): State<AppState>,
    Query(query): Query<PaymentInstructionsQuery>,
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
    if let Some(collection_id) = non_empty_opt(query.collection_record_id.as_deref()) {
        filters.insert(
            "collection_record_id".to_string(),
            Value::String(collection_id),
        );
    }

    let rows = list_rows(
        pool,
        "payment_instructions",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn get_payment_instruction(
    State(state): State<AppState>,
    Path(path): Path<PaymentInstructionPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(
        pool,
        "payment_instructions",
        &path.instruction_id,
        "id",
    )
    .await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

/// Public endpoint — no auth required.
/// Returns payment info for a given reference code.
async fn get_public_payment_info(
    State(state): State<AppState>,
    Path(path): Path<PaymentReferencePath>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let record = get_row(
        pool,
        "payment_instructions",
        &path.reference_code,
        "reference_code",
    )
    .await?;

    let status = value_str(&record, "status");
    if status != "active" {
        return Err(AppError::Gone(
            "This payment link is no longer active.".to_string(),
        ));
    }

    // Check expiry
    if let Some(expires_at) = record
        .as_object()
        .and_then(|obj| obj.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                // Mark as expired
                let mut patch = Map::new();
                patch.insert("status".to_string(), Value::String("expired".to_string()));
                let _ = update_row(
                    pool,
                    "payment_instructions",
                    &value_str(&record, "id"),
                    &patch,
                    "id",
                )
                .await;
                return Err(AppError::Gone(
                    "This payment link has expired.".to_string(),
                ));
            }
        }
    }

    // Fetch org name for display
    let org_id = value_str(&record, "organization_id");
    let org_name = if !org_id.is_empty() {
        get_row(pool, "organizations", &org_id, "id")
            .await
            .ok()
            .map(|org| value_str(&org, "name"))
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Return only the fields needed for the public payment page
    Ok(Json(json!({
        "reference_code": value_str(&record, "reference_code"),
        "payment_method": value_str(&record, "payment_method"),
        "bank_name": value_str(&record, "bank_name"),
        "account_number": value_str(&record, "account_number"),
        "account_holder": value_str(&record, "account_holder"),
        "qr_payload_url": value_str(&record, "qr_payload_url"),
        "amount": record.as_object().and_then(|o| o.get("amount")).cloned().unwrap_or(Value::Null),
        "currency": value_str(&record, "currency"),
        "tenant_name": value_str(&record, "tenant_name"),
        "organization_name": org_name,
        "expires_at": value_str(&record, "expires_at"),
    })))
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CollectionIdPath {
    pub collection_id: String,
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

fn value_str_opt(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
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
