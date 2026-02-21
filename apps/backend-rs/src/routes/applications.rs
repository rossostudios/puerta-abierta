use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Duration, FixedOffset, Utc};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, ApplicationPath, ApplicationStatusInput, ApplicationsQuery,
        ConvertApplicationToLeaseInput,
    },
    services::{
        analytics::write_analytics_event,
        audit::write_audit_log,
        lease_schedule::ensure_monthly_lease_schedule,
        notification_center::{emit_event, EmitNotificationEventInput},
        pricing::lease_financials_from_lines,
        workflows::fire_trigger,
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const APPLICATION_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];
const RESPONSE_SLA_MINUTES: i64 = 120;
const RESPONSE_SLA_WARNING_MINUTES: f64 = 30.0;
const QUALIFICATION_STRONG_THRESHOLD: i64 = 75;
const QUALIFICATION_MODERATE_THRESHOLD: i64 = 50;

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/applications", axum::routing::get(list_applications))
        .route(
            "/applications/{application_id}",
            axum::routing::get(get_application),
        )
        .route(
            "/applications/{application_id}/status",
            axum::routing::post(update_application_status),
        )
        .route(
            "/applications/{application_id}/convert-to-lease",
            axum::routing::post(convert_application_to_lease),
        )
}

async fn list_applications(
    State(state): State<AppState>,
    Query(query): Query<ApplicationsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_applications_pipeline_enabled(&state)?;

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
    if let Some(listing_id) = non_empty_opt(query.listing_id.as_deref()) {
        filters.insert("listing_id".to_string(), Value::String(listing_id));
    }

    let rows = list_rows(
        pool,
        "application_submissions",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    let enriched = enrich_applications(pool, rows).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn get_application(
    State(state): State<AppState>,
    Path(path): Path<ApplicationPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_applications_pipeline_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "application_submissions", &path.application_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let events = list_rows(
        pool,
        "application_events",
        Some(&json_map(&[(
            "application_id",
            Value::String(path.application_id.clone()),
        )])),
        300,
        0,
        "created_at",
        true,
    )
    .await?;

    let mut enriched = enrich_applications(pool, vec![record]).await?;
    let mut item = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    if let Some(obj) = item.as_object_mut() {
        obj.insert("events".to_string(), Value::Array(events));
    }
    Ok(Json(item))
}

async fn update_application_status(
    State(state): State<AppState>,
    Path(path): Path<ApplicationPath>,
    headers: HeaderMap,
    Json(payload): Json<ApplicationStatusInput>,
) -> AppResult<Json<Value>> {
    ensure_applications_pipeline_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "application_submissions", &path.application_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, APPLICATION_EDIT_ROLES).await?;

    let current = value_str(&record, "status");
    let current_status = if current.is_empty() {
        "new".to_string()
    } else {
        current
    };
    let next = payload.status.trim().to_string();
    if next.is_empty() {
        return Err(AppError::BadRequest("status is required.".to_string()));
    }
    if !can_transition(&current_status, &next) {
        return Err(AppError::BadRequest(format!(
            "Invalid application status transition: {current_status} -> {next}."
        )));
    }

    let now_iso = Utc::now().to_rfc3339();
    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String(next.clone()));

    if let Some(assigned_user_id) = payload.assigned_user_id.clone() {
        patch.insert(
            "assigned_user_id".to_string(),
            Value::String(assigned_user_id),
        );
    }
    if next != "new" && missing_or_blank(&record, "first_response_at") {
        patch.insert(
            "first_response_at".to_string(),
            Value::String(now_iso.clone()),
        );
    }
    if next == "qualified" && missing_or_blank(&record, "qualified_at") {
        patch.insert("qualified_at".to_string(), Value::String(now_iso.clone()));
    }
    if matches!(next.as_str(), "rejected" | "lost") {
        patch.insert(
            "rejected_reason".to_string(),
            payload
                .rejected_reason
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
    }

    let updated = update_row(
        pool,
        "application_submissions",
        &path.application_id,
        &patch,
        "id",
    )
    .await?;

    let event = create_row(
        pool,
        "application_events",
        &json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("application_id", Value::String(path.application_id.clone())),
            ("event_type", Value::String("status_changed".to_string())),
            (
                "event_payload",
                json!({
                    "from": current_status,
                    "to": next,
                    "assigned_user_id": payload.assigned_user_id,
                    "note": payload.note,
                    "rejected_reason": payload.rejected_reason,
                }),
            ),
            ("actor_user_id", Value::String(user_id.clone())),
        ]),
    )
    .await?;
    let event_id = value_str(&event, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "status_transition",
        "application_submissions",
        Some(&path.application_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    if next == "qualified" {
        write_analytics_event(
            state.db_pool.as_ref(),
            Some(&org_id),
            "qualify",
            Some(json!({
                "application_id": path.application_id,
                "status": "qualified",
            })),
        )
        .await;
    }

    let mut event_payload = Map::new();
    event_payload.insert(
        "application_id".to_string(),
        Value::String(path.application_id.clone()),
    );
    event_payload.insert("from".to_string(), Value::String(current_status.clone()));
    event_payload.insert("to".to_string(), Value::String(next.clone()));
    if let Some(assigned_user_id) = payload
        .assigned_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        event_payload.insert(
            "assigned_user_id".to_string(),
            Value::String(assigned_user_id.to_string()),
        );
    }
    if !event_id.is_empty() {
        event_payload.insert(
            "application_event_id".to_string(),
            Value::String(event_id.clone()),
        );
    }

    let _ = emit_event(
        pool,
        EmitNotificationEventInput {
            organization_id: org_id.clone(),
            event_type: "application_status_changed".to_string(),
            category: "applications".to_string(),
            severity: "info".to_string(),
            title: "Aplicación actualizada".to_string(),
            body: format!("Estado cambiado: {current_status} → {next}"),
            link_path: Some("/module/applications".to_string()),
            source_table: Some("application_submissions".to_string()),
            source_id: Some(path.application_id.clone()),
            actor_user_id: Some(user_id.clone()),
            payload: event_payload,
            dedupe_key: Some(format!(
                "application_status_changed:{}:{}",
                path.application_id,
                if event_id.is_empty() {
                    Utc::now().timestamp().to_string()
                } else {
                    event_id.clone()
                }
            )),
            occurred_at: None,
            fallback_roles: vec![],
        },
    )
    .await;

    let mut enriched = enrich_applications(pool, vec![updated]).await?;
    let mut item = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    if let Some(obj) = item.as_object_mut() {
        obj.insert(
            "last_event_id".to_string(),
            event.get("id").cloned().unwrap_or(Value::Null),
        );
    }
    Ok(Json(item))
}

async fn convert_application_to_lease(
    State(state): State<AppState>,
    Path(path): Path<ApplicationPath>,
    headers: HeaderMap,
    Json(payload): Json<ConvertApplicationToLeaseInput>,
) -> AppResult<Json<Value>> {
    ensure_applications_pipeline_enabled(&state)?;
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let application = get_row(pool, "application_submissions", &path.application_id, "id").await?;
    let org_id = value_str(&application, "organization_id");
    assert_org_role(&state, &user_id, &org_id, APPLICATION_EDIT_ROLES).await?;

    let current_status = value_str(&application, "status");
    if matches!(current_status.as_str(), "rejected" | "lost") {
        return Err(AppError::BadRequest(
            "Cannot convert rejected/lost application to lease.".to_string(),
        ));
    }

    let mut listing: Option<Value> = None;
    if let Some(listing_id) = application
        .as_object()
        .and_then(|obj| obj.get("listing_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        listing = Some(get_row(pool, "listings", listing_id, "id").await?);
    }

    let mut defaults = crate::services::pricing::LeaseFinancials::default();
    if let Some(listing_row) = listing.as_ref() {
        let listing_id = value_str(listing_row, "id");
        if !listing_id.is_empty() {
            let lines = listing_fee_lines(pool, &listing_id).await?;
            if !lines.is_empty() {
                defaults = lease_financials_from_lines(&lines);
            }
        }
    }

    let use_explicit = [
        payload.monthly_rent,
        payload.service_fee_flat,
        payload.security_deposit,
        payload.guarantee_option_fee,
        payload.tax_iva,
    ]
    .iter()
    .any(|value| *value > 0.0);

    let monthly_rent = if use_explicit {
        payload.monthly_rent
    } else {
        defaults.monthly_rent
    };
    let service_fee_flat = if use_explicit {
        payload.service_fee_flat
    } else {
        defaults.service_fee_flat
    };
    let security_deposit = if use_explicit {
        payload.security_deposit
    } else {
        defaults.security_deposit
    };
    let guarantee_option_fee = if use_explicit {
        payload.guarantee_option_fee
    } else {
        defaults.guarantee_option_fee
    };
    let tax_iva = if use_explicit {
        payload.tax_iva
    } else {
        defaults.tax_iva
    };

    let (total_move_in, monthly_recurring_total) = if use_explicit {
        (
            round2(
                monthly_rent + service_fee_flat + security_deposit + guarantee_option_fee + tax_iva,
            ),
            round2(monthly_rent + tax_iva),
        )
    } else {
        (
            round2(defaults.total_move_in),
            round2(defaults.monthly_recurring_total),
        )
    };

    let listing_property_id = listing
        .as_ref()
        .and_then(|item| item.as_object())
        .and_then(|obj| obj.get("property_id"))
        .cloned()
        .unwrap_or(Value::Null);
    let listing_unit_id = listing
        .as_ref()
        .and_then(|item| item.as_object())
        .and_then(|obj| obj.get("unit_id"))
        .cloned()
        .unwrap_or(Value::Null);

    let lease_payload = json_map(&[
        ("organization_id", Value::String(org_id.clone())),
        ("application_id", Value::String(path.application_id.clone())),
        ("property_id", listing_property_id),
        ("unit_id", listing_unit_id),
        (
            "tenant_full_name",
            application_value(&application, "full_name").unwrap_or(Value::Null),
        ),
        (
            "tenant_email",
            application_value(&application, "email").unwrap_or(Value::Null),
        ),
        (
            "tenant_phone_e164",
            application_value(&application, "phone_e164").unwrap_or(Value::Null),
        ),
        ("lease_status", Value::String("active".to_string())),
        ("starts_on", Value::String(payload.starts_on.clone())),
        (
            "ends_on",
            payload
                .ends_on
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null),
        ),
        ("currency", Value::String(payload.currency.clone())),
        ("monthly_rent", json!(monthly_rent)),
        ("service_fee_flat", json!(service_fee_flat)),
        ("security_deposit", json!(security_deposit)),
        ("guarantee_option_fee", json!(guarantee_option_fee)),
        ("tax_iva", json!(tax_iva)),
        ("total_move_in", json!(total_move_in)),
        ("monthly_recurring_total", json!(monthly_recurring_total)),
        ("platform_fee", json!(payload.platform_fee)),
        (
            "notes",
            payload
                .notes
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null),
        ),
        ("created_by_user_id", Value::String(user_id.clone())),
    ]);

    let lease = create_row(pool, "leases", &lease_payload).await?;
    let lease_id = value_str(&lease, "id");

    let mut first_collection: Option<Value> = None;
    let mut schedule_due_dates: Vec<String> = Vec::new();
    let mut schedule_collections_created: usize = 0;
    if payload.generate_first_collection {
        let schedule = ensure_monthly_lease_schedule(
            pool,
            &org_id,
            &lease_id,
            &payload.starts_on,
            payload.first_collection_due_date.as_deref(),
            payload.ends_on.as_deref(),
            payload.collection_schedule_months,
            monthly_recurring_total,
            &payload.currency,
            Some(&user_id),
        )
        .await?;
        first_collection = schedule.first_collection.clone();
        schedule_due_dates = schedule.due_dates.clone();
        schedule_collections_created = schedule.collections.len();
    }

    // Create security deposit collection record if deposit > 0
    if security_deposit > 0.0 {
        let deposit_record = json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("lease_id", Value::String(lease_id.clone())),
            (
                "property_id",
                lease.get("property_id").cloned().unwrap_or(Value::Null),
            ),
            (
                "unit_id",
                lease.get("unit_id").cloned().unwrap_or(Value::Null),
            ),
            ("charge_type", Value::String("security_deposit".to_string())),
            ("amount", json!(security_deposit)),
            ("currency", Value::String(payload.currency.clone())),
            ("due_date", Value::String(payload.starts_on.clone())),
            ("status", Value::String("pending".to_string())),
        ]);
        let _ = create_row(pool, "collection_records", &deposit_record).await;
    }

    // Create move-in preparation task
    {
        let tenant_name = application_value(&application, "full_name")
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "Tenant".to_string());
        let task_record = json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            (
                "property_id",
                lease.get("property_id").cloned().unwrap_or(Value::Null),
            ),
            (
                "unit_id",
                lease.get("unit_id").cloned().unwrap_or(Value::Null),
            ),
            ("type", Value::String("check_in".to_string())),
            (
                "title",
                Value::String(format!("Move-in preparation: {tenant_name}")),
            ),
            ("status", Value::String("todo".to_string())),
            ("priority", Value::String("high".to_string())),
            ("due_date", Value::String(payload.starts_on.clone())),
        ]);
        let _ = create_row(pool, "tasks", &task_record).await;
    }

    // Fire lease_created and lease_activated workflow triggers
    {
        let mut wf_ctx = Map::new();
        wf_ctx.insert("lease_id".to_string(), Value::String(lease_id.clone()));
        wf_ctx.insert(
            "application_id".to_string(),
            Value::String(path.application_id.clone()),
        );
        if let Some(pid) = lease.get("property_id") {
            if !pid.is_null() {
                wf_ctx.insert("property_id".to_string(), pid.clone());
            }
        }
        if let Some(uid) = lease.get("unit_id") {
            if !uid.is_null() {
                wf_ctx.insert("unit_id".to_string(), uid.clone());
            }
        }
        let engine_mode = state.config.workflow_engine_mode;
        fire_trigger(pool, &org_id, "lease_created", &wf_ctx, engine_mode).await;
        fire_trigger(pool, &org_id, "lease_activated", &wf_ctx, engine_mode).await;
    }

    let now_iso = Utc::now().to_rfc3339();
    let mut application_patch = Map::new();
    application_patch.insert(
        "status".to_string(),
        Value::String("contract_signed".to_string()),
    );
    application_patch.insert(
        "qualified_at".to_string(),
        existing_or_now(&application, "qualified_at", &now_iso),
    );
    application_patch.insert(
        "first_response_at".to_string(),
        existing_or_now(&application, "first_response_at", &now_iso),
    );
    let updated_application = update_row(
        pool,
        "application_submissions",
        &path.application_id,
        &application_patch,
        "id",
    )
    .await?;

    let collection_id = first_collection
        .as_ref()
        .and_then(|item| item.as_object())
        .and_then(|obj| obj.get("id"))
        .cloned()
        .unwrap_or(Value::Null);

    let _ = create_row(
        pool,
        "application_events",
        &json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("application_id", Value::String(path.application_id.clone())),
            ("event_type", Value::String("lease_sign".to_string())),
            (
                "event_payload",
                json!({
                    "lease_id": lease.get("id").cloned().unwrap_or(Value::Null),
                    "collection_id": collection_id,
                    "schedule_due_dates": schedule_due_dates,
                }),
            ),
            ("actor_user_id", Value::String(user_id.clone())),
        ]),
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "convert_to_lease",
        "application_submissions",
        Some(&path.application_id),
        Some(application),
        Some(updated_application.clone()),
    )
    .await;

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&org_id),
        "lease_sign",
        Some(json!({
            "application_id": path.application_id,
            "lease_id": lease.get("id").cloned().unwrap_or(Value::Null),
            "collection_id": first_collection
                .as_ref()
                .and_then(|item| item.as_object())
                .and_then(|obj| obj.get("id"))
                .cloned()
                .unwrap_or(Value::Null),
            "schedule_collections_created": schedule_collections_created,
        })),
    )
    .await;

    let mut enriched = enrich_applications(pool, vec![updated_application]).await?;
    Ok(Json(json!({
        "application": enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
        "lease": lease,
        "first_collection": first_collection,
        "schedule_due_dates": schedule_due_dates,
        "schedule_collections_created": schedule_collections_created,
    })))
}

async fn listing_fee_lines(pool: &sqlx::PgPool, listing_id: &str) -> AppResult<Vec<Value>> {
    list_rows(
        pool,
        "listing_fee_lines",
        Some(&json_map(&[(
            "listing_id",
            Value::String(listing_id.to_string()),
        )])),
        300,
        0,
        "sort_order",
        true,
    )
    .await
}

async fn enrich_applications(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let listing_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("listing_id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let assigned_user_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("assigned_user_id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let listing_ids_for_query = listing_ids.clone();
    let assigned_user_ids_for_query = assigned_user_ids.clone();
    let (listings, users) = tokio::try_join!(
        async move {
            if listing_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "listings",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            listing_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, listing_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if assigned_user_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "app_users",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            assigned_user_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, assigned_user_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        }
    )?;

    let mut listing_context: std::collections::HashMap<String, (Option<String>, f64)> =
        std::collections::HashMap::new();
    for listing in listings {
        let listing_id = value_str(&listing, "id");
        if listing_id.is_empty() {
            continue;
        }
        let title = listing
            .as_object()
            .and_then(|obj| obj.get("title"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let monthly_recurring_total = number_from_value(
            listing
                .as_object()
                .and_then(|obj| obj.get("monthly_recurring_total")),
        )
        .max(0.0);
        listing_context.insert(listing_id, (title, monthly_recurring_total));
    }

    let mut assigned_user_name: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for user in users {
        let user_id = value_str(&user, "id");
        if user_id.is_empty() {
            continue;
        }
        let preferred_name = user
            .as_object()
            .and_then(|obj| obj.get("full_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                user.as_object()
                    .and_then(|obj| obj.get("email"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| user_id.clone());
        assigned_user_name.insert(user_id, preferred_name);
    }

    let now = Utc::now().fixed_offset();
    let mut enriched = Vec::with_capacity(rows.len());
    for mut row in rows {
        if let Some(obj) = row.as_object_mut() {
            let listing_id = obj
                .get("listing_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let listing_info = listing_id.and_then(|value| listing_context.get(value));
            let listing_title = listing_info
                .and_then(|(title, _)| title.clone())
                .map(Value::String)
                .unwrap_or(Value::Null);
            obj.insert("listing_title".to_string(), listing_title);

            let monthly_total = listing_info.map(|(_, monthly)| *monthly).unwrap_or(0.0);
            let (score, band, income_ratio) = qualification_from_row(obj, monthly_total);
            obj.insert("qualification_score".to_string(), json!(score));
            obj.insert("qualification_band".to_string(), Value::String(band));
            obj.insert(
                "income_to_rent_ratio".to_string(),
                income_ratio
                    .map(|value| json!(value))
                    .unwrap_or(Value::Null),
            );

            if let Some(assigned_user_id) = obj
                .get("assigned_user_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                obj.insert(
                    "assigned_user_name".to_string(),
                    assigned_user_name
                        .get(assigned_user_id)
                        .cloned()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                );
            }

            let created_at = parse_iso_datetime(obj.get("created_at"));
            let Some(created_at) = created_at else {
                enriched.push(row);
                continue;
            };

            let sla_due_at = created_at + Duration::minutes(RESPONSE_SLA_MINUTES);
            obj.insert(
                "response_sla_due_at".to_string(),
                Value::String(sla_due_at.to_rfc3339()),
            );

            if let Some(first_response_at) = parse_iso_datetime(obj.get("first_response_at")) {
                let elapsed_seconds =
                    (first_response_at - created_at).num_milliseconds() as f64 / 1000.0;
                let elapsed_minutes = round2((elapsed_seconds.max(0.0)) / 60.0);
                obj.insert("first_response_minutes".to_string(), json!(elapsed_minutes));
                if first_response_at <= sla_due_at {
                    obj.insert(
                        "response_sla_status".to_string(),
                        Value::String("met".to_string()),
                    );
                    obj.insert(
                        "response_sla_alert_level".to_string(),
                        Value::String("none".to_string()),
                    );
                } else {
                    obj.insert(
                        "response_sla_status".to_string(),
                        Value::String("breached".to_string()),
                    );
                    obj.insert(
                        "response_sla_breached_at".to_string(),
                        Value::String(sla_due_at.to_rfc3339()),
                    );
                    obj.insert(
                        "response_sla_alert_level".to_string(),
                        Value::String("critical".to_string()),
                    );
                }
                enriched.push(row);
                continue;
            }

            let remaining = (sla_due_at - now).num_milliseconds() as f64 / 60000.0;
            if remaining <= 0.0 {
                obj.insert(
                    "response_sla_status".to_string(),
                    Value::String("breached".to_string()),
                );
                obj.insert(
                    "response_sla_breached_at".to_string(),
                    Value::String(sla_due_at.to_rfc3339()),
                );
                obj.insert("response_sla_remaining_minutes".to_string(), json!(0));
                obj.insert(
                    "response_sla_alert_level".to_string(),
                    Value::String("critical".to_string()),
                );
            } else if remaining <= RESPONSE_SLA_WARNING_MINUTES {
                obj.insert(
                    "response_sla_status".to_string(),
                    Value::String("pending".to_string()),
                );
                obj.insert(
                    "response_sla_remaining_minutes".to_string(),
                    json!(round2(remaining)),
                );
                obj.insert(
                    "response_sla_alert_level".to_string(),
                    Value::String("warning".to_string()),
                );
            } else {
                obj.insert(
                    "response_sla_status".to_string(),
                    Value::String("pending".to_string()),
                );
                obj.insert(
                    "response_sla_remaining_minutes".to_string(),
                    json!(round2(remaining)),
                );
                obj.insert(
                    "response_sla_alert_level".to_string(),
                    Value::String("normal".to_string()),
                );
            }
        }
        enriched.push(row);
    }

    Ok(enriched)
}

fn qualification_from_row(
    row: &Map<String, Value>,
    monthly_recurring_total: f64,
) -> (i64, String, Option<f64>) {
    let mut score: f64 = 0.0;

    if has_non_empty_string(row.get("phone_e164")) {
        score += 8.0;
    }
    if has_non_empty_string(row.get("document_number")) {
        score += 10.0;
    }
    if has_non_empty_string(row.get("email")) {
        score += 6.0;
    }
    if has_non_empty_string(row.get("message")) {
        score += 4.0;
    }

    let guarantee_choice = row
        .get("guarantee_choice")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if guarantee_choice == "guarantor_product" {
        score += 16.0;
    } else if guarantee_choice == "cash_deposit" {
        score += 10.0;
    } else {
        score += 6.0;
    }

    let monthly_income = number_from_value(row.get("monthly_income")).max(0.0);
    let mut income_to_rent_ratio: Option<f64> = None;
    if monthly_income > 0.0 && monthly_recurring_total > 0.0 {
        let ratio = round2(monthly_income / monthly_recurring_total);
        income_to_rent_ratio = Some(ratio);
        if ratio >= 3.0 {
            score += 40.0;
        } else if ratio >= 2.5 {
            score += 34.0;
        } else if ratio >= 2.0 {
            score += 28.0;
        } else if ratio >= 1.5 {
            score += 20.0;
        } else {
            score += 10.0;
        }
    } else if monthly_income > 0.0 {
        score += 18.0;
    }

    let status = row
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        status.as_str(),
        "qualified" | "visit_scheduled" | "offer_sent" | "contract_signed"
    ) {
        score += 12.0;
    } else if matches!(status.as_str(), "rejected" | "lost") {
        score -= 8.0;
    }

    let bounded_score = score.round().clamp(0.0, 100.0) as i64;
    let band = if bounded_score >= QUALIFICATION_STRONG_THRESHOLD {
        "strong".to_string()
    } else if bounded_score >= QUALIFICATION_MODERATE_THRESHOLD {
        "moderate".to_string()
    } else {
        "watch".to_string()
    };

    (bounded_score, band, income_to_rent_ratio)
}

fn can_transition(current: &str, next: &str) -> bool {
    if current == next {
        return true;
    }
    match current {
        "new" => matches!(next, "screening" | "rejected" | "lost"),
        "screening" => matches!(next, "qualified" | "visit_scheduled" | "rejected" | "lost"),
        "qualified" => matches!(
            next,
            "visit_scheduled" | "offer_sent" | "contract_signed" | "rejected" | "lost"
        ),
        "visit_scheduled" => matches!(next, "offer_sent" | "qualified" | "rejected" | "lost"),
        "offer_sent" => matches!(next, "contract_signed" | "rejected" | "lost"),
        "contract_signed" => next == "lost",
        "rejected" | "lost" => false,
        _ => false,
    }
}

fn ensure_applications_pipeline_enabled(state: &AppState) -> AppResult<()> {
    if state.config.applications_pipeline_enabled {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "Applications pipeline is disabled.".to_string(),
    ))
}

fn ensure_lease_collections_enabled(state: &AppState) -> AppResult<()> {
    if state.config.lease_collections_enabled {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "Lease collections endpoints are disabled.".to_string(),
    ))
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

fn parse_iso_datetime(value: Option<&Value>) -> Option<DateTime<FixedOffset>> {
    let mut text = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)?;
    if text.ends_with('Z') {
        text.truncate(text.len().saturating_sub(1));
        text.push_str("+00:00");
    }
    DateTime::parse_from_rfc3339(&text).ok()
}

fn number_from_value(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn has_non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|item| !item.is_empty())
}

fn missing_or_blank(row: &Value, key: &str) -> bool {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .map(|value| match value {
            Value::Null => true,
            Value::String(text) => text.trim().is_empty(),
            _ => false,
        })
        .unwrap_or(true)
}

fn existing_or_now(row: &Value, key: &str, fallback_iso: &str) -> Value {
    if let Some(value) = row
        .as_object()
        .and_then(|obj| obj.get(key))
        .filter(|value| !matches!(value, Value::Null))
    {
        if let Some(text) = value.as_str() {
            if !text.trim().is_empty() {
                return Value::String(text.to_string());
            }
            return Value::String(fallback_iso.to_string());
        }
        return value.clone();
    }
    Value::String(fallback_iso.to_string())
}

fn application_value(row: &Value, key: &str) -> Option<Value> {
    row.as_object().and_then(|obj| obj.get(key)).cloned()
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}
