use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::list_rows,
    schemas::{OwnerSummaryQuery, ReportsPeriodQuery},
    services::pricing::missing_required_fee_types,
    state::AppState,
    tenancy::assert_org_member,
};

const REPORTABLE_STATUSES: &[&str] = &["confirmed", "checked_in", "checked_out"];
const ACTIVE_TASK_STATUSES: &[&str] = &["todo", "in_progress"];
const TURNOVER_TASK_TYPES: &[&str] = &["check_in", "check_out", "cleaning", "inspection"];
const UPCOMING_CHECK_IN_STATUSES: &[&str] = &["pending", "confirmed"];
const UPCOMING_CHECK_OUT_STATUSES: &[&str] = &["confirmed", "checked_in"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/reports/owner-summary",
            axum::routing::get(owner_summary_report),
        )
        .route("/reports/summary", axum::routing::get(owner_summary_report))
        .route(
            "/reports/operations-summary",
            axum::routing::get(operations_summary_report),
        )
        .route(
            "/reports/transparency-summary",
            axum::routing::get(transparency_summary_report),
        )
        .route(
            "/reports/finance-dashboard",
            axum::routing::get(finance_dashboard),
        )
        .route(
            "/reports/kpi-dashboard",
            axum::routing::get(kpi_dashboard),
        )
}

async fn owner_summary_report(
    State(state): State<AppState>,
    Query(query): Query<OwnerSummaryQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;
    let total_days = nights(period_start, period_end);

    let mut units = list_rows(
        pool,
        "units",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        3000,
        0,
        "created_at",
        false,
    )
    .await?;
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        units.retain(|unit| value_str(unit, "property_id") == property_id);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        units.retain(|unit| value_str(unit, "id") == unit_id);
    }

    let unit_count = std::cmp::max(units.len(), 1) as i64;
    let available_nights = std::cmp::max(total_days * unit_count, 1) as f64;

    let mut reservations = list_rows(
        pool,
        "reservations",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        6000,
        0,
        "created_at",
        false,
    )
    .await?;
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        reservations.retain(|item| value_str(item, "unit_id") == unit_id);
    }
    if query.property_id.is_some() {
        let units_in_property = units
            .iter()
            .filter_map(Value::as_object)
            .filter_map(|unit| unit.get("id"))
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect::<std::collections::HashSet<_>>();
        reservations.retain(|item| {
            item.as_object()
                .and_then(|obj| obj.get("unit_id"))
                .and_then(Value::as_str)
                .is_some_and(|unit_id| units_in_property.contains(unit_id))
        });
    }

    let mut booked_nights = 0_i64;
    let mut gross_revenue = 0.0;
    for reservation in reservations {
        let status = value_str(&reservation, "status");
        if !REPORTABLE_STATUSES.contains(&status.as_str()) {
            continue;
        }

        let check_in = parse_date(&value_str(&reservation, "check_in_date")).ok();
        let check_out = parse_date(&value_str(&reservation, "check_out_date")).ok();
        let (Some(check_in), Some(check_out)) = (check_in, check_out) else {
            continue;
        };

        if check_out <= period_start || check_in >= period_end {
            continue;
        }
        let overlap_start = std::cmp::max(check_in, period_start);
        let overlap_end = std::cmp::min(check_out, period_end);
        booked_nights += nights(overlap_start, overlap_end);
        gross_revenue += number_from_value(reservation.get("total_amount"));
    }

    let mut expenses = list_rows(
        pool,
        "expenses",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        6000,
        0,
        "created_at",
        false,
    )
    .await?;
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        expenses.retain(|item| value_str(item, "unit_id") == unit_id);
    }
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        expenses.retain(|item| value_str(item, "property_id") == property_id);
    }

    let mut total_expenses = 0.0;
    let mut warnings: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for expense in expenses {
        let Some(expense_date) = parse_date(&value_str(&expense, "expense_date")).ok() else {
            continue;
        };
        if expense_date < period_start || expense_date > period_end {
            continue;
        }
        let (amount_pyg, warning) = expense_amount_pyg(&expense);
        total_expenses += amount_pyg;
        if let Some(warning_key) = warning {
            let next = warnings.get(&warning_key).copied().unwrap_or(0) + 1;
            warnings.insert(warning_key, next);
        }
    }

    let occupancy_rate = round4((booked_nights as f64) / available_nights);
    let net_payout = round2(gross_revenue - total_expenses);

    Ok(Json(json!({
        "organization_id": query.org_id,
        "from": query.from_date,
        "to": query.to_date,
        "occupancy_rate": occupancy_rate,
        "gross_revenue": round2(gross_revenue),
        "expenses": round2(total_expenses),
        "net_payout": net_payout,
        "expense_warnings": warnings,
    })))
}

async fn operations_summary_report(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;
    let now_utc = Utc::now().date_naive();

    let tasks = list_rows(
        pool,
        "tasks",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        20000,
        0,
        "created_at",
        false,
    )
    .await?;

    let mut turnovers_due = 0_i64;
    let mut turnovers_completed_on_time = 0_i64;
    let mut open_tasks = 0_i64;
    let mut overdue_tasks = 0_i64;
    let mut sla_breached_tasks = 0_i64;

    for task in tasks {
        let task_type = value_str(&task, "type").to_ascii_lowercase();
        let status = value_str(&task, "status").to_ascii_lowercase();

        let due_at = datetime_or_none(task.get("due_at"));
        let due_date = due_at.map(|value| value.date_naive());
        let sla_due_at = datetime_or_none(task.get("sla_due_at"));
        let completed_at = datetime_or_none(task.get("completed_at"));
        let sla_breached_at = datetime_or_none(task.get("sla_breached_at"));

        if ACTIVE_TASK_STATUSES.contains(&status.as_str()) {
            open_tasks += 1;
            if due_date.is_some_and(|due| due < now_utc) {
                overdue_tasks += 1;
            }
        }

        if sla_breached_at.is_some()
            || (ACTIVE_TASK_STATUSES.contains(&status.as_str())
                && sla_due_at.is_some_and(|value| value.date_naive() < now_utc))
        {
            sla_breached_tasks += 1;
        }

        if !TURNOVER_TASK_TYPES.contains(&task_type.as_str()) {
            continue;
        }
        let Some(due_date) = due_date else {
            continue;
        };
        if due_date < period_start || due_date > period_end {
            continue;
        }

        turnovers_due += 1;
        if status != "done" {
            continue;
        }

        let reference_due = sla_due_at.or(due_at);
        if reference_due
            .zip(completed_at)
            .is_some_and(|(due, completed)| completed <= due)
            || (reference_due.is_none() && completed_at.is_some())
        {
            turnovers_completed_on_time += 1;
        }
    }

    let turnover_on_time_rate = if turnovers_due > 0 {
        round4((turnovers_completed_on_time as f64) / (turnovers_due as f64))
    } else {
        0.0
    };

    let reservations = list_rows(
        pool,
        "reservations",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        20000,
        0,
        "created_at",
        false,
    )
    .await?;
    let mut reservations_upcoming_check_in = 0_i64;
    let mut reservations_upcoming_check_out = 0_i64;
    for reservation in reservations {
        let status = value_str(&reservation, "status").to_ascii_lowercase();

        if let Ok(check_in_date) = parse_date(&value_str(&reservation, "check_in_date")) {
            if check_in_date >= period_start
                && check_in_date <= period_end
                && UPCOMING_CHECK_IN_STATUSES.contains(&status.as_str())
            {
                reservations_upcoming_check_in += 1;
            }
        }

        if let Ok(check_out_date) = parse_date(&value_str(&reservation, "check_out_date")) {
            if check_out_date >= period_start
                && check_out_date <= period_end
                && UPCOMING_CHECK_OUT_STATUSES.contains(&status.as_str())
            {
                reservations_upcoming_check_out += 1;
            }
        }
    }

    Ok(Json(json!({
        "organization_id": query.org_id,
        "from": query.from_date,
        "to": query.to_date,
        "turnovers_due": turnovers_due,
        "turnovers_completed_on_time": turnovers_completed_on_time,
        "turnover_on_time_rate": turnover_on_time_rate,
        "open_tasks": open_tasks,
        "overdue_tasks": overdue_tasks,
        "sla_breached_tasks": sla_breached_tasks,
        "reservations_upcoming_check_in": reservations_upcoming_check_in,
        "reservations_upcoming_check_out": reservations_upcoming_check_out,
    })))
}

async fn transparency_summary_report(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;

    let listings = list_rows(
        pool,
        "listings",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        6000,
        0,
        "created_at",
        false,
    )
    .await?;
    let listing_ids = listings
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| item.get("id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    let fee_filters = if listing_ids.is_empty() {
        json_map(&[("organization_id", Value::String(query.org_id.clone()))])
    } else {
        json_map(&[(
            "listing_id",
            Value::Array(listing_ids.iter().cloned().map(Value::String).collect()),
        )])
    };

    let fee_lines = list_rows(
        pool,
        "listing_fee_lines",
        Some(&fee_filters),
        if listing_ids.is_empty() {
            1000
        } else {
            std::cmp::max(1000, (listing_ids.len() as i64) * 20)
        },
        0,
        "sort_order",
        true,
    )
    .await?;

    let mut lines_by_listing: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();
    for line in fee_lines {
        let listing_id = value_str(&line, "listing_id");
        if listing_id.is_empty() {
            continue;
        }
        lines_by_listing.entry(listing_id).or_default().push(line);
    }

    let mut published_count = 0_i64;
    let mut transparent_count = 0_i64;
    for listing in &listings {
        if !bool_value(listing.get("is_published")) {
            continue;
        }
        published_count += 1;
        let listing_id = value_str(listing, "id");
        let missing =
            missing_required_fee_types(lines_by_listing.get(&listing_id).unwrap_or(&Vec::new()));
        if missing.is_empty() {
            transparent_count += 1;
        }
    }

    let transparent_listings_pct = if published_count > 0 {
        round4((transparent_count as f64) / (published_count as f64))
    } else {
        0.0
    };

    let applications = list_rows(
        pool,
        "application_submissions",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        12000,
        0,
        "created_at",
        false,
    )
    .await?;

    let qualified_like_statuses = [
        "qualified",
        "visit_scheduled",
        "offer_sent",
        "contract_signed",
    ]
    .into_iter()
    .collect::<std::collections::HashSet<_>>();
    let mut in_period_apps: Vec<Value> = Vec::new();
    let mut first_response_hours: Vec<f64> = Vec::new();
    let mut qualified_count = 0_i64;
    for application in applications {
        let created_at = datetime_or_none(application.get("created_at"));
        let Some(created_at) = created_at else {
            continue;
        };
        let created_date = created_at.date_naive();
        if created_date < period_start || created_date > period_end {
            continue;
        }
        in_period_apps.push(application.clone());

        let status = value_str(&application, "status");
        if qualified_like_statuses.contains(status.as_str()) {
            qualified_count += 1;
        }

        if let Some(first_response_at) = datetime_or_none(application.get("first_response_at")) {
            let elapsed_hours =
                ((first_response_at - created_at).num_milliseconds() as f64).max(0.0) / 3600000.0;
            first_response_hours.push(elapsed_hours);
        }
    }

    let applications_count = in_period_apps.len() as i64;
    let inquiry_to_qualified_rate = if applications_count > 0 {
        round4((qualified_count as f64) / (applications_count as f64))
    } else {
        0.0
    };
    let median_first_response_hours = median(&first_response_hours).map(round2);

    let collections = list_rows(
        pool,
        "collection_records",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
        20000,
        0,
        "created_at",
        false,
    )
    .await?;
    let in_period_collections = collections
        .into_iter()
        .filter(|row| {
            row.get("due_date")
                .and_then(Value::as_str)
                .and_then(|value| parse_date(value).ok())
                .is_some_and(|due_date| due_date >= period_start && due_date <= period_end)
        })
        .collect::<Vec<_>>();

    let total_collections = in_period_collections.len() as i64;
    let paid_collections = in_period_collections
        .iter()
        .filter(|row| value_str(row, "status") == "paid")
        .count() as i64;
    let collection_success_rate = if total_collections > 0 {
        round4((paid_collections as f64) / (total_collections as f64))
    } else {
        0.0
    };
    let paid_amount = round2(
        in_period_collections
            .iter()
            .filter(|row| value_str(row, "status") == "paid")
            .map(|row| number_from_value(row.get("amount")))
            .sum(),
    );

    let alert_events = list_rows(
        pool,
        "integration_events",
        Some(&json_map(&[
            ("organization_id", Value::String(query.org_id.clone())),
            ("provider", Value::String("alerting".to_string())),
        ])),
        20000,
        0,
        "received_at",
        false,
    )
    .await?;
    let mut application_submit_failures = 0_i64;
    let mut application_event_write_failures = 0_i64;
    for event in alert_events {
        let event_type = value_str(&event, "event_type");
        if !matches!(
            event_type.as_str(),
            "application_submit_failed" | "application_event_write_failed"
        ) {
            continue;
        }
        let Some(received_at) = datetime_or_none(event.get("received_at")) else {
            continue;
        };
        let received_date = received_at.date_naive();
        if received_date < period_start || received_date > period_end {
            continue;
        }
        if event_type == "application_submit_failed" {
            application_submit_failures += 1;
        } else {
            application_event_write_failures += 1;
        }
    }

    let application_submit_attempts = applications_count + application_submit_failures;
    let application_submit_failure_rate = if application_submit_attempts > 0 {
        round4((application_submit_failures as f64) / (application_submit_attempts as f64))
    } else {
        0.0
    };

    Ok(Json(json!({
        "organization_id": query.org_id,
        "from": query.from_date,
        "to": query.to_date,
        "published_listings": published_count,
        "transparent_listings": transparent_count,
        "transparent_listings_pct": transparent_listings_pct,
        "applications": applications_count,
        "qualified_applications": qualified_count,
        "inquiry_to_qualified_rate": inquiry_to_qualified_rate,
        "median_first_response_hours": median_first_response_hours,
        "collections_scheduled": total_collections,
        "collections_paid": paid_collections,
        "collection_success_rate": collection_success_rate,
        "paid_collections_amount": paid_amount,
        "application_submit_failures": application_submit_failures,
        "application_event_write_failures": application_event_write_failures,
        "application_submit_failure_rate": application_submit_failure_rate,
    })))
}

/// Finance dashboard: 6 months of monthly revenue, expenses, collection rates, and expense breakdown.
async fn finance_dashboard(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let end_date = parse_date(&query.to_date)?;
    let months_back: u32 = 6;

    // Build month boundaries
    let mut month_boundaries: Vec<(NaiveDate, NaiveDate, String)> = Vec::new();
    for i in 0..months_back {
        let offset = months_back - 1 - i;
        let (year, month) = {
            let m = end_date.month() as i32 - offset as i32;
            if m <= 0 {
                (
                    end_date.year() - 1 + (m - 1) / 12,
                    ((m - 1) % 12 + 12) as u32 + 1,
                )
            } else {
                (end_date.year(), m as u32)
            }
        };
        let start = NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(end_date);
        let next_month = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)
        }
        .unwrap_or(end_date);
        let label = format!("{:04}-{:02}", year, month);
        month_boundaries.push((start, next_month, label));
    }

    let org_filter = json_map(&[("organization_id", Value::String(query.org_id.clone()))]);

    // Fetch reservations
    let reservations = list_rows(
        pool,
        "reservations",
        Some(&org_filter),
        10000,
        0,
        "created_at",
        false,
    )
    .await?;

    // Fetch expenses
    let expenses = list_rows(
        pool,
        "expenses",
        Some(&org_filter),
        10000,
        0,
        "created_at",
        false,
    )
    .await?;

    // Fetch collections
    let collections = list_rows(
        pool,
        "collection_records",
        Some(&org_filter),
        20000,
        0,
        "created_at",
        false,
    )
    .await?;

    // Compute monthly data
    let mut monthly_data: Vec<Value> = Vec::new();
    for (month_start, month_end, label) in &month_boundaries {
        // Revenue from reservations
        let mut month_revenue = 0.0;
        for reservation in &reservations {
            let status = value_str(reservation, "status");
            if !REPORTABLE_STATUSES.contains(&status.as_str()) {
                continue;
            }
            let check_in = parse_date(&value_str(reservation, "check_in_date")).ok();
            let check_out = parse_date(&value_str(reservation, "check_out_date")).ok();
            let (Some(ci), Some(co)) = (check_in, check_out) else {
                continue;
            };
            if co <= *month_start || ci >= *month_end {
                continue;
            }
            month_revenue += number_from_value(reservation.get("total_amount"));
        }

        // Revenue from collection records (for LTR)
        for collection in &collections {
            let status = value_str(collection, "status");
            if status != "paid" {
                continue;
            }
            if let Ok(due_date) = parse_date(&value_str(collection, "due_date")) {
                if due_date >= *month_start && due_date < *month_end {
                    month_revenue += number_from_value(collection.get("amount"));
                }
            }
        }

        // Expenses
        let mut month_expenses = 0.0;
        for expense in &expenses {
            if let Ok(expense_date) = parse_date(&value_str(expense, "expense_date")) {
                if expense_date >= *month_start && expense_date < *month_end {
                    let (amount, _) = expense_amount_pyg(expense);
                    month_expenses += amount;
                }
            }
        }

        // Collection rate for the month
        let mut scheduled = 0_i64;
        let mut paid = 0_i64;
        for collection in &collections {
            if let Ok(due_date) = parse_date(&value_str(collection, "due_date")) {
                if due_date >= *month_start && due_date < *month_end {
                    scheduled += 1;
                    if value_str(collection, "status") == "paid" {
                        paid += 1;
                    }
                }
            }
        }
        let collection_rate = if scheduled > 0 {
            round4(paid as f64 / scheduled as f64)
        } else {
            0.0
        };

        monthly_data.push(json!({
            "month": label,
            "revenue": round2(month_revenue),
            "expenses": round2(month_expenses),
            "net": round2(month_revenue - month_expenses),
            "collections_scheduled": scheduled,
            "collections_paid": paid,
            "collection_rate": collection_rate,
        }));
    }

    // Expense breakdown by category (full period)
    let period_start = month_boundaries
        .first()
        .map(|(s, _, _)| *s)
        .unwrap_or(end_date);
    let mut category_totals: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();
    for expense in &expenses {
        if let Ok(expense_date) = parse_date(&value_str(expense, "expense_date")) {
            if expense_date >= period_start && expense_date <= end_date {
                let (amount, _) = expense_amount_pyg(expense);
                let category = value_str(expense, "category");
                let cat = if category.is_empty() {
                    "other".to_string()
                } else {
                    category
                };
                *category_totals.entry(cat).or_insert(0.0) += amount;
            }
        }
    }
    let expense_breakdown: Vec<Value> = category_totals
        .into_iter()
        .map(|(category, total)| json!({ "category": category, "total": round2(total) }))
        .collect();

    // Outstanding collections
    let outstanding: Vec<Value> = collections
        .iter()
        .filter(|c| {
            let status = value_str(c, "status");
            status == "pending" || status == "overdue"
        })
        .take(20)
        .cloned()
        .collect();

    Ok(Json(json!({
        "organization_id": query.org_id,
        "months": monthly_data,
        "expense_breakdown": expense_breakdown,
        "outstanding_collections": outstanding,
    })))
}

/// KPI Dashboard: collection rate, occupancy, avg days late, revenue per unit,
/// maintenance response time. All computed over the given period.
async fn kpi_dashboard(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;

    let org_filter = json_map(&[("organization_id", Value::String(query.org_id.clone()))]);

    // Fetch all needed data in parallel-ish style
    let collections = list_rows(pool, "collection_records", Some(&org_filter), 20000, 0, "created_at", false).await?;
    let units = list_rows(pool, "units", Some(&org_filter), 3000, 0, "created_at", false).await?;
    let leases = list_rows(pool, "leases", Some(&org_filter), 5000, 0, "created_at", false).await?;
    let tasks = list_rows(pool, "tasks", Some(&org_filter), 10000, 0, "created_at", false).await?;

    // ── Collection Rate ──
    let in_period_collections: Vec<&Value> = collections
        .iter()
        .filter(|c| {
            c.get("due_date")
                .and_then(Value::as_str)
                .and_then(|d| parse_date(d).ok())
                .is_some_and(|d| d >= period_start && d <= period_end)
        })
        .collect();
    let total_collections = in_period_collections.len() as i64;
    let paid_collections = in_period_collections
        .iter()
        .filter(|c| value_str(c, "status") == "paid")
        .count() as i64;
    let collection_rate = if total_collections > 0 {
        round4(paid_collections as f64 / total_collections as f64)
    } else {
        0.0
    };

    // ── Average Days Late ──
    let mut days_late_values: Vec<f64> = Vec::new();
    for c in &in_period_collections {
        let status = value_str(c, "status");
        if status != "paid" {
            continue;
        }
        let due_date = match c.get("due_date").and_then(Value::as_str).and_then(|d| parse_date(d).ok()) {
            Some(d) => d,
            None => continue,
        };
        let paid_at = c.get("paid_at").and_then(Value::as_str).and_then(|s| {
            let trimmed = s.trim();
            // Try date-only first, then datetime
            parse_date(trimmed).ok().or_else(|| {
                chrono::DateTime::parse_from_rfc3339(trimmed)
                    .ok()
                    .map(|dt| dt.date_naive())
            })
        });
        if let Some(paid_date) = paid_at {
            let days = (paid_date - due_date).num_days();
            if days > 0 {
                days_late_values.push(days as f64);
            }
        }
    }
    let avg_days_late = if days_late_values.is_empty() {
        0.0
    } else {
        round2(days_late_values.iter().sum::<f64>() / days_late_values.len() as f64)
    };

    // ── Occupancy Rate (unit-months with active leases / total unit-months) ──
    let total_units = units.len() as i64;
    let active_leases = leases
        .iter()
        .filter(|l| {
            let status = value_str(l, "lease_status");
            status == "active" || status == "delinquent"
        })
        .count() as i64;
    let occupancy_rate = if total_units > 0 {
        round4(std::cmp::min(active_leases, total_units) as f64 / total_units as f64)
    } else {
        0.0
    };

    // ── Revenue Per Unit ──
    let total_paid_amount: f64 = in_period_collections
        .iter()
        .filter(|c| value_str(c, "status") == "paid")
        .map(|c| number_from_value(c.get("amount")))
        .sum();
    let revenue_per_unit = if total_units > 0 {
        round2(total_paid_amount / total_units as f64)
    } else {
        0.0
    };

    // ── Maintenance Response Time (avg hours from task creation to completion) ──
    let mut response_hours: Vec<f64> = Vec::new();
    for task in &tasks {
        if value_str(task, "type") != "maintenance" {
            continue;
        }
        if value_str(task, "status") != "done" {
            continue;
        }
        let created = datetime_or_none(task.get("created_at"));
        let completed = datetime_or_none(task.get("completed_at"));
        if let (Some(c), Some(d)) = (created, completed) {
            let hours = (d - c).num_hours() as f64;
            if hours >= 0.0 {
                response_hours.push(hours);
            }
        }
    }
    let avg_maintenance_response_hours = if response_hours.is_empty() {
        None
    } else {
        Some(round2(
            response_hours.iter().sum::<f64>() / response_hours.len() as f64,
        ))
    };
    let median_maintenance_response_hours = median(&response_hours).map(round2);

    // ── Expiring Leases (next 60 days) ──
    let today = Utc::now().date_naive();
    let day_60 = today + chrono::Duration::days(60);
    let expiring_leases = leases
        .iter()
        .filter(|l| {
            let status = value_str(l, "lease_status");
            if status != "active" {
                return false;
            }
            l.get("ends_on")
                .and_then(Value::as_str)
                .and_then(|d| parse_date(d).ok())
                .is_some_and(|d| d >= today && d <= day_60)
        })
        .count() as i64;

    // ── Open Maintenance Requests ──
    let open_maintenance = tasks
        .iter()
        .filter(|t| {
            value_str(t, "type") == "maintenance"
                && ACTIVE_TASK_STATUSES.contains(&value_str(t, "status").as_str())
        })
        .count() as i64;

    Ok(Json(json!({
        "organization_id": query.org_id,
        "from": query.from_date,
        "to": query.to_date,
        "collection_rate": collection_rate,
        "total_collections": total_collections,
        "paid_collections": paid_collections,
        "avg_days_late": avg_days_late,
        "occupancy_rate": occupancy_rate,
        "total_units": total_units,
        "active_leases": active_leases,
        "revenue_per_unit": revenue_per_unit,
        "total_paid_amount": round2(total_paid_amount),
        "avg_maintenance_response_hours": avg_maintenance_response_hours,
        "median_maintenance_response_hours": median_maintenance_response_hours,
        "open_maintenance_tasks": open_maintenance,
        "expiring_leases_60d": expiring_leases,
    })))
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid ISO date.".to_string()))
}

fn nights(start: NaiveDate, end: NaiveDate) -> i64 {
    (end - start).num_days().max(0)
}

fn datetime_or_none(value: Option<&Value>) -> Option<DateTime<chrono::FixedOffset>> {
    let text = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())?;
    let mut normalized = text.to_string();
    if normalized.ends_with('Z') {
        normalized.truncate(normalized.len().saturating_sub(1));
        normalized.push_str("+00:00");
    }
    DateTime::parse_from_rfc3339(&normalized).ok()
}

fn expense_amount_pyg(expense: &Value) -> (f64, Option<String>) {
    let currency = value_str(expense, "currency").to_ascii_uppercase();
    let amount = number_from_value(expense.get("amount"));
    if currency == "PYG" {
        return (amount, None);
    }
    if currency == "USD" {
        let fx_rate = number_from_value(expense.get("fx_rate_to_pyg"));
        if fx_rate <= 0.0 {
            return (0.0, Some("missing_fx_rate_to_pyg".to_string()));
        }
        return (amount * fx_rate, None);
    }
    (0.0, Some(format!("unsupported_currency:{currency}")))
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

fn number_from_value(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn bool_value(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => {
            let lower = text.trim().to_ascii_lowercase();
            lower == "true" || lower == "1"
        }
        Some(Value::Number(number)) => number.as_i64().is_some_and(|value| value != 0),
        _ => false,
    }
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.total_cmp(right));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        return sorted.get(mid).copied();
    }
    sorted
        .get(mid.saturating_sub(1))
        .zip(sorted.get(mid))
        .map(|(left, right)| (left + right) / 2.0)
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

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}
