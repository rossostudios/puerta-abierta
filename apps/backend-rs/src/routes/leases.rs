use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateLeaseInput, LeasePath,
        LeaseRentRollQuery, LeasesQuery, UpdateLeaseInput,
    },
    services::{
        audit::write_audit_log, lease_schedule::ensure_monthly_lease_schedule,
        sequences::enroll_in_sequences, workflows::fire_trigger,
    },
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
        .route("/leases/rent-roll", axum::routing::get(get_rent_roll))
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
    if let Some(space_id) = non_empty_opt(query.space_id.as_deref()) {
        filters.insert("space_id".to_string(), Value::String(space_id));
    }
    if let Some(bed_id) = non_empty_opt(query.bed_id.as_deref()) {
        filters.insert("bed_id".to_string(), Value::String(bed_id));
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

#[derive(Debug, Clone, serde::Serialize)]
struct RentRollLeaseBlock {
    lease_id: String,
    lease_status: String,
    starts_on: String,
    ends_on: Option<String>,
    tenant_full_name: String,
    tenant_phone_e164: Option<String>,
    monthly_rent: f64,
    monthly_recurring_total: f64,
    currency: String,
    turnover_buffer_hours: i16,
}

#[derive(Debug, Clone, serde::Serialize)]
struct RentRollBufferBlock {
    lease_id: String,
    kind: String,
    starts_on: String,
    ends_on: String,
    turnover_buffer_hours: i16,
}

#[derive(Debug, Clone, serde::Serialize)]
struct RentRollTrack {
    track_id: String,
    target_type: String,
    property_id: Option<String>,
    unit_id: Option<String>,
    space_id: Option<String>,
    bed_id: Option<String>,
    property_name: Option<String>,
    unit_name: Option<String>,
    space_name: Option<String>,
    bed_code: Option<String>,
    leases: Vec<RentRollLeaseBlock>,
    buffers: Vec<RentRollBufferBlock>,
}

const RENT_ROLL_MAX_DAYS: i64 = 730;

async fn get_rent_roll(
    State(state): State<AppState>,
    Query(query): Query<LeaseRentRollQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let today = Utc::now().date_naive();
    let from_default = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
    let from_date = if let Some(raw_from) = non_empty_opt(query.from_date.as_deref()) {
        parse_date_opt(Some(&raw_from)).ok_or_else(|| {
            AppError::BadRequest("Invalid 'from' date. Expected YYYY-MM-DD.".to_string())
        })?
    } else {
        from_default
    };
    let to_date = if let Some(raw_to) = non_empty_opt(query.to_date.as_deref()) {
        parse_date_opt(Some(&raw_to)).ok_or_else(|| {
            AppError::BadRequest("Invalid 'to' date. Expected YYYY-MM-DD.".to_string())
        })?
    } else {
        from_date + Duration::days(180)
    };

    if to_date < from_date {
        return Err(AppError::BadRequest(
            "Invalid date window: 'to' must be on or after 'from'.".to_string(),
        ));
    }
    if (to_date - from_date).num_days() > RENT_ROLL_MAX_DAYS {
        return Err(AppError::BadRequest(format!(
            "Date window exceeds {} days. Narrow the range.",
            RENT_ROLL_MAX_DAYS
        )));
    }

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        filters.insert("property_id".to_string(), Value::String(property_id));
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }
    if let Some(space_id) = non_empty_opt(query.space_id.as_deref()) {
        filters.insert("space_id".to_string(), Value::String(space_id));
    }
    if let Some(bed_id) = non_empty_opt(query.bed_id.as_deref()) {
        filters.insert("bed_id".to_string(), Value::String(bed_id));
    }

    let rows = list_rows(
        pool,
        "leases",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 5000),
        0,
        "starts_on",
        true,
    )
    .await?;

    let leases = rows
        .into_iter()
        .filter(|row| lease_overlaps_window(row, from_date, to_date))
        .collect::<Vec<_>>();

    let property_ids = extract_ids(&leases, "property_id");
    let unit_ids = extract_ids(&leases, "unit_id");
    let space_ids = extract_ids(&leases, "space_id");
    let bed_ids = extract_ids(&leases, "bed_id");

    let (properties, units, spaces, beds) = tokio::try_join!(
        async {
            if property_ids.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
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
                .await
            }
        },
        async {
            if unit_ids.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
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
                .await
            }
        },
        async {
            if space_ids.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "unit_spaces",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(space_ids.iter().cloned().map(Value::String).collect()),
                    )])),
                    std::cmp::max(200, space_ids.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async {
            if bed_ids.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "unit_beds",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(bed_ids.iter().cloned().map(Value::String).collect()),
                    )])),
                    std::cmp::max(200, bed_ids.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        }
    )?;

    let property_names = map_by_id_field(&properties, "name");
    let unit_names = map_by_id_field(&units, "name");
    let space_names = map_by_id_field(&spaces, "name");
    let bed_codes = map_by_id_field(&beds, "code");

    let mut tracks: HashMap<String, RentRollTrack> = HashMap::new();
    for lease in leases {
        let lease_id = value_str(&lease, "id");
        if lease_id.is_empty() {
            continue;
        }
        let property_id = value_opt_str(&lease, "property_id");
        let unit_id = value_opt_str(&lease, "unit_id");
        let space_id = value_opt_str(&lease, "space_id");
        let bed_id = value_opt_str(&lease, "bed_id");

        let (track_id, target_type) = if let Some(bed_id) = &bed_id {
            (format!("bed:{bed_id}"), "bed".to_string())
        } else if let Some(space_id) = &space_id {
            (format!("space:{space_id}"), "space".to_string())
        } else if let Some(unit_id) = &unit_id {
            (format!("unit:{unit_id}"), "unit".to_string())
        } else {
            continue;
        };

        let track = tracks
            .entry(track_id.clone())
            .or_insert_with(|| RentRollTrack {
                track_id: track_id.clone(),
                target_type: target_type.clone(),
                property_id: property_id.clone(),
                unit_id: unit_id.clone(),
                space_id: space_id.clone(),
                bed_id: bed_id.clone(),
                property_name: property_id
                    .as_ref()
                    .and_then(|id| property_names.get(id))
                    .cloned(),
                unit_name: unit_id.as_ref().and_then(|id| unit_names.get(id)).cloned(),
                space_name: space_id
                    .as_ref()
                    .and_then(|id| space_names.get(id))
                    .cloned(),
                bed_code: bed_id.as_ref().and_then(|id| bed_codes.get(id)).cloned(),
                leases: Vec::new(),
                buffers: Vec::new(),
            });

        let starts_on = value_str(&lease, "starts_on");
        if starts_on.is_empty() {
            continue;
        }
        let ends_on = value_opt_str(&lease, "ends_on");
        let turnover_buffer_hours = clamp_turnover_buffer_hours(
            value_i64(
                lease
                    .as_object()
                    .and_then(|obj| obj.get("turnover_buffer_hours")),
            )
            .unwrap_or(24),
        );

        track.leases.push(RentRollLeaseBlock {
            lease_id: lease_id.clone(),
            lease_status: value_str(&lease, "lease_status"),
            starts_on: starts_on.clone(),
            ends_on: ends_on.clone(),
            tenant_full_name: value_str(&lease, "tenant_full_name"),
            tenant_phone_e164: value_opt_str(&lease, "tenant_phone_e164"),
            monthly_rent: value_number(lease.as_object().and_then(|obj| obj.get("monthly_rent"))),
            monthly_recurring_total: value_number(
                lease
                    .as_object()
                    .and_then(|obj| obj.get("monthly_recurring_total")),
            ),
            currency: value_str(&lease, "currency"),
            turnover_buffer_hours,
        });

        if let (Some(start_date), Some(end_date)) = (
            parse_date_opt(Some(&starts_on)),
            ends_on
                .as_deref()
                .and_then(|value| parse_date_opt(Some(value))),
        ) {
            let buffer_days = turnover_hours_to_days(i64::from(turnover_buffer_hours));
            if buffer_days > 0 {
                let before_start = start_date - Duration::days(buffer_days);
                let before_end = start_date - Duration::days(1);
                if before_end >= from_date && before_start <= to_date {
                    track.buffers.push(RentRollBufferBlock {
                        lease_id: lease_id.clone(),
                        kind: "turnover_before".to_string(),
                        starts_on: before_start.format("%Y-%m-%d").to_string(),
                        ends_on: before_end.format("%Y-%m-%d").to_string(),
                        turnover_buffer_hours,
                    });
                }

                let after_start = end_date + Duration::days(1);
                let after_end = end_date + Duration::days(buffer_days);
                if after_end >= from_date && after_start <= to_date {
                    track.buffers.push(RentRollBufferBlock {
                        lease_id,
                        kind: "turnover_after".to_string(),
                        starts_on: after_start.format("%Y-%m-%d").to_string(),
                        ends_on: after_end.format("%Y-%m-%d").to_string(),
                        turnover_buffer_hours,
                    });
                }
            }
        }
    }

    let mut track_values = tracks.into_values().collect::<Vec<_>>();
    for track in &mut track_values {
        track
            .leases
            .sort_by(|left, right| left.starts_on.cmp(&right.starts_on));
        track
            .buffers
            .sort_by(|left, right| left.starts_on.cmp(&right.starts_on));
    }
    track_values.sort_by(|left, right| {
        rent_roll_track_sort_key(left).cmp(&rent_roll_track_sort_key(right))
    });

    let lease_block_count = track_values
        .iter()
        .map(|track| track.leases.len())
        .sum::<usize>();
    let buffer_block_count = track_values
        .iter()
        .map(|track| track.buffers.len())
        .sum::<usize>();

    Ok(Json(json!({
        "from": from_date.format("%Y-%m-%d").to_string(),
        "to": to_date.format("%Y-%m-%d").to_string(),
        "track_count": track_values.len(),
        "lease_block_count": lease_block_count,
        "buffer_block_count": buffer_block_count,
        "data": track_values,
    })))
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
    normalize_lease_payload_for_write(&mut lease_payload);
    lease_payload.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    resolve_lease_target_fields(pool, &mut lease_payload).await?;
    validate_lease_payload_for_write(pool, &lease_payload, None).await?;

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

    // Fire workflow trigger for lease_created
    {
        let mut ctx = Map::new();
        ctx.insert("lease_id".to_string(), Value::String(lease_id.clone()));
        ctx.insert(
            "property_id".to_string(),
            Value::String(value_str(&lease, "property_id")),
        );
        ctx.insert(
            "unit_id".to_string(),
            Value::String(value_str(&lease, "unit_id")),
        );
        ctx.insert(
            "tenant_full_name".to_string(),
            Value::String(value_str(&lease, "tenant_full_name")),
        );
        ctx.insert(
            "tenant_phone_e164".to_string(),
            Value::String(value_str(&lease, "tenant_phone_e164")),
        );
        ctx.insert(
            "starts_on".to_string(),
            Value::String(value_str(&lease, "starts_on")),
        );
        fire_trigger(
            pool,
            &payload.organization_id,
            "lease_created",
            &ctx,
            state.config.workflow_engine_mode,
        )
        .await;

        // Enroll in communication sequences for lease_created
        let tenant_phone = value_str(&lease, "tenant_phone_e164");
        if !tenant_phone.is_empty() {
            enroll_in_sequences(
                pool,
                &payload.organization_id,
                "lease_created",
                "lease",
                &lease_id,
                &tenant_phone,
                &ctx,
            )
            .await;
        }
    }

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
    normalize_lease_payload_for_write(&mut patch);

    if !patch.is_empty() {
        let mut merged = record.as_object().cloned().unwrap_or_default();
        for (key, value) in &patch {
            merged.insert(key.clone(), value.clone());
        }

        resolve_lease_target_fields(pool, &mut merged).await?;
        validate_lease_payload_for_write(pool, &merged, Some(&path.lease_id)).await?;

        if let Some(record_obj) = record.as_object() {
            for key in ["property_id", "unit_id", "space_id", "bed_id"] {
                let merged_value = merged.get(key).cloned();
                let existing_value = record_obj.get(key).cloned();
                if merged_value != existing_value {
                    if let Some(value) = merged_value {
                        patch.insert(key.to_string(), value);
                    }
                }
            }
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
        Some(record.clone()),
        Some(updated.clone()),
    )
    .await;

    // Fire lease_activated trigger when status changes to active
    let old_status = value_str(&record, "lease_status");
    let new_status = value_str(&updated, "lease_status");
    if new_status == "active" && old_status != "active" {
        let mut ctx = Map::new();
        ctx.insert("lease_id".to_string(), Value::String(path.lease_id.clone()));
        ctx.insert(
            "property_id".to_string(),
            Value::String(value_str(&updated, "property_id")),
        );
        ctx.insert(
            "unit_id".to_string(),
            Value::String(value_str(&updated, "unit_id")),
        );
        ctx.insert(
            "tenant_full_name".to_string(),
            Value::String(value_str(&updated, "tenant_full_name")),
        );
        ctx.insert(
            "tenant_phone_e164".to_string(),
            Value::String(value_str(&updated, "tenant_phone_e164")),
        );
        fire_trigger(
            pool,
            &org_id,
            "lease_activated",
            &ctx,
            state.config.workflow_engine_mode,
        )
        .await;

        // Enroll in communication sequences for lease_activated
        let tenant_phone = value_str(&updated, "tenant_phone_e164");
        if !tenant_phone.is_empty() {
            enroll_in_sequences(
                pool,
                &org_id,
                "lease_activated",
                "lease",
                &path.lease_id,
                &tenant_phone,
                &ctx,
            )
            .await;
        }
    }

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

fn normalize_lease_payload_for_write(payload: &mut Map<String, Value>) {
    normalize_lowercase_string(payload, "lease_status");
    normalize_uppercase_string(payload, "currency");
}

fn normalize_lowercase_string(payload: &mut Map<String, Value>, key: &str) {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_ascii_lowercase);
    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

fn normalize_uppercase_string(payload: &mut Map<String, Value>, key: &str) {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_ascii_uppercase);
    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

async fn resolve_lease_target_fields(
    pool: &sqlx::PgPool,
    payload: &mut Map<String, Value>,
) -> AppResult<()> {
    let org_id = map_string(payload, "organization_id")
        .ok_or_else(|| AppError::BadRequest("organization_id is required.".to_string()))?;

    let mut property_id = map_string(payload, "property_id");
    let mut unit_id = map_string(payload, "unit_id");
    let mut space_id = map_string(payload, "space_id");
    let mut bed_id = map_string(payload, "bed_id");

    if let Some(ref selected_bed_id) = bed_id {
        let bed = get_row(pool, "unit_beds", selected_bed_id, "id")
            .await
            .map_err(|_| AppError::BadRequest("Invalid bed_id.".to_string()))?;
        validate_target_org(&bed, &org_id, "bed_id")?;
        let bed_unit_id = value_str(&bed, "unit_id");
        let bed_property_id = value_str(&bed, "property_id");
        let bed_space_id = value_str(&bed, "space_id");

        if bed_unit_id.is_empty() {
            return Err(AppError::BadRequest(
                "bed_id does not have a linked unit.".to_string(),
            ));
        }

        if let Some(current_unit_id) = unit_id.as_deref() {
            if current_unit_id != bed_unit_id {
                return Err(AppError::BadRequest(
                    "bed_id does not belong to the provided unit_id.".to_string(),
                ));
            }
        }
        if let Some(current_property_id) = property_id.as_deref() {
            if current_property_id != bed_property_id {
                return Err(AppError::BadRequest(
                    "bed_id does not belong to the provided property_id.".to_string(),
                ));
            }
        }
        unit_id = Some(bed_unit_id);
        if !bed_property_id.is_empty() {
            property_id = Some(bed_property_id);
        }
        if !bed_space_id.is_empty() {
            if let Some(current_space_id) = space_id.as_deref() {
                if current_space_id != bed_space_id {
                    return Err(AppError::BadRequest(
                        "bed_id does not belong to the provided space_id.".to_string(),
                    ));
                }
            }
            space_id = Some(bed_space_id);
        }
    }

    if let Some(ref selected_space_id) = space_id {
        let space = get_row(pool, "unit_spaces", selected_space_id, "id")
            .await
            .map_err(|_| AppError::BadRequest("Invalid space_id.".to_string()))?;
        validate_target_org(&space, &org_id, "space_id")?;
        let space_unit_id = value_str(&space, "unit_id");
        let space_property_id = value_str(&space, "property_id");

        if space_unit_id.is_empty() {
            return Err(AppError::BadRequest(
                "space_id does not have a linked unit.".to_string(),
            ));
        }

        if let Some(current_unit_id) = unit_id.as_deref() {
            if current_unit_id != space_unit_id {
                return Err(AppError::BadRequest(
                    "space_id does not belong to the provided unit_id.".to_string(),
                ));
            }
        }
        if let Some(current_property_id) = property_id.as_deref() {
            if current_property_id != space_property_id {
                return Err(AppError::BadRequest(
                    "space_id does not belong to the provided property_id.".to_string(),
                ));
            }
        }
        unit_id = Some(space_unit_id);
        if !space_property_id.is_empty() {
            property_id = Some(space_property_id);
        }
    }

    if let Some(ref selected_unit_id) = unit_id {
        let unit = get_row(pool, "units", selected_unit_id, "id")
            .await
            .map_err(|_| AppError::BadRequest("Invalid unit_id.".to_string()))?;
        validate_target_org(&unit, &org_id, "unit_id")?;
        let unit_property_id = value_str(&unit, "property_id");
        if let Some(current_property_id) = property_id.as_deref() {
            if current_property_id != unit_property_id {
                return Err(AppError::BadRequest(
                    "unit_id does not belong to the provided property_id.".to_string(),
                ));
            }
        }
        if !unit_property_id.is_empty() {
            property_id = Some(unit_property_id);
        }
    } else {
        return Err(AppError::BadRequest(
            "unit_id is required (or derivable from space_id/bed_id).".to_string(),
        ));
    }

    if let Some(value) = property_id {
        payload.insert("property_id".to_string(), Value::String(value));
    }
    if let Some(value) = unit_id {
        payload.insert("unit_id".to_string(), Value::String(value));
    }
    if let Some(value) = space_id {
        payload.insert("space_id".to_string(), Value::String(value));
    }
    if let Some(value) = bed_id.take() {
        payload.insert("bed_id".to_string(), Value::String(value));
    }

    Ok(())
}

fn validate_target_org(record: &Value, org_id: &str, field_name: &str) -> AppResult<()> {
    let target_org_id = value_str(record, "organization_id");
    if target_org_id.is_empty() || target_org_id != org_id {
        return Err(AppError::BadRequest(format!(
            "{field_name} does not belong to this organization."
        )));
    }
    Ok(())
}

async fn validate_lease_payload_for_write(
    pool: &sqlx::PgPool,
    payload: &Map<String, Value>,
    current_lease_id: Option<&str>,
) -> AppResult<()> {
    let org_id = map_string(payload, "organization_id")
        .ok_or_else(|| AppError::BadRequest("organization_id is required.".to_string()))?;
    let unit_id = map_string(payload, "unit_id")
        .ok_or_else(|| AppError::BadRequest("unit_id is required.".to_string()))?;
    let starts_on = map_string(payload, "starts_on")
        .ok_or_else(|| AppError::BadRequest("starts_on is required.".to_string()))?;
    let starts_on_date = parse_date_opt(Some(&starts_on))
        .ok_or_else(|| AppError::BadRequest("starts_on must be YYYY-MM-DD.".to_string()))?;
    let ends_on_date =
        map_string(payload, "ends_on").and_then(|value| parse_date_opt(Some(&value)));

    if let Some(end_date) = ends_on_date {
        if end_date < starts_on_date {
            return Err(AppError::BadRequest(
                "ends_on must be on or after starts_on.".to_string(),
            ));
        }
    }

    let lease_status = map_string(payload, "lease_status").unwrap_or_else(|| "draft".to_string());
    let turnover_buffer_hours =
        clamp_turnover_buffer_hours(value_i64(payload.get("turnover_buffer_hours")).unwrap_or(24));

    if !is_occupancy_status(&lease_status) {
        return Ok(());
    }

    let candidate_space_id = map_string(payload, "space_id");
    let candidate_bed_id = map_string(payload, "bed_id");
    let candidate_buffer_days = turnover_hours_to_days(i64::from(turnover_buffer_hours));

    let existing_rows = list_rows(
        pool,
        "leases",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("unit_id", Value::String(unit_id)),
            (
                "lease_status",
                Value::Array(
                    ["draft", "active", "delinquent"]
                        .iter()
                        .map(|value| Value::String((*value).to_string()))
                        .collect(),
                ),
            ),
        ])),
        5000,
        0,
        "starts_on",
        true,
    )
    .await?;

    for existing in existing_rows {
        let existing_id = value_str(&existing, "id");
        if let Some(current_id) = current_lease_id {
            if current_id == existing_id {
                continue;
            }
        }

        let existing_status = value_str(&existing, "lease_status");
        if !is_occupancy_status(&existing_status) {
            continue;
        }

        let existing_starts_on = value_str(&existing, "starts_on");
        let Some(existing_start_date) = parse_date_opt(Some(&existing_starts_on)) else {
            continue;
        };
        let existing_end_date =
            value_opt_str(&existing, "ends_on").and_then(|value| parse_date_opt(Some(&value)));

        let existing_space_id = value_opt_str(&existing, "space_id");
        let existing_bed_id = value_opt_str(&existing, "bed_id");
        if !lease_targets_conflict(
            candidate_space_id.as_deref(),
            candidate_bed_id.as_deref(),
            existing_space_id.as_deref(),
            existing_bed_id.as_deref(),
        ) {
            continue;
        }

        let existing_buffer_days = turnover_hours_to_days(i64::from(clamp_turnover_buffer_hours(
            value_i64(
                existing
                    .as_object()
                    .and_then(|obj| obj.get("turnover_buffer_hours")),
            )
            .unwrap_or(24),
        )));
        let required_days = std::cmp::max(candidate_buffer_days, existing_buffer_days);
        if intervals_conflict_with_buffer(
            starts_on_date,
            ends_on_date,
            existing_start_date,
            existing_end_date,
            required_days,
        ) {
            return Err(AppError::Conflict(format!(
                "Lease overlaps an existing lease ({existing_id}) for the same occupancy target. Enforce at least {required_days} day(s) turnover gap.",
            )));
        }
    }

    Ok(())
}

fn is_occupancy_status(status: &str) -> bool {
    matches!(status, "draft" | "active" | "delinquent")
}

fn lease_targets_conflict(
    candidate_space_id: Option<&str>,
    candidate_bed_id: Option<&str>,
    existing_space_id: Option<&str>,
    existing_bed_id: Option<&str>,
) -> bool {
    let candidate_is_unit_level = candidate_space_id.is_none() && candidate_bed_id.is_none();
    let existing_is_unit_level = existing_space_id.is_none() && existing_bed_id.is_none();

    if candidate_is_unit_level || existing_is_unit_level {
        return true;
    }

    let candidate_is_bed_level = candidate_bed_id.is_some();
    let existing_is_bed_level = existing_bed_id.is_some();

    match (candidate_is_bed_level, existing_is_bed_level) {
        // Bed-level leases should only conflict on the exact same bed.
        (true, true) => match (candidate_bed_id, existing_bed_id) {
            (Some(candidate_bed_id), Some(existing_bed_id)) => candidate_bed_id == existing_bed_id,
            _ => true,
        },
        // Space-level leases conflict on the same space.
        (false, false) => match (candidate_space_id, existing_space_id) {
            (Some(candidate_space_id), Some(existing_space_id)) => {
                candidate_space_id == existing_space_id
            }
            _ => true,
        },
        // Bed-level vs space-level conflicts if they refer to the same space.
        (true, false) | (false, true) => match (candidate_space_id, existing_space_id) {
            (Some(candidate_space_id), Some(existing_space_id)) => {
                candidate_space_id == existing_space_id
            }
            _ => true,
        },
    }
}

fn intervals_conflict_with_buffer(
    start_a: NaiveDate,
    end_a: Option<NaiveDate>,
    start_b: NaiveDate,
    end_b: Option<NaiveDate>,
    buffer_days: i64,
) -> bool {
    let max_day = i64::MAX / 4;
    let start_a_num = i64::from(start_a.num_days_from_ce());
    let end_a_num = end_a
        .map(|value| i64::from(value.num_days_from_ce()))
        .unwrap_or(max_day);
    let start_b_num = i64::from(start_b.num_days_from_ce());
    let end_b_num = end_b
        .map(|value| i64::from(value.num_days_from_ce()))
        .unwrap_or(max_day);

    start_a_num <= end_b_num.saturating_add(buffer_days)
        && start_b_num <= end_a_num.saturating_add(buffer_days)
}

fn clamp_turnover_buffer_hours(value: i64) -> i16 {
    value.clamp(0, 240) as i16
}

fn turnover_hours_to_days(hours: i64) -> i64 {
    if hours <= 0 {
        return 0;
    }
    (hours + 23) / 24
}

fn parse_date_opt(value: Option<&str>) -> Option<NaiveDate> {
    value.and_then(|text| NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d").ok())
}

fn lease_overlaps_window(lease: &Value, from_date: NaiveDate, to_date: NaiveDate) -> bool {
    let starts_on = value_str(lease, "starts_on");
    let Some(start_date) = parse_date_opt(Some(&starts_on)) else {
        return false;
    };
    let end_date = value_opt_str(lease, "ends_on")
        .as_deref()
        .and_then(|value| parse_date_opt(Some(value)))
        .unwrap_or(to_date);
    start_date <= to_date && end_date >= from_date
}

fn rent_roll_track_sort_key(track: &RentRollTrack) -> (String, String, String, String, String) {
    (
        track
            .property_name
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        track
            .unit_name
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        track
            .space_name
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        track
            .bed_code
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        track.track_id.to_ascii_lowercase(),
    )
}

fn map_string(payload: &Map<String, Value>, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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

    let property_ids_for_query = property_ids.clone();
    let unit_ids_for_query = unit_ids.clone();
    let lease_ids_for_query = lease_ids.clone();
    let (properties, units, collections) = tokio::try_join!(
        async move {
            if property_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "properties",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            property_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, property_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if unit_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "units",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            unit_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, unit_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if lease_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "collection_records",
                    Some(&json_map(&[(
                        "lease_id",
                        Value::Array(
                            lease_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(300, (lease_ids_for_query.len() as i64) * 12),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        }
    )?;

    let property_name = map_by_id_field(&properties, "name");
    let unit_name = map_by_id_field(&units, "name");

    let mut collection_stats: HashMap<String, LeaseCollectionStats> = HashMap::new();
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

fn extract_ids(rows: &[Value], key: &str) -> HashSet<String> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter_map(|obj| obj.get(key))
        .filter_map(|value| string_value(Some(value)))
        .collect()
}

fn map_by_id_field(rows: &[Value], field: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
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

fn value_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|parsed| parsed as i64)),
        Some(Value::String(text)) => text.trim().parse::<i64>().ok(),
        _ => None,
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

fn value_opt_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
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

    let app_public_url =
        std::env::var("APP_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());

    let updated = crate::services::lease_renewal::send_renewal_offer(
        pool,
        &path.lease_id,
        payload.offered_rent,
        payload.notes.as_deref(),
        &app_public_url,
    )
    .await
    .map_err(AppError::BadRequest)?;

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
    new_lease.insert(
        "parent_lease_id".to_string(),
        Value::String(path.lease_id.clone()),
    );
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

    new_lease.insert("monthly_rent".to_string(), json!(offered_rent));
    new_lease.insert(
        "lease_status".to_string(),
        Value::String("active".to_string()),
    );
    new_lease.insert("starts_on".to_string(), Value::String(new_starts_on));
    new_lease.insert("ends_on".to_string(), Value::String(new_ends_on));
    if let Some(notes) = &payload.notes {
        new_lease.insert("renewal_notes".to_string(), Value::String(notes.clone()));
    }

    normalize_lease_payload_for_write(&mut new_lease);
    resolve_lease_target_fields(pool, &mut new_lease).await?;
    validate_lease_payload_for_write(pool, &new_lease, None).await?;

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
            if ends.is_empty() {
                None
            } else {
                Some(ends.as_str())
            },
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

#[cfg(test)]
mod tests {
    use super::{
        clamp_turnover_buffer_hours, intervals_conflict_with_buffer, lease_targets_conflict,
        parse_date_opt, turnover_hours_to_days,
    };

    #[test]
    fn converts_turnover_hours_to_days() {
        assert_eq!(turnover_hours_to_days(0), 0);
        assert_eq!(turnover_hours_to_days(1), 1);
        assert_eq!(turnover_hours_to_days(24), 1);
        assert_eq!(turnover_hours_to_days(25), 2);
        assert_eq!(turnover_hours_to_days(48), 2);
    }

    #[test]
    fn clamps_turnover_hours() {
        assert_eq!(clamp_turnover_buffer_hours(-20), 0);
        assert_eq!(clamp_turnover_buffer_hours(12), 12);
        assert_eq!(clamp_turnover_buffer_hours(999), 240);
    }

    #[test]
    fn detects_interval_conflicts_with_buffer() {
        let a_start = parse_date_opt(Some("2026-01-01")).expect("valid date");
        let a_end = parse_date_opt(Some("2026-01-31"));
        let b_start = parse_date_opt(Some("2026-02-01")).expect("valid date");
        let b_end = parse_date_opt(Some("2026-02-28"));

        assert!(intervals_conflict_with_buffer(
            a_start, a_end, b_start, b_end, 1
        ));
        assert!(!intervals_conflict_with_buffer(
            a_start, a_end, b_start, b_end, 0
        ));
    }

    #[test]
    fn checks_target_conflict_matrix() {
        assert!(lease_targets_conflict(None, None, None, None));
        assert!(lease_targets_conflict(None, None, Some("space-a"), None));
        assert!(lease_targets_conflict(
            Some("space-a"),
            None,
            Some("space-a"),
            None
        ));
        assert!(!lease_targets_conflict(
            Some("space-a"),
            None,
            Some("space-b"),
            None
        ));
        assert!(!lease_targets_conflict(
            Some("space-a"),
            Some("bed-a"),
            Some("space-a"),
            Some("bed-b")
        ));
        assert!(lease_targets_conflict(
            Some("space-a"),
            Some("bed-a"),
            Some("space-a"),
            Some("bed-a")
        ));
        assert!(lease_targets_conflict(
            Some("space-a"),
            Some("bed-a"),
            Some("space-a"),
            None
        ));
        assert!(lease_targets_conflict(
            Some("space-a"),
            None,
            Some("space-a"),
            Some("bed-b")
        ));
        assert!(!lease_targets_conflict(
            Some("space-a"),
            Some("bed-a"),
            Some("space-b"),
            Some("bed-b")
        ));
        assert!(!lease_targets_conflict(
            Some("space-a"),
            Some("bed-a"),
            Some("space-b"),
            None
        ));
    }
}
