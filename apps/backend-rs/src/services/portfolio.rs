use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
}

/// Get cross-property portfolio KPIs.
pub async fn tool_get_portfolio_kpis(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    // Total units and properties
    let counts = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::int FROM properties WHERE organization_id = $1::uuid) AS total_properties,
            (SELECT COUNT(*)::int FROM units WHERE organization_id = $1::uuid) AS total_units,
            (SELECT COUNT(*)::int FROM units WHERE organization_id = $1::uuid AND is_active = true) AS active_units",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Portfolio counts query failed");
        AppError::Dependency("Portfolio counts query failed.".to_string())
    })?;

    let total_properties = counts.try_get::<i32, _>("total_properties").unwrap_or(0);
    let total_units = counts.try_get::<i32, _>("total_units").unwrap_or(0);
    let active_units = counts.try_get::<i32, _>("active_units").unwrap_or(1).max(1);

    // Revenue and occupancy for current month
    let metrics = sqlx::query(
        "SELECT
            COALESCE(SUM(total_amount), 0)::float8 AS monthly_revenue,
            COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS room_nights,
            COUNT(*)::bigint AS reservations
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= date_trunc('month', current_date)::date
           AND check_in_date < (date_trunc('month', current_date) + interval '1 month')::date",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Revenue metrics query failed");
        AppError::Dependency("Revenue metrics query failed.".to_string())
    })?;

    let monthly_revenue = metrics.try_get::<f64, _>("monthly_revenue").unwrap_or(0.0);
    let room_nights = metrics.try_get::<i64, _>("room_nights").unwrap_or(0);

    // Expenses for current month
    let expenses: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0)::float8
         FROM expenses
         WHERE organization_id = $1::uuid
           AND expense_date >= date_trunc('month', current_date)::date
           AND expense_date < (date_trunc('month', current_date) + interval '1 month')::date
           AND approval_status != 'rejected'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    // Active leases
    let active_leases: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM leases
         WHERE organization_id = $1::uuid AND lease_status = 'active'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Occupancy = occupied units / total active units
    let days_in_month = 30_i64;
    let available_nights = active_units as i64 * days_in_month;
    let occupancy = if available_nights > 0 {
        (room_nights as f64 / available_nights as f64 * 100.0).min(100.0)
    } else {
        0.0
    };

    let noi = monthly_revenue - expenses;
    let rev_par = if active_units > 0 {
        monthly_revenue / active_units as f64 / days_in_month as f64
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "portfolio": {
            "total_properties": total_properties,
            "total_units": total_units,
            "active_units": active_units,
            "active_leases": active_leases,
        },
        "current_month": {
            "revenue": (monthly_revenue * 100.0).round() / 100.0,
            "expenses": (expenses * 100.0).round() / 100.0,
            "noi": (noi * 100.0).round() / 100.0,
            "occupancy_pct": (occupancy * 100.0).round() / 100.0,
            "rev_par": (rev_par * 100.0).round() / 100.0,
            "room_nights": room_nights,
        },
    }))
}

/// Compare performance metrics across properties.
pub async fn tool_get_property_comparison(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let metric = args
        .get("metric")
        .and_then(Value::as_str)
        .unwrap_or("revenue");
    let period_days = args
        .get("period_days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 365);

    let rows = sqlx::query(
        "SELECT
            p.id::text AS property_id,
            p.name AS property_name,
            COUNT(DISTINCT u.id)::int AS unit_count,
            COALESCE(SUM(r.total_amount), 0)::float8 AS revenue,
            COALESCE(SUM(r.check_out_date - r.check_in_date), 0)::bigint AS room_nights,
            COUNT(r.id)::bigint AS reservations
         FROM properties p
         LEFT JOIN units u ON u.property_id = p.id
         LEFT JOIN reservations r ON r.unit_id = u.id
           AND r.status IN ('confirmed', 'checked_in', 'checked_out')
           AND r.check_in_date >= current_date - ($2::int || ' days')::interval
         WHERE p.organization_id = $1::uuid
         GROUP BY p.id, p.name
         ORDER BY revenue DESC",
    )
    .bind(org_id)
    .bind(period_days as i32)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Property comparison query failed");
        AppError::Dependency("Property comparison query failed.".to_string())
    })?;

    let properties: Vec<Value> = rows
        .iter()
        .map(|r| {
            let units = r.try_get::<i32, _>("unit_count").unwrap_or(0).max(1);
            let revenue = r.try_get::<f64, _>("revenue").unwrap_or(0.0);
            let room_nights = r.try_get::<i64, _>("room_nights").unwrap_or(0);
            let available_nights = units as i64 * period_days;
            let occupancy = if available_nights > 0 {
                room_nights as f64 / available_nights as f64 * 100.0
            } else {
                0.0
            };

            json!({
                "property_id": r.try_get::<String, _>("property_id").unwrap_or_default(),
                "property_name": r.try_get::<String, _>("property_name").unwrap_or_default(),
                "unit_count": units,
                "revenue": (revenue * 100.0).round() / 100.0,
                "room_nights": room_nights,
                "reservations": r.try_get::<i64, _>("reservations").unwrap_or(0),
                "occupancy_pct": (occupancy * 100.0).round() / 100.0,
                "rev_par": if available_nights > 0 {
                    (revenue / available_nights as f64 * 100.0).round() / 100.0
                } else {
                    0.0
                },
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "metric": metric,
        "period_days": period_days,
        "properties": properties,
        "count": properties.len(),
    }))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 9: Portfolio Intelligence — enhanced tools
// ───────────────────────────────────────────────────────────────────────

/// Get 12-month KPI trends per property.
pub async fn tool_get_portfolio_trends(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let months = args
        .get("months")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(1, 24) as i32;

    let snapshots = sqlx::query(
        "SELECT snapshot_date::text, total_units, occupied_units,
                revenue::float8, expenses::float8, noi::float8,
                occupancy, revpar::float8
         FROM portfolio_snapshots
         WHERE organization_id = $1::uuid
           AND snapshot_date >= current_date - ($2::int || ' months')::interval
         ORDER BY snapshot_date ASC",
    )
    .bind(org_id)
    .bind(months)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let trend_points: Vec<Value> = snapshots
        .iter()
        .map(|r| {
            json!({
                "date": r.try_get::<String, _>("snapshot_date").unwrap_or_default(),
                "total_units": r.try_get::<i32, _>("total_units").unwrap_or(0),
                "occupied_units": r.try_get::<i32, _>("occupied_units").unwrap_or(0),
                "revenue": r.try_get::<f64, _>("revenue").unwrap_or(0.0),
                "expenses": r.try_get::<f64, _>("expenses").unwrap_or(0.0),
                "noi": r.try_get::<f64, _>("noi").unwrap_or(0.0),
                "occupancy": r.try_get::<f64, _>("occupancy").unwrap_or(0.0),
                "revpar": r.try_get::<f64, _>("revpar").unwrap_or(0.0),
            })
        })
        .collect();

    // Calculate month-over-month growth
    let mom_growth = if trend_points.len() >= 2 {
        let last = &trend_points[trend_points.len() - 1];
        let prev = &trend_points[trend_points.len() - 2];
        let rev_last = last.get("revenue").and_then(Value::as_f64).unwrap_or(0.0);
        let rev_prev = prev
            .get("revenue")
            .and_then(Value::as_f64)
            .unwrap_or(1.0)
            .max(1.0);
        ((rev_last - rev_prev) / rev_prev * 100.0 * 100.0).round() / 100.0
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "months": months,
        "data_points": trend_points.len(),
        "month_over_month_revenue_growth_pct": mom_growth,
        "trends": trend_points,
    }))
}

/// Rank properties by performance and identify outliers.
pub async fn tool_get_property_heatmap(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let metric = args
        .get("metric")
        .and_then(Value::as_str)
        .unwrap_or("revenue");
    let period_days = args
        .get("period_days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 365) as i32;

    let rows = sqlx::query(
        "SELECT
            p.id::text AS property_id,
            p.name AS property_name,
            p.city,
            COUNT(DISTINCT u.id)::int AS unit_count,
            COALESCE(SUM(r.total_amount), 0)::float8 AS revenue,
            COUNT(r.id)::int AS reservations,
            COALESCE(SUM(r.check_out_date - r.check_in_date), 0)::int AS room_nights,
            COALESCE((SELECT SUM(amount)::float8 FROM expenses e
                      WHERE e.property_id = p.id
                        AND e.expense_date >= current_date - ($2::int || ' days')::interval
                        AND e.approval_status != 'rejected'), 0) AS expenses
         FROM properties p
         LEFT JOIN units u ON u.property_id = p.id
         LEFT JOIN reservations r ON r.unit_id = u.id
           AND r.status IN ('confirmed', 'checked_in', 'checked_out')
           AND r.check_in_date >= current_date - ($2::int || ' days')::interval
         WHERE p.organization_id = $1::uuid
         GROUP BY p.id, p.name, p.city
         ORDER BY revenue DESC",
    )
    .bind(org_id)
    .bind(period_days)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut properties: Vec<Value> = Vec::new();
    let mut revenues: Vec<f64> = Vec::new();

    for r in &rows {
        let units = r.try_get::<i32, _>("unit_count").unwrap_or(0).max(1);
        let revenue = r.try_get::<f64, _>("revenue").unwrap_or(0.0);
        let expenses = r.try_get::<f64, _>("expenses").unwrap_or(0.0);
        let room_nights = r.try_get::<i32, _>("room_nights").unwrap_or(0);
        let available_nights = units * period_days;
        let occupancy = if available_nights > 0 {
            room_nights as f64 / available_nights as f64 * 100.0
        } else {
            0.0
        };
        let noi = revenue - expenses;
        let rev_per_unit = if units > 0 {
            revenue / units as f64
        } else {
            0.0
        };

        revenues.push(revenue);

        properties.push(json!({
            "property_id": r.try_get::<String, _>("property_id").unwrap_or_default(),
            "property_name": r.try_get::<String, _>("property_name").unwrap_or_default(),
            "city": r.try_get::<Option<String>, _>("city").ok().flatten(),
            "unit_count": units,
            "revenue": (revenue * 100.0).round() / 100.0,
            "expenses": (expenses * 100.0).round() / 100.0,
            "noi": (noi * 100.0).round() / 100.0,
            "occupancy_pct": (occupancy * 100.0).round() / 100.0,
            "rev_per_unit": (rev_per_unit * 100.0).round() / 100.0,
            "room_nights": room_nights,
        }));
    }

    // Identify outliers (> 1.5x or < 0.5x average)
    let avg_rev = if revenues.is_empty() {
        0.0
    } else {
        revenues.iter().sum::<f64>() / revenues.len() as f64
    };
    let outliers: Vec<Value> = properties
        .iter()
        .filter(|p| {
            let rev = p.get("revenue").and_then(Value::as_f64).unwrap_or(0.0);
            avg_rev > 0.0 && (rev > avg_rev * 1.5 || rev < avg_rev * 0.5)
        })
        .map(|p| {
            let rev = p.get("revenue").and_then(Value::as_f64).unwrap_or(0.0);
            let direction = if rev > avg_rev {
                "above_average"
            } else {
                "below_average"
            };
            json!({
                "property_name": p.get("property_name"),
                "revenue": rev,
                "direction": direction,
                "deviation_pct": ((rev - avg_rev) / avg_rev * 100.0 * 100.0).round() / 100.0,
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "metric": metric,
        "period_days": period_days,
        "average_revenue": (avg_rev * 100.0).round() / 100.0,
        "properties": properties,
        "outliers": outliers,
        "property_count": properties.len(),
    }))
}

/// Generate a structured performance digest for the given period.
pub async fn tool_generate_performance_digest(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let digest_type = args
        .get("digest_type")
        .and_then(Value::as_str)
        .unwrap_or("weekly");
    let period_days = if digest_type == "monthly" { 30 } else { 7 };

    // Get current period KPIs
    let current = sqlx::query(
        "SELECT
            COALESCE(SUM(r.total_amount), 0)::float8 AS revenue,
            COUNT(r.id)::int AS reservations,
            COALESCE(SUM(r.check_out_date - r.check_in_date), 0)::int AS room_nights
         FROM reservations r
         WHERE r.organization_id = $1::uuid
           AND r.status IN ('confirmed', 'checked_in', 'checked_out')
           AND r.check_in_date >= current_date - ($2::int || ' days')::interval",
    )
    .bind(org_id)
    .bind(period_days)
    .fetch_one(pool)
    .await
    .ok();

    let revenue = current
        .as_ref()
        .and_then(|r| r.try_get::<f64, _>("revenue").ok())
        .unwrap_or(0.0);
    let reservations = current
        .as_ref()
        .and_then(|r| r.try_get::<i32, _>("reservations").ok())
        .unwrap_or(0);
    let room_nights = current
        .as_ref()
        .and_then(|r| r.try_get::<i32, _>("room_nights").ok())
        .unwrap_or(0);

    let expenses: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses
         WHERE organization_id = $1::uuid
           AND expense_date >= current_date - ($2::int || ' days')::interval
           AND approval_status != 'rejected'",
    )
    .bind(org_id)
    .bind(period_days)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    // Get previous period for comparison
    let prev = sqlx::query(
        "SELECT COALESCE(SUM(r.total_amount), 0)::float8 AS revenue
         FROM reservations r
         WHERE r.organization_id = $1::uuid
           AND r.status IN ('confirmed', 'checked_in', 'checked_out')
           AND r.check_in_date >= current_date - ($2::int || ' days')::interval
           AND r.check_in_date < current_date - ($3::int || ' days')::interval",
    )
    .bind(org_id)
    .bind(period_days * 2)
    .bind(period_days)
    .fetch_one(pool)
    .await
    .ok();

    let prev_revenue = prev
        .as_ref()
        .and_then(|r| r.try_get::<f64, _>("revenue").ok())
        .unwrap_or(0.0);
    let revenue_change = if prev_revenue > 0.0 {
        ((revenue - prev_revenue) / prev_revenue * 100.0 * 100.0).round() / 100.0
    } else {
        0.0
    };

    // Maintenance stats
    let maint_open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM maintenance_requests
         WHERE organization_id = $1::uuid AND status IN ('open', 'in_progress')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let noi = revenue - expenses;
    let today = chrono::Utc::now().date_naive();
    let period_start = today - chrono::Duration::days(period_days as i64);

    // Store digest
    let digest_id = sqlx::query(
        "INSERT INTO performance_digests
            (organization_id, digest_type, period_start, period_end, kpis, highlights, concerns)
         VALUES ($1::uuid, $2, $3::date, $4::date, $5::jsonb, '[]'::jsonb, '[]'::jsonb)
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(digest_type)
    .bind(period_start.to_string())
    .bind(today.to_string())
    .bind(&json!({
        "revenue": revenue,
        "expenses": expenses,
        "noi": noi,
        "reservations": reservations,
        "room_nights": room_nights,
        "revenue_change_pct": revenue_change,
        "maintenance_open": maint_open,
    }))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|r| r.try_get::<String, _>("id").ok())
    .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "digest_id": digest_id,
        "digest_type": digest_type,
        "period_start": period_start.to_string(),
        "period_end": today.to_string(),
        "kpis": {
            "revenue": (revenue * 100.0).round() / 100.0,
            "expenses": (expenses * 100.0).round() / 100.0,
            "noi": (noi * 100.0).round() / 100.0,
            "reservations": reservations,
            "room_nights": room_nights,
            "revenue_change_pct": revenue_change,
            "maintenance_open": maint_open,
        },
    }))
}

/// Capture a nightly portfolio snapshot for historical tracking.
pub async fn capture_portfolio_snapshot(pool: &sqlx::PgPool, org_id: &str) {
    let total_units: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid")
            .bind(org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let occupied: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT unit_id)::bigint FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in')
           AND check_in_date <= current_date
           AND check_out_date > current_date",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let revenue: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0)::float8 FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= date_trunc('month', current_date)::date",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    let expenses: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses
         WHERE organization_id = $1::uuid
           AND expense_date >= date_trunc('month', current_date)::date
           AND approval_status != 'rejected'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    let noi = revenue - expenses;
    let occupancy = if total_units > 0 {
        occupied as f64 / total_units as f64
    } else {
        0.0
    };
    let rev_par = if total_units > 0 {
        revenue / total_units as f64 / 30.0
    } else {
        0.0
    };

    sqlx::query(
        "INSERT INTO portfolio_snapshots (
            organization_id, snapshot_date, total_units, occupied_units,
            revenue, expenses, noi, occupancy, rev_par
         ) VALUES ($1::uuid, current_date, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (organization_id, snapshot_date)
         DO UPDATE SET total_units = EXCLUDED.total_units,
                       occupied_units = EXCLUDED.occupied_units,
                       revenue = EXCLUDED.revenue,
                       expenses = EXCLUDED.expenses,
                       noi = EXCLUDED.noi,
                       occupancy = EXCLUDED.occupancy,
                       rev_par = EXCLUDED.rev_par",
    )
    .bind(org_id)
    .bind(total_units)
    .bind(occupied)
    .bind(revenue)
    .bind(expenses)
    .bind(noi)
    .bind(occupancy)
    .bind(rev_par)
    .execute(pool)
    .await
    .ok();
}
