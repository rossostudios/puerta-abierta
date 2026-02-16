use axum::extract::State;
use axum::Json;
use chrono::Utc;
use serde_json::{json, Value};
use std::time::Duration;

use crate::state::AppState;

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let db_ok = if let Some(pool) = &state.db_pool {
        // Wrap in a short timeout so the healthcheck always responds quickly,
        // even if the first DB connection hangs (e.g. DNS, SSL, TCP).
        match tokio::time::timeout(
            Duration::from_secs(3),
            sqlx::query("SELECT 1").fetch_one(pool),
        )
        .await
        {
            Ok(Ok(_)) => true,
            Ok(Err(e)) => {
                tracing::error!(error = %e, "Health check DB query failed");
                false
            }
            Err(_) => {
                tracing::error!("Health check DB query timed out (3s)");
                false
            }
        }
    } else {
        true // no DB configured — skip check
    };

    let status = if db_ok { "ok" } else { "degraded" };
    Json(json!({
        "status": status,
        "now": Utc::now().to_rfc3339(),
        "db": db_ok
    }))
}
