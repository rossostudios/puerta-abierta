use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, BlockPath, CalendarAvailabilityQuery,
        CalendarBlocksQuery, CreateCalendarBlockInput, UpdateCalendarBlockInput,
    },
    services::{audit::write_audit_log, enrichment::enrich_calendar_blocks},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const ACTIVE_BOOKING_STATUSES: &[&str] = &["pending", "confirmed", "checked_in"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/calendar/availability",
            axum::routing::get(calendar_availability),
        )
        .route(
            "/calendar/blocks",
            axum::routing::get(list_calendar_blocks).post(create_calendar_block),
        )
        .route(
            "/calendar/blocks/{block_id}",
            axum::routing::get(get_calendar_block)
                .patch(update_calendar_block)
                .delete(delete_calendar_block),
        )
}

async fn calendar_availability(
    State(state): State<AppState>,
    Query(query): Query<CalendarAvailabilityQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let window_start = parse_date(&query.from_date)?;
    let window_end = parse_date(&query.to_date)?;

    let mut unavailable: Vec<(String, String)> = Vec::new();

    // Fetch reservations and calendar blocks in parallel
    let res_filters = json_map(&[
        ("organization_id", Value::String(query.org_id.clone())),
        ("unit_id", Value::String(query.unit_id.clone())),
    ]);
    let block_filters = json_map(&[
        ("organization_id", Value::String(query.org_id.clone())),
        ("unit_id", Value::String(query.unit_id.clone())),
    ]);
    let (reservations, blocks) = tokio::try_join!(
        list_rows(
            pool,
            "reservations",
            Some(&res_filters),
            1000,
            0,
            "created_at",
            false
        ),
        list_rows(
            pool,
            "calendar_blocks",
            Some(&block_filters),
            1000,
            0,
            "created_at",
            false
        ),
    )?;

    for reservation in reservations {
        let Some(obj) = reservation.as_object() else {
            continue;
        };
        let status = value_string(obj.get("status")).unwrap_or_default();
        if !ACTIVE_BOOKING_STATUSES.contains(&status.as_str()) {
            continue;
        }
        let Some(check_in_raw) = value_string(obj.get("check_in_date")) else {
            continue;
        };
        let Some(check_out_raw) = value_string(obj.get("check_out_date")) else {
            continue;
        };
        let Ok(start) = parse_date(&check_in_raw) else {
            continue;
        };
        let Ok(end) = parse_date(&check_out_raw) else {
            continue;
        };

        if overlaps(window_start, window_end, start, end) {
            unavailable.push((check_in_raw, check_out_raw));
        }
    }

    for block in blocks {
        let Some(obj) = block.as_object() else {
            continue;
        };
        let Some(starts_on_raw) = value_string(obj.get("starts_on")) else {
            continue;
        };
        let Some(ends_on_raw) = value_string(obj.get("ends_on")) else {
            continue;
        };
        let Ok(start) = parse_date(&starts_on_raw) else {
            continue;
        };
        let Ok(end) = parse_date(&ends_on_raw) else {
            continue;
        };

        if overlaps(window_start, window_end, start, end) {
            unavailable.push((starts_on_raw, ends_on_raw));
        }
    }

    unavailable.sort_unstable();
    let periods = unavailable
        .into_iter()
        .map(|(from, to)| json!({ "from": from, "to": to }))
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "unit_id": query.unit_id,
        "from": query.from_date,
        "to": query.to_date,
        "unavailable_periods": periods
    })))
}

async fn list_calendar_blocks(
    State(state): State<AppState>,
    Query(query): Query<CalendarBlocksQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }

    let rows = list_rows(
        pool,
        "calendar_blocks",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "starts_on",
        true,
    )
    .await?;
    let enriched = enrich_calendar_blocks(&state, pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_calendar_block(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateCalendarBlockInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "operator"],
    )
    .await?;
    let pool = db_pool(&state)?;

    let starts_on = parse_date(&payload.starts_on)?;
    let ends_on = parse_date(&payload.ends_on)?;
    if ends_on <= starts_on {
        return Err(AppError::BadRequest(
            "ends_on must be later than starts_on.".to_string(),
        ));
    }

    let existing_blocks = list_rows(
        pool,
        "calendar_blocks",
        Some(&json_map(&[
            (
                "organization_id",
                Value::String(payload.organization_id.clone()),
            ),
            ("unit_id", Value::String(payload.unit_id.clone())),
        ])),
        1000,
        0,
        "created_at",
        false,
    )
    .await?;

    for block in existing_blocks {
        let Some(obj) = block.as_object() else {
            continue;
        };
        let Some(existing_starts) = value_string(obj.get("starts_on")) else {
            continue;
        };
        let Some(existing_ends) = value_string(obj.get("ends_on")) else {
            continue;
        };
        let Ok(start) = parse_date(&existing_starts) else {
            continue;
        };
        let Ok(end) = parse_date(&existing_ends) else {
            continue;
        };
        if overlaps(starts_on, ends_on, start, end) {
            return Err(AppError::Conflict(
                "Calendar block overlaps an existing block.".to_string(),
            ));
        }
    }

    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "calendar_blocks", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "calendar_blocks",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_calendar_block(
    State(state): State<AppState>,
    Path(path): Path<BlockPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "calendar_blocks", &path.block_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut enriched = enrich_calendar_blocks(&state, pool, vec![record], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_calendar_block(
    State(state): State<AppState>,
    Path(path): Path<BlockPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateCalendarBlockInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "calendar_blocks", &path.block_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    if patch.is_empty() {
        let mut enriched = enrich_calendar_blocks(&state, pool, vec![record], &org_id).await?;
        return Ok(Json(
            enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
        ));
    }

    let next_starts = parse_date(
        patch
            .get("starts_on")
            .and_then(Value::as_str)
            .unwrap_or_else(|| {
                record
                    .get("starts_on")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            }),
    )?;
    let next_ends = parse_date(
        patch
            .get("ends_on")
            .and_then(Value::as_str)
            .unwrap_or_else(|| record.get("ends_on").and_then(Value::as_str).unwrap_or("")),
    )?;
    if next_ends <= next_starts {
        return Err(AppError::BadRequest(
            "ends_on must be later than starts_on.".to_string(),
        ));
    }

    let updated = update_row(pool, "calendar_blocks", &path.block_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "calendar_blocks",
        Some(&path.block_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut enriched = enrich_calendar_blocks(&state, pool, vec![updated], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn delete_calendar_block(
    State(state): State<AppState>,
    Path(path): Path<BlockPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "calendar_blocks", &path.block_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let deleted = delete_row(pool, "calendar_blocks", &path.block_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "calendar_blocks",
        Some(&path.block_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}

fn overlaps(start_a: NaiveDate, end_a: NaiveDate, start_b: NaiveDate, end_b: NaiveDate) -> bool {
    !(end_a <= start_b || start_a >= end_b)
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid ISO date format.".to_string()))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database is not configured. Set DATABASE_URL.".to_string())
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

fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}
