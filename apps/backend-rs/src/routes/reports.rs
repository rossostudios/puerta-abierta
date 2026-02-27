use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::list_rows,
    schemas::{OwnerSummaryQuery, ReportsPeriodQuery},
    services::{agent_chats, anomaly_detection},
    state::AppState,
    tenancy::assert_org_member,
};

const REPORTABLE_STATUSES: &[&str] = &["confirmed", "checked_in", "checked_out"];

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
        .route("/reports/kpi-dashboard", axum::routing::get(kpi_dashboard))
        .route(
            "/reports/occupancy-forecast",
            axum::routing::get(occupancy_forecast),
        )
        .route("/reports/anomalies", axum::routing::get(list_anomalies))
        .route(
            "/reports/anomalies/{id}/dismiss",
            axum::routing::post(dismiss_anomaly),
        )
        .route(
            "/reports/anomalies/scan",
            axum::routing::post(run_anomaly_scan),
        )
        .route(
            "/reports/agent-performance",
            axum::routing::get(agent_performance),
        )
        .route("/reports/revenue-trend", axum::routing::get(revenue_trend))
        .route(
            "/reports/predictive-outlook",
            axum::routing::get(predictive_outlook),
        )
}

async fn owner_summary_report(
    State(state): State<AppState>,
    Query(query): Query<OwnerSummaryQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;
    let total_days = nights(period_start, period_end);
    let property_id = parse_optional_uuid(query.property_id.as_deref(), "property_id")?;
    let unit_id = parse_optional_uuid(query.unit_id.as_deref(), "unit_id")?;

    let cache_key = report_cache_key("owner_summary", &query);
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }
    let key_lock = state.report_response_cache.key_lock(&cache_key).await;
    let _guard = key_lock.lock().await;
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let pool = db_pool(&state)?;

    let owner_metrics_query = sqlx::query(
        "WITH filtered_units AS (
           SELECT u.id
             FROM units u
            WHERE u.organization_id = $1::uuid
              AND ($2::uuid IS NULL OR u.property_id = $2::uuid)
              AND ($3::uuid IS NULL OR u.id = $3::uuid)
         ),
         reservation_scope AS (
           SELECT
             r.check_in_date,
             r.check_out_date,
             r.total_amount
           FROM reservations r
           JOIN filtered_units u ON u.id = r.unit_id
           WHERE r.organization_id = $1::uuid
             AND r.status IN ('confirmed', 'checked_in', 'checked_out')
             AND r.check_out_date > $4::date
             AND r.check_in_date < $5::date
         )
         SELECT
           (SELECT COUNT(*)::bigint FROM filtered_units) AS unit_count,
           COALESCE(
             SUM(
               GREATEST(
                 LEAST(rs.check_out_date, $5::date) - GREATEST(rs.check_in_date, $4::date),
                 0
               )
             ),
             0
           )::bigint AS booked_nights,
           COALESCE(SUM(rs.total_amount), 0)::double precision AS gross_revenue
         FROM reservation_scope rs",
    )
    .bind(&query.org_id)
    .bind(property_id)
    .bind(unit_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool);

    let expense_metrics_query = sqlx::query(
        "SELECT
           COALESCE(
             SUM(
               CASE
                 WHEN e.currency = 'PYG' THEN e.amount
                 WHEN e.currency = 'USD' AND COALESCE(e.fx_rate_to_pyg, 0) > 0
                   THEN e.amount * e.fx_rate_to_pyg
                 ELSE 0
               END
             ),
             0
           )::double precision AS total_expenses,
           COUNT(*) FILTER (
             WHERE e.currency = 'USD'
               AND (e.fx_rate_to_pyg IS NULL OR e.fx_rate_to_pyg <= 0)
           )::bigint AS missing_fx_rate_to_pyg,
           COUNT(*) FILTER (
             WHERE e.currency NOT IN ('PYG', 'USD')
           )::bigint AS unsupported_currency
         FROM expenses e
         WHERE e.organization_id = $1::uuid
           AND e.expense_date >= $2::date
           AND e.expense_date <= $3::date
           AND (
             ($5::uuid IS NOT NULL AND e.unit_id = $5::uuid)
             OR ($5::uuid IS NULL AND $4::uuid IS NOT NULL AND e.property_id = $4::uuid)
             OR ($5::uuid IS NULL AND $4::uuid IS NULL)
           )",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .bind(property_id)
    .bind(unit_id)
    .fetch_one(pool);

    let (owner_metrics, expense_metrics) =
        tokio::try_join!(owner_metrics_query, expense_metrics_query).map_err(|error| {
            tracing::error!(error = %error, "Failed to compute owner summary report");
            AppError::Dependency("Failed to compute owner summary report.".to_string())
        })?;

    let raw_unit_count = owner_metrics.try_get::<i64, _>("unit_count").unwrap_or(0);
    let booked_nights = owner_metrics
        .try_get::<i64, _>("booked_nights")
        .unwrap_or(0);
    let gross_revenue = owner_metrics
        .try_get::<f64, _>("gross_revenue")
        .unwrap_or(0.0);
    let total_expenses = expense_metrics
        .try_get::<f64, _>("total_expenses")
        .unwrap_or(0.0);

    let mut warnings: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let missing_fx_count = expense_metrics
        .try_get::<i64, _>("missing_fx_rate_to_pyg")
        .unwrap_or(0);
    if missing_fx_count > 0 {
        warnings.insert("missing_fx_rate_to_pyg".to_string(), missing_fx_count);
    }
    let unsupported_currency_count = expense_metrics
        .try_get::<i64, _>("unsupported_currency")
        .unwrap_or(0);
    if unsupported_currency_count > 0 {
        warnings.insert(
            "unsupported_currency".to_string(),
            unsupported_currency_count,
        );
    }

    let unit_count = std::cmp::max(raw_unit_count, 1);
    let available_nights = std::cmp::max(total_days * unit_count, 1) as f64;

    let occupancy_rate = round4((booked_nights as f64) / available_nights);
    let net_payout = round2(gross_revenue - total_expenses);

    let response = json!({
        "organization_id": query.org_id,
        "from": query.from_date,
        "to": query.to_date,
        "occupancy_rate": occupancy_rate,
        "gross_revenue": round2(gross_revenue),
        "expenses": round2(total_expenses),
        "net_payout": net_payout,
        "expense_warnings": warnings,
    });

    state
        .report_response_cache
        .put(cache_key, response.clone())
        .await;
    Ok(Json(response))
}

async fn operations_summary_report(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;
    let period_start_ts = start_of_day_utc(period_start);
    let period_end_exclusive_ts = start_of_day_utc(period_end + chrono::Duration::days(1));
    let now_utc = Utc::now();

    let cache_key = report_cache_key("operations_summary", &query);
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }
    let key_lock = state.report_response_cache.key_lock(&cache_key).await;
    let _guard = key_lock.lock().await;
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let pool = db_pool(&state)?;

    let task_metrics = sqlx::query(
        "SELECT
           COUNT(*) FILTER (
             WHERE type IN ('check_in', 'check_out', 'cleaning', 'inspection')
               AND due_at IS NOT NULL
               AND due_at >= $2::timestamptz
               AND due_at < $3::timestamptz
           )::bigint AS turnovers_due,
           COUNT(*) FILTER (
             WHERE type IN ('check_in', 'check_out', 'cleaning', 'inspection')
               AND due_at IS NOT NULL
               AND due_at >= $2::timestamptz
               AND due_at < $3::timestamptz
               AND status = 'done'
               AND completed_at IS NOT NULL
               AND (
                 COALESCE(sla_due_at, due_at) IS NULL
                 OR completed_at <= COALESCE(sla_due_at, due_at)
               )
           )::bigint AS turnovers_completed_on_time,
           COUNT(*) FILTER (
             WHERE status IN ('todo', 'in_progress')
           )::bigint AS open_tasks,
           COUNT(*) FILTER (
             WHERE status IN ('todo', 'in_progress')
               AND due_at IS NOT NULL
               AND due_at < $4::timestamptz
           )::bigint AS overdue_tasks,
           COUNT(*) FILTER (
             WHERE sla_breached_at IS NOT NULL
                OR (
                  status IN ('todo', 'in_progress')
                  AND sla_due_at IS NOT NULL
                  AND sla_due_at < $4::timestamptz
                )
           )::bigint AS sla_breached_tasks
         FROM tasks
         WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .bind(period_start_ts)
    .bind(period_end_exclusive_ts)
    .bind(now_utc)
    .fetch_one(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to compute task operations summary");
        AppError::Dependency("Failed to compute operations summary.".to_string())
    })?;

    let turnovers_due = task_metrics.try_get::<i64, _>("turnovers_due").unwrap_or(0);
    let turnovers_completed_on_time = task_metrics
        .try_get::<i64, _>("turnovers_completed_on_time")
        .unwrap_or(0);
    let open_tasks = task_metrics.try_get::<i64, _>("open_tasks").unwrap_or(0);
    let overdue_tasks = task_metrics.try_get::<i64, _>("overdue_tasks").unwrap_or(0);
    let sla_breached_tasks = task_metrics
        .try_get::<i64, _>("sla_breached_tasks")
        .unwrap_or(0);

    let turnover_on_time_rate = if turnovers_due > 0 {
        round4((turnovers_completed_on_time as f64) / (turnovers_due as f64))
    } else {
        0.0
    };

    let reservation_metrics = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE status IN ('pending', 'confirmed')
                AND check_in_date BETWEEN $2::date AND $3::date
            )::bigint AS reservations_upcoming_check_in,
            COUNT(*) FILTER (
              WHERE status IN ('confirmed', 'checked_in')
                AND check_out_date BETWEEN $2::date AND $3::date
            )::bigint AS reservations_upcoming_check_out
          FROM reservations
          WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to compute reservation operations summary");
        AppError::Dependency("Failed to compute operations summary.".to_string())
    })?;

    let reservations_upcoming_check_in = reservation_metrics
        .try_get::<i64, _>("reservations_upcoming_check_in")
        .unwrap_or(0);
    let reservations_upcoming_check_out = reservation_metrics
        .try_get::<i64, _>("reservations_upcoming_check_out")
        .unwrap_or(0);

    let response = json!({
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
    });

    state
        .report_response_cache
        .put(cache_key, response.clone())
        .await;
    Ok(Json(response))
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

    let listing_metrics_query = sqlx::query(
        "WITH published AS (
           SELECT id
             FROM listings
            WHERE organization_id = $1::uuid
              AND is_published = true
         ),
         line_presence AS (
           SELECT
             lf.listing_id,
             BOOL_OR(lf.fee_type = 'monthly_rent') AS has_monthly_rent,
             BOOL_OR(lf.fee_type = 'advance_rent') AS has_advance_rent,
             BOOL_OR(lf.fee_type = 'service_fee_flat') AS has_service_fee_flat,
             BOOL_OR(lf.fee_type = 'security_deposit') AS has_security_deposit,
             BOOL_OR(lf.fee_type = 'guarantee_option_fee') AS has_guarantee_option_fee
           FROM listing_fee_lines lf
           JOIN published p ON p.id = lf.listing_id
           GROUP BY lf.listing_id
         )
         SELECT
           (SELECT COUNT(*)::bigint FROM published) AS published_count,
           COUNT(*) FILTER (
             WHERE COALESCE(lp.has_monthly_rent, false)
               AND COALESCE(lp.has_advance_rent, false)
               AND COALESCE(lp.has_service_fee_flat, false)
               AND (
                 COALESCE(lp.has_security_deposit, false)
                 OR COALESCE(lp.has_guarantee_option_fee, false)
               )
           )::bigint AS transparent_count
         FROM published p
         LEFT JOIN line_presence lp ON lp.listing_id = p.id",
    )
    .bind(&query.org_id)
    .fetch_one(pool);

    let application_metrics_query = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE created_at::date BETWEEN $2::date AND $3::date
            )::bigint AS applications_count,
            COUNT(*) FILTER (
              WHERE created_at::date BETWEEN $2::date AND $3::date
                AND status IN ('qualified', 'visit_scheduled', 'offer_sent', 'contract_signed')
            )::bigint AS qualified_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600.0
            ) FILTER (
              WHERE created_at::date BETWEEN $2::date AND $3::date
                AND first_response_at IS NOT NULL
                AND first_response_at >= created_at
            ) AS median_first_response_hours
          FROM application_submissions
          WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool);

    let collection_metrics_query = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE due_date BETWEEN $2::date AND $3::date
            )::bigint AS total_collections,
            COUNT(*) FILTER (
              WHERE due_date BETWEEN $2::date AND $3::date
                AND status = 'paid'
            )::bigint AS paid_collections,
            COALESCE(
              SUM(amount) FILTER (
                WHERE due_date BETWEEN $2::date AND $3::date
                  AND status = 'paid'
              ),
              0
            )::double precision AS paid_amount
          FROM collection_records
          WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool);

    let alert_metrics_query = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE provider = 'alerting'
                AND event_type = 'application_submit_failed'
                AND received_at::date BETWEEN $2::date AND $3::date
            )::bigint AS application_submit_failures,
            COUNT(*) FILTER (
              WHERE provider = 'alerting'
                AND event_type = 'application_event_write_failed'
                AND received_at::date BETWEEN $2::date AND $3::date
            )::bigint AS application_event_write_failures
          FROM integration_events
          WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool);

    let (listing_metrics, application_metrics, collection_metrics, alert_metrics) =
        tokio::try_join!(
            listing_metrics_query,
            application_metrics_query,
            collection_metrics_query,
            alert_metrics_query,
        )
        .map_err(|error| {
            tracing::error!(error = %error, "Failed to compute transparency summary");
            AppError::Dependency("Failed to compute transparency summary.".to_string())
        })?;

    let published_count = listing_metrics
        .try_get::<i64, _>("published_count")
        .unwrap_or(0);
    let transparent_count = listing_metrics
        .try_get::<i64, _>("transparent_count")
        .unwrap_or(0);
    let transparent_listings_pct = if published_count > 0 {
        round4((transparent_count as f64) / (published_count as f64))
    } else {
        0.0
    };

    let applications_count = application_metrics
        .try_get::<i64, _>("applications_count")
        .unwrap_or(0);
    let qualified_count = application_metrics
        .try_get::<i64, _>("qualified_count")
        .unwrap_or(0);
    let inquiry_to_qualified_rate = if applications_count > 0 {
        round4((qualified_count as f64) / (applications_count as f64))
    } else {
        0.0
    };
    let median_first_response_hours = application_metrics
        .try_get::<Option<f64>, _>("median_first_response_hours")
        .ok()
        .flatten()
        .map(round2);

    let total_collections = collection_metrics
        .try_get::<i64, _>("total_collections")
        .unwrap_or(0);
    let paid_collections = collection_metrics
        .try_get::<i64, _>("paid_collections")
        .unwrap_or(0);
    let paid_amount = round2(
        collection_metrics
            .try_get::<f64, _>("paid_amount")
            .unwrap_or(0.0),
    );
    let collection_success_rate = if total_collections > 0 {
        round4((paid_collections as f64) / (total_collections as f64))
    } else {
        0.0
    };

    let application_submit_failures = alert_metrics
        .try_get::<i64, _>("application_submit_failures")
        .unwrap_or(0);
    let application_event_write_failures = alert_metrics
        .try_get::<i64, _>("application_event_write_failures")
        .unwrap_or(0);

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

    let monthly_rows = sqlx::query(
        "WITH months AS (
           SELECT
             gs::date AS month_start,
             (gs + interval '1 month')::date AS month_end
           FROM generate_series(
             date_trunc('month', $2::date) - interval '5 months',
             date_trunc('month', $2::date),
             interval '1 month'
           ) gs
         ),
         reservation_monthly AS (
           SELECT
             m.month_start,
             COALESCE(SUM(r.total_amount), 0)::double precision AS reservation_revenue
           FROM months m
           LEFT JOIN reservations r
             ON r.organization_id = $1::uuid
            AND r.status IN ('confirmed', 'checked_in', 'checked_out')
            AND r.check_out_date > m.month_start
            AND r.check_in_date < m.month_end
           GROUP BY m.month_start
         ),
         collection_monthly AS (
           SELECT
             m.month_start,
             COALESCE(
               SUM(c.amount) FILTER (WHERE c.status = 'paid'),
               0
             )::double precision AS paid_collection_revenue,
             COUNT(c.id)::bigint AS collections_scheduled,
             COUNT(c.id) FILTER (WHERE c.status = 'paid')::bigint AS collections_paid
           FROM months m
           LEFT JOIN collection_records c
             ON c.organization_id = $1::uuid
            AND c.due_date >= m.month_start
            AND c.due_date < m.month_end
           GROUP BY m.month_start
         ),
         expense_monthly AS (
           SELECT
             m.month_start,
             COALESCE(
               SUM(
                 CASE
                   WHEN e.currency = 'PYG' THEN e.amount
                   WHEN e.currency = 'USD' AND COALESCE(e.fx_rate_to_pyg, 0) > 0
                     THEN e.amount * e.fx_rate_to_pyg
                   ELSE 0
                 END
               ),
               0
             )::double precision AS expense_total
           FROM months m
           LEFT JOIN expenses e
             ON e.organization_id = $1::uuid
            AND e.expense_date >= m.month_start
            AND e.expense_date < m.month_end
           GROUP BY m.month_start
         )
         SELECT
           to_char(m.month_start, 'YYYY-MM') AS month,
           (
             COALESCE(r.reservation_revenue, 0)
             + COALESCE(c.paid_collection_revenue, 0)
           )::double precision AS revenue,
           COALESCE(e.expense_total, 0)::double precision AS expenses,
           COALESCE(c.collections_scheduled, 0)::bigint AS collections_scheduled,
           COALESCE(c.collections_paid, 0)::bigint AS collections_paid
         FROM months m
         LEFT JOIN reservation_monthly r ON r.month_start = m.month_start
         LEFT JOIN collection_monthly c ON c.month_start = m.month_start
         LEFT JOIN expense_monthly e ON e.month_start = m.month_start
         ORDER BY m.month_start",
    )
    .bind(&query.org_id)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to compute finance monthly dashboard");
        AppError::Dependency("Failed to compute finance dashboard.".to_string())
    })?;

    let monthly_data: Vec<Value> = monthly_rows
        .into_iter()
        .map(|row| {
            let revenue = row.try_get::<f64, _>("revenue").unwrap_or(0.0);
            let expenses = row.try_get::<f64, _>("expenses").unwrap_or(0.0);
            let scheduled = row.try_get::<i64, _>("collections_scheduled").unwrap_or(0);
            let paid = row.try_get::<i64, _>("collections_paid").unwrap_or(0);
            let collection_rate = if scheduled > 0 {
                round4(paid as f64 / scheduled as f64)
            } else {
                0.0
            };

            json!({
                "month": row.try_get::<String, _>("month").unwrap_or_default(),
                "revenue": round2(revenue),
                "expenses": round2(expenses),
                "net": round2(revenue - expenses),
                "collections_scheduled": scheduled,
                "collections_paid": paid,
                "collection_rate": collection_rate,
            })
        })
        .collect();

    let expense_breakdown_rows = sqlx::query(
        "WITH period AS (
           SELECT
             (date_trunc('month', $2::date) - interval '5 months')::date AS period_start,
             $2::date AS period_end
         )
         SELECT
           COALESCE(NULLIF(e.category::text, ''), 'other') AS category,
           COALESCE(
             SUM(
               CASE
                 WHEN e.currency = 'PYG' THEN e.amount
                 WHEN e.currency = 'USD' AND COALESCE(e.fx_rate_to_pyg, 0) > 0
                   THEN e.amount * e.fx_rate_to_pyg
                 ELSE 0
               END
             ),
             0
           )::double precision AS total
         FROM expenses e
         CROSS JOIN period p
         WHERE e.organization_id = $1::uuid
           AND e.expense_date >= p.period_start
           AND e.expense_date <= p.period_end
         GROUP BY COALESCE(NULLIF(e.category::text, ''), 'other')
         ORDER BY total DESC",
    )
    .bind(&query.org_id)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to compute finance expense breakdown");
        AppError::Dependency("Failed to compute finance dashboard.".to_string())
    })?;

    let expense_breakdown: Vec<Value> = expense_breakdown_rows
        .into_iter()
        .map(|row| {
            json!({
                "category": row.try_get::<String, _>("category").unwrap_or_else(|_| "other".to_string()),
                "total": round2(row.try_get::<f64, _>("total").unwrap_or(0.0)),
            })
        })
        .collect();

    let outstanding_rows = sqlx::query(
        "SELECT row_to_json(c) AS row
           FROM collection_records c
          WHERE c.organization_id = $1::uuid
            AND c.status IN ('pending', 'late')
          ORDER BY c.created_at DESC
          LIMIT 20",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to list outstanding collections");
        AppError::Dependency("Failed to compute finance dashboard.".to_string())
    })?;

    let outstanding: Vec<Value> = outstanding_rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
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

    let period_start = parse_date(&query.from_date)?;
    let period_end = parse_date(&query.to_date)?;
    let period_start_ts = start_of_day_utc(period_start);
    let period_end_exclusive_ts = start_of_day_utc(period_end + chrono::Duration::days(1));
    let today = Utc::now().date_naive();
    let day_60 = today + chrono::Duration::days(60);

    let cache_key = report_cache_key("kpi_dashboard", &query);
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }
    let key_lock = state.report_response_cache.key_lock(&cache_key).await;
    let _guard = key_lock.lock().await;
    if let Some(cached) = state.report_response_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let pool = db_pool(&state)?;

    let collections_query = sqlx::query(
        "SELECT
            COUNT(*)::bigint AS total_collections,
            COUNT(*) FILTER (WHERE status = 'paid')::bigint AS paid_collections,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::double precision AS total_paid_amount,
            AVG(
              CASE
                WHEN status = 'paid'
                 AND paid_at IS NOT NULL
                 AND paid_at::date > due_date
                THEN (paid_at::date - due_date)::double precision
                ELSE NULL
              END
            ) AS avg_days_late
          FROM collection_records
          WHERE organization_id = $1::uuid
            AND due_date BETWEEN $2::date AND $3::date",
    )
    .bind(&query.org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool);

    let occupancy_query = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::bigint
               FROM units u
              WHERE u.organization_id = $1::uuid) AS total_units,
            (SELECT COUNT(*)::bigint
               FROM leases l
              WHERE l.organization_id = $1::uuid
                AND l.lease_status IN ('active', 'delinquent')) AS active_leases,
            (SELECT COUNT(*)::bigint
               FROM leases l
              WHERE l.organization_id = $1::uuid
                AND l.lease_status = 'active'
                AND l.ends_on BETWEEN $2::date AND $3::date) AS expiring_leases_60d",
    )
    .bind(&query.org_id)
    .bind(today)
    .bind(day_60)
    .fetch_one(pool);

    let maintenance_query = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE type = 'maintenance'
                AND status IN ('todo', 'in_progress')
                AND (
                  due_at IS NULL
                  OR (due_at >= $2::timestamptz AND due_at < $3::timestamptz)
                )
            )::bigint AS open_maintenance_tasks,
            AVG(
              CASE
                WHEN type = 'maintenance'
                 AND status = 'done'
                 AND completed_at IS NOT NULL
                 AND completed_at >= created_at
                 AND completed_at >= $2::timestamptz
                 AND completed_at < $3::timestamptz
                THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0
                ELSE NULL
              END
            ) AS avg_maintenance_response_hours,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0
            ) FILTER (
              WHERE type = 'maintenance'
                AND status = 'done'
                AND completed_at IS NOT NULL
                AND completed_at >= created_at
                AND completed_at >= $2::timestamptz
                AND completed_at < $3::timestamptz
            ) AS median_maintenance_response_hours
          FROM tasks
          WHERE organization_id = $1::uuid
            AND (
              (
                type = 'maintenance'
                AND status IN ('todo', 'in_progress')
                AND (
                  due_at IS NULL
                  OR (due_at >= $2::timestamptz AND due_at < $3::timestamptz)
                )
              )
              OR (
                type = 'maintenance'
                AND status = 'done'
                AND completed_at IS NOT NULL
                AND completed_at >= created_at
                AND completed_at >= $2::timestamptz
                AND completed_at < $3::timestamptz
              )
            )",
    )
    .bind(&query.org_id)
    .bind(period_start_ts)
    .bind(period_end_exclusive_ts)
    .fetch_one(pool);

    let (collection_metrics, occupancy_metrics, maintenance_metrics) =
        tokio::try_join!(collections_query, occupancy_query, maintenance_query).map_err(
            |error| {
                tracing::error!(error = %error, "Failed to compute KPI dashboard");
                AppError::Dependency("Failed to compute KPI dashboard.".to_string())
            },
        )?;

    let total_collections = collection_metrics
        .try_get::<i64, _>("total_collections")
        .unwrap_or(0);
    let paid_collections = collection_metrics
        .try_get::<i64, _>("paid_collections")
        .unwrap_or(0);
    let total_paid_amount = collection_metrics
        .try_get::<f64, _>("total_paid_amount")
        .unwrap_or(0.0);
    let avg_days_late = round2(
        collection_metrics
            .try_get::<Option<f64>, _>("avg_days_late")
            .ok()
            .flatten()
            .unwrap_or(0.0),
    );

    let collection_rate = if total_collections > 0 {
        round4(paid_collections as f64 / total_collections as f64)
    } else {
        0.0
    };

    let total_units = occupancy_metrics
        .try_get::<i64, _>("total_units")
        .unwrap_or(0);
    let active_leases = occupancy_metrics
        .try_get::<i64, _>("active_leases")
        .unwrap_or(0);
    let expiring_leases = occupancy_metrics
        .try_get::<i64, _>("expiring_leases_60d")
        .unwrap_or(0);
    let occupancy_rate = if total_units > 0 {
        round4(std::cmp::min(active_leases, total_units) as f64 / total_units as f64)
    } else {
        0.0
    };
    let revenue_per_unit = if total_units > 0 {
        round2(total_paid_amount / total_units as f64)
    } else {
        0.0
    };

    let open_maintenance = maintenance_metrics
        .try_get::<i64, _>("open_maintenance_tasks")
        .unwrap_or(0);
    let avg_maintenance_response_hours = maintenance_metrics
        .try_get::<Option<f64>, _>("avg_maintenance_response_hours")
        .ok()
        .flatten()
        .map(round2);
    let median_maintenance_response_hours = maintenance_metrics
        .try_get::<Option<f64>, _>("median_maintenance_response_hours")
        .ok()
        .flatten()
        .map(round2);

    let response = json!({
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
    });

    state
        .report_response_cache
        .put(cache_key, response.clone())
        .await;
    Ok(Json(response))
}

#[derive(Debug, Clone, Deserialize)]
struct ForecastQuery {
    org_id: String,
    #[serde(default = "default_months_ahead")]
    months_ahead: i64,
}

fn default_months_ahead() -> i64 {
    3
}

#[derive(Debug, Clone, Deserialize)]
struct AnomalyIdPath {
    id: String,
}

/// GET /reports/occupancy-forecast — predict occupancy for upcoming months
async fn occupancy_forecast(
    State(state): State<AppState>,
    Query(query): Query<ForecastQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let months_ahead = query.months_ahead.clamp(1, 6);
    let today = Utc::now().date_naive();

    // Total units
    let unit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid")
            .bind(&query.org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    if unit_count == 0 {
        return Ok(Json(json!({
            "organization_id": query.org_id,
            "months": [],
            "message": "No units found.",
        })));
    }

    // Historical monthly occupancy (past 12 months)
    let reservations = list_rows(
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

    let mut monthly_nights: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

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
        let twelve_months_ago = today - chrono::Duration::days(365);
        if co <= twelve_months_ago {
            continue;
        }
        let n = nights(ci, co);
        let month_key = format!("{:04}-{:02}", ci.year(), ci.month());
        *monthly_nights.entry(month_key).or_insert(0) += n;
    }

    // Compute moving average
    let mut occ_rates: Vec<f64> = Vec::new();
    for i in 1..=12 {
        let past = today - chrono::Duration::days(i * 30);
        let key = format!("{:04}-{:02}", past.year(), past.month());
        let n = monthly_nights.get(&key).copied().unwrap_or(0);
        let occ = (n as f64) / (unit_count as f64 * 30.0);
        occ_rates.push(occ.clamp(0.0, 1.0));
    }

    let avg_occ = if occ_rates.is_empty() {
        0.0
    } else {
        occ_rates.iter().sum::<f64>() / occ_rates.len() as f64
    };

    // Build historical series
    let mut historical: Vec<Value> = Vec::new();
    for i in (1..=6).rev() {
        let past = today - chrono::Duration::days(i * 30);
        let key = format!("{:04}-{:02}", past.year(), past.month());
        let n = monthly_nights.get(&key).copied().unwrap_or(0);
        let occ = ((n as f64) / (unit_count as f64 * 30.0)).clamp(0.0, 1.0);
        historical.push(json!({
            "month": key,
            "occupancy_pct": round2(occ * 100.0),
            "is_forecast": false,
        }));
    }

    // Build forecast
    let mut forecast: Vec<Value> = Vec::new();
    for i in 0..months_ahead {
        let future = today + chrono::Duration::days((i + 1) * 30);
        let month_label = format!("{:04}-{:02}", future.year(), future.month());
        let predicted_units = (avg_occ * unit_count as f64).round() as i64;
        forecast.push(json!({
            "month": month_label,
            "occupancy_pct": round2(avg_occ * 100.0),
            "units_occupied": predicted_units,
            "total_units": unit_count,
            "is_forecast": true,
        }));
    }

    let mut all_months = historical;
    all_months.extend(forecast);

    Ok(Json(json!({
        "organization_id": query.org_id,
        "historical_avg_occupancy_pct": round2(avg_occ * 100.0),
        "total_units": unit_count,
        "months": all_months,
    })))
}

/// GET /reports/anomalies — list active (non-dismissed) anomaly alerts
async fn list_anomalies(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM anomaly_alerts t
         WHERE organization_id = $1::uuid
           AND is_dismissed = false
         ORDER BY detected_at DESC
         LIMIT 100",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to list anomalies");
        AppError::Dependency("Failed to list anomalies.".to_string())
    })?;

    let data: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect();

    Ok(Json(json!({
        "organization_id": query.org_id,
        "data": data,
        "count": data.len(),
    })))
}

/// POST /reports/anomalies/{id}/dismiss — dismiss an anomaly alert
async fn dismiss_anomaly(
    State(state): State<AppState>,
    Path(path): Path<AnomalyIdPath>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    sqlx::query(
        "UPDATE anomaly_alerts
         SET is_dismissed = true, dismissed_at = now(), dismissed_by = $1::uuid
         WHERE id = $2::uuid AND organization_id = $3::uuid",
    )
    .bind(&user_id)
    .bind(&path.id)
    .bind(&query.org_id)
    .execute(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to dismiss anomaly");
        AppError::Dependency("Failed to dismiss anomaly.".to_string())
    })?;

    Ok(Json(json!({ "ok": true, "id": path.id })))
}

/// POST /reports/anomalies/scan — trigger anomaly detection scan
async fn run_anomaly_scan(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let alerts = anomaly_detection::run_anomaly_scan(&state, &query.org_id).await?;

    Ok(Json(json!({
        "ok": true,
        "new_alerts": alerts.len(),
        "alerts": alerts,
    })))
}

/// GET /reports/agent-performance — agent usage stats for last 30 days
async fn agent_performance(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let stats = agent_chats::get_agent_performance_stats(&state, &query.org_id).await?;
    Ok(Json(stats))
}

/// GET /reports/revenue-trend — monthly revenue for past 6 months
async fn revenue_trend(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let end_date = parse_date(&query.to_date)?;

    let monthly_rows = sqlx::query(
        "WITH months AS (
           SELECT
             gs::date AS month_start,
             (gs + interval '1 month')::date AS month_end
           FROM generate_series(
             date_trunc('month', $2::date) - interval '5 months',
             date_trunc('month', $2::date),
             interval '1 month'
           ) gs
         ),
         reservation_monthly AS (
           SELECT
             m.month_start,
             COALESCE(SUM(r.total_amount), 0)::double precision AS reservation_revenue
           FROM months m
           LEFT JOIN reservations r
             ON r.organization_id = $1::uuid
            AND r.status IN ('confirmed', 'checked_in', 'checked_out')
            AND r.check_out_date > m.month_start
            AND r.check_in_date < m.month_end
           GROUP BY m.month_start
         ),
         collection_monthly AS (
           SELECT
             m.month_start,
             COALESCE(
               SUM(c.amount) FILTER (WHERE c.status = 'paid'),
               0
             )::double precision AS paid_collection_revenue
           FROM months m
           LEFT JOIN collection_records c
             ON c.organization_id = $1::uuid
            AND c.due_date >= m.month_start
            AND c.due_date < m.month_end
           GROUP BY m.month_start
         )
         SELECT
           to_char(m.month_start, 'YYYY-MM') AS month,
           (
             COALESCE(r.reservation_revenue, 0)
             + COALESCE(c.paid_collection_revenue, 0)
           )::double precision AS revenue
         FROM months m
         LEFT JOIN reservation_monthly r ON r.month_start = m.month_start
         LEFT JOIN collection_monthly c ON c.month_start = m.month_start
         ORDER BY m.month_start",
    )
    .bind(&query.org_id)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to compute revenue trend");
        AppError::Dependency("Failed to compute revenue trend.".to_string())
    })?;

    let monthly_data: Vec<Value> = monthly_rows
        .into_iter()
        .map(|row| {
            json!({
                "month": row.try_get::<String, _>("month").unwrap_or_default(),
                "revenue": round2(row.try_get::<f64, _>("revenue").unwrap_or(0.0)),
            })
        })
        .collect();

    Ok(Json(json!({
        "organization_id": query.org_id,
        "months": monthly_data,
    })))
}

fn report_cache_key<T: Serialize>(report_name: &str, query: &T) -> String {
    let suffix = serde_json::to_string(query).unwrap_or_else(|_| "invalid_query".to_string());
    format!("{report_name}:{suffix}")
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid ISO date.".to_string()))
}

fn start_of_day_utc(date: NaiveDate) -> chrono::DateTime<Utc> {
    date.and_time(chrono::NaiveTime::MIN).and_utc()
}

fn parse_optional_uuid(value: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    let Some(raw) = non_empty_opt(value) else {
        return Ok(None);
    };
    Uuid::parse_str(&raw)
        .map(Some)
        .map_err(|_| AppError::BadRequest(format!("Invalid {field}.")))
}

fn nights(start: NaiveDate, end: NaiveDate) -> i64 {
    (end - start).num_days().max(0)
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

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

// ---------------------------------------------------------------------------
// Predictive Outlook (S15.3)
// ---------------------------------------------------------------------------

async fn predictive_outlook(
    State(state): State<AppState>,
    Query(query): Query<ReportsPeriodQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = db_pool(&state)?;
    let mut items: Vec<Value> = Vec::new();

    // Upcoming check-ins in 48h
    let checkins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reservations
         WHERE organization_id = $1::uuid
           AND check_in_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
           AND status IN ('confirmed', 'pending')",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if checkins > 0 {
        items.push(json!({
            "id": "checkins-48h",
            "category": "operations",
            "title": format!("{} check-in{} expected in the next 48 hours", checkins, if checkins > 1 { "s" } else { "" }),
            "confidence_pct": 95,
            "cta_label": "View",
            "cta_href": "/module/reservations"
        }));
    }

    // Upcoming check-outs in 48h
    let checkouts: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reservations
         WHERE organization_id = $1::uuid
           AND check_out_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
           AND status = 'checked_in'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if checkouts > 0 {
        items.push(json!({
            "id": "checkouts-48h",
            "category": "operations",
            "title": format!("{} check-out{} in the next 48 hours", checkouts, if checkouts > 1 { "s" } else { "" }),
            "confidence_pct": 95,
            "cta_label": "View",
            "cta_href": "/module/reservations"
        }));
    }

    // Leases expiring in 7 days
    let expiring_leases: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status = 'active'
           AND ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if expiring_leases > 0 {
        items.push(json!({
            "id": "expiring-leases-7d",
            "category": "leases",
            "title": format!("{} lease{} expiring within 7 days", expiring_leases, if expiring_leases > 1 { "s" } else { "" }),
            "confidence_pct": 100,
            "cta_label": "Review",
            "cta_href": "/module/leases"
        }));
    }

    // Demand forecast from ml_predictions
    let forecast_row = sqlx::query(
        "SELECT prediction_value, confidence
         FROM ml_predictions
         WHERE organization_id = $1::uuid
           AND prediction_type = 'demand'
           AND target_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&query.org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(row) = forecast_row {
        let value: f64 = row.try_get("prediction_value").unwrap_or(0.0);
        let confidence: f64 = row.try_get("confidence").unwrap_or(0.0);
        items.push(json!({
            "id": "demand-forecast",
            "category": "demand",
            "title": format!("Predicted occupancy demand: {:.0}%", value * 100.0),
            "confidence_pct": (confidence * 100.0).round() as i64,
        }));
    }

    // Overdue tasks
    let overdue: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tasks
         WHERE organization_id = $1::uuid
           AND status NOT IN ('done', 'cancelled')
           AND due_date < CURRENT_DATE",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if overdue > 0 {
        items.push(json!({
            "id": "overdue-tasks",
            "category": "maintenance",
            "title": format!("{} overdue task{} need attention", overdue, if overdue > 1 { "s" } else { "" }),
            "confidence_pct": 100,
            "cta_label": "View",
            "cta_href": "/module/operations?tab=tasks"
        }));
    }

    Ok(Json(json!({ "data": items })))
}
