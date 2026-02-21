use serde_json::{json, Map, Value};
use sqlx::PgPool;

/// Record a usage event for billing/metering purposes.
pub async fn record_usage_event(
    pool: &PgPool,
    org_id: &str,
    event_type: &str,
    quantity: i64,
) {
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
