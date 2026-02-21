use axum::{
    body::Body,
    extract::{Path, State},
    http::{header::CONTENT_TYPE, HeaderMap, HeaderValue, Response, StatusCode},
};
use sha2::{Digest, Sha256};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::get_row,
    schemas::IcalPath,
    services::ical::build_unit_ical_export,
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route("/public/ical/{token}", axum::routing::get(export_ical))
}

async fn export_ical(
    State(state): State<AppState>,
    Path(path): Path<IcalPath>,
    headers: HeaderMap,
) -> AppResult<Response<Body>> {
    let raw_token = path.token.trim();
    let token = raw_token.strip_suffix(".ics").unwrap_or(raw_token);
    if token.is_empty() {
        return Err(AppError::BadRequest("Missing iCal token.".to_string()));
    }

    let pool = db_pool(&state)?;
    let listing = get_row(pool, "integrations", token, "ical_export_token").await?;

    if !is_active_listing(&listing) {
        return Err(AppError::NotFound("Listing is inactive.".to_string()));
    }

    let org_id = value_str(&listing, "organization_id");
    let unit_id = value_str(&listing, "unit_id");

    if org_id.is_empty() {
        return Err(AppError::NotFound(
            "Listing missing organization context.".to_string(),
        ));
    }
    if unit_id.is_empty() {
        return Err(AppError::NotFound(
            "Listing missing unit context.".to_string(),
        ));
    }

    let calendar_name = listing
        .as_object()
        .and_then(|obj| obj.get("public_name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Casaora");

    let ics = build_unit_ical_export(pool, &org_id, &unit_id, calendar_name).await?;

    // Generate ETag from content hash
    let mut hasher = Sha256::new();
    hasher.update(ics.as_bytes());
    let hash = hasher.finalize();
    let etag = format!(
        "\"{}\"",
        hash[..16]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );

    // Support If-None-Match for efficient cache validation
    if let Some(if_none_match) = headers.get("if-none-match").and_then(|v| v.to_str().ok()) {
        if if_none_match == etag || if_none_match.trim_matches('"') == etag.trim_matches('"') {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .body(Body::empty())
                .map_err(|error| {
                    tracing::error!(error = %error, "Could not build 304 response");
                    AppError::Internal("Could not build response.".to_string())
                });
        }
    }

    let mut response = Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(ics))
        .map_err(|error| {
            tracing::error!(error = %error, "Could not build iCal response");
            AppError::Internal("Could not build iCal response.".to_string())
        })?;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/calendar; charset=utf-8"),
    );
    if let Ok(val) = HeaderValue::from_str(&etag) {
        headers.insert("etag", val);
    }
    headers.insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=1800"),
    );
    Ok(response)
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

fn is_active_listing(listing: &Value) -> bool {
    match listing.as_object().and_then(|obj| obj.get("is_active")) {
        None => true,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_i64().is_some_and(|value| value != 0),
        Some(Value::String(text)) => {
            let lowered = text.trim().to_ascii_lowercase();
            !(lowered == "false" || lowered == "0" || lowered == "off")
        }
        Some(_) => true,
    }
}
