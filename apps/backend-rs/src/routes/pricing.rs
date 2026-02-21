use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreatePricingTemplateInput,
        PricingTemplatesQuery, TemplatePath, UpdatePricingTemplateInput,
    },
    services::{
        audit::write_audit_log,
        pricing::{compute_pricing_totals, normalize_fee_lines},
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const PRICING_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/pricing/templates",
            axum::routing::get(list_pricing_templates).post(create_pricing_template),
        )
        .route(
            "/pricing/templates/{template_id}",
            axum::routing::get(get_pricing_template).patch(update_pricing_template),
        )
        .route(
            "/pricing/recommendations",
            axum::routing::get(list_pricing_recommendations),
        )
        .route(
            "/pricing/recommendations/{recommendation_id}",
            axum::routing::patch(update_pricing_recommendation),
        )
}

async fn list_pricing_templates(
    State(state): State<AppState>,
    Query(query): Query<PricingTemplatesQuery>,
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
    if let Some(is_active) = query.is_active {
        filters.insert("is_active".to_string(), Value::Bool(is_active));
    }

    let rows = list_rows(
        pool,
        "pricing_templates",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    let attached = attach_lines(pool, rows).await?;
    Ok(Json(json!({ "data": attached })))
}

async fn create_pricing_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePricingTemplateInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        PRICING_EDIT_ROLES,
    )
    .await?;
    let pool = db_pool(&state)?;

    let mut template_payload = remove_nulls(serialize_to_map(&payload));
    template_payload.remove("lines");
    template_payload.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let created = create_row(pool, "pricing_templates", &template_payload).await?;
    let template_id = value_str(&created, "id");

    let source_lines = payload
        .lines
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::BadRequest(format!("Invalid fee line payload: {error}")))?;
    let created_lines =
        replace_template_lines(pool, &payload.organization_id, &template_id, &source_lines).await?;

    if payload.is_default {
        set_default_template(pool, &payload.organization_id, &template_id).await?;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "pricing_templates",
        Some(&template_id),
        None,
        Some(json!({
            "template": created,
            "lines": created_lines,
        })),
    )
    .await;

    let mut rows = attach_lines(pool, vec![created]).await?;
    let item = rows.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok((axum::http::StatusCode::CREATED, Json(item)))
}

async fn get_pricing_template(
    State(state): State<AppState>,
    Path(path): Path<TemplatePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "pricing_templates", &path.template_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut rows = attach_lines(pool, vec![record]).await?;
    Ok(Json(
        rows.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_pricing_template(
    State(state): State<AppState>,
    Path(path): Path<TemplatePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdatePricingTemplateInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "pricing_templates", &path.template_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, PRICING_EDIT_ROLES).await?;

    let mut patch = remove_nulls(serialize_to_map(&payload));
    patch.remove("lines");

    let mut updated = record.clone();
    if !patch.is_empty() {
        updated = update_row(pool, "pricing_templates", &path.template_id, &patch, "id").await?;
    }

    if let Some(lines) = payload.lines.as_ref() {
        let source_lines = lines
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::BadRequest(format!("Invalid fee line payload: {error}")))?;
        replace_template_lines(pool, &org_id, &path.template_id, &source_lines).await?;
    }

    if payload.is_default == Some(true) {
        set_default_template(pool, &org_id, &path.template_id).await?;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "pricing_templates",
        Some(&path.template_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut rows = attach_lines(pool, vec![updated]).await?;
    Ok(Json(
        rows.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn replace_template_lines(
    pool: &sqlx::PgPool,
    org_id: &str,
    template_id: &str,
    lines: &[Value],
) -> AppResult<Vec<Value>> {
    sqlx::query("DELETE FROM pricing_template_lines WHERE pricing_template_id = $1")
        .bind(template_id)
        .execute(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    let normalized = normalize_fee_lines(lines);
    let mut created_lines = Vec::new();
    for (index, line) in normalized.into_iter().enumerate() {
        let Some(obj) = line.as_object() else {
            continue;
        };

        let mut payload = Map::new();
        payload.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        payload.insert(
            "pricing_template_id".to_string(),
            Value::String(template_id.to_string()),
        );
        payload.insert(
            "fee_type".to_string(),
            obj.get("fee_type").cloned().unwrap_or(Value::Null),
        );
        payload.insert(
            "label".to_string(),
            obj.get("label").cloned().unwrap_or(Value::Null),
        );
        payload.insert(
            "amount".to_string(),
            obj.get("amount").cloned().unwrap_or(Value::Null),
        );
        payload.insert(
            "is_refundable".to_string(),
            obj.get("is_refundable")
                .cloned()
                .unwrap_or(Value::Bool(false)),
        );
        payload.insert(
            "is_recurring".to_string(),
            obj.get("is_recurring")
                .cloned()
                .unwrap_or(Value::Bool(false)),
        );
        payload.insert("sort_order".to_string(), json!((index + 1) as i32));

        let created = create_row(pool, "pricing_template_lines", &payload).await?;
        created_lines.push(created);
    }

    Ok(created_lines)
}

async fn attach_lines(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let template_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if template_ids.is_empty() {
        return Ok(rows);
    }

    let lines = list_rows(
        pool,
        "pricing_template_lines",
        Some(&json_map(&[(
            "pricing_template_id",
            Value::Array(template_ids.iter().cloned().map(Value::String).collect()),
        )])),
        std::cmp::max(200, (template_ids.len() as i64) * 20),
        0,
        "sort_order",
        true,
    )
    .await?;

    let mut grouped: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();
    for line in lines {
        let key = line
            .as_object()
            .and_then(|item| item.get("pricing_template_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string();
        if key.is_empty() {
            continue;
        }
        grouped.entry(key).or_default().push(line);
    }

    let mut attached = Vec::with_capacity(rows.len());
    for mut row in rows {
        if let Some(obj) = row.as_object_mut() {
            let row_id = obj
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_default();
            let fee_lines = grouped.get(row_id).cloned().unwrap_or_default();
            let totals = compute_pricing_totals(&fee_lines);
            obj.insert("lines".to_string(), Value::Array(fee_lines));
            obj.insert("total_move_in".to_string(), json!(totals.total_move_in));
            obj.insert(
                "monthly_recurring_total".to_string(),
                json!(totals.monthly_recurring_total),
            );
        }
        attached.push(row);
    }

    Ok(attached)
}

async fn set_default_template(
    pool: &sqlx::PgPool,
    org_id: &str,
    template_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE pricing_templates SET is_default = FALSE WHERE organization_id = $1 AND id <> $2",
    )
    .bind(org_id)
    .bind(template_id)
    .execute(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Pricing recommendations
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RecommendationsQuery {
    org_id: String,
    status: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RecommendationPath {
    recommendation_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateRecommendationInput {
    org_id: String,
    status: String,
}

async fn list_pricing_recommendations(
    State(state): State<AppState>,
    Query(query): Query<RecommendationsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let limit = clamp_limit_in_range(query.limit.unwrap_or(50), 1, 100);
    let status_filter = query.status.as_deref().unwrap_or("pending");

    let rows = sqlx::query(
        "SELECT id, unit_id, recommendation_type, current_rate::float8,
                recommended_rate::float8, confidence, reasoning,
                revenue_impact_estimate::float8,
                date_range_start::text, date_range_end::text,
                status, agent_slug, created_at::text
         FROM pricing_recommendations
         WHERE organization_id = $1::uuid AND status = $2
         ORDER BY created_at DESC
         LIMIT $3",
    )
    .bind(&query.org_id)
    .bind(status_filter)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<sqlx::types::Uuid, _>("id")
                    .map(|u| u.to_string()).unwrap_or_default(),
                "unit_id": r.try_get::<Option<sqlx::types::Uuid>, _>("unit_id")
                    .ok().flatten().map(|u| u.to_string()),
                "recommendation_type": r.try_get::<String, _>("recommendation_type").unwrap_or_default(),
                "current_rate": r.try_get::<Option<f64>, _>("current_rate").unwrap_or(None),
                "recommended_rate": r.try_get::<Option<f64>, _>("recommended_rate").unwrap_or(None),
                "confidence": r.try_get::<f64, _>("confidence").unwrap_or(0.0),
                "reasoning": r.try_get::<String, _>("reasoning").unwrap_or_default(),
                "revenue_impact_estimate": r.try_get::<Option<f64>, _>("revenue_impact_estimate").unwrap_or(None),
                "date_range_start": r.try_get::<Option<String>, _>("date_range_start").unwrap_or(None),
                "date_range_end": r.try_get::<Option<String>, _>("date_range_end").unwrap_or(None),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "agent_slug": r.try_get::<String, _>("agent_slug").unwrap_or_default(),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn update_pricing_recommendation(
    State(state): State<AppState>,
    Path(path): Path<RecommendationPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateRecommendationInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, PRICING_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let valid_statuses = ["approved", "dismissed", "applied"];
    if !valid_statuses.contains(&payload.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "status must be one of: {}",
            valid_statuses.join(", ")
        )));
    }

    let result = sqlx::query(
        "UPDATE pricing_recommendations
         SET status = $3, reviewed_by = $4::uuid, reviewed_at = now(), updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid
         RETURNING id",
    )
    .bind(&path.recommendation_id)
    .bind(&payload.org_id)
    .bind(&payload.status)
    .bind(&user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    match result {
        Some(_) => {
            write_audit_log(
                state.db_pool.as_ref(),
                Some(&payload.org_id),
                Some(&user_id),
                "update",
                "pricing_recommendations",
                Some(&path.recommendation_id),
                None,
                Some(json!({ "status": payload.status })),
            )
            .await;
            Ok(Json(json!({ "ok": true, "status": payload.status })))
        }
        None => Err(AppError::NotFound("Recommendation not found.".to_string())),
    }
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

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}
