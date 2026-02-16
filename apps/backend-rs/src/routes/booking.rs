use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde_json::{json, Map, Value};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows},
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/booking/{org_slug}",
            axum::routing::get(get_booking_page),
        )
        .route(
            "/public/booking/{org_slug}/availability",
            axum::routing::get(check_availability),
        )
        .route(
            "/public/booking/{org_slug}/reserve",
            axum::routing::post(create_booking),
        )
}

#[derive(Debug, serde::Deserialize)]
struct OrgSlugPath {
    org_slug: String,
}

#[derive(Debug, serde::Deserialize)]
struct AvailabilityQuery {
    unit_id: Option<String>,
    start: String,
    end: String,
}

#[derive(Debug, serde::Deserialize)]
struct CreateBookingInput {
    unit_id: String,
    check_in_date: String,
    check_out_date: String,
    guest_full_name: String,
    guest_email: Option<String>,
    guest_phone_e164: Option<String>,
    notes: Option<String>,
    num_guests: Option<i32>,
}

/// Get the public booking page data for an organization.
async fn get_booking_page(
    State(state): State<AppState>,
    Path(path): Path<OrgSlugPath>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let org = find_org_by_slug(pool, &path.org_slug).await?;
    let org_id = val_str(&org, "id");
    let booking_enabled = org
        .as_object()
        .and_then(|o| o.get("booking_enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !booking_enabled {
        return Err(AppError::NotFound(
            "Booking is not enabled for this organization.".to_string(),
        ));
    }

    // Get published units via integrations (marketplace listings)
    let mut unit_filters = Map::new();
    unit_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.clone()),
    );
    let units = list_rows(pool, "units", Some(&unit_filters), 100, 0, "name", true)
        .await
        .unwrap_or_default();

    Ok(Json(json!({
        "organization": {
            "id": org_id,
            "name": val_str(&org, "name"),
            "org_slug": val_str(&org, "org_slug"),
            "brand_color": val_str(&org, "brand_color"),
            "logo_url": val_str(&org, "logo_url"),
        },
        "units": units,
    })))
}

/// Check availability for a date range.
async fn check_availability(
    State(state): State<AppState>,
    Path(path): Path<OrgSlugPath>,
    Query(query): Query<AvailabilityQuery>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let org = find_org_by_slug(pool, &path.org_slug).await?;
    let org_id = val_str(&org, "id");

    let start = NaiveDate::parse_from_str(&query.start, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid start date.".to_string()))?;
    let end = NaiveDate::parse_from_str(&query.end, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid end date.".to_string()))?;

    if end <= start {
        return Err(AppError::BadRequest(
            "End date must be after start date.".to_string(),
        ));
    }

    // Get reservations in the date range
    let mut res_filters = Map::new();
    res_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.clone()),
    );
    if let Some(unit_id) = &query.unit_id {
        res_filters.insert("unit_id".to_string(), Value::String(unit_id.clone()));
    }
    let reservations = list_rows(
        pool,
        "reservations",
        Some(&res_filters),
        500,
        0,
        "check_in_date",
        true,
    )
    .await
    .unwrap_or_default();

    // Filter to active reservations that overlap with the requested range
    let active_statuses = ["pending", "confirmed", "checked_in"];
    let blocked_ranges: Vec<Value> = reservations
        .iter()
        .filter_map(|r| {
            let obj = r.as_object()?;
            let status = obj.get("status")?.as_str()?;
            if !active_statuses.contains(&status) {
                return None;
            }
            let ci = NaiveDate::parse_from_str(obj.get("check_in_date")?.as_str()?, "%Y-%m-%d").ok()?;
            let co = NaiveDate::parse_from_str(obj.get("check_out_date")?.as_str()?, "%Y-%m-%d").ok()?;

            // Check overlap
            if co <= start || ci >= end {
                return None;
            }
            Some(json!({
                "unit_id": obj.get("unit_id"),
                "check_in_date": ci.to_string(),
                "check_out_date": co.to_string(),
            }))
        })
        .collect();

    // Determine which units are available for the full range
    let mut unit_filters = Map::new();
    unit_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id),
    );
    let all_units = list_rows(pool, "units", Some(&unit_filters), 100, 0, "name", true)
        .await
        .unwrap_or_default();

    let blocked_unit_ids: std::collections::HashSet<String> = blocked_ranges
        .iter()
        .filter_map(|r| r.get("unit_id").and_then(Value::as_str).map(ToOwned::to_owned))
        .collect();

    let available_units: Vec<&Value> = all_units
        .iter()
        .filter(|u| {
            let uid = u
                .as_object()
                .and_then(|o| o.get("id"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            !blocked_unit_ids.contains(uid)
        })
        .collect();

    Ok(Json(json!({
        "start": query.start,
        "end": query.end,
        "available_units": available_units,
        "blocked_ranges": blocked_ranges,
    })))
}

/// Create a booking (reservation + guest) from the public booking page.
async fn create_booking(
    State(state): State<AppState>,
    Path(path): Path<OrgSlugPath>,
    Json(payload): Json<CreateBookingInput>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;

    let org = find_org_by_slug(pool, &path.org_slug).await?;
    let org_id = val_str(&org, "id");
    let booking_enabled = org
        .as_object()
        .and_then(|o| o.get("booking_enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !booking_enabled {
        return Err(AppError::Forbidden(
            "Booking is not enabled for this organization.".to_string(),
        ));
    }

    // Validate dates
    let check_in = NaiveDate::parse_from_str(&payload.check_in_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid check-in date.".to_string()))?;
    let check_out = NaiveDate::parse_from_str(&payload.check_out_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid check-out date.".to_string()))?;
    if check_out <= check_in {
        return Err(AppError::BadRequest(
            "Check-out must be after check-in.".to_string(),
        ));
    }

    // Check for overlapping active reservations
    let mut res_filters = Map::new();
    res_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.clone()),
    );
    res_filters.insert(
        "unit_id".to_string(),
        Value::String(payload.unit_id.clone()),
    );
    let existing = list_rows(pool, "reservations", Some(&res_filters), 500, 0, "check_in_date", true)
        .await
        .unwrap_or_default();

    let has_overlap = existing.iter().any(|r| {
        let obj = match r.as_object() {
            Some(o) => o,
            None => return false,
        };
        let status = obj
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !["pending", "confirmed", "checked_in"].contains(&status) {
            return false;
        }
        let ci = obj
            .get("check_in_date")
            .and_then(Value::as_str)
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        let co = obj
            .get("check_out_date")
            .and_then(Value::as_str)
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        match (ci, co) {
            (Some(ci), Some(co)) => !(check_out <= ci || check_in >= co),
            _ => false,
        }
    });

    if has_overlap {
        return Err(AppError::Conflict(
            "Selected dates overlap with an existing reservation.".to_string(),
        ));
    }

    // Create or find guest
    let mut guest_payload = Map::new();
    guest_payload.insert(
        "organization_id".to_string(),
        Value::String(org_id.clone()),
    );
    guest_payload.insert(
        "full_name".to_string(),
        Value::String(payload.guest_full_name.clone()),
    );
    if let Some(email) = &payload.guest_email {
        guest_payload.insert("email".to_string(), Value::String(email.clone()));
    }
    if let Some(phone) = &payload.guest_phone_e164 {
        guest_payload.insert("phone_e164".to_string(), Value::String(phone.clone()));
    }
    guest_payload.insert(
        "source".to_string(),
        Value::String("direct_booking".to_string()),
    );
    let guest = create_row(pool, "guests", &guest_payload).await?;
    let guest_id = val_str(&guest, "id");

    // Resolve unit → property_id
    let unit = get_row(pool, "units", &payload.unit_id, "id").await.ok();
    let property_id = unit
        .as_ref()
        .map(|u| val_str(u, "property_id"))
        .unwrap_or_default();

    // Create reservation
    let mut reservation_payload = Map::new();
    reservation_payload.insert(
        "organization_id".to_string(),
        Value::String(org_id),
    );
    if !property_id.is_empty() {
        reservation_payload.insert(
            "property_id".to_string(),
            Value::String(property_id),
        );
    }
    reservation_payload.insert(
        "unit_id".to_string(),
        Value::String(payload.unit_id),
    );
    reservation_payload.insert("guest_id".to_string(), Value::String(guest_id));
    reservation_payload.insert(
        "check_in_date".to_string(),
        Value::String(payload.check_in_date),
    );
    reservation_payload.insert(
        "check_out_date".to_string(),
        Value::String(payload.check_out_date),
    );
    reservation_payload.insert(
        "status".to_string(),
        Value::String("pending".to_string()),
    );
    reservation_payload.insert(
        "source".to_string(),
        Value::String("direct_booking".to_string()),
    );
    if let Some(notes) = payload.notes {
        reservation_payload.insert("notes".to_string(), Value::String(notes));
    }
    if let Some(num) = payload.num_guests {
        reservation_payload.insert(
            "num_guests".to_string(),
            Value::Number(serde_json::Number::from(num)),
        );
    }

    let reservation = create_row(pool, "reservations", &reservation_payload).await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "reservation": reservation,
            "guest": guest,
        })),
    ))
}

async fn find_org_by_slug(pool: &sqlx::PgPool, slug: &str) -> AppResult<Value> {
    // Query organizations by org_slug
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM organizations t WHERE org_slug = $1 LIMIT 1",
    )
    .bind(slug)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    rows.into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("Organization with slug '{slug}' not found.")))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
