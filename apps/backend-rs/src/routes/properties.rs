use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit, remove_nulls, serialize_to_map, CreatePropertyInput, CreateUnitInput,
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
            "/properties/{property_id}",
            axum::routing::get(get_property)
                .patch(update_property)
                .delete(delete_property),
        )
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

    let record = remove_nulls(serialize_to_map(&payload));
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
    let patch = remove_nulls(serialize_to_map(&payload));
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
    let patch = remove_nulls(serialize_to_map(&payload));
    let updated = update_row(pool, "units", &path.unit_id, &patch, "id").await?;

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
