use chrono::Datelike;
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

/// Score a rental application using rule-based screening criteria.
/// Returns a 0-100 score with detailed breakdown.
pub async fn tool_score_application(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if app_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "application_id is required." }));
    }

    // Fetch application data
    let app = sqlx::query(
        "SELECT
            id::text,
            applicant_name,
            monthly_income::float8,
            employment_status,
            employment_months::int,
            references_count::int,
            has_guarantor,
            unit_id::text,
            status
         FROM application_submissions
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch application");
        AppError::Dependency("Failed to fetch application.".to_string())
    })?;

    let Some(row) = app else {
        return Ok(json!({ "ok": false, "error": "Application not found." }));
    };

    let monthly_income = row.try_get::<f64, _>("monthly_income").unwrap_or(0.0);
    let employment_status = row
        .try_get::<Option<String>, _>("employment_status")
        .ok()
        .flatten()
        .unwrap_or_default();
    let employment_months = row.try_get::<i32, _>("employment_months").unwrap_or(0);
    let references_count = row.try_get::<i32, _>("references_count").unwrap_or(0);
    let has_guarantor = row.try_get::<bool, _>("has_guarantor").unwrap_or(false);
    let unit_id = row
        .try_get::<Option<String>, _>("unit_id")
        .ok()
        .flatten()
        .unwrap_or_default();

    // Get rent amount for income-to-rent ratio
    let monthly_rent: f64 = if !unit_id.is_empty() {
        sqlx::query_scalar(
            "SELECT COALESCE(base_price, 0)::float8
             FROM pricing_templates
             WHERE organization_id = $1::uuid AND unit_id = $2::uuid AND is_active = true
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(org_id)
        .bind(&unit_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0.0)
    } else {
        0.0
    };

    let mut breakdown = Vec::new();
    let mut total_score: f64 = 0.0;
    let mut max_possible: f64 = 0.0;

    // 1. Income-to-rent ratio (max 30 points)
    let income_score = if monthly_rent > 0.0 && monthly_income > 0.0 {
        let ratio = monthly_income / monthly_rent;
        if ratio >= 3.0 {
            30.0
        } else if ratio >= 2.5 {
            25.0
        } else if ratio >= 2.0 {
            18.0
        } else if ratio >= 1.5 {
            10.0
        } else {
            5.0
        }
    } else {
        15.0 // Unknown - neutral score
    };
    total_score += income_score;
    max_possible += 30.0;
    breakdown.push(json!({
        "factor": "income_to_rent_ratio",
        "score": income_score,
        "max": 30,
        "detail": if monthly_rent > 0.0 && monthly_income > 0.0 {
            format!("Ratio: {:.1}x", monthly_income / monthly_rent)
        } else {
            "Insufficient data".to_string()
        },
    }));

    // 2. Employment stability (max 25 points)
    let employment_score = match employment_status.as_str() {
        "employed" | "full_time" => {
            if employment_months >= 24 {
                25.0
            } else if employment_months >= 12 {
                20.0
            } else if employment_months >= 6 {
                15.0
            } else {
                10.0
            }
        }
        "self_employed" | "business_owner" => {
            if employment_months >= 24 {
                22.0
            } else {
                15.0
            }
        }
        "retired" | "pensioner" => 20.0,
        "student" => 10.0,
        _ => 12.0,
    };
    total_score += employment_score;
    max_possible += 25.0;
    breakdown.push(json!({
        "factor": "employment_stability",
        "score": employment_score,
        "max": 25,
        "detail": format!("{} for {} months", employment_status, employment_months),
    }));

    // 3. References (max 20 points)
    let reference_score = if references_count >= 3 {
        20.0
    } else if references_count == 2 {
        15.0
    } else if references_count == 1 {
        10.0
    } else {
        5.0
    };
    total_score += reference_score;
    max_possible += 20.0;
    breakdown.push(json!({
        "factor": "references",
        "score": reference_score,
        "max": 20,
        "detail": format!("{} references provided", references_count),
    }));

    // 4. Guarantor (max 15 points)
    let guarantor_score = if has_guarantor { 15.0 } else { 5.0 };
    total_score += guarantor_score;
    max_possible += 15.0;
    breakdown.push(json!({
        "factor": "guarantor",
        "score": guarantor_score,
        "max": 15,
        "detail": if has_guarantor { "Guarantor provided" } else { "No guarantor" },
    }));

    // 5. Application completeness (max 10 points)
    let completeness_score =
        if monthly_income > 0.0 && !employment_status.is_empty() && references_count > 0 {
            10.0
        } else if monthly_income > 0.0 || !employment_status.is_empty() {
            6.0
        } else {
            3.0
        };
    total_score += completeness_score;
    max_possible += 10.0;
    breakdown.push(json!({
        "factor": "completeness",
        "score": completeness_score,
        "max": 10,
        "detail": "Application data completeness",
    }));

    // Normalize to 0-100
    let final_score = if max_possible > 0.0 {
        (total_score / max_possible * 100.0).round() as i32
    } else {
        0
    };

    let risk_level = if final_score >= 80 {
        "low"
    } else if final_score >= 60 {
        "medium"
    } else if final_score >= 40 {
        "elevated"
    } else {
        "high"
    };

    // Update application with screening score
    sqlx::query(
        "UPDATE application_submissions
         SET screening_score = $3, screening_breakdown = $4, screened_at = now(), updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .bind(final_score)
    .bind(json!(breakdown))
    .execute(pool)
    .await
    .ok();

    // Store predictive score and risk factors on the applications table (Sprint 11)
    let risk_factors: Vec<Value> = breakdown
        .iter()
        .filter(|b| {
            b.get("score")
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                < b.get("max").and_then(Value::as_f64).unwrap_or(100.0) * 0.5
        })
        .map(|b| {
            json!({
                "factor": b.get("factor").and_then(Value::as_str).unwrap_or("unknown"),
                "severity": if b.get("score").and_then(Value::as_f64).unwrap_or(0.0) <
                    b.get("max").and_then(Value::as_f64).unwrap_or(100.0) * 0.3 { "high" } else { "medium" },
                "detail": b.get("detail").and_then(Value::as_str).unwrap_or(""),
            })
        })
        .collect();

    sqlx::query(
        "UPDATE applications
         SET predictive_score = $3, risk_factors = $4, ml_screened_at = now(), updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .bind(final_score as f64)
    .bind(json!(risk_factors))
    .execute(pool)
    .await
    .ok();

    // Store ML prediction for tracking outcome feedback
    sqlx::query(
        "INSERT INTO ml_predictions (organization_id, prediction_type, entity_type, entity_id, predicted_value, predicted_label, confidence, features, model_version)
         VALUES ($1::uuid, 'tenant_risk', 'application', $2::uuid, $3, $4, $5, $6, 'rule_v1')",
    )
    .bind(org_id)
    .bind(app_id)
    .bind(final_score as f64)
    .bind(risk_level)
    .bind(total_score / max_possible)
    .bind(json!({
        "income_ratio": if monthly_rent > 0.0 && monthly_income > 0.0 { monthly_income / monthly_rent } else { 0.0 },
        "employment_months": employment_months,
        "references_count": references_count,
        "has_guarantor": has_guarantor,
    }))
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "application_id": app_id,
        "score": final_score,
        "risk_level": risk_level,
        "breakdown": breakdown,
        "risk_factors": risk_factors,
        "recommendation": if final_score >= 70 {
            "Recommend approval. Strong application profile."
        } else if final_score >= 50 {
            "Conditional approval. Review highlighted risk factors."
        } else {
            "Additional verification recommended before proceeding."
        },
    }))
}

/// Get aggregated risk radar: predicted risks across all categories for an org.
pub async fn tool_get_risk_radar(
    state: &AppState,
    org_id: &str,
    _args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    // Get recent predictions grouped by type
    let rows = sqlx::query(
        "SELECT prediction_type,
                COUNT(*)::int AS total,
                AVG(confidence)::float8 AS avg_confidence,
                COUNT(*) FILTER (WHERE predicted_label IN ('high', 'critical', 'elevated'))::int AS high_risk_count,
                MAX(created_at)::text AS latest
         FROM ml_predictions
         WHERE organization_id = $1::uuid
           AND created_at > now() - interval '30 days'
         GROUP BY prediction_type
         ORDER BY high_risk_count DESC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch risk radar");
        AppError::Dependency("Failed to fetch risk radar.".to_string())
    })?;

    let categories: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "type": r.try_get::<String, _>("prediction_type").unwrap_or_default(),
                "total_predictions": r.try_get::<i32, _>("total").unwrap_or(0),
                "avg_confidence": format!("{:.0}%", r.try_get::<f64, _>("avg_confidence").unwrap_or(0.0) * 100.0),
                "high_risk_count": r.try_get::<i32, _>("high_risk_count").unwrap_or(0),
                "latest": r.try_get::<Option<String>, _>("latest").ok().flatten().unwrap_or_default(),
            })
        })
        .collect();

    // Get upcoming demand forecasts
    let forecasts = sqlx::query(
        "SELECT forecast_date::text, predicted_demand,
                AVG(predicted_occupancy)::float8 AS avg_occupancy,
                AVG(predicted_adr)::float8 AS avg_adr
         FROM demand_forecasts
         WHERE organization_id = $1::uuid
           AND forecast_date >= CURRENT_DATE
           AND forecast_date <= CURRENT_DATE + 30
         GROUP BY forecast_date, predicted_demand
         ORDER BY forecast_date
         LIMIT 30",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let demand_outlook: Vec<Value> = forecasts
        .iter()
        .map(|r| {
            json!({
                "date": r.try_get::<String, _>("forecast_date").unwrap_or_default(),
                "demand": r.try_get::<String, _>("predicted_demand").unwrap_or_default(),
                "avg_occupancy": format!("{:.0}%", r.try_get::<f64, _>("avg_occupancy").unwrap_or(0.0) * 100.0),
                "avg_adr": r.try_get::<f64, _>("avg_adr").unwrap_or(0.0),
            })
        })
        .collect();

    // Active anomaly alerts
    let alert_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM anomaly_alerts
         WHERE organization_id = $1::uuid AND is_dismissed = false",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    Ok(json!({
        "ok": true,
        "risk_categories": categories,
        "demand_outlook_30d": demand_outlook,
        "active_anomaly_alerts": alert_count,
        "summary": format!("{} prediction categories tracked, {} active anomaly alerts", categories.len(), alert_count),
    }))
}

/// Forecast demand for 90 days using historical reservation patterns.
pub async fn tool_forecast_demand(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let days_ahead = args
        .get("days_ahead")
        .and_then(Value::as_i64)
        .unwrap_or(90)
        .min(180) as i32;

    let unit_id = args.get("unit_id").and_then(Value::as_str).unwrap_or("");

    // Get historical reservations for the past 12 months
    let hist_query = if unit_id.is_empty() {
        sqlx::query(
            "SELECT check_in_date::text, check_out_date::text, total_amount::float8, unit_id::text
             FROM reservations
             WHERE organization_id = $1::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= CURRENT_DATE - 365
             ORDER BY check_in_date",
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT check_in_date::text, check_out_date::text, total_amount::float8, unit_id::text
             FROM reservations
             WHERE organization_id = $1::uuid
               AND unit_id = $2::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= CURRENT_DATE - 365
             ORDER BY check_in_date",
        )
        .bind(org_id)
        .bind(unit_id)
        .fetch_all(pool)
        .await
    };

    let reservations = hist_query.map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch historical reservations");
        AppError::Dependency("Failed to fetch reservations.".to_string())
    })?;

    // Build monthly occupancy map from last 12 months
    let mut month_occupancy: std::collections::HashMap<u32, (f64, f64, u32)> =
        std::collections::HashMap::new(); // month -> (total_nights, total_revenue, count)
    let today = chrono::Utc::now().date_naive();

    for row in &reservations {
        let ci = row
            .try_get::<String, _>("check_in_date")
            .unwrap_or_default();
        let co = row
            .try_get::<String, _>("check_out_date")
            .unwrap_or_default();
        let amount = row.try_get::<f64, _>("total_amount").unwrap_or(0.0);

        if let (Ok(ci_date), Ok(co_date)) = (
            chrono::NaiveDate::parse_from_str(&ci, "%Y-%m-%d"),
            chrono::NaiveDate::parse_from_str(&co, "%Y-%m-%d"),
        ) {
            let nights = (co_date - ci_date).num_days().max(1) as f64;
            let month = ci_date.month();
            let entry = month_occupancy.entry(month).or_insert((0.0, 0.0, 0));
            entry.0 += nights;
            entry.1 += amount;
            entry.2 += 1;
        }
    }

    // Get total unit count for occupancy calculation
    let total_units: i64 = if unit_id.is_empty() {
        sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid AND status = 'available'",
        )
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap_or(1)
    } else {
        1
    };
    let total_units = total_units.max(1) as f64;

    // Generate forecasts
    let mut forecasts: Vec<Value> = Vec::new();
    for day_offset in 0..days_ahead {
        let forecast_date = today + chrono::Duration::days(day_offset as i64);
        let month = forecast_date.month();

        let (avg_nights, avg_revenue, booking_count) = month_occupancy
            .get(&month)
            .copied()
            .unwrap_or((0.0, 0.0, 0));

        // Days in this month historically covered by bookings
        let days_in_month = 30.0;
        let occupancy = if booking_count > 0 {
            (avg_nights / (days_in_month * total_units)).min(1.0)
        } else {
            0.3 // Default baseline
        };

        let adr = if booking_count > 0 && avg_nights > 0.0 {
            avg_revenue / avg_nights
        } else {
            0.0
        };

        let demand_level = if occupancy >= 0.85 {
            "peak"
        } else if occupancy >= 0.65 {
            "high"
        } else if occupancy >= 0.40 {
            "normal"
        } else {
            "low"
        };

        let confidence = if booking_count >= 3 {
            0.7
        } else if booking_count >= 1 {
            0.4
        } else {
            0.2
        };

        // Store forecast
        sqlx::query(
            "INSERT INTO demand_forecasts (organization_id, unit_id, forecast_date, predicted_occupancy, predicted_adr, predicted_demand, confidence, factors)
             VALUES ($1::uuid, NULLIF($2, '')::uuid, $3::date, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING",
        )
        .bind(org_id)
        .bind(if unit_id.is_empty() { "" } else { unit_id })
        .bind(forecast_date.to_string())
        .bind(occupancy)
        .bind(adr)
        .bind(demand_level)
        .bind(confidence)
        .bind(json!({ "historical_bookings": booking_count, "month": month }))
        .execute(pool)
        .await
        .ok();

        // Only include weekly samples in response to keep it concise
        if day_offset % 7 == 0 || day_offset == days_ahead - 1 {
            forecasts.push(json!({
                "date": forecast_date.to_string(),
                "occupancy": format!("{:.0}%", occupancy * 100.0),
                "adr": format!("{:.0}", adr),
                "demand": demand_level,
                "confidence": format!("{:.0}%", confidence * 100.0),
            }));
        }
    }

    // Store ML prediction record
    sqlx::query(
        "INSERT INTO ml_predictions (organization_id, prediction_type, entity_type, entity_id, predicted_label, confidence, features, model_version)
         VALUES ($1::uuid, 'demand', 'organization', $1::uuid, 'forecast_generated', 0.5, $2, 'seasonal_v1')",
    )
    .bind(org_id)
    .bind(json!({ "days_ahead": days_ahead, "unit_id": unit_id, "data_points": reservations.len() }))
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "days_ahead": days_ahead,
        "unit_filter": if unit_id.is_empty() { "all units" } else { unit_id },
        "data_points": reservations.len(),
        "forecasts": forecasts,
        "summary": format!("Generated {}-day demand forecast from {} historical reservations", days_ahead, reservations.len()),
    }))
}
