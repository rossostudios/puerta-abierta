use serde_json::{json, Map, Value};
use sqlx::PgPool;

/// Record a usage event for billing/metering purposes.
pub async fn record_usage_event(pool: &PgPool, org_id: &str, event_type: &str, quantity: i64) {
    let billing_period = chrono::Utc::now().format("%Y-%m").to_string();

    let result = sqlx::query(
        "INSERT INTO usage_events (organization_id, event_type, quantity, billing_period)
         VALUES ($1::uuid, $2, $3, $4)",
    )
    .bind(org_id)
    .bind(event_type)
    .bind(quantity)
    .bind(&billing_period)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!(
            org_id,
            event_type,
            error = %e,
            "Failed to record usage event"
        );
    }
}

/// Get usage summary for an organization for the current billing period.
pub async fn get_usage_summary(pool: &PgPool, org_id: &str) -> Value {
    let billing_period = chrono::Utc::now().format("%Y-%m").to_string();

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT event_type, COALESCE(SUM(quantity), 0)::bigint
         FROM usage_events
         WHERE organization_id = $1::uuid
           AND billing_period = $2
         GROUP BY event_type
         ORDER BY event_type",
    )
    .bind(org_id)
    .bind(&billing_period)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut usage = Map::new();
    for (event_type, total) in &rows {
        usage.insert(event_type.clone(), json!(total));
    }

    json!({
        "billing_period": billing_period,
        "usage": usage,
    })
}

/// S20: Get usage history over the last N months, broken down by event_type.
pub async fn get_usage_over_time(pool: &PgPool, org_id: &str, months: i32) -> Value {
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT billing_period, event_type, COALESCE(SUM(quantity), 0)::bigint AS total
         FROM usage_events
         WHERE organization_id = $1::uuid
           AND billing_period >= to_char(now() - ($2::int || ' months')::interval, 'YYYY-MM')
         GROUP BY billing_period, event_type
         ORDER BY billing_period, event_type",
    )
    .bind(org_id)
    .bind(months)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut periods: Map<String, Value> = Map::new();
    for (period, event_type, total) in &rows {
        let period_map = periods.entry(period.clone()).or_insert_with(|| json!({}));
        if let Some(obj) = period_map.as_object_mut() {
            obj.insert(event_type.clone(), json!(total));
        }
    }

    json!({
        "months": months,
        "periods": periods,
    })
}
