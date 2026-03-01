use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::Utc;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn live() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "now": Utc::now().to_rfc3339(),
    }))
}

pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    readiness_response(&state).await
}

// Backward-compatible alias. Same payload as /ready so callers can inspect db/schema state.
pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    readiness_response(&state).await
}

pub async fn cache_stats(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "org_membership": { "entries": state.org_membership_cache.entry_count() },
        "public_listings": { "entries": state.public_listings_cache.entry_count() },
        "report_response": { "entries": state.report_response_cache.entry_count() },
        "enrichment": { "entries": state.enrichment_cache.entry_count() },
        "agent_config": { "entries": state.agent_config_cache.entry_count() },
        "fx": { "entries": state.fx_cache.entry_count() },
    }))
}

async fn readiness_response(state: &AppState) -> (StatusCode, Json<Value>) {
    let report = state.api_readiness_report().await;
    let status = if report.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(json!({
            "status": report.status,
            "ready": report.ready,
            "db": report.db,
            "schema": report.schema,
            "code": report.code,
            "detail": report.detail,
            "retryable": report.retryable,
            "missing_columns": report.missing_columns,
            "now": Utc::now().to_rfc3339(),
        })),
    )
}
