use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, Utc};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateLeaseInput, LeasePath,
        LeasesQuery, UpdateLeaseInput,
    },
    services::{audit::write_audit_log, lease_schedule::ensure_monthly_lease_schedule},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const LEASE_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/leases",
            axum::routing::get(list_leases).post(create_lease),
        )
        .route(
            "/leases/{lease_id}",
            axum::routing::get(get_lease).patch(update_lease),
        )
        .route(
            "/leases/{lease_id}/renew",
            axum::routing::post(send_renewal_offer),
        )
        .route(
            "/leases/{lease_id}/renewal-accept",
            axum::routing::post(accept_renewal),
        )
}

async fn list_leases(
    State(state): State<AppState>,
    Query(query): Query<LeasesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    if let Some(lease_status) = non_empty_opt(query.lease_status.as_deref()) {
        filters.insert("lease_status".to_string(), Value::String(lease_status));
    }
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        filters.insert("property_id".to_string(), Value::String(property_id));
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }

    let rows = list_rows(
        pool,
        "leases",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    let enriched = enrich_leases(pool, rows).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateLeaseInput>,
) -> AppResult<impl IntoResponse> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, LEASE_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut lease_payload = remove_nulls(serialize_to_map(&payload));
    lease_payload.remove("charges");
    lease_payload.remove("generate_first_collection");
    lease_payload.remove("first_collection_due_date");
    lease_payload.remove("collection_schedule_months");
    lease_payload.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let totals = compute_totals(&lease_payload);
    lease_payload.insert("total_move_in".to_string(), json!(totals.total_move_in));
    lease_payload.insert(
        "monthly_recurring_total".to_string(),
        json!(totals.monthly_recurring_total),
    );

    let lease = create_row(pool, "leases", &lease_payload).await?;
    let lease_id = value_str(&lease, "id");

    for charge in &payload.charges {
        let mut charge_payload = remove_nulls(serialize_to_map(charge));
        charge_payload.insert(
            "organization_id".to_string(),
            Value::String(payload.organization_id.clone()),
        );
        charge_payload.insert("lease_id".to_string(), Value::String(lease_id.clone()));
        let _ = create_row(pool, "lease_charges", &charge_payload).await?;
    }

    let mut first_collection: Option<Value> = None;
    let mut schedule_due_dates: Vec<String> = Vec::new();
    let mut schedule_collections_created: usize = 0;
    let mut schedule_charges_created: usize = 0;

    if payload.generate_first_collection {
        let schedule_result = ensure_monthly_lease_schedule(
            pool,
            &payload.organization_id,
            &lease_id,
            &payload.starts_on,
            payload.first_collection_due_date.as_deref(),
            payload.ends_on.as_deref(),
            payload.collection_schedule_months,
            totals.monthly_recurring_total,
            &payload.currency,
            Some(&user_id),
        )
        .await?;

        first_collection = schedule_result.first_collection.clone();
        schedule_due_dates = schedule_result.due_dates.clone();
        schedule_collections_created = schedule_result.collections.len();
        schedule_charges_created = schedule_result.charges.len();
    }

    let mut audit_after_state = Map::new();
    audit_after_state.insert("lease".to_string(), lease.clone());
    audit_after_state.insert(
        "first_collection".to_string(),
        first_collection.clone().unwrap_or(Value::Null),
    );
    audit_after_state.insert(
        "schedule_due_dates".to_string(),
        Value::Array(
            schedule_due_dates
                .iter()
                .cloned()
                .map(Value::String)
                .collect(),
        ),
    );
    audit_after_state.insert(
        "schedule_charges_created".to_string(),
        json!(schedule_charges_created),
    );
    audit_after_state.insert(
        "schedule_collections_created".to_string(),
        json!(schedule_collections_created),
    );

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "leases",
        Some(&lease_id),
        None,
        Some(Value::Object(audit_after_state)),
    )
    .await;

    let mut enriched = enrich_leases(pool, vec![lease]).await?;
    let lease_payload = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "lease": lease_payload,
            "first_collection": first_collection,
            "schedule_due_dates": schedule_due_dates,
            "schedule_collections_created": schedule_collections_created
        })),
    ))
}

async fn get_lease(
    State(state): State<AppState>,
    Path(path): Path<LeasePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "leases", &path.lease_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let charges = list_rows(
        pool,
        "lease_charges",
        Some(&json_map(&[(
            "lease_id",
            Value::String(path.lease_id.clone()),
        )])),
        500,
        0,
        "charge_date",
        true,
    )
    .await?;
    let collections = list_rows(
        pool,
        "collection_records",
        Some(&json_map(&[(
            "lease_id",
            Value::String(path.lease_id.clone()),
        )])),
        500,
        0,
        "due_date",
        true,
    )
    .await?;

    let mut enriched = enrich_leases(pool, vec![record]).await?;
    let mut item = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    if let Some(obj) = item.as_object_mut() {
        obj.insert("charges".to_string(), Value::Array(charges));
        obj.insert("collections".to_string(), Value::Array(collections));
    }

    Ok(Json(item))
}

async fn update_lease(
    State(state): State<AppState>,
    Path(path): Path<LeasePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateLeaseInput>,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "leases", &path.lease_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, LEASE_EDIT_ROLES).await?;

    let mut patch = remove_nulls(serialize_to_map(&payload));

    if !patch.is_empty() {
        let mut merged = record.as_object().cloned().unwrap_or_default();
        for (key, value) in &patch {
            merged.insert(key.clone(), value.clone());
        }

        if patch.contains_key("monthly_rent")
            || patch.contains_key("service_fee_flat")
            || patch.contains_key("security_deposit")
            || patch.contains_key("guarantee_option_fee")
            || patch.contains_key("tax_iva")
        {
            let totals = compute_totals(&merged);
            patch.insert("total_move_in".to_string(), json!(totals.total_move_in));
            patch.insert(
                "monthly_recurring_total".to_string(),
                json!(totals.monthly_recurring_total),
            );
        }
    }

    let mut updated = update_row(pool, "leases", &path.lease_id, &patch, "id").await?;

    if value_str(&updated, "lease_status") == "active" {
        let unpaid_past_due = list_rows(
            pool,
            "collection_records",
            Some(&json_map(&[
                ("lease_id", Value::String(path.lease_id.clone())),
                (
                    "status",
                    Value::Array(
                        ["scheduled", "pending", "late"]
                            .iter()
                            .map(|value| Value::String((*value).to_string()))
                            .collect(),
                    ),
                ),
            ])),
            200,
            0,
            "created_at",
            false,
        )
        .await?;

        let now_date = Utc::now().date_naive().to_string();
        let has_overdue = unpaid_past_due.iter().any(|row| {
            row.as_object()
                .and_then(|obj| obj.get("due_date"))
                .and_then(Value::as_str)
                .is_some_and(|due_date| !due_date.is_empty() && due_date < now_date.as_str())
        });

        if has_overdue {
            let mut lease_patch = Map::new();
            lease_patch.insert(
                "lease_status".to_string(),
                Value::String("delinquent".to_string()),
            );
            updated = update_row(pool, "leases", &path.lease_id, &lease_patch, "id").await?;
        }
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "leases",
        Some(&path.lease_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut enriched = enrich_leases(pool, vec![updated]).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

#[derive(Debug, Clone, Copy)]
struct LeaseTotals {
    total_move_in: f64,
    monthly_recurring_total: f64,
}

fn compute_totals(record: &Map<String, Value>) -> LeaseTotals {
    let monthly_rent = map_number(record, "monthly_rent");
    let service_fee_flat = map_number(record, "service_fee_flat");
    let security_deposit = map_number(record, "security_deposit");
    let guarantee_option_fee = map_number(record, "guarantee_option_fee");
    let tax_iva = map_number(record, "tax_iva");

    let total_move_in =
        monthly_rent + service_fee_flat + security_deposit + guarantee_option_fee + tax_iva;
    let monthly_recurring_total = monthly_rent + tax_iva;

    LeaseTotals {
        total_move_in: round2(total_move_in),
        monthly_recurring_total: round2(monthly_recurring_total),
    }
}

async fn enrich_leases(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let property_ids = extract_ids(&rows, "property_id");
    let unit_ids = extract_ids(&rows, "unit_id");
    let lease_ids = extract_ids(&rows, "id");

    let mut property_name: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if !property_ids.is_empty() {
        let properties = list_rows(
            pool,
            "properties",
            Some(&json_map(&[(
                "id",
                Value::Array(property_ids.iter().cloned().map(Value::String).collect()),
            )])),
            std::cmp::max(200, property_ids.len() as i64),
            0,
            "created_at",
            false,
        )
        .await?;
        property_name = map_by_id_field(&properties, "name");
    }

    let mut unit_name: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if !unit_ids.is_empty() {
        let units = list_rows(
            pool,
            "units",
            Some(&json_map(&[(
                "id",
                Value::Array(unit_ids.iter().cloned().map(Value::String).collect()),
            )])),
            std::cmp::max(200, unit_ids.len() as i64),
            0,
            "created_at",
            false,
        )
        .await?;
        unit_name = map_by_id_field(&units, "name");
    }

    let collections = if lease_ids.is_empty() {
        Vec::new()
    } else {
        list_rows(
            pool,
            "collection_records",
            Some(&json_map(&[(
                "lease_id",
                Value::Array(lease_ids.iter().cloned().map(Value::String).collect()),
            )])),
            std::cmp::max(300, (lease_ids.len() as i64) * 12),
            0,
            "created_at",
            false,
        )
        .await?
    };

    let mut collection_stats: std::collections::HashMap<String, LeaseCollectionStats> =
        std::collections::HashMap::new();
    for collection in collections {
        let Some(collection_obj) = collection.as_object() else {
            continue;
        };
        let Some(lease_id) = string_value(collection_obj.get("lease_id")) else {
            continue;
        };
        let stats = collection_stats.entry(lease_id).or_default();
        let amount = value_number(collection_obj.get("amount"));
        stats.count += 1;
        stats.amount += amount;
        if string_value(collection_obj.get("status")).as_deref() == Some("paid") {
            stats.paid_count += 1;
            stats.paid_amount += amount;
        }
    }

    let mut enriched = Vec::with_capacity(rows.len());
    for mut row in rows {
        if let Some(obj) = row.as_object_mut() {
            if let Some(property_id) = string_value(obj.get("property_id")) {
                obj.insert(
                    "property_name".to_string(),
                    property_name
                        .get(&property_id)
                        .cloned()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                );
            }
            if let Some(unit_id) = string_value(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    unit_name
                        .get(&unit_id)
                        .cloned()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                );
            }

            let lease_id = string_value(obj.get("id")).unwrap_or_default();
            let stats = collection_stats.get(&lease_id).cloned().unwrap_or_default();
            obj.insert("collection_count".to_string(), json!(stats.count));
            obj.insert("collection_paid_count".to_string(), json!(stats.paid_count));
            obj.insert(
                "collection_amount_total".to_string(),
                json!(round2(stats.amount)),
            );
            obj.insert(
                "collection_amount_paid".to_string(),
                json!(round2(stats.paid_amount)),
            );
        }
        enriched.push(row);
    }

    Ok(enriched)
}

#[derive(Debug, Clone, Copy, Default)]
struct LeaseCollectionStats {
    count: i32,
    paid_count: i32,
    amount: f64,
    paid_amount: f64,
}

fn extract_ids(rows: &[Value], key: &str) -> std::collections::HashSet<String> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter_map(|obj| obj.get(key))
        .filter_map(|value| string_value(Some(value)))
        .collect()
}

fn map_by_id_field(rows: &[Value], field: &str) -> std::collections::HashMap<String, String> {
    let mut values = std::collections::HashMap::new();
    for row in rows {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let Some(id) = string_value(obj.get("id")) else {
            continue;
        };
        let Some(value) = string_value(obj.get(field)) else {
            continue;
        };
        values.insert(id, value);
    }
    values
}

fn ensure_lease_collections_enabled(state: &AppState) -> AppResult<()> {
    if state.config.lease_collections_enabled {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "Lease collections endpoints are disabled.".to_string(),
    ))
}

fn map_number(record: &Map<String, Value>, key: &str) -> f64 {
    value_number(record.get(key))
}

fn value_number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn value_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
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

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

// ── Renewal endpoints ──────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct RenewalOfferInput {
    offered_rent: Option<f64>,
    notes: Option<String>,
}

/// Send a renewal offer to the tenant for an expiring lease.
async fn send_renewal_offer(
    State(state): State<AppState>,
    Path(path): Path<LeasePath>,
    headers: HeaderMap,
    Json(payload): Json<RenewalOfferInput>,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let lease = get_row(pool, "leases", &path.lease_id, "id").await?;
    let org_id = value_str(&lease, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let app_public_url = std::env::var("APP_PUBLIC_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());

    let updated = crate::services::lease_renewal::send_renewal_offer(
        pool,
        &path.lease_id,
        payload.offered_rent,
        payload.notes.as_deref(),
        &app_public_url,
    )
    .await
    .map_err(|e| AppError::BadRequest(e))?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "renewal_offer",
        "leases",
        Some(&path.lease_id),
        Some(lease),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({
        "message": "Renewal offer sent.",
        "lease": updated,
    })))
}

#[derive(Debug, serde::Deserialize)]
struct AcceptRenewalInput {
    /// Number of months for the new lease (default 12).
    duration_months: Option<i32>,
    notes: Option<String>,
}

/// Accept a renewal offer, creating a new lease linked to the original.
async fn accept_renewal(
    State(state): State<AppState>,
    Path(path): Path<LeasePath>,
    headers: HeaderMap,
    Json(payload): Json<AcceptRenewalInput>,
) -> AppResult<impl IntoResponse> {
    ensure_lease_collections_enabled(&state)?;
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let original = get_row(pool, "leases", &path.lease_id, "id").await?;
    let org_id = value_str(&original, "organization_id");
    assert_org_role(&state, &user_id, &org_id, LEASE_EDIT_ROLES).await?;

    let renewal_status = value_str(&original, "renewal_status");
    if renewal_status != "offered" && renewal_status != "pending" {
        return Err(AppError::BadRequest(
            "Lease must have an active renewal offer to accept.".to_string(),
        ));
    }

    // Get the offered rent (or use current rent)
    let offered_rent = original
        .as_object()
        .and_then(|o| o.get("renewal_offered_rent"))
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| {
            original
                .as_object()
                .and_then(|o| o.get("monthly_rent"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
        });

    let ends_on_str = value_str(&original, "ends_on");
    let new_starts_on = if !ends_on_str.is_empty() {
        // New lease starts the day after old one ends
        chrono::NaiveDate::parse_from_str(&ends_on_str, "%Y-%m-%d")
            .map(|d| d + chrono::Duration::days(1))
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|_| Utc::now().date_naive().format("%Y-%m-%d").to_string())
    } else {
        Utc::now().date_naive().format("%Y-%m-%d").to_string()
    };

    let duration_months = payload.duration_months.unwrap_or(12);
    let new_ends_on = chrono::NaiveDate::parse_from_str(&new_starts_on, "%Y-%m-%d")
        .map(|d| {
            let month = d.month0() as i32 + duration_months;
            let year = d.year() + month / 12;
            let m = (month % 12) as u32;
            chrono::NaiveDate::from_ymd_opt(year, m + 1, d.day().min(28))
                .unwrap_or(d)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_default();

    // Mark original lease as completed with accepted renewal
    let mut original_patch = Map::new();
    original_patch.insert(
        "renewal_status".to_string(),
        Value::String("accepted".to_string()),
    );
    original_patch.insert(
        "renewal_decided_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    let _ = update_row(pool, "leases", &path.lease_id, &original_patch, "id").await;

    // Create the new renewal lease
    let mut new_lease = Map::new();
    new_lease.insert("organization_id".to_string(), Value::String(org_id.clone()));
    new_lease.insert("parent_lease_id".to_string(), Value::String(path.lease_id.clone()));
    new_lease.insert("is_renewal".to_string(), Value::Bool(true));

    // Copy over fields from original
    for field in &[
        "property_id",
        "unit_id",
        "tenant_full_name",
        "tenant_email",
        "tenant_phone_e164",
        "currency",
        "service_fee_flat",
        "security_deposit",
        "guarantee_option_fee",
        "tax_iva",
        "platform_fee",
    ] {
        if let Some(val) = original.as_object().and_then(|o| o.get(*field)) {
            if !val.is_null() {
                new_lease.insert(field.to_string(), val.clone());
            }
        }
    }

    new_lease.insert(
        "monthly_rent".to_string(),
        json!(offered_rent),
    );
    new_lease.insert("lease_status".to_string(), Value::String("active".to_string()));
    new_lease.insert("starts_on".to_string(), Value::String(new_starts_on));
    new_lease.insert("ends_on".to_string(), Value::String(new_ends_on));
    if let Some(notes) = &payload.notes {
        new_lease.insert("renewal_notes".to_string(), Value::String(notes.clone()));
    }

    // Compute totals
    let totals = compute_totals(&new_lease);
    new_lease.insert("total_move_in".to_string(), json!(totals.total_move_in));
    new_lease.insert(
        "monthly_recurring_total".to_string(),
        json!(totals.monthly_recurring_total),
    );

    let created = create_row(pool, "leases", &new_lease).await?;
    let new_lease_id = value_str(&created, "id");

    // Auto-generate collection schedule for the new lease
    if !new_lease_id.is_empty() {
        let starts = value_str(&created, "starts_on");
        let ends = value_str(&created, "ends_on");
        let rent = created
            .as_object()
            .and_then(|o| o.get("monthly_rent"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let cur = value_str(&created, "currency");

        let _ = ensure_monthly_lease_schedule(
            pool,
            &org_id,
            &new_lease_id,
            &starts,
            None,
            if ends.is_empty() { None } else { Some(ends.as_str()) },
            Some(duration_months),
            rent,
            &cur,
            Some(user_id.as_str()),
        )
        .await;
    }

    // Complete the original lease
    let mut complete_patch = Map::new();
    complete_patch.insert(
        "lease_status".to_string(),
        Value::String("completed".to_string()),
    );
    let _ = update_row(pool, "leases", &path.lease_id, &complete_patch, "id").await;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "renewal_accept",
        "leases",
        Some(&path.lease_id),
        Some(original),
        Some(created.clone()),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "message": "Renewal accepted. New lease created.",
            "original_lease_id": path.lease_id,
            "new_lease": created,
        })),
    ))
}
