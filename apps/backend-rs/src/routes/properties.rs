use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{
        count_rows, create_row, delete_row, get_row, list_rows, update_row,
    },
    schemas::{
        clamp_limit, remove_nulls, serialize_to_map, BulkImportPropertiesInput,
        BulkUpdateUnitsFilters, BulkUpdateUnitsInput, CreatePropertyInput, CreateUnitInput,
        PropertiesQuery, PropertyPath, UnitPath, UnitsQuery, UpdatePropertyInput, UpdateUnitInput,
    },
    services::{
        audit::write_audit_log,
        enrichment::enrich_units,
        plan_limits::{check_plan_limit, PlanResource},
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/properties",
            axum::routing::get(list_properties).post(create_property),
        )
        .route(
            "/properties/import-csv",
            axum::routing::post(bulk_import_properties),
        )
        .route(
            "/properties/{property_id}",
            axum::routing::get(get_property)
                .patch(update_property)
                .delete(delete_property),
        )
        .route(
            "/properties/{property_id}/hierarchy",
            axum::routing::get(get_property_hierarchy),
        )
        .route("/units/bulk-update", axum::routing::post(bulk_update_units))
        .route("/units", axum::routing::get(list_units).post(create_unit))
        .route(
            "/units/{unit_id}",
            axum::routing::get(get_unit)
                .patch(update_unit)
                .delete(delete_unit),
        )
}

async fn list_properties(
    State(state): State<AppState>,
    Query(query): Query<PropertiesQuery>,
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
    if let Some(status) = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert("status".to_string(), Value::String(status.to_string()));
    }
    if let Some(property_type) = query
        .property_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert(
            "property_type".to_string(),
            Value::String(property_type.to_ascii_lowercase()),
        );
    }
    if let Some(neighborhood) = query
        .neighborhood
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert(
            "neighborhood".to_string(),
            Value::String(neighborhood.to_string()),
        );
    }
    let rows = list_rows(
        pool,
        "properties",
        Some(&filters),
        clamp_limit(query.limit),
        0,
        "created_at",
        false,
    )
    .await?;
    Ok(Json(json!({ "data": rows })))
}

async fn create_property(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePropertyInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    check_plan_limit(pool, &payload.organization_id, PlanResource::Property).await?;

    let mut record = remove_nulls(serialize_to_map(&payload));
    normalize_property_payload_for_write(&mut record);
    let created = create_row(pool, "properties", &record).await?;
    let entity_id = value_str(&created, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "properties",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;
    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_property(
    State(state): State<AppState>,
    Path(path): Path<PropertyPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "properties", &path.property_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;
    Ok(Json(record))
}

async fn get_property_hierarchy(
    State(state): State<AppState>,
    Path(path): Path<PropertyPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let property = get_row(pool, "properties", &path.property_id, "id").await?;
    let org_id = value_str(&property, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let filters = json_map(&[
        ("organization_id", Value::String(org_id.clone())),
        ("property_id", Value::String(path.property_id.clone())),
    ]);

    let floors = list_rows(
        pool,
        "property_floors",
        Some(&filters),
        5_000,
        0,
        "created_at",
        true,
    )
    .await?;
    let units = list_rows(pool, "units", Some(&filters), 10_000, 0, "created_at", true).await?;
    let spaces = list_rows(
        pool,
        "unit_spaces",
        Some(&filters),
        20_000,
        0,
        "created_at",
        true,
    )
    .await?;
    let beds = list_rows(
        pool,
        "unit_beds",
        Some(&filters),
        30_000,
        0,
        "created_at",
        true,
    )
    .await?;

    let hierarchy = build_property_hierarchy(property, floors, units, spaces, beds);
    Ok(Json(hierarchy))
}

async fn update_property(
    State(state): State<AppState>,
    Path(path): Path<PropertyPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdatePropertyInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "properties", &path.property_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let mut patch = remove_nulls(serialize_to_map(&payload));
    normalize_property_payload_for_write(&mut patch);
    let updated = update_row(pool, "properties", &path.property_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "properties",
        Some(&path.property_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;
    Ok(Json(updated))
}

async fn delete_property(
    State(state): State<AppState>,
    Path(path): Path<PropertyPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "properties", &path.property_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let deleted = delete_row(pool, "properties", &path.property_id, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "properties",
        Some(&path.property_id),
        Some(deleted.clone()),
        None,
    )
    .await;
    Ok(Json(deleted))
}

async fn list_units(
    State(state): State<AppState>,
    Query(query): Query<UnitsQuery>,
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
    if let Some(property_id) = query
        .property_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert(
            "property_id".to_string(),
            Value::String(property_id.to_string()),
        );
    }
    if let Some(unit_type) = query
        .unit_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert(
            "unit_type".to_string(),
            Value::String(unit_type.to_ascii_lowercase()),
        );
    }
    if let Some(condition_status) = query
        .condition_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        filters.insert(
            "condition_status".to_string(),
            Value::String(condition_status.to_ascii_lowercase()),
        );
    }
    if let Some(floor_level) = query.floor_level {
        filters.insert("floor_level".to_string(), json!(floor_level));
    }
    let rows = list_rows(
        pool,
        "units",
        Some(&filters),
        clamp_limit(query.limit),
        0,
        "created_at",
        false,
    )
    .await?;
    let enriched = enrich_units(pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

const BULK_UPDATE_UNITS_APPLY_CAP: i64 = 500;
const BULK_UPDATE_UNITS_PREVIEW_CAP: i64 = 200;

async fn bulk_update_units(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BulkUpdateUnitsInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let filters = build_bulk_unit_filters(&payload.organization_id, &payload.filters)?;
    let matched_count = count_rows(pool, "units", Some(&filters)).await?;
    let mut patch = remove_nulls(serialize_to_map(&payload.patch));
    normalize_unit_payload_for_write(&mut patch);
    validate_bulk_unit_patch(&patch)?;

    if payload.dry_run {
        let preview_rows = list_rows(
            pool,
            "units",
            Some(&filters),
            BULK_UPDATE_UNITS_PREVIEW_CAP,
            0,
            "created_at",
            false,
        )
        .await?;
        let preview_ids = preview_rows
            .iter()
            .map(|row| value_str(row, "id"))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();

        return Ok(Json(json!({
            "dry_run": true,
            "matched_count": matched_count,
            "preview_count": preview_ids.len(),
            "preview_unit_ids": preview_ids,
            "apply_cap": BULK_UPDATE_UNITS_APPLY_CAP,
            "patch": Value::Object(patch),
        })));
    }

    if matched_count == 0 {
        return Ok(Json(json!({
            "dry_run": false,
            "matched_count": 0,
            "updated_count": 0,
            "failed_count": 0,
            "updated_unit_ids": [],
            "failures": [],
        })));
    }

    if matched_count > BULK_UPDATE_UNITS_APPLY_CAP {
        return Err(AppError::BadRequest(format!(
            "Bulk update matches {matched_count} units which exceeds the apply cap of {}. Re-run with dry_run=true and narrower filters.",
            BULK_UPDATE_UNITS_APPLY_CAP
        )));
    }

    let target_rows = list_rows(
        pool,
        "units",
        Some(&filters),
        matched_count.max(1),
        0,
        "created_at",
        false,
    )
    .await?;

    let sync_floor = patch.contains_key("floor_level");
    let sync_beds = patch.contains_key("bed_configuration") || patch.contains_key("beds_count");

    let mut updated_unit_ids: Vec<String> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    for unit in target_rows {
        let unit_id = value_str(&unit, "id");
        if unit_id.is_empty() {
            continue;
        }
        match update_row(pool, "units", &unit_id, &patch, "id").await {
            Ok(updated) => {
                if sync_floor || sync_beds {
                    if let Err(error) =
                        sync_unit_hierarchy_dual_write(pool, &updated, sync_floor, sync_beds).await
                    {
                        failures.push(json!({
                            "unit_id": unit_id,
                            "error": error.to_string(),
                        }));
                        continue;
                    }
                }
                updated_unit_ids.push(unit_id);
            }
            Err(error) => {
                failures.push(json!({
                    "unit_id": unit_id,
                    "error": error.to_string(),
                }));
            }
        }
    }

    let updated_count = updated_unit_ids.len() as i64;
    let failed_count = failures.len() as i64;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "bulk_update",
        "units",
        None,
        None,
        Some(json!({
            "matched_count": matched_count,
            "updated_count": updated_count,
            "failed_count": failed_count,
            "filters": Value::Object(filters),
            "patch": Value::Object(patch.clone()),
        })),
    )
    .await;

    Ok(Json(json!({
        "dry_run": false,
        "matched_count": matched_count,
        "updated_count": updated_count,
        "failed_count": failed_count,
        "updated_unit_ids": updated_unit_ids,
        "failures": failures,
        "patch": Value::Object(patch),
    })))
}

async fn create_unit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateUnitInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    check_plan_limit(pool, &payload.organization_id, PlanResource::Unit).await?;

    let code = payload.code.trim().to_string();
    if code.is_empty() {
        return Err(AppError::BadRequest("code is required.".to_string()));
    }

    let existing_units = list_rows(
        pool,
        "units",
        Some(&json_map(&[
            (
                "organization_id",
                Value::String(payload.organization_id.clone()),
            ),
            ("property_id", Value::String(payload.property_id.clone())),
        ])),
        2000,
        0,
        "created_at",
        false,
    )
    .await?;

    let existing_codes = existing_units
        .iter()
        .filter_map(|row| row.as_object())
        .filter_map(|obj| obj.get("code").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>();

    if contains_case_insensitive(&existing_codes, &code) {
        let suggestion = suggest_next_unit_code(&code, &existing_codes);
        return Err(AppError::Conflict(duplicate_unit_code_message(
            &code,
            &suggestion,
        )));
    }

    let mut payload_map = remove_nulls(serialize_to_map(&payload));
    payload_map.insert("code".to_string(), Value::String(code.clone()));
    normalize_unit_payload_for_write(&mut payload_map);

    let created = match create_row(pool, "units", &payload_map).await {
        Ok(value) => value,
        Err(AppError::BadRequest(message)) if message.to_lowercase().contains("duplicate") => {
            let refreshed_units = list_rows(
                pool,
                "units",
                Some(&json_map(&[
                    (
                        "organization_id",
                        Value::String(payload.organization_id.clone()),
                    ),
                    ("property_id", Value::String(payload.property_id.clone())),
                ])),
                2000,
                0,
                "created_at",
                false,
            )
            .await?;
            let refreshed_codes = refreshed_units
                .iter()
                .filter_map(|row| row.as_object())
                .filter_map(|obj| obj.get("code").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<std::collections::HashSet<_>>();
            let suggestion = suggest_next_unit_code(&code, &refreshed_codes);
            return Err(AppError::Conflict(duplicate_unit_code_message(
                &code,
                &suggestion,
            )));
        }
        Err(error) => return Err(error),
    };

    sync_unit_hierarchy_dual_write(pool, &created, true, true).await?;

    let entity_id = value_str(&created, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "units",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_unit(
    State(state): State<AppState>,
    Path(path): Path<UnitPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "units", &path.unit_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;
    let mut enriched = enrich_units(pool, vec![record], &org_id).await?;
    let first = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok(Json(first))
}

async fn update_unit(
    State(state): State<AppState>,
    Path(path): Path<UnitPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateUnitInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "units", &path.unit_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let mut patch = remove_nulls(serialize_to_map(&payload));
    normalize_unit_payload_for_write(&mut patch);
    let updated = update_row(pool, "units", &path.unit_id, &patch, "id").await?;
    let sync_floor = patch.contains_key("floor_level");
    let sync_beds = patch.contains_key("bed_configuration") || patch.contains_key("beds_count");
    if sync_floor || sync_beds {
        sync_unit_hierarchy_dual_write(pool, &updated, sync_floor, sync_beds).await?;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "units",
        Some(&path.unit_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn delete_unit(
    State(state): State<AppState>,
    Path(path): Path<UnitPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "units", &path.unit_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let deleted = delete_row(pool, "units", &path.unit_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "units",
        Some(&path.unit_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
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

fn contains_case_insensitive(values: &std::collections::HashSet<String>, needle: &str) -> bool {
    let lowered = needle.trim().to_lowercase();
    values.iter().any(|item| item.to_lowercase() == lowered)
}

fn suggest_next_unit_code(
    code: &str,
    existing_codes: &std::collections::HashSet<String>,
) -> String {
    let normalized_existing = existing_codes
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<std::collections::HashSet<_>>();
    let base_code = code.trim();
    if base_code.is_empty() {
        return "A1".to_string();
    }

    if !normalized_existing.contains(&base_code.to_lowercase()) {
        return base_code.to_string();
    }

    let mut split_idx = base_code.len();
    for (idx, character) in base_code.char_indices().rev() {
        if character.is_ascii_digit() {
            split_idx = idx;
        } else {
            break;
        }
    }
    if split_idx < base_code.len() {
        let prefix = &base_code[..split_idx];
        let digits = &base_code[split_idx..];
        if let Ok(current) = digits.parse::<i32>() {
            let width = digits.len();
            for next in (current + 1)..(current + 10_000) {
                let candidate = format!("{prefix}{:0width$}", next, width = width);
                if !normalized_existing.contains(&candidate.to_lowercase()) {
                    return candidate;
                }
            }
        }
    }

    for suffix in 2..10_000 {
        let candidate = format!("{base_code}-{suffix}");
        if !normalized_existing.contains(&candidate.to_lowercase()) {
            return candidate;
        }
    }

    format!("{base_code}-{}", normalized_existing.len() + 1)
}

fn duplicate_unit_code_message(code: &str, suggestion: &str) -> String {
    if !suggestion.trim().is_empty()
        && suggestion.trim().to_lowercase() != code.trim().to_lowercase()
    {
        return format!("Unit code '{code}' already exists for this property. Try '{suggestion}'.");
    }
    format!("Unit code '{code}' already exists for this property.")
}

fn build_property_hierarchy(
    property: Value,
    mut floors: Vec<Value>,
    mut units: Vec<Value>,
    mut spaces: Vec<Value>,
    mut beds: Vec<Value>,
) -> Value {
    let total_units = units.len();
    let total_spaces = spaces.len();
    let total_beds = beds.len();

    floors.sort_by(compare_floor_values);
    units.sort_by(compare_unit_values);
    spaces.sort_by(compare_space_values);
    beds.sort_by(compare_bed_values);

    let mut beds_by_space_id: HashMap<String, Vec<Value>> = HashMap::new();
    let mut unassigned_beds_by_unit: HashMap<String, Vec<Value>> = HashMap::new();
    for bed in beds {
        let unit_id = value_str(&bed, "unit_id");
        if unit_id.is_empty() {
            continue;
        }
        if let Some(space_id) = value_opt_str(&bed, "space_id") {
            beds_by_space_id.entry(space_id).or_default().push(bed);
        } else {
            unassigned_beds_by_unit
                .entry(unit_id)
                .or_default()
                .push(bed);
        }
    }
    for values in beds_by_space_id.values_mut() {
        values.sort_by(compare_bed_values);
    }
    for values in unassigned_beds_by_unit.values_mut() {
        values.sort_by(compare_bed_values);
    }

    let mut spaces_by_unit_id: HashMap<String, Vec<Value>> = HashMap::new();
    for mut space in spaces {
        let unit_id = value_str(&space, "unit_id");
        if unit_id.is_empty() {
            continue;
        }
        let space_id = value_str(&space, "id");
        let mut attached_beds = if space_id.is_empty() {
            Vec::new()
        } else {
            beds_by_space_id.remove(&space_id).unwrap_or_default()
        };
        attached_beds.sort_by(compare_bed_values);
        if let Some(object) = space.as_object_mut() {
            object.insert("beds".to_string(), Value::Array(attached_beds));
        }
        spaces_by_unit_id.entry(unit_id).or_default().push(space);
    }
    for values in spaces_by_unit_id.values_mut() {
        values.sort_by(compare_space_values);
    }

    for orphaned in beds_by_space_id.into_values() {
        for bed in orphaned {
            let unit_id = value_str(&bed, "unit_id");
            if unit_id.is_empty() {
                continue;
            }
            unassigned_beds_by_unit
                .entry(unit_id)
                .or_default()
                .push(bed);
        }
    }
    for values in unassigned_beds_by_unit.values_mut() {
        values.sort_by(compare_bed_values);
    }

    let mut floor_id_by_number: HashMap<i16, String> = HashMap::new();
    for floor in &floors {
        let floor_id = value_str(floor, "id");
        if floor_id.is_empty() {
            continue;
        }
        if let Some(number) = value_i16(floor, "number") {
            floor_id_by_number.insert(number, floor_id);
        }
    }

    let mut units_by_floor_id: HashMap<String, Vec<Value>> = HashMap::new();
    let mut unassigned_units: Vec<Value> = Vec::new();
    for mut unit in units {
        let unit_id = value_str(&unit, "id");
        if unit_id.is_empty() {
            continue;
        }

        let mut unit_spaces = spaces_by_unit_id.remove(&unit_id).unwrap_or_default();
        unit_spaces.sort_by(compare_space_values);

        let mut unit_unassigned_beds = unassigned_beds_by_unit.remove(&unit_id).unwrap_or_default();
        unit_unassigned_beds.sort_by(compare_bed_values);

        if let Some(object) = unit.as_object_mut() {
            object.insert("spaces".to_string(), Value::Array(unit_spaces));
            object.insert(
                "unassigned_beds".to_string(),
                Value::Array(unit_unassigned_beds),
            );
        }

        if let Some(floor_level) = value_i16(&unit, "floor_level") {
            if let Some(floor_id) = floor_id_by_number.get(&floor_level) {
                units_by_floor_id
                    .entry(floor_id.to_string())
                    .or_default()
                    .push(unit);
                continue;
            }
        }
        unassigned_units.push(unit);
    }

    for values in units_by_floor_id.values_mut() {
        values.sort_by(compare_unit_values);
    }
    unassigned_units.sort_by(compare_unit_values);

    let mut floor_nodes: Vec<Value> = Vec::with_capacity(floors.len());
    for mut floor in floors {
        let floor_id = value_str(&floor, "id");
        let mut floor_units = units_by_floor_id.remove(&floor_id).unwrap_or_default();
        floor_units.sort_by(compare_unit_values);
        if let Some(object) = floor.as_object_mut() {
            object.insert("units".to_string(), Value::Array(floor_units));
        }
        floor_nodes.push(floor);
    }

    for mut dangling_units in units_by_floor_id.into_values() {
        unassigned_units.append(&mut dangling_units);
    }
    unassigned_units.sort_by(compare_unit_values);
    let floor_count = floor_nodes.len();

    json!({
        "property": property,
        "floors": floor_nodes,
        "unassigned_units": unassigned_units,
        "counts": {
            "floors": floor_count,
            "units": total_units,
            "spaces": total_spaces,
            "beds": total_beds,
        }
    })
}

fn compare_floor_values(left: &Value, right: &Value) -> std::cmp::Ordering {
    floor_sort_key(left).cmp(&floor_sort_key(right))
}

fn compare_unit_values(left: &Value, right: &Value) -> std::cmp::Ordering {
    unit_sort_key(left).cmp(&unit_sort_key(right))
}

fn compare_space_values(left: &Value, right: &Value) -> std::cmp::Ordering {
    space_sort_key(left).cmp(&space_sort_key(right))
}

fn compare_bed_values(left: &Value, right: &Value) -> std::cmp::Ordering {
    bed_sort_key(left).cmp(&bed_sort_key(right))
}

fn floor_sort_key(value: &Value) -> (i64, i64, String) {
    (
        value_i64(value, "sort_order").unwrap_or(i64::MAX / 2),
        value_i64(value, "number").unwrap_or(i64::MAX / 2),
        value_str(value, "label").to_ascii_lowercase(),
    )
}

fn unit_sort_key(value: &Value) -> (i64, String, String) {
    (
        value_i64(value, "floor_level").unwrap_or(i64::MAX / 2),
        value_str(value, "code").to_ascii_lowercase(),
        value_str(value, "name").to_ascii_lowercase(),
    )
}

fn space_sort_key(value: &Value) -> (String, String) {
    (
        value_str(value, "name").to_ascii_lowercase(),
        value_str(value, "code").to_ascii_lowercase(),
    )
}

fn bed_sort_key(value: &Value) -> (i64, String, String) {
    (
        value_i64(value, "sort_order").unwrap_or(i64::MAX / 2),
        value_str(value, "code").to_ascii_lowercase(),
        value_str(value, "bed_type").to_ascii_lowercase(),
    )
}

async fn sync_unit_hierarchy_dual_write(
    pool: &sqlx::PgPool,
    unit: &Value,
    sync_floor: bool,
    sync_beds: bool,
) -> AppResult<()> {
    if sync_floor {
        ensure_property_floor_for_unit(pool, unit).await?;
    }
    if sync_beds {
        sync_unit_beds_for_unit(pool, unit).await?;
    }
    Ok(())
}

async fn ensure_property_floor_for_unit(pool: &sqlx::PgPool, unit: &Value) -> AppResult<()> {
    let Some(number) = value_i16(unit, "floor_level") else {
        return Ok(());
    };

    let org_id = value_str(unit, "organization_id");
    let property_id = value_str(unit, "property_id");
    if org_id.is_empty() || property_id.is_empty() {
        return Ok(());
    }

    let label = default_floor_label(number);
    let result = sqlx::query(
        "INSERT INTO property_floors (organization_id, property_id, label, number, sort_order)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)
         ON CONFLICT (property_id, number) DO NOTHING",
    )
    .bind(&org_id)
    .bind(&property_id)
    .bind(label)
    .bind(number)
    .bind(i32::from(number))
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(error) if is_undefined_table_error(&error) => {
            tracing::warn!("Skipping property_floors sync; table not available yet.");
            Ok(())
        }
        Err(error) => Err(AppError::Dependency(format!(
            "Failed to sync property floor metadata: {error}"
        ))),
    }
}

async fn sync_unit_beds_for_unit(pool: &sqlx::PgPool, unit: &Value) -> AppResult<()> {
    let org_id = value_str(unit, "organization_id");
    let property_id = value_str(unit, "property_id");
    let unit_id = value_str(unit, "id");
    if org_id.is_empty() || property_id.is_empty() || unit_id.is_empty() {
        return Ok(());
    }

    let bed_seeds = desired_unit_bed_seeds(unit);
    if bed_seeds.is_empty() {
        return Ok(());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::Dependency(format!("Failed to begin bed sync txn: {error}")))?;

    let delete_result = sqlx::query(
        "DELETE FROM unit_beds WHERE organization_id = $1::uuid AND unit_id = $2::uuid",
    )
    .bind(&org_id)
    .bind(&unit_id)
    .execute(&mut *tx)
    .await;

    if let Err(error) = delete_result {
        if is_undefined_table_error(&error) {
            let _ = tx.rollback().await;
            tracing::warn!("Skipping unit_beds sync; table not available yet.");
            return Ok(());
        }
        let _ = tx.rollback().await;
        return Err(AppError::Dependency(format!(
            "Failed to clear existing unit beds: {error}"
        )));
    }

    for bed in bed_seeds {
        let insert_result = sqlx::query(
            "INSERT INTO unit_beds (
                organization_id,
                property_id,
                unit_id,
                code,
                bed_type,
                status,
                sort_order,
                notes
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)",
        )
        .bind(&org_id)
        .bind(&property_id)
        .bind(&unit_id)
        .bind(&bed.code)
        .bind(&bed.bed_type)
        .bind(&bed.status)
        .bind(bed.sort_order)
        .bind(&bed.notes)
        .execute(&mut *tx)
        .await;

        if let Err(error) = insert_result {
            if is_undefined_table_error(&error) {
                let _ = tx.rollback().await;
                tracing::warn!("Skipping unit_beds sync; table not available yet.");
                return Ok(());
            }
            let _ = tx.rollback().await;
            return Err(AppError::Dependency(format!(
                "Failed to insert unit bed rows: {error}"
            )));
        }
    }

    tx.commit()
        .await
        .map_err(|error| AppError::Dependency(format!("Failed to commit bed sync txn: {error}")))?;

    Ok(())
}

#[derive(Debug, Clone)]
struct UnitBedSeed {
    code: String,
    bed_type: String,
    status: String,
    sort_order: i32,
    notes: Option<String>,
}

fn desired_unit_bed_seeds(unit: &Value) -> Vec<UnitBedSeed> {
    let mut seeds: Vec<UnitBedSeed> = Vec::new();

    if let Some(items) = value_array(unit, "bed_configuration") {
        for item in items {
            match item {
                Value::String(raw_type) => {
                    seeds.push(UnitBedSeed {
                        code: String::new(),
                        bed_type: normalize_bed_type(raw_type),
                        status: "available".to_string(),
                        sort_order: 0,
                        notes: None,
                    });
                }
                Value::Number(number) => {
                    if let Some(raw_count) = number.as_u64() {
                        let count = (raw_count as usize).clamp(1, 50);
                        for _ in 0..count {
                            seeds.push(UnitBedSeed {
                                code: String::new(),
                                bed_type: "single".to_string(),
                                status: "available".to_string(),
                                sort_order: 0,
                                notes: None,
                            });
                        }
                    }
                }
                Value::Object(object) => {
                    let count =
                        object_positive_usize(object, &["count", "quantity", "qty"]).unwrap_or(1);
                    let bed_type = object_string(object, &["bed_type", "type"])
                        .map(|value| normalize_bed_type(&value))
                        .unwrap_or_else(|| "single".to_string());
                    let status = object_string(object, &["status", "condition_status"])
                        .map(|value| normalize_bed_status(&value))
                        .unwrap_or_else(|| "available".to_string());
                    let explicit_code =
                        object_string(object, &["code", "bed_code", "label"]).unwrap_or_default();
                    let notes = object_string(object, &["notes"]);

                    for replica in 0..count.clamp(1, 50) {
                        let code = if replica == 0 {
                            explicit_code.clone()
                        } else {
                            String::new()
                        };
                        seeds.push(UnitBedSeed {
                            code,
                            bed_type: bed_type.clone(),
                            status: status.clone(),
                            sort_order: 0,
                            notes: notes.clone(),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    let beds_count = value_i64(unit, "beds_count").unwrap_or(1).clamp(1, 50) as usize;

    if seeds.is_empty() {
        for _ in 0..beds_count {
            seeds.push(UnitBedSeed {
                code: String::new(),
                bed_type: "single".to_string(),
                status: "available".to_string(),
                sort_order: 0,
                notes: None,
            });
        }
    } else if seeds.len() < beds_count {
        for _ in seeds.len()..beds_count {
            seeds.push(UnitBedSeed {
                code: String::new(),
                bed_type: "single".to_string(),
                status: "available".to_string(),
                sort_order: 0,
                notes: None,
            });
        }
    }

    let mut used_codes: HashSet<String> = HashSet::new();
    for (index, seed) in seeds.iter_mut().enumerate() {
        seed.sort_order = index as i32;
        let base_code = sanitize_bed_code(&seed.code);
        let mut candidate = if base_code.is_empty() {
            format!("BED-{}", index + 1)
        } else {
            base_code
        };
        let normalized = candidate.to_ascii_lowercase();
        if used_codes.contains(&normalized) {
            let original = candidate.clone();
            let mut suffix = 2;
            while used_codes.contains(&candidate.to_ascii_lowercase()) {
                candidate = format!("{original}-{suffix}");
                suffix += 1;
            }
        }
        used_codes.insert(candidate.to_ascii_lowercase());
        seed.code = candidate;
    }

    seeds
}

fn default_floor_label(number: i16) -> String {
    if number == 0 {
        return "Ground Floor".to_string();
    }
    if number < 0 {
        return format!("Basement {}", number.abs());
    }
    format!("Floor {number}")
}

fn sanitize_bed_code(code: &str) -> String {
    let candidate = code.trim();
    if candidate.is_empty() {
        return String::new();
    }
    let mut output = String::with_capacity(candidate.len());
    for character in candidate.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            output.push(character.to_ascii_uppercase());
        } else if character.is_whitespace() {
            output.push('-');
        }
    }
    output.trim_matches('-').to_string()
}

fn normalize_bed_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "single" => "single".to_string(),
        "twin" => "twin".to_string(),
        "double" => "double".to_string(),
        "queen" => "queen".to_string(),
        "king" => "king".to_string(),
        "bunk" | "bunk bed" | "bunk_bed" => "bunk".to_string(),
        "sofa_bed" | "sofabed" | "sofa bed" | "sofa" => "sofa_bed".to_string(),
        "other" => "other".to_string(),
        _ => "single".to_string(),
    }
}

fn normalize_bed_status(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "available" => "available".to_string(),
        "occupied" => "occupied".to_string(),
        "reserved" => "reserved".to_string(),
        "dirty" => "dirty".to_string(),
        "inspecting" => "inspecting".to_string(),
        "out_of_order" => "out_of_order".to_string(),
        "blocked" => "blocked".to_string(),
        "clean" => "available".to_string(),
        _ => "available".to_string(),
    }
}

fn object_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn object_positive_usize(object: &Map<String, Value>, keys: &[&str]) -> Option<usize> {
    for key in keys {
        let Some(value) = object.get(*key) else {
            continue;
        };
        let candidate = match value {
            Value::Number(number) => number.as_i64().and_then(|parsed| {
                if parsed > 0 {
                    usize::try_from(parsed).ok()
                } else {
                    None
                }
            }),
            Value::String(text) => text
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|parsed| *parsed > 0),
            _ => None,
        };
        if candidate.is_some() {
            return candidate;
        }
    }
    None
}

fn value_opt_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn value_i64(row: &Value, key: &str) -> Option<i64> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| match value {
            Value::Number(number) => number
                .as_i64()
                .or_else(|| number.as_f64().map(|parsed| parsed as i64)),
            Value::String(text) => text.trim().parse::<i64>().ok(),
            _ => None,
        })
}

fn value_i16(row: &Value, key: &str) -> Option<i16> {
    value_i64(row, key).and_then(|value| i16::try_from(value).ok())
}

fn value_array<'a>(row: &'a Value, key: &str) -> Option<&'a Vec<Value>> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_array)
}

fn is_undefined_table_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::Database(db_error) => db_error.code().as_deref() == Some("42P01"),
        _ => false,
    }
}

fn build_bulk_unit_filters(
    organization_id: &str,
    filters: &BulkUpdateUnitsFilters,
) -> AppResult<Map<String, Value>> {
    let mut built = Map::new();
    built.insert(
        "organization_id".to_string(),
        Value::String(organization_id.to_string()),
    );

    let mut has_scope_filter = false;
    if let Some(property_id) = filters
        .property_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        built.insert(
            "property_id".to_string(),
            Value::String(property_id.to_string()),
        );
        has_scope_filter = true;
    }

    if let Some(unit_ids) = &filters.unit_ids {
        let normalized_ids = unit_ids
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| Value::String(value.to_string()))
            .collect::<Vec<_>>();
        if !normalized_ids.is_empty() {
            built.insert("id".to_string(), Value::Array(normalized_ids));
            has_scope_filter = true;
        }
    }

    if let Some(floor_level) = filters.floor_level {
        built.insert("floor_level".to_string(), json!(floor_level));
        has_scope_filter = true;
    }
    if let Some(unit_type) = filters
        .unit_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        built.insert(
            "unit_type".to_string(),
            Value::String(unit_type.to_ascii_lowercase()),
        );
        has_scope_filter = true;
    }
    if let Some(condition_status) = filters
        .condition_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        built.insert(
            "condition_status".to_string(),
            Value::String(condition_status.to_ascii_lowercase()),
        );
        has_scope_filter = true;
    }
    if let Some(bedrooms) = filters.bedrooms {
        built.insert("bedrooms".to_string(), json!(bedrooms));
        has_scope_filter = true;
    }
    if let Some(is_active) = filters.is_active {
        built.insert("is_active".to_string(), Value::Bool(is_active));
        has_scope_filter = true;
    }

    if !has_scope_filter {
        return Err(AppError::BadRequest(
            "At least one filter is required for bulk unit updates.".to_string(),
        ));
    }

    Ok(built)
}

fn validate_bulk_unit_patch(patch: &Map<String, Value>) -> AppResult<()> {
    if patch.is_empty() {
        return Err(AppError::BadRequest(
            "Patch payload is empty. Provide fields to update.".to_string(),
        ));
    }

    if let Some(unit_type) = patch.get("unit_type").and_then(Value::as_str) {
        let allowed = ["entire_place", "private_room", "shared_room", "bed"];
        if !allowed.contains(&unit_type) {
            return Err(AppError::BadRequest(format!(
                "Invalid unit_type '{unit_type}'. Allowed: {}",
                allowed.join(", ")
            )));
        }
    }

    if let Some(condition_status) = patch.get("condition_status").and_then(Value::as_str) {
        let allowed = ["clean", "dirty", "inspecting", "out_of_order"];
        if !allowed.contains(&condition_status) {
            return Err(AppError::BadRequest(format!(
                "Invalid condition_status '{condition_status}'. Allowed: {}",
                allowed.join(", ")
            )));
        }
    }

    if let Some(floor_level) = patch.get("floor_level").and_then(Value::as_i64) {
        if !(-20..=200).contains(&floor_level) {
            return Err(AppError::BadRequest(
                "floor_level must be between -20 and 200.".to_string(),
            ));
        }
    }

    for key in [
        "base_price_nightly",
        "base_price_monthly",
        "default_nightly_rate",
        "default_cleaning_fee",
    ] {
        if let Some(number) = patch.get(key).and_then(Value::as_f64) {
            if number < 0.0 {
                return Err(AppError::BadRequest(format!(
                    "{key} must be greater than or equal to 0."
                )));
            }
        }
    }

    Ok(())
}

/// Bulk import properties from a JSON array (parsed from CSV on the frontend).
async fn bulk_import_properties(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BulkImportPropertiesInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let mut results: Vec<Value> = Vec::new();
    let mut succeeded = 0u32;
    let mut failed = 0u32;

    for (i, row) in payload.rows.iter().enumerate() {
        let name = row.name.trim();
        if name.is_empty() {
            results.push(json!({
                "index": i,
                "ok": false,
                "error": "Name is required",
            }));
            failed += 1;
            continue;
        }

        let mut record = Map::new();
        record.insert(
            "organization_id".to_string(),
            Value::String(payload.organization_id.clone()),
        );
        record.insert("name".to_string(), Value::String(name.to_string()));

        if let Some(ref code) = row.code {
            let code = code.trim();
            if !code.is_empty() {
                record.insert("code".to_string(), Value::String(code.to_string()));
            }
        }
        if let Some(ref addr) = row.address_line1 {
            let addr = addr.trim();
            if !addr.is_empty() {
                record.insert("address_line1".to_string(), Value::String(addr.to_string()));
            }
        }
        if let Some(ref city) = row.city {
            let city = city.trim();
            if !city.is_empty() {
                record.insert("city".to_string(), Value::String(city.to_string()));
            }
        }
        if let Some(ref address_line2) = row.address_line2 {
            let value = address_line2.trim();
            if !value.is_empty() {
                record.insert(
                    "address_line2".to_string(),
                    Value::String(value.to_string()),
                );
            }
        }
        if let Some(ref region) = row.region {
            let value = region.trim();
            if !value.is_empty() {
                record.insert("region".to_string(), Value::String(value.to_string()));
            }
        }
        if let Some(ref neighborhood) = row.neighborhood {
            let value = neighborhood.trim();
            if !value.is_empty() {
                record.insert("neighborhood".to_string(), Value::String(value.to_string()));
            }
        }
        if let Some(ref postal_code) = row.postal_code {
            let value = postal_code.trim();
            if !value.is_empty() {
                record.insert("postal_code".to_string(), Value::String(value.to_string()));
            }
        }
        if let Some(ref cc) = row.country_code {
            let cc = cc.trim();
            if !cc.is_empty() {
                record.insert("country_code".to_string(), Value::String(cc.to_string()));
            }
        }
        if let Some(lat) = row.latitude {
            record.insert(
                "latitude".to_string(),
                Value::Number(
                    serde_json::Number::from_f64(lat)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                ),
            );
        }
        if let Some(lng) = row.longitude {
            record.insert(
                "longitude".to_string(),
                Value::Number(
                    serde_json::Number::from_f64(lng)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                ),
            );
        }
        if let Some(ref property_type) = row.property_type {
            let value = property_type.trim();
            if !value.is_empty() {
                record.insert(
                    "property_type".to_string(),
                    Value::String(value.to_ascii_lowercase()),
                );
            }
        }
        if let Some(ref owner_name) = row.asset_owner_name {
            let value = owner_name.trim();
            if !value.is_empty() {
                record.insert(
                    "asset_owner_name".to_string(),
                    Value::String(value.to_string()),
                );
            }
        }

        normalize_property_payload_for_write(&mut record);

        match create_row(pool, "properties", &record).await {
            Ok(_created) => {
                results.push(json!({ "index": i, "ok": true }));
                succeeded += 1;
            }
            Err(err) => {
                results.push(json!({
                    "index": i,
                    "ok": false,
                    "error": err.to_string(),
                }));
                failed += 1;
            }
        }
    }

    write_audit_log(
        Some(pool),
        Some(&payload.organization_id),
        Some(&user_id),
        "bulk_import",
        "property",
        None,
        None,
        Some(json!({ "total": payload.rows.len(), "succeeded": succeeded, "failed": failed })),
    )
    .await;

    Ok(Json(json!({
        "total": payload.rows.len(),
        "succeeded": succeeded,
        "failed": failed,
        "rows": results,
    })))
}

fn normalize_unit_payload_for_write(payload: &mut Map<String, Value>) {
    normalize_lowercase_string(payload, "unit_type");
    normalize_lowercase_string(payload, "condition_status");
    normalize_uppercase_string(payload, "currency");
    mirror_alias_value(payload, "base_price_nightly", "default_nightly_rate");
    mirror_alias_value(payload, "area_sqm", "square_meters");
}

fn mirror_alias_value(payload: &mut Map<String, Value>, canonical_key: &str, legacy_key: &str) {
    let canonical = payload.get(canonical_key).cloned();
    let legacy = payload.get(legacy_key).cloned();

    match (canonical, legacy) {
        (Some(value), Some(_)) => {
            payload.insert(legacy_key.to_string(), value.clone());
            payload.insert(canonical_key.to_string(), value);
        }
        (Some(value), None) => {
            payload.insert(legacy_key.to_string(), value);
        }
        (None, Some(value)) => {
            payload.insert(canonical_key.to_string(), value);
        }
        (None, None) => {}
    }
}

fn normalize_property_payload_for_write(payload: &mut Map<String, Value>) {
    normalize_lowercase_string(payload, "property_type");
    normalize_uppercase_string(payload, "country_code");
}

fn normalize_lowercase_string(payload: &mut Map<String, Value>, key: &str) {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_ascii_lowercase);

    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

fn normalize_uppercase_string(payload: &mut Map<String, Value>, key: &str) {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_ascii_uppercase);

    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_bulk_unit_filters, build_property_hierarchy, default_floor_label,
        desired_unit_bed_seeds, normalize_property_payload_for_write,
        normalize_unit_payload_for_write, validate_bulk_unit_patch,
    };
    use crate::schemas::BulkUpdateUnitsFilters;
    use serde_json::{json, Map, Value};

    #[test]
    fn normalizes_property_type_and_country_code() {
        let mut payload = Map::new();
        payload.insert(
            "property_type".to_string(),
            Value::String("Co_Living_House".to_string()),
        );
        payload.insert("country_code".to_string(), Value::String("py".to_string()));

        normalize_property_payload_for_write(&mut payload);

        assert_eq!(
            payload.get("property_type").and_then(Value::as_str),
            Some("co_living_house")
        );
        assert_eq!(
            payload.get("country_code").and_then(Value::as_str),
            Some("PY")
        );
    }

    #[test]
    fn mirrors_unit_alias_fields() {
        let mut payload = Map::new();
        payload.insert("base_price_nightly".to_string(), json!(250000));
        payload.insert("area_sqm".to_string(), json!(56.5));
        payload.insert("unit_type".to_string(), Value::String("BED".to_string()));
        payload.insert(
            "condition_status".to_string(),
            Value::String("DIRTY".to_string()),
        );

        normalize_unit_payload_for_write(&mut payload);

        assert_eq!(
            payload
                .get("default_nightly_rate")
                .and_then(Value::as_f64)
                .map(|value| value as i64),
            Some(250000)
        );
        assert_eq!(
            payload.get("square_meters").and_then(Value::as_f64),
            Some(56.5)
        );
        assert_eq!(
            payload.get("unit_type").and_then(Value::as_str),
            Some("bed")
        );
        assert_eq!(
            payload.get("condition_status").and_then(Value::as_str),
            Some("dirty")
        );
    }

    #[test]
    fn derives_unit_beds_from_legacy_configuration() {
        let unit = json!({
            "beds_count": 3,
            "bed_configuration": [
                { "bed_type": "queen", "code": "A 1" },
                { "type": "bunk", "count": 2, "status": "dirty" }
            ]
        });

        let beds = desired_unit_bed_seeds(&unit);
        assert_eq!(beds.len(), 3);
        assert_eq!(beds[0].bed_type, "queen");
        assert_eq!(beds[0].code, "A-1");
        assert_eq!(beds[1].bed_type, "bunk");
        assert_eq!(beds[1].status, "dirty");
        assert_ne!(beds[1].code, beds[2].code);
    }

    #[test]
    fn builds_property_hierarchy_by_floor() {
        let property = json!({
            "id": "p1",
            "organization_id": "org1"
        });
        let floors = vec![json!({
            "id": "f1",
            "property_id": "p1",
            "organization_id": "org1",
            "label": "Floor 1",
            "number": 1,
            "sort_order": 1
        })];
        let units = vec![
            json!({
                "id": "u1",
                "organization_id": "org1",
                "property_id": "p1",
                "code": "U-101",
                "name": "Unit 101",
                "floor_level": 1
            }),
            json!({
                "id": "u2",
                "organization_id": "org1",
                "property_id": "p1",
                "code": "U-LOBBY",
                "name": "Lobby Unit",
                "floor_level": null
            }),
        ];

        let hierarchy = build_property_hierarchy(property, floors, units, Vec::new(), Vec::new());
        let floor_nodes = hierarchy
            .get("floors")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert_eq!(floor_nodes.len(), 1);
        let first_floor_units = floor_nodes[0]
            .get("units")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert_eq!(first_floor_units.len(), 1);
        assert_eq!(
            first_floor_units[0]
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "u1"
        );

        let unassigned_units = hierarchy
            .get("unassigned_units")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert_eq!(unassigned_units.len(), 1);
        assert_eq!(
            unassigned_units[0]
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "u2"
        );
    }

    #[test]
    fn formats_floor_labels() {
        assert_eq!(default_floor_label(0), "Ground Floor");
        assert_eq!(default_floor_label(3), "Floor 3");
        assert_eq!(default_floor_label(-1), "Basement 1");
    }

    #[test]
    fn validates_bulk_patch_rejects_negative_price() {
        let mut patch = Map::new();
        patch.insert("base_price_nightly".to_string(), json!(-1));
        let result = validate_bulk_unit_patch(&patch);
        assert!(result.is_err());
    }

    #[test]
    fn builds_bulk_filters_and_requires_scope() {
        let scoped = BulkUpdateUnitsFilters {
            property_id: Some("prop-1".to_string()),
            unit_ids: None,
            floor_level: Some(3),
            unit_type: Some("BED".to_string()),
            condition_status: None,
            bedrooms: None,
            is_active: Some(true),
        };
        let map = build_bulk_unit_filters("org-1", &scoped).expect("filters should build");
        assert_eq!(
            map.get("organization_id").and_then(Value::as_str),
            Some("org-1")
        );
        assert_eq!(map.get("floor_level").and_then(Value::as_i64), Some(3));
        assert_eq!(map.get("unit_type").and_then(Value::as_str), Some("bed"));

        let empty = BulkUpdateUnitsFilters::default();
        let empty_result = build_bulk_unit_filters("org-1", &empty);
        assert!(empty_result.is_err());
    }
}
