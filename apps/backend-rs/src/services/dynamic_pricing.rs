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

// ───────────────────────────────────────────────────────────────────────
// Paraguay seasonal coefficients
// Jun–Aug (Chaco/winter tourism) and Dec–Feb (pool/summer season) are high.
// ───────────────────────────────────────────────────────────────────────

fn seasonal_coefficient(month: u32) -> f64 {
    match month {
        12 | 1 | 2 => 1.15, // High season: summer / pool
        6 | 7 | 8 => 1.10,  // Moderate high: Chaco / winter tourism
        3 | 11 => 1.05,     // Shoulder
        _ => 0.95,          // Low season
    }
}

fn day_of_week_factor(dow: &str) -> f64 {
    match dow {
        "fri" => 1.10,
        "sat" => 1.15,
        "sun" => 1.10,
        _ => 1.0,
    }
}

/// Enhanced pricing recommendations with ML scoring fields:
/// seasonal, demand, competitor, day-of-week, length-of-stay, and last-minute adjustments.
pub async fn tool_generate_pricing_recommendations(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let period_days = args
        .get("period_days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 90);
    let target_unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    // Get current performance metrics
    let metrics = sqlx::query(
        "SELECT
            COUNT(*)::bigint AS total_reservations,
            COALESCE(AVG(nightly_rate), 0)::float8 AS avg_rate,
            COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS total_nights
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= current_date - ($2::int || ' days')::interval",
    )
    .bind(org_id)
    .bind(period_days as i32)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Pricing metrics query failed");
        AppError::Dependency("Pricing metrics query failed.".to_string())
    })?;

    let avg_rate = metrics.try_get::<f64, _>("avg_rate").unwrap_or(0.0);
    let total_nights = metrics.try_get::<i64, _>("total_nights").unwrap_or(0);

    let unit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid AND is_active = true",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(1)
    .max(1);

    let available_nights = unit_count * period_days;
    let occupancy = if available_nights > 0 {
        total_nights as f64 / available_nights as f64
    } else {
        0.0
    };

    // Fetch competitor market data (latest snapshot)
    let market_avg: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(local_avg_rate), 0)::float8
         FROM market_data_snapshots
         WHERE org_id = $1::uuid
           AND snapshot_date >= current_date - interval '14 days'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    // Fetch active pricing rule set (org-wide fallback)
    let rule_set = sqlx::query(
        "SELECT min_rate::float8, max_rate::float8,
                weekend_premium_pct::float8, holiday_premium_pct::float8,
                low_season_discount_pct::float8, high_season_premium_pct::float8,
                last_minute_days::int, last_minute_discount_pct::float8,
                long_stay_threshold_days::int, long_stay_discount_pct::float8,
                day_of_week_factors
         FROM pricing_rule_sets
         WHERE org_id = $1::uuid AND is_active = true
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let min_rate = rule_set
        .as_ref()
        .and_then(|r| r.try_get::<Option<f64>, _>("min_rate").ok().flatten())
        .unwrap_or(0.0);
    let max_rate = rule_set
        .as_ref()
        .and_then(|r| r.try_get::<Option<f64>, _>("max_rate").ok().flatten())
        .unwrap_or(f64::MAX);
    let last_minute_days = rule_set
        .as_ref()
        .and_then(|r| {
            r.try_get::<Option<i32>, _>("last_minute_days")
                .ok()
                .flatten()
        })
        .unwrap_or(3);
    let last_minute_discount = rule_set
        .as_ref()
        .and_then(|r| {
            r.try_get::<Option<f64>, _>("last_minute_discount_pct")
                .ok()
                .flatten()
        })
        .unwrap_or(0.0);
    let long_stay_threshold = rule_set
        .as_ref()
        .and_then(|r| {
            r.try_get::<Option<i32>, _>("long_stay_threshold_days")
                .ok()
                .flatten()
        })
        .unwrap_or(7);
    let long_stay_discount = rule_set
        .as_ref()
        .and_then(|r| {
            r.try_get::<Option<f64>, _>("long_stay_discount_pct")
                .ok()
                .flatten()
        })
        .unwrap_or(0.0);

    // Current month for seasonal factor
    let now = chrono::Utc::now();
    let current_month = now.format("%m").to_string().parse::<u32>().unwrap_or(1);
    let current_dow = now.format("%a").to_string().to_lowercase();
    let dow_key = &current_dow[..3.min(current_dow.len())];

    let seasonal_coeff = seasonal_coefficient(current_month);
    let dow_factor = day_of_week_factor(dow_key);

    // Fetch pricing templates (optionally filtered by unit)
    let templates = if let Some(uid) = target_unit_id {
        sqlx::query(
            "SELECT pt.id::text, pt.unit_id::text, pt.base_price::float8, u.unit_name
             FROM pricing_templates pt
             JOIN units u ON u.id = pt.unit_id
             WHERE pt.organization_id = $1::uuid AND pt.is_active = true AND pt.unit_id = $2::uuid
             ORDER BY u.unit_name LIMIT 50",
        )
        .bind(org_id)
        .bind(uid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT pt.id::text, pt.unit_id::text, pt.base_price::float8, u.unit_name
             FROM pricing_templates pt
             JOIN units u ON u.id = pt.unit_id
             WHERE pt.organization_id = $1::uuid AND pt.is_active = true
             ORDER BY u.unit_name LIMIT 50",
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch pricing templates");
        AppError::Dependency("Failed to fetch pricing templates.".to_string())
    })?;

    let mut recommendations = Vec::new();
    for row in &templates {
        let template_id = row.try_get::<String, _>("id").unwrap_or_default();
        let unit_id = row.try_get::<String, _>("unit_id").unwrap_or_default();
        let unit_name = row.try_get::<String, _>("unit_name").unwrap_or_default();
        let current_price = row.try_get::<f64, _>("base_price").unwrap_or(0.0);

        if current_price <= 0.0 {
            continue;
        }

        // 1. Demand adjustment based on occupancy
        let demand_adj = if occupancy > 0.85 {
            0.10
        } else if occupancy > 0.70 {
            0.05
        } else if occupancy < 0.40 {
            -0.10
        } else if occupancy < 0.55 {
            -0.05
        } else {
            0.0
        };

        // 2. Seasonal adjustment
        let seasonal_adj = seasonal_coeff - 1.0;

        // 3. Competitor adjustment: if market avg available and we're above/below
        let competitor_adj = if market_avg > 0.0 {
            let ratio = current_price / market_avg;
            if ratio > 1.15 {
                -0.05 // We're significantly above market, pull down
            } else if ratio < 0.85 {
                0.05 // We're below market, push up
            } else {
                0.0
            }
        } else {
            0.0
        };

        // 4. Day-of-week factor (for nightly pricing context)
        let dow_adj = dow_factor - 1.0;

        // 5. Last-minute discount (occupancy < 60% and within N days)
        let last_minute_adj = if occupancy < 0.60 && last_minute_days > 0 {
            -(last_minute_discount / 100.0)
        } else {
            0.0
        };

        // 6. Length-of-stay discount hint (stored but not applied to base)
        let los_discount = if long_stay_threshold > 0 {
            long_stay_discount / 100.0
        } else {
            0.0
        };

        // Composite adjustment (capped at ±25%)
        let total_adj = (demand_adj + seasonal_adj + competitor_adj + dow_adj + last_minute_adj)
            .clamp(-0.25, 0.25);
        let adjustment_pct = (total_adj * 10000.0).round() / 100.0; // e.g. 12.50%
        let recommended_price = (current_price * (1.0 + total_adj)).clamp(min_rate, max_rate);

        // Confidence score: higher when more data points agree on direction
        let signals = [demand_adj, seasonal_adj, competitor_adj];
        let positive = signals.iter().filter(|&&s| s > 0.0).count();
        let negative = signals.iter().filter(|&&s| s < 0.0).count();
        let agreement = positive.max(negative) as f64 / signals.len() as f64;
        let confidence = 0.4 + agreement * 0.5; // range 0.4 – 0.9

        // Projected revenue and occupancy
        let proj_occupancy = (occupancy + total_adj * 0.3).clamp(0.0, 1.0);
        let proj_revenue = recommended_price * proj_occupancy * period_days as f64;

        if (recommended_price - current_price).abs() < 0.50 {
            continue; // Skip trivial changes
        }

        let mut reasons = Vec::new();
        if demand_adj.abs() > 0.001 {
            reasons.push(format!(
                "Occupancy {:.0}% → demand {}",
                occupancy * 100.0,
                if demand_adj > 0.0 {
                    "boost"
                } else {
                    "reduction"
                }
            ));
        }
        if seasonal_adj.abs() > 0.001 {
            reasons.push(format!("Seasonal factor {:.0}%", seasonal_adj * 100.0));
        }
        if competitor_adj.abs() > 0.001 {
            reasons.push(format!(
                "Competitor positioning vs market avg ${:.0}",
                market_avg
            ));
        }
        if last_minute_adj.abs() > 0.001 {
            reasons.push(format!(
                "Last-minute discount {:.0}%",
                last_minute_adj * 100.0
            ));
        }
        let reason = reasons.join(". ");

        // Insert recommendation with extended ML scoring fields
        let rec = sqlx::query(
            "INSERT INTO pricing_recommendations (
                organization_id, unit_id, pricing_template_id,
                current_price, recommended_price, adjustment_pct, reason, status,
                confidence_score, seasonal_adjustment, demand_adjustment,
                competitor_adjustment, day_of_week_factor,
                length_of_stay_discount, last_minute_adjustment,
                projected_revenue, projected_occupancy
             ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'pending',
                       $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(&unit_id)
        .bind(&template_id)
        .bind(current_price)
        .bind(recommended_price)
        .bind(adjustment_pct)
        .bind(&reason)
        .bind(confidence)
        .bind(seasonal_adj)
        .bind(demand_adj)
        .bind(competitor_adj)
        .bind(dow_factor)
        .bind(los_discount)
        .bind(last_minute_adj)
        .bind(proj_revenue)
        .bind(proj_occupancy)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let rec_id = rec
            .and_then(|r| r.try_get::<String, _>("id").ok())
            .unwrap_or_default();

        recommendations.push(json!({
            "recommendation_id": rec_id,
            "unit_id": unit_id,
            "unit_name": unit_name,
            "current_price": (current_price * 100.0).round() / 100.0,
            "recommended_price": (recommended_price * 100.0).round() / 100.0,
            "adjustment_pct": adjustment_pct,
            "confidence_score": (confidence * 100.0).round() / 100.0,
            "reason": reason,
            "factors": {
                "demand_adjustment": (demand_adj * 100.0).round() / 100.0,
                "seasonal_adjustment": (seasonal_adj * 100.0).round() / 100.0,
                "competitor_adjustment": (competitor_adj * 100.0).round() / 100.0,
                "day_of_week_factor": dow_factor,
                "last_minute_adjustment": (last_minute_adj * 100.0).round() / 100.0,
                "length_of_stay_discount": (los_discount * 100.0).round() / 100.0,
            },
            "projected_revenue": (proj_revenue * 100.0).round() / 100.0,
            "projected_occupancy_pct": (proj_occupancy * 10000.0).round() / 100.0,
        }));
    }

    Ok(json!({
        "ok": true,
        "period_days": period_days,
        "portfolio_occupancy_pct": (occupancy * 10000.0).round() / 100.0,
        "avg_daily_rate": (avg_rate * 100.0).round() / 100.0,
        "market_avg_rate": (market_avg * 100.0).round() / 100.0,
        "seasonal_coefficient": seasonal_coeff,
        "recommendations": recommendations,
        "count": recommendations.len(),
    }))
}

/// Apply a pricing recommendation by updating the pricing template.
pub async fn tool_apply_pricing_recommendation(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rec_id = args
        .get("recommendation_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if rec_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "recommendation_id is required." }));
    }

    // Fetch recommendation
    let rec = sqlx::query(
        "SELECT pricing_template_id::text, recommended_price::float8
         FROM pricing_recommendations
         WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'pending'",
    )
    .bind(rec_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch recommendation");
        AppError::Dependency("Failed to fetch recommendation.".to_string())
    })?;

    let Some(row) = rec else {
        return Ok(json!({ "ok": false, "error": "Recommendation not found or already applied." }));
    };

    let template_id = row
        .try_get::<String, _>("pricing_template_id")
        .unwrap_or_default();
    let new_price = row.try_get::<f64, _>("recommended_price").unwrap_or(0.0);

    // Update pricing template
    sqlx::query(
        "UPDATE pricing_templates SET base_price = $3, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(&template_id)
    .bind(org_id)
    .bind(new_price)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to update pricing template");
        AppError::Dependency("Failed to update pricing template.".to_string())
    })?;

    // Mark recommendation as applied
    sqlx::query(
        "UPDATE pricing_recommendations
         SET status = 'applied', auto_applied = true, applied_at = now()
         WHERE id = $1::uuid",
    )
    .bind(rec_id)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "recommendation_id": rec_id,
        "pricing_template_id": template_id,
        "new_price": (new_price * 100.0).round() / 100.0,
        "status": "applied",
    }))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 3: New tools — market data, rate simulation
// ───────────────────────────────────────────────────────────────────────

/// Fetch and store market data snapshots (competitor rates, demand indices).
/// Can import from iCal competitor feeds or manual entry.
pub async fn tool_fetch_market_data(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let property_id = args
        .get("property_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let source = args
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("manual");

    // If competitor data provided directly, store it
    let competitor_name = args.get("competitor_name").and_then(Value::as_str);
    let competitor_rate = args.get("competitor_rate").and_then(Value::as_f64);
    let local_avg_rate = args.get("local_avg_rate").and_then(Value::as_f64);
    let demand_index = args.get("demand_index").and_then(Value::as_f64);
    let event_indicator = args.get("event_indicator").and_then(Value::as_str);

    let row = sqlx::query(
        "INSERT INTO market_data_snapshots
            (org_id, property_id, snapshot_date, source,
             competitor_name, competitor_rate, local_avg_rate,
             demand_index, event_indicator)
         VALUES ($1::uuid,
                 CASE WHEN $2 = '' THEN NULL ELSE $2::uuid END,
                 current_date, $3, $4, $5, $6, $7, $8)
         RETURNING id::text, snapshot_date::text",
    )
    .bind(org_id)
    .bind(property_id.unwrap_or(""))
    .bind(source)
    .bind(competitor_name.unwrap_or(""))
    .bind(competitor_rate)
    .bind(local_avg_rate)
    .bind(demand_index)
    .bind(event_indicator.unwrap_or(""))
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to store market data snapshot");
        AppError::Dependency("Failed to store market data snapshot.".to_string())
    })?;

    let snap_id = row.try_get::<String, _>("id").unwrap_or_default();
    let snap_date = row
        .try_get::<String, _>("snapshot_date")
        .unwrap_or_default();

    // Also return recent market summary
    let summary = sqlx::query(
        "SELECT
            COUNT(*)::bigint AS snapshot_count,
            COALESCE(AVG(competitor_rate), 0)::float8 AS avg_competitor_rate,
            COALESCE(AVG(local_avg_rate), 0)::float8 AS avg_local_rate,
            COALESCE(AVG(demand_index), 0)::float8 AS avg_demand_index
         FROM market_data_snapshots
         WHERE org_id = $1::uuid
           AND snapshot_date >= current_date - interval '14 days'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .ok();

    let avg_competitor = summary
        .as_ref()
        .and_then(|r| r.try_get::<f64, _>("avg_competitor_rate").ok())
        .unwrap_or(0.0);
    let avg_local = summary
        .as_ref()
        .and_then(|r| r.try_get::<f64, _>("avg_local_rate").ok())
        .unwrap_or(0.0);
    let avg_demand = summary
        .as_ref()
        .and_then(|r| r.try_get::<f64, _>("avg_demand_index").ok())
        .unwrap_or(0.0);

    Ok(json!({
        "ok": true,
        "snapshot_id": snap_id,
        "snapshot_date": snap_date,
        "source": source,
        "market_summary_14d": {
            "avg_competitor_rate": (avg_competitor * 100.0).round() / 100.0,
            "avg_local_rate": (avg_local * 100.0).round() / 100.0,
            "avg_demand_index": (avg_demand * 100.0).round() / 100.0,
        },
    }))
}

/// Simulate the revenue impact of a rate change for a unit or property.
/// Projects occupancy shift and revenue delta over a given period.
pub async fn tool_simulate_rate_impact(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let proposed_rate = args
        .get("proposed_rate")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let period_days = args
        .get("period_days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 180) as i32;

    if unit_id.is_empty() || proposed_rate <= 0.0 {
        return Ok(
            json!({ "ok": false, "error": "unit_id and proposed_rate (> 0) are required." }),
        );
    }

    // Get current rate and historical occupancy for this unit
    let current_data = sqlx::query(
        "SELECT COALESCE(pt.base_price, 0)::float8 AS current_rate,
                u.unit_name
         FROM units u
         LEFT JOIN pricing_templates pt ON pt.unit_id = u.id AND pt.is_active = true
         WHERE u.id = $1::uuid AND u.organization_id = $2::uuid
         LIMIT 1",
    )
    .bind(unit_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch unit for simulation");
        AppError::Dependency("Failed to fetch unit data.".to_string())
    })?;

    let Some(row) = current_data else {
        return Ok(json!({ "ok": false, "error": "Unit not found." }));
    };

    let current_rate = row.try_get::<f64, _>("current_rate").unwrap_or(0.0);
    let unit_name = row.try_get::<String, _>("unit_name").unwrap_or_default();

    // Historical occupancy for this unit over past 90 days
    let hist_nights: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(check_out_date - check_in_date), 0)::bigint
         FROM reservations
         WHERE organization_id = $1::uuid AND unit_id = $2::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= current_date - interval '90 days'",
    )
    .bind(org_id)
    .bind(unit_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let hist_occupancy = (hist_nights as f64 / 90.0).clamp(0.0, 1.0);

    // S18/S23: Price elasticity — check ML model first, then guardrail config, then default
    let elasticity = {
        // Try ML model
        let ml_e = crate::services::ml_pipeline::get_active_elasticity(pool, org_id).await;
        if let Some(e) = ml_e {
            e
        } else {
            // Fallback to guardrail config with -0.8 default
            crate::services::ai_agent::get_guardrail_value_f64(
                pool,
                org_id,
                "price_elasticity",
                -0.8,
            )
            .await
        }
    };
    let rate_change_pct = if current_rate > 0.0 {
        (proposed_rate - current_rate) / current_rate
    } else {
        0.0
    };
    let occupancy_change = rate_change_pct * elasticity;
    let projected_occupancy = (hist_occupancy + occupancy_change).clamp(0.05, 0.98);

    let current_revenue = current_rate * hist_occupancy * period_days as f64;
    let projected_revenue = proposed_rate * projected_occupancy * period_days as f64;
    let revenue_delta = projected_revenue - current_revenue;
    let revenue_delta_pct = if current_revenue > 0.0 {
        (revenue_delta / current_revenue) * 100.0
    } else {
        0.0
    };

    // RevPAR comparison
    let current_revpar = current_rate * hist_occupancy;
    let projected_revpar = proposed_rate * projected_occupancy;

    Ok(json!({
        "ok": true,
        "unit_id": unit_id,
        "unit_name": unit_name,
        "period_days": period_days,
        "current": {
            "rate": (current_rate * 100.0).round() / 100.0,
            "occupancy_pct": (hist_occupancy * 10000.0).round() / 100.0,
            "projected_revenue": (current_revenue * 100.0).round() / 100.0,
            "revpar": (current_revpar * 100.0).round() / 100.0,
        },
        "proposed": {
            "rate": (proposed_rate * 100.0).round() / 100.0,
            "occupancy_pct": (projected_occupancy * 10000.0).round() / 100.0,
            "projected_revenue": (projected_revenue * 100.0).round() / 100.0,
            "revpar": (projected_revpar * 100.0).round() / 100.0,
        },
        "delta": {
            "revenue": (revenue_delta * 100.0).round() / 100.0,
            "revenue_pct": (revenue_delta_pct * 100.0).round() / 100.0,
            "occupancy_shift_pct": (occupancy_change * 10000.0).round() / 100.0,
        },
        "model": {
            "elasticity": elasticity,
            "note": "Price elasticity of -0.8: a 10% price increase reduces occupancy by ~8%",
        },
    }))
}

/// Daily pricing recommendations job — generates recommendations for all active orgs.
/// Called by the scheduler at 06:00 UTC.
pub async fn run_daily_pricing_recommendations(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    let org_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true LIMIT 100")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let mut total = 0u32;
    for (org_id,) in &org_ids {
        let args = Map::new(); // default period_days = 30
        match tool_generate_pricing_recommendations(state, org_id, &args).await {
            Ok(result) => {
                let count = result.get("count").and_then(Value::as_u64).unwrap_or(0);
                total += count as u32;
            }
            Err(e) => {
                tracing::warn!(org_id, error = %e, "Daily pricing: failed for org");
            }
        }
    }

    // Auto-approve pricing changes with < 10% delta (skip approval queue)
    let mut auto_applied = 0u32;
    for (org_id,) in &org_ids {
        match auto_approve_small_pricing_changes(pool, org_id).await {
            Ok(count) => auto_applied += count,
            Err(e) => {
                tracing::warn!(org_id, error = %e, "Daily pricing: auto-approve failed");
            }
        }
    }

    tracing::info!(
        total_recommendations = total,
        auto_applied,
        org_count = org_ids.len(),
        "Daily pricing recommendations completed"
    );
}

/// Auto-approve pricing recommendations where the change delta is less than 10%.
async fn auto_approve_small_pricing_changes(pool: &sqlx::PgPool, org_id: &str) -> AppResult<u32> {
    let rows = sqlx::query_as::<_, (String, String, f64, f64)>(
        "SELECT pr.id::text, pr.pricing_template_id::text,
                pr.recommended_price::float8, pt.base_price::float8
         FROM pricing_recommendations pr
         JOIN pricing_templates pt ON pt.id = pr.pricing_template_id
         WHERE pr.organization_id = $1::uuid
           AND pr.status = 'pending'
           AND pt.base_price > 0
         LIMIT 100",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch pending recommendations");
        AppError::Dependency("Failed to fetch pending recommendations.".to_string())
    })?;

    let mut count = 0u32;
    for (rec_id, template_id, recommended, current) in &rows {
        let delta_pct = ((recommended - current) / current).abs();
        if delta_pct >= 0.10 {
            continue; // Needs human review
        }

        // Apply the small change directly
        let _ = sqlx::query(
            "UPDATE pricing_templates SET base_price = $3, updated_at = now()
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(template_id)
        .bind(org_id)
        .bind(recommended)
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "UPDATE pricing_recommendations
             SET status = 'applied', auto_applied = true, applied_at = now()
             WHERE id = $1::uuid",
        )
        .bind(rec_id)
        .execute(pool)
        .await;

        count += 1;
    }

    Ok(count)
}
