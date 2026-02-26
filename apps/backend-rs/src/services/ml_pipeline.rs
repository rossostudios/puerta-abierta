use serde_json::{json, Value};
use sqlx::Row;

use crate::state::AppState;

/// S23: Compute pricing features for all units in an org.
pub async fn compute_pricing_features(pool: &sqlx::PgPool, org_id: &str) {
    // Extract per-unit features: occupancy at various price points, seasonal patterns
    let units: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM units WHERE organization_id = $1::uuid LIMIT 500")
            .bind(org_id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    for (unit_id,) in &units {
        let features = sqlx::query(
            "SELECT
                COALESCE(AVG(CASE WHEN r.status = 'confirmed' THEN r.total_amount END), 0)::float8 AS avg_rate,
                COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END)::float8 AS total_bookings,
                COALESCE(AVG(r.check_out_date - r.check_in_date), 0)::float8 AS avg_stay_length,
                COUNT(CASE WHEN r.status = 'confirmed' AND r.check_in_date >= CURRENT_DATE - 90 THEN 1 END)::float8 AS bookings_90d,
                COUNT(CASE WHEN r.status = 'confirmed' AND r.check_in_date >= CURRENT_DATE - 30 THEN 1 END)::float8 AS bookings_30d
             FROM reservations r
             WHERE r.unit_id = $1::uuid AND r.organization_id = $2::uuid",
        )
        .bind(unit_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await;

        let features_json = match features {
            Ok(Some(row)) => json!({
                "avg_rate": row.try_get::<f64, _>("avg_rate").unwrap_or(0.0),
                "total_bookings": row.try_get::<f64, _>("total_bookings").unwrap_or(0.0),
                "avg_stay_length": row.try_get::<f64, _>("avg_stay_length").unwrap_or(0.0),
                "bookings_90d": row.try_get::<f64, _>("bookings_90d").unwrap_or(0.0),
                "bookings_30d": row.try_get::<f64, _>("bookings_30d").unwrap_or(0.0),
            }),
            _ => continue,
        };

        sqlx::query(
            "INSERT INTO ml_features (organization_id, feature_set, entity_id, features, computed_at)
             VALUES ($1::uuid, 'pricing', $2, $3::jsonb, now())
             ON CONFLICT (organization_id, feature_set, entity_id)
             DO UPDATE SET features = EXCLUDED.features, computed_at = now()",
        )
        .bind(org_id)
        .bind(unit_id)
        .bind(&features_json)
        .execute(pool)
        .await
        .ok();
    }
}

/// S23: Compute demand features at org level.
pub async fn compute_demand_features(pool: &sqlx::PgPool, org_id: &str) {
    let features = sqlx::query(
        "SELECT
            COUNT(CASE WHEN r.check_in_date >= CURRENT_DATE AND r.check_in_date < CURRENT_DATE + 30 THEN 1 END)::float8 AS upcoming_30d,
            COUNT(CASE WHEN r.check_in_date >= CURRENT_DATE AND r.check_in_date < CURRENT_DATE + 7 THEN 1 END)::float8 AS upcoming_7d,
            COUNT(CASE WHEN r.created_at >= CURRENT_DATE - 7 THEN 1 END)::float8 AS new_bookings_7d,
            COUNT(CASE WHEN r.created_at >= CURRENT_DATE - 30 THEN 1 END)::float8 AS new_bookings_30d
         FROM reservations r
         WHERE r.organization_id = $1::uuid AND r.status IN ('confirmed', 'pending')",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await;

    let features_json = match features {
        Ok(Some(row)) => json!({
            "upcoming_30d": row.try_get::<f64, _>("upcoming_30d").unwrap_or(0.0),
            "upcoming_7d": row.try_get::<f64, _>("upcoming_7d").unwrap_or(0.0),
            "new_bookings_7d": row.try_get::<f64, _>("new_bookings_7d").unwrap_or(0.0),
            "new_bookings_30d": row.try_get::<f64, _>("new_bookings_30d").unwrap_or(0.0),
        }),
        _ => return,
    };

    sqlx::query(
        "INSERT INTO ml_features (organization_id, feature_set, entity_id, features, computed_at)
         VALUES ($1::uuid, 'demand', $1, $2::jsonb, now())
         ON CONFLICT (organization_id, feature_set, entity_id)
         DO UPDATE SET features = EXCLUDED.features, computed_at = now()",
    )
    .bind(org_id)
    .bind(&features_json)
    .execute(pool)
    .await
    .ok();
}

/// S23: Train elasticity model from historical reservation data.
/// Uses simple linear regression: price vs occupancy rate.
pub async fn train_elasticity_model(pool: &sqlx::PgPool, org_id: &str) -> Option<f64> {
    // Gather monthly price-occupancy pairs
    let rows: Vec<(f64, f64)> = sqlx::query_as(
        "WITH monthly AS (
            SELECT
                date_trunc('month', r.check_in_date) AS month,
                AVG(r.total_amount / NULLIF(r.check_out_date - r.check_in_date, 0))::float8 AS avg_nightly_rate,
                COUNT(*)::float8 / NULLIF((SELECT COUNT(*)::float8 FROM units WHERE organization_id = $1::uuid), 0) AS occupancy_proxy
            FROM reservations r
            WHERE r.organization_id = $1::uuid
              AND r.status = 'confirmed'
              AND r.check_in_date >= CURRENT_DATE - 365
            GROUP BY date_trunc('month', r.check_in_date)
            HAVING AVG(r.total_amount / NULLIF(r.check_out_date - r.check_in_date, 0)) > 0
        )
        SELECT avg_nightly_rate, occupancy_proxy FROM monthly ORDER BY month",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if rows.len() < 3 {
        return None; // Not enough data
    }

    // Simple linear regression: occupancy = a + b * price
    let n = rows.len() as f64;
    let sum_x: f64 = rows.iter().map(|(x, _)| x).sum();
    let sum_y: f64 = rows.iter().map(|(_, y)| y).sum();
    let sum_xy: f64 = rows.iter().map(|(x, y)| x * y).sum();
    let sum_x2: f64 = rows.iter().map(|(x, _)| x * x).sum();

    let denom = n * sum_x2 - sum_x * sum_x;
    if denom.abs() < 1e-10 {
        return None;
    }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let mean_price = sum_x / n;
    let mean_occ = sum_y / n;

    // Elasticity = (dOcc/dPrice) * (Price/Occ)
    let elasticity = if mean_occ.abs() > 1e-10 {
        slope * (mean_price / mean_occ)
    } else {
        -0.8
    };

    // Clamp to reasonable range
    let elasticity = elasticity.clamp(-3.0, 0.0);

    // Deactivate old models
    sqlx::query(
        "UPDATE ml_models SET is_active = false
         WHERE organization_id = $1::uuid AND model_type = 'price_elasticity'",
    )
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    // Get next version
    let version: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0)::int4 + 1
         FROM ml_models WHERE organization_id = $1::uuid AND model_type = 'price_elasticity'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(1);

    let r_squared = {
        let ss_res: f64 = rows
            .iter()
            .map(|(x, y)| {
                let predicted = mean_occ + slope * (x - mean_price);
                (y - predicted).powi(2)
            })
            .sum();
        let ss_tot: f64 = rows.iter().map(|(_, y)| (y - mean_occ).powi(2)).sum();
        if ss_tot > 1e-10 {
            1.0 - ss_res / ss_tot
        } else {
            0.0
        }
    };

    sqlx::query(
        "INSERT INTO ml_models (organization_id, model_type, version, parameters, metrics, is_active)
         VALUES ($1::uuid, 'price_elasticity', $2, $3::jsonb, $4::jsonb, true)",
    )
    .bind(org_id)
    .bind(version)
    .bind(json!({
        "elasticity": elasticity,
        "slope": slope,
        "mean_price": mean_price,
        "mean_occupancy": mean_occ,
        "data_points": rows.len(),
    }))
    .bind(json!({
        "r_squared": (r_squared * 10000.0).round() / 10000.0,
        "data_months": rows.len(),
    }))
    .execute(pool)
    .await
    .ok();

    Some(elasticity)
}

/// Get the active elasticity from ML model, or None if no model exists.
pub async fn get_active_elasticity(pool: &sqlx::PgPool, org_id: &str) -> Option<f64> {
    let params: Option<Value> = sqlx::query_scalar(
        "SELECT parameters FROM ml_models
         WHERE organization_id = $1::uuid AND model_type = 'price_elasticity' AND is_active = true
         ORDER BY trained_at DESC LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    params.and_then(|p| p.get("elasticity").and_then(Value::as_f64))
}

/// S23: Record a prediction outcome for the feedback loop.
pub async fn record_outcome(
    pool: &sqlx::PgPool,
    org_id: &str,
    prediction_id: Option<&str>,
    predicted: f64,
    actual: f64,
    feedback_type: &str,
) {
    sqlx::query(
        "INSERT INTO ml_outcomes (organization_id, prediction_id, predicted_value, actual_value, feedback_type)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)",
    )
    .bind(org_id)
    .bind(prediction_id)
    .bind(predicted)
    .bind(actual)
    .bind(feedback_type)
    .execute(pool)
    .await
    .ok();
}

/// Compute all features for all active organizations.
pub async fn compute_all_features(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    let org_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true LIMIT 100")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let mut computed = 0u32;
    for (org_id,) in &org_ids {
        compute_pricing_features(pool, org_id).await;
        compute_demand_features(pool, org_id).await;
        // Also try to train elasticity model if enough data
        train_elasticity_model(pool, org_id).await;
        computed += 1;
    }

    if computed > 0 {
        tracing::info!(
            orgs = computed,
            "ML pipeline: features computed and models trained"
        );
    }
}
