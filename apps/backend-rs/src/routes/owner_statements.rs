use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, CreateOwnerStatementInput, OwnerStatementPath, OwnerStatementsQuery,
    },
    services::{audit::write_audit_log, enrichment::enrich_owner_statements},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const REPORTABLE_STATUSES: &[&str] = &["confirmed", "checked_in", "checked_out"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/owner-statements",
            axum::routing::get(list_owner_statements).post(create_owner_statement),
        )
        .route(
            "/owner-statements/{statement_id}",
            axum::routing::get(get_owner_statement),
        )
        .route(
            "/owner-statements/{statement_id}/request-approval",
            axum::routing::post(request_approval_owner_statement),
        )
        .route(
            "/owner-statements/{statement_id}/approve",
            axum::routing::post(approve_owner_statement),
        )
        .route(
            "/owner-statements/{statement_id}/finalize",
            axum::routing::post(finalize_owner_statement),
        )
}

async fn list_owner_statements(
    State(state): State<AppState>,
    Query(query): Query<OwnerStatementsQuery>,
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
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }

    let rows = list_rows(
        pool,
        "owner_statements",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "period_start",
        false,
    )
    .await?;
    let enriched = enrich_owner_statements(pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_owner_statement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateOwnerStatementInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "accountant"],
    )
    .await?;
    let pool = db_pool(&state)?;

    let breakdown = build_statement_breakdown(
        pool,
        &payload.organization_id,
        &payload.period_start,
        &payload.period_end,
        payload.property_id.as_deref(),
        payload.unit_id.as_deref(),
    )
    .await?;

    let mut statement = serde_json::to_value(&payload)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    statement.insert("gross_revenue".to_string(), json!(breakdown.gross_revenue));
    statement.insert(
        "lease_collections".to_string(),
        json!(breakdown.lease_collections),
    );
    statement.insert("service_fees".to_string(), json!(breakdown.service_fees));
    statement.insert(
        "collection_fees".to_string(),
        json!(breakdown.collection_fees),
    );
    statement.insert("platform_fees".to_string(), json!(breakdown.platform_fees));
    statement.insert(
        "taxes_collected".to_string(),
        json!(breakdown.taxes_collected),
    );
    statement.insert(
        "operating_expenses".to_string(),
        json!(breakdown.operating_expenses),
    );
    statement.insert("net_payout".to_string(), json!(breakdown.net_payout));
    statement.insert("status".to_string(), Value::String("draft".to_string()));

    let created = create_row(pool, "owner_statements", &statement).await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "owner_statements",
        Some(&value_str(&created, "id")),
        None,
        Some(created.clone()),
    )
    .await;

    let mut response = created.as_object().cloned().unwrap_or_default();
    response.insert("line_items".to_string(), Value::Array(breakdown.line_items));
    response.insert(
        "reconciliation".to_string(),
        json!({
            "gross_total": breakdown.reconciliation_gross_total,
            "computed_net_payout": breakdown.reconciliation_computed_net_payout,
            "stored_net_payout": breakdown.net_payout,
            "stored_vs_computed_diff": 0.0,
        }),
    );

    Ok((
        axum::http::StatusCode::CREATED,
        Json(Value::Object(response)),
    ))
}

async fn get_owner_statement(
    State(state): State<AppState>,
    Path(path): Path<OwnerStatementPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "owner_statements", &path.statement_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut enriched_rows = enrich_owner_statements(pool, vec![record.clone()], &org_id).await?;
    let mut item = enriched_rows
        .pop()
        .unwrap_or_else(|| Value::Object(Map::new()));

    let breakdown = build_statement_breakdown(
        pool,
        &org_id,
        &value_str(&record, "period_start"),
        &value_str(&record, "period_end"),
        non_empty_opt(record.get("property_id").and_then(Value::as_str)).as_deref(),
        non_empty_opt(record.get("unit_id").and_then(Value::as_str)).as_deref(),
    )
    .await?;

    let stored_net = round2(number_from_value(record.get("net_payout")));
    if let Some(obj) = item.as_object_mut() {
        obj.insert("line_items".to_string(), Value::Array(breakdown.line_items));
        obj.insert(
            "reconciliation".to_string(),
            json!({
                "gross_total": breakdown.reconciliation_gross_total,
                "computed_net_payout": breakdown.reconciliation_computed_net_payout,
                "stored_net_payout": stored_net,
                "stored_vs_computed_diff": round2(stored_net - breakdown.reconciliation_computed_net_payout),
            }),
        );
    }
    Ok(Json(item))
}

async fn request_approval_owner_statement(
    State(state): State<AppState>,
    Path(path): Path<OwnerStatementPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "owner_statements", &path.statement_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "accountant"]).await?;

    let current_status = value_str(&record, "status");
    if current_status != "draft" {
        return Err(AppError::BadRequest(
            "Only draft statements can be submitted for approval.".to_string(),
        ));
    }

    let mut patch = Map::new();
    patch.insert(
        "approval_status".to_string(),
        Value::String("pending".to_string()),
    );
    patch.insert(
        "approval_requested_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "owner_statements", &path.statement_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "request_approval",
        "owner_statements",
        Some(&path.statement_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn approve_owner_statement(
    State(state): State<AppState>,
    Path(path): Path<OwnerStatementPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "owner_statements", &path.statement_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let approval_status = value_str(&record, "approval_status");
    if approval_status != "pending" {
        return Err(AppError::BadRequest(
            "Only statements with pending approval can be approved.".to_string(),
        ));
    }

    let mut patch = Map::new();
    patch.insert(
        "approval_status".to_string(),
        Value::String("approved".to_string()),
    );
    patch.insert("approved_by".to_string(), Value::String(user_id.clone()));
    patch.insert(
        "approved_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "owner_statements", &path.statement_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "approve",
        "owner_statements",
        Some(&path.statement_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn finalize_owner_statement(
    State(state): State<AppState>,
    Path(path): Path<OwnerStatementPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "owner_statements", &path.statement_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "accountant"]).await?;

    let updated = update_row(
        pool,
        "owner_statements",
        &path.statement_id,
        &json_map(&[("status", Value::String("finalized".to_string()))]),
        "id",
    )
    .await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "status_transition",
        "owner_statements",
        Some(&path.statement_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

struct StatementBreakdown {
    gross_revenue: f64,
    lease_collections: f64,
    service_fees: f64,
    collection_fees: f64,
    platform_fees: f64,
    taxes_collected: f64,
    operating_expenses: f64,
    net_payout: f64,
    line_items: Vec<Value>,
    reconciliation_gross_total: f64,
    reconciliation_computed_net_payout: f64,
}

async fn build_statement_breakdown(
    pool: &sqlx::PgPool,
    organization_id: &str,
    period_start: &str,
    period_end: &str,
    property_id: Option<&str>,
    unit_id: Option<&str>,
) -> AppResult<StatementBreakdown> {
    let start = parse_date(period_start)?;
    let end = parse_date(period_end)?;
    let start_iso = start.to_string();
    let end_iso = end.to_string();

    let mut allowed_unit_ids: Option<std::collections::HashSet<String>> = None;
    if let Some(property_id) = property_id.map(str::trim).filter(|value| !value.is_empty()) {
        let units = list_rows(
            pool,
            "units",
            Some(&json_map(&[
                (
                    "organization_id",
                    Value::String(organization_id.to_string()),
                ),
                ("property_id", Value::String(property_id.to_string())),
            ])),
            3000,
            0,
            "created_at",
            false,
        )
        .await?;
        let ids = units
            .iter()
            .filter_map(Value::as_object)
            .filter_map(|unit| unit.get("id"))
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<std::collections::HashSet<_>>();
        allowed_unit_ids = Some(ids);
    }

    let unit_scope = unit_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let property_scope = property_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let mut reservation_filters = json_map(&[
        (
            "organization_id",
            Value::String(organization_id.to_string()),
        ),
        ("check_out_date__gt", Value::String(start_iso.clone())),
        ("check_in_date__lte", Value::String(end_iso.clone())),
        (
            "status",
            Value::Array(
                REPORTABLE_STATUSES
                    .iter()
                    .map(|status| Value::String((*status).to_string()))
                    .collect(),
            ),
        ),
    ]);
    if let Some(unit_scope_id) = unit_scope.as_ref() {
        reservation_filters.insert("unit_id".to_string(), Value::String(unit_scope_id.clone()));
    } else if let Some(allowed) = allowed_unit_ids.as_ref() {
        if !allowed.is_empty() {
            reservation_filters.insert(
                "unit_id".to_string(),
                Value::Array(allowed.iter().cloned().map(Value::String).collect()),
            );
        }
    }

    let mut expense_base_filters = json_map(&[(
        "organization_id",
        Value::String(organization_id.to_string()),
    )]);
    expense_base_filters.insert(
        "expense_date__gte".to_string(),
        Value::String(start_iso.clone()),
    );
    expense_base_filters.insert(
        "expense_date__lte".to_string(),
        Value::String(end_iso.clone()),
    );
    if let Some(unit_scope_id) = unit_scope.as_ref() {
        expense_base_filters.insert("unit_id".to_string(), Value::String(unit_scope_id.clone()));
    } else if let Some(property_scope_id) = property_scope.as_ref() {
        expense_base_filters.insert(
            "property_id".to_string(),
            Value::String(property_scope_id.clone()),
        );
    }

    let mut lease_filters = json_map(&[(
        "organization_id",
        Value::String(organization_id.to_string()),
    )]);
    if let Some(unit_scope_id) = unit_scope.as_ref() {
        lease_filters.insert("unit_id".to_string(), Value::String(unit_scope_id.clone()));
    } else if let Some(allowed) = allowed_unit_ids.as_ref() {
        if !allowed.is_empty() {
            lease_filters.insert(
                "unit_id".to_string(),
                Value::Array(allowed.iter().cloned().map(Value::String).collect()),
            );
        } else if let Some(property_scope_id) = property_scope.as_ref() {
            lease_filters.insert(
                "property_id".to_string(),
                Value::String(property_scope_id.clone()),
            );
        }
    } else if let Some(property_scope_id) = property_scope.as_ref() {
        lease_filters.insert(
            "property_id".to_string(),
            Value::String(property_scope_id.clone()),
        );
    }

    let (reservations, mut expenses, leases) = tokio::try_join!(
        async {
            list_rows(
                pool,
                "reservations",
                Some(&reservation_filters),
                5000,
                0,
                "check_in_date",
                true,
            )
            .await
        },
        async {
            list_rows(
                pool,
                "expenses",
                Some(&expense_base_filters),
                5000,
                0,
                "expense_date",
                false,
            )
            .await
        },
        async {
            list_rows(
                pool,
                "leases",
                Some(&lease_filters),
                6000,
                0,
                "created_at",
                false,
            )
            .await
        }
    )?;

    if unit_scope.is_none() {
        if let (Some(property_scope_id), Some(allowed)) =
            (property_scope.as_ref(), allowed_unit_ids.as_ref())
        {
            if !allowed.is_empty() {
                let expense_unit_rows = list_rows(
                    pool,
                    "expenses",
                    Some(&json_map(&[
                        (
                            "organization_id",
                            Value::String(organization_id.to_string()),
                        ),
                        (
                            "unit_id",
                            Value::Array(allowed.iter().cloned().map(Value::String).collect()),
                        ),
                        ("expense_date__gte", Value::String(start_iso.clone())),
                        ("expense_date__lte", Value::String(end_iso.clone())),
                    ])),
                    5000,
                    0,
                    "expense_date",
                    false,
                )
                .await?;

                let mut merged = std::collections::HashMap::new();
                for row in expenses.drain(..).chain(expense_unit_rows.into_iter()) {
                    let id = value_str(&row, "id");
                    if id.is_empty() {
                        continue;
                    }
                    let keep = row
                        .as_object()
                        .and_then(|obj| obj.get("property_id"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| value == property_scope_id)
                        || row
                            .as_object()
                            .and_then(|obj| obj.get("unit_id"))
                            .and_then(Value::as_str)
                            .is_some_and(|value| allowed.contains(value));
                    if keep {
                        merged.insert(id, row);
                    }
                }
                expenses = merged.into_values().collect::<Vec<_>>();
            }
        }
    }

    let lease_index = leases
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let lease_id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?
                .to_string();
            Some((lease_id, Value::Object(item.clone())))
        })
        .collect::<std::collections::HashMap<String, Value>>();
    let lease_ids = lease_index.keys().cloned().collect::<Vec<_>>();

    let (lease_charges, collections) = if lease_ids.is_empty() {
        (Vec::new(), Vec::new())
    } else {
        let lease_ids_for_charges = lease_ids.clone();
        let lease_ids_for_collections = lease_ids.clone();
        tokio::try_join!(
            async move {
                list_rows(
                    pool,
                    "lease_charges",
                    Some(&json_map(&[
                        (
                            "organization_id",
                            Value::String(organization_id.to_string()),
                        ),
                        (
                            "lease_id",
                            Value::Array(
                                lease_ids_for_charges
                                    .iter()
                                    .cloned()
                                    .map(Value::String)
                                    .collect(),
                            ),
                        ),
                        (
                            "charge_type",
                            Value::Array(
                                ["service_fee_flat", "admin_fee"]
                                    .iter()
                                    .map(|kind| Value::String((*kind).to_string()))
                                    .collect(),
                            ),
                        ),
                        ("charge_date__gte", Value::String(start_iso.clone())),
                        ("charge_date__lte", Value::String(end_iso.clone())),
                    ])),
                    std::cmp::max(3000, (lease_ids_for_charges.len() as i64) * 12),
                    0,
                    "charge_date",
                    false,
                )
                .await
            },
            async move {
                list_rows(
                    pool,
                    "collection_records",
                    Some(&json_map(&[
                        (
                            "organization_id",
                            Value::String(organization_id.to_string()),
                        ),
                        (
                            "lease_id",
                            Value::Array(
                                lease_ids_for_collections
                                    .iter()
                                    .cloned()
                                    .map(Value::String)
                                    .collect(),
                            ),
                        ),
                        ("status", Value::String("paid".to_string())),
                    ])),
                    std::cmp::max(4000, (lease_ids_for_collections.len() as i64) * 24),
                    0,
                    "paid_at",
                    false,
                )
                .await
            }
        )?
    };

    let mut line_items: Vec<Value> = Vec::new();
    let mut expense_warnings: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    let mut gross_revenue = 0.0;
    let mut platform_fees = 0.0;
    let mut taxes_collected = 0.0;
    for reservation in reservations {
        let Some(res_obj) = reservation.as_object() else {
            continue;
        };
        let Some(check_in_date) = res_obj
            .get("check_in_date")
            .and_then(Value::as_str)
            .and_then(|value| parse_date(value).ok())
        else {
            continue;
        };
        let Some(check_out_date) = res_obj
            .get("check_out_date")
            .and_then(Value::as_str)
            .and_then(|value| parse_date(value).ok())
        else {
            continue;
        };
        if check_out_date <= start || check_in_date > end {
            continue;
        }

        let reservation_id = value_str_from_obj(res_obj, "id");
        let gross_amount = number_from_obj(res_obj, "total_amount");
        let platform_amount = number_from_obj(res_obj, "platform_fee");
        let tax_amount = number_from_obj(res_obj, "tax_amount");

        gross_revenue += gross_amount;
        platform_fees += platform_amount;
        taxes_collected += tax_amount;

        if gross_amount != 0.0 {
            line_items.push(json!({
                "bucket": "gross_revenue",
                "source_table": "reservations",
                "source_id": reservation_id,
                "kind": "reservation_total",
                "from": value_str_from_obj(res_obj, "check_in_date"),
                "to": value_str_from_obj(res_obj, "check_out_date"),
                "amount_pyg": round2(gross_amount),
            }));
        }
        if platform_amount != 0.0 {
            line_items.push(json!({
                "bucket": "platform_fees",
                "source_table": "reservations",
                "source_id": reservation_id,
                "kind": "reservation_platform_fee",
                "amount_pyg": round2(platform_amount),
            }));
        }
        if tax_amount != 0.0 {
            line_items.push(json!({
                "bucket": "taxes_collected",
                "source_table": "reservations",
                "source_id": reservation_id,
                "kind": "reservation_tax",
                "amount_pyg": round2(tax_amount),
            }));
        }
    }

    let mut operating_expenses = 0.0;
    for expense in expenses {
        let Some(expense_obj) = expense.as_object() else {
            continue;
        };
        let Some(expense_date) = expense_obj
            .get("expense_date")
            .and_then(Value::as_str)
            .and_then(|value| parse_date(value).ok())
        else {
            continue;
        };
        if expense_date < start || expense_date > end {
            continue;
        }

        let (amount_pyg, warning) = expense_amount_pyg(expense_obj);
        operating_expenses += amount_pyg;
        let expense_id = value_str_from_obj(expense_obj, "id");
        if let Some(warning_key) = warning {
            expense_warnings
                .entry(warning_key)
                .or_default()
                .push(expense_id.clone());
        }
        line_items.push(json!({
            "bucket": "operating_expenses",
            "source_table": "expenses",
            "source_id": expense_id,
            "kind": fallback_str(expense_obj.get("category"), "expense"),
            "date": value_str_from_obj(expense_obj, "expense_date"),
            "amount_pyg": round2(amount_pyg),
        }));
    }

    let mut lease_collections = 0.0;
    let mut paid_lease_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for collection in collections {
        let Some(collection_obj) = collection.as_object() else {
            continue;
        };
        if value_str_from_obj(collection_obj, "status") != "paid" {
            continue;
        }

        let paid_on = collection_obj
            .get("paid_at")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .and_then(|value| parse_date(&value[..std::cmp::min(10, value.len())]).ok())
            .or_else(|| {
                collection_obj
                    .get("due_date")
                    .and_then(Value::as_str)
                    .and_then(|value| parse_date(value).ok())
            });
        let Some(paid_on) = paid_on else {
            continue;
        };
        if paid_on < start || paid_on > end {
            continue;
        }

        let (amount_pyg, warning) = generic_amount_pyg(collection_obj, "amount");
        lease_collections += amount_pyg;
        let collection_id = value_str_from_obj(collection_obj, "id");
        if let Some(warning_key) = warning {
            expense_warnings
                .entry(warning_key)
                .or_default()
                .push(collection_id.clone());
        }

        let lease_id = value_str_from_obj(collection_obj, "lease_id");
        if !lease_id.is_empty() {
            paid_lease_ids.insert(lease_id);
        }

        line_items.push(json!({
            "bucket": "lease_collections",
            "source_table": "collection_records",
            "source_id": collection_id,
            "kind": "collection_paid",
            "date": paid_on.to_string(),
            "amount_pyg": round2(amount_pyg),
        }));
    }

    let mut service_fees = 0.0;
    for charge in lease_charges {
        let Some(charge_obj) = charge.as_object() else {
            continue;
        };
        let Some(charge_date) = charge_obj
            .get("charge_date")
            .and_then(Value::as_str)
            .and_then(|value| parse_date(value).ok())
        else {
            continue;
        };
        if charge_date < start || charge_date > end {
            continue;
        }

        let charge_type = value_str_from_obj(charge_obj, "charge_type");
        if !matches!(charge_type.as_str(), "service_fee_flat" | "admin_fee") {
            continue;
        }

        let (amount_pyg, warning) = generic_amount_pyg(charge_obj, "amount");
        service_fees += amount_pyg;
        let charge_id = value_str_from_obj(charge_obj, "id");
        if let Some(warning_key) = warning {
            expense_warnings
                .entry(warning_key)
                .or_default()
                .push(charge_id.clone());
        }

        line_items.push(json!({
            "bucket": "service_fees",
            "source_table": "lease_charges",
            "source_id": charge_id,
            "kind": charge_type,
            "date": value_str_from_obj(charge_obj, "charge_date"),
            "amount_pyg": round2(amount_pyg),
        }));
    }

    let mut collection_fees = 0.0;
    for lease_id in paid_lease_ids {
        let lease = lease_index
            .get(&lease_id)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let platform_fee = number_from_obj(&lease, "platform_fee");
        collection_fees += platform_fee;
        line_items.push(json!({
            "bucket": "collection_fees",
            "source_table": "leases",
            "source_id": lease_id,
            "kind": "platform_fee_per_paid_lease",
            "amount_pyg": round2(platform_fee),
        }));
    }

    if !expense_warnings.is_empty() {
        let missing = expense_warnings
            .get("missing_fx_rate_to_pyg")
            .map(|ids| ids.len())
            .unwrap_or(0);
        let unsupported = expense_warnings
            .iter()
            .filter(|(key, _)| key.starts_with("unsupported_currency:"))
            .map(|(_, ids)| ids.len())
            .sum::<usize>();

        let mut samples: Vec<String> = Vec::new();
        for ids in expense_warnings.values() {
            for expense_id in ids {
                if expense_id.trim().is_empty()
                    || samples.iter().any(|existing| existing == expense_id)
                {
                    continue;
                }
                samples.push(expense_id.clone());
                if samples.len() >= 8 {
                    break;
                }
            }
            if samples.len() >= 8 {
                break;
            }
        }
        let sample_ids = if samples.is_empty() {
            "n/a".to_string()
        } else {
            samples.join(", ")
        };
        return Err(AppError::BadRequest(format!(
            "Cannot compute operating expenses in PYG for this period. missing_fx_rate_to_pyg={missing}, unsupported_currency={unsupported}. Fix the underlying expenses (sample ids: {sample_ids})."
        )));
    }

    let gross_total = gross_revenue + lease_collections;
    let net_payout =
        gross_total - platform_fees - service_fees - collection_fees - operating_expenses;

    Ok(StatementBreakdown {
        gross_revenue: round2(gross_revenue),
        lease_collections: round2(lease_collections),
        service_fees: round2(service_fees),
        collection_fees: round2(collection_fees),
        platform_fees: round2(platform_fees),
        taxes_collected: round2(taxes_collected),
        operating_expenses: round2(operating_expenses),
        net_payout: round2(net_payout),
        line_items,
        reconciliation_gross_total: round2(gross_total),
        reconciliation_computed_net_payout: round2(net_payout),
    })
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid ISO date.".to_string()))
}

fn expense_amount_pyg(expense: &Map<String, Value>) -> (f64, Option<String>) {
    let currency = value_str_from_obj(expense, "currency").to_ascii_uppercase();
    let amount = number_from_obj(expense, "amount");
    if currency == "PYG" {
        return (amount, None);
    }
    if currency == "USD" {
        let fx_rate = number_from_obj(expense, "fx_rate_to_pyg");
        if fx_rate <= 0.0 {
            return (0.0, Some("missing_fx_rate_to_pyg".to_string()));
        }
        return (amount * fx_rate, None);
    }
    (0.0, Some(format!("unsupported_currency:{currency}")))
}

fn generic_amount_pyg(record: &Map<String, Value>, amount_key: &str) -> (f64, Option<String>) {
    let currency = value_str_from_obj(record, "currency").to_ascii_uppercase();
    let amount = number_from_obj(record, amount_key);
    if currency == "PYG" {
        return (amount, None);
    }
    (0.0, Some(format!("unsupported_currency:{currency}")))
}

fn fallback_str(value: Option<&Value>, default: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default.to_string())
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

/// Auto-generate monthly owner statements for all properties with asset owners.
/// Called by the scheduler on the 1st of each month. Skips properties that
/// already have a statement for the period.
pub async fn auto_generate_monthly_statements(
    pool: &sqlx::PgPool,
    org_id: &str,
    engine_mode: crate::config::WorkflowEngineMode,
) -> u32 {
    let today = chrono::Utc::now().date_naive();

    // Compute previous month period
    let first_of_this_month = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .unwrap_or(today);
    let period_end = first_of_this_month
        .pred_opt()
        .unwrap_or(first_of_this_month);
    let period_start = NaiveDate::from_ymd_opt(period_end.year(), period_end.month(), 1)
        .unwrap_or(period_end);

    let period_start_str = period_start.to_string();
    let period_end_str = period_end.to_string();

    // Find properties with asset owners in this org
    let properties: Vec<(String, String)> = sqlx::query_as(
        "SELECT p.id::text, COALESCE(p.name, '') as name
         FROM properties p
         WHERE p.organization_id = $1::uuid
           AND p.asset_owner_id IS NOT NULL
           AND p.is_active = true",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut created_count: u32 = 0;
    for (property_id, property_name) in &properties {
        // Check if a statement already exists for this period + property
        let existing: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM owner_statements
                WHERE organization_id = $1::uuid
                  AND property_id = $2::uuid
                  AND period_start = $3::date
                  AND period_end = $4::date
            )",
        )
        .bind(org_id)
        .bind(property_id.as_str())
        .bind(&period_start_str)
        .bind(&period_end_str)
        .fetch_one(pool)
        .await
        .unwrap_or(true); // If query fails, assume exists to avoid duplicates

        if existing {
            continue;
        }

        // Build the statement breakdown
        let breakdown = match build_statement_breakdown(
            pool,
            org_id,
            &period_start_str,
            &period_end_str,
            Some(property_id),
            None,
        )
        .await
        {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(
                    property_id,
                    error = %e,
                    "Failed to build statement breakdown"
                );
                continue;
            }
        };

        let mut statement = Map::new();
        statement.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        statement.insert(
            "property_id".to_string(),
            Value::String(property_id.clone()),
        );
        statement.insert(
            "period_start".to_string(),
            Value::String(period_start_str.clone()),
        );
        statement.insert(
            "period_end".to_string(),
            Value::String(period_end_str.clone()),
        );
        statement.insert(
            "title".to_string(),
            Value::String(format!(
                "{property_name} — {} {}",
                month_name(period_start.month()),
                period_start.year()
            )),
        );
        statement.insert("gross_revenue".to_string(), json!(breakdown.gross_revenue));
        statement.insert(
            "lease_collections".to_string(),
            json!(breakdown.lease_collections),
        );
        statement.insert("service_fees".to_string(), json!(breakdown.service_fees));
        statement.insert(
            "collection_fees".to_string(),
            json!(breakdown.collection_fees),
        );
        statement.insert("platform_fees".to_string(), json!(breakdown.platform_fees));
        statement.insert(
            "taxes_collected".to_string(),
            json!(breakdown.taxes_collected),
        );
        statement.insert(
            "operating_expenses".to_string(),
            json!(breakdown.operating_expenses),
        );
        statement.insert("net_payout".to_string(), json!(breakdown.net_payout));
        statement.insert("status".to_string(), Value::String("draft".to_string()));

        match create_row(pool, "owner_statements", &statement).await {
            Ok(created) => {
                created_count += 1;
                let statement_id = value_str(&created, "id");
                let mut ctx = Map::new();
                ctx.insert(
                    "statement_id".to_string(),
                    Value::String(statement_id),
                );
                ctx.insert(
                    "property_id".to_string(),
                    Value::String(property_id.clone()),
                );
                ctx.insert(
                    "period".to_string(),
                    Value::String(format!("{period_start_str} to {period_end_str}")),
                );
                crate::services::workflows::fire_trigger(
                    pool,
                    org_id,
                    "owner_statement_ready",
                    &ctx,
                    engine_mode,
                )
                .await;
            }
            Err(e) => {
                tracing::warn!(
                    property_id,
                    error = %e,
                    "Failed to create owner statement"
                );
            }
        }
    }

    if created_count > 0 {
        tracing::info!(org_id, created_count, "Auto-generated owner statements");
    }

    created_count
}

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "Unknown",
    }
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

fn value_str_from_obj(obj: &Map<String, Value>, key: &str) -> String {
    obj.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn number_from_obj(obj: &Map<String, Value>, key: &str) -> f64 {
    number_from_value(obj.get(key))
}

fn number_from_value(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
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
