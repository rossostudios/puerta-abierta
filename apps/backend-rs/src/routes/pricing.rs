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
        .route(
            "/pricing/strategies",
            axum::routing::get(list_strategies).post(create_strategy),
        )
        .route(
            "/pricing/strategies/{strategy_id}",
            axum::routing::patch(update_strategy),
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
        .map_err(db_error)?;

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
    .map_err(db_error)?;
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
    .map_err(db_error)?;

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
    .map_err(db_error)?;

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

// ---------------------------------------------------------------------------
// Pricing strategies (wraps pricing_rule_sets)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct StrategiesQuery {
    org_id: String,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StrategyPath {
    strategy_id: String,
}

#[derive(Debug, Deserialize)]
struct CreateStrategyInput {
    org_id: String,
    strategy: String,
    min_rate: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct UpdateStrategyInput {
    org_id: String,
    strategy: Option<String>,
    min_rate: Option<f64>,
    is_active: Option<bool>,
}

fn strategy_presets(strategy: &str) -> AppResult<serde_json::Map<String, Value>> {
    let mut m = serde_json::Map::new();
    match strategy {
        "aggressive_growth" => {
            m.insert("weekend_premium_pct".into(), json!(20.0));
            m.insert("high_season_premium_pct".into(), json!(25.0));
            m.insert("low_season_discount_pct".into(), json!(0.0));
            m.insert("last_minute_discount_pct".into(), json!(5.0));
            m.insert("long_stay_discount_pct".into(), json!(3.0));
            m.insert("last_minute_days".into(), json!(2));
            m.insert("long_stay_threshold_days".into(), json!(14));
            m.insert("holiday_premium_pct".into(), json!(20.0));
        }
        "maximum_occupancy" => {
            m.insert("weekend_premium_pct".into(), json!(5.0));
            m.insert("high_season_premium_pct".into(), json!(10.0));
            m.insert("low_season_discount_pct".into(), json!(15.0));
            m.insert("last_minute_discount_pct".into(), json!(20.0));
            m.insert("long_stay_discount_pct".into(), json!(10.0));
            m.insert("last_minute_days".into(), json!(5));
            m.insert("long_stay_threshold_days".into(), json!(7));
            m.insert("holiday_premium_pct".into(), json!(10.0));
        }
        "balanced" => {
            m.insert("weekend_premium_pct".into(), json!(10.0));
            m.insert("high_season_premium_pct".into(), json!(15.0));
            m.insert("low_season_discount_pct".into(), json!(5.0));
            m.insert("last_minute_discount_pct".into(), json!(10.0));
            m.insert("long_stay_discount_pct".into(), json!(5.0));
            m.insert("last_minute_days".into(), json!(3));
            m.insert("long_stay_threshold_days".into(), json!(7));
            m.insert("holiday_premium_pct".into(), json!(15.0));
        }
        _ => {
            return Err(AppError::BadRequest(
                "strategy must be one of: aggressive_growth, maximum_occupancy, balanced".to_string(),
            ));
        }
    }
    Ok(m)
}

async fn list_strategies(
    State(state): State<AppState>,
    Query(query): Query<StrategiesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let limit = clamp_limit_in_range(query.limit.unwrap_or(50), 1, 100);

    let rows = sqlx::query(
        "SELECT id, org_id, name, description, is_active,
                min_rate::float8, max_rate::float8,
                weekend_premium_pct::float8, holiday_premium_pct::float8,
                low_season_discount_pct::float8, high_season_premium_pct::float8,
                last_minute_days, last_minute_discount_pct::float8,
                long_stay_threshold_days, long_stay_discount_pct::float8,
                created_at::text, updated_at::text
         FROM pricing_rule_sets
         WHERE org_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(&query.org_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(db_error)?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<sqlx::types::Uuid, _>("id")
                    .map(|u| u.to_string()).unwrap_or_default(),
                "org_id": r.try_get::<sqlx::types::Uuid, _>("org_id")
                    .map(|u| u.to_string()).unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<Option<String>, _>("description").unwrap_or(None),
                "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
                "min_rate": r.try_get::<Option<f64>, _>("min_rate").unwrap_or(None),
                "max_rate": r.try_get::<Option<f64>, _>("max_rate").unwrap_or(None),
                "weekend_premium_pct": r.try_get::<Option<f64>, _>("weekend_premium_pct").unwrap_or(None),
                "holiday_premium_pct": r.try_get::<Option<f64>, _>("holiday_premium_pct").unwrap_or(None),
                "low_season_discount_pct": r.try_get::<Option<f64>, _>("low_season_discount_pct").unwrap_or(None),
                "high_season_premium_pct": r.try_get::<Option<f64>, _>("high_season_premium_pct").unwrap_or(None),
                "last_minute_days": r.try_get::<Option<i32>, _>("last_minute_days").unwrap_or(None),
                "last_minute_discount_pct": r.try_get::<Option<f64>, _>("last_minute_discount_pct").unwrap_or(None),
                "long_stay_threshold_days": r.try_get::<Option<i32>, _>("long_stay_threshold_days").unwrap_or(None),
                "long_stay_discount_pct": r.try_get::<Option<f64>, _>("long_stay_discount_pct").unwrap_or(None),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn create_strategy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateStrategyInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, PRICING_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let presets = strategy_presets(&payload.strategy)?;

    // Deactivate any currently active strategies for the org
    sqlx::query(
        "UPDATE pricing_rule_sets SET is_active = FALSE WHERE org_id = $1::uuid AND is_active = TRUE",
    )
    .bind(&payload.org_id)
    .execute(pool)
    .await
    .map_err(db_error)?;

    let row = sqlx::query(
        "INSERT INTO pricing_rule_sets (
            org_id, name, description, is_active, min_rate,
            weekend_premium_pct, holiday_premium_pct,
            low_season_discount_pct, high_season_premium_pct,
            last_minute_days, last_minute_discount_pct,
            long_stay_threshold_days, long_stay_discount_pct
        ) VALUES (
            $1::uuid, $2, $3, TRUE, $4,
            $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id, org_id, name, description, is_active,
                  min_rate::float8, max_rate::float8,
                  weekend_premium_pct::float8, holiday_premium_pct::float8,
                  low_season_discount_pct::float8, high_season_premium_pct::float8,
                  last_minute_days, last_minute_discount_pct::float8,
                  long_stay_threshold_days, long_stay_discount_pct::float8,
                  created_at::text, updated_at::text",
    )
    .bind(&payload.org_id)
    .bind(&payload.strategy)
    .bind(strategy_description(&payload.strategy))
    .bind(payload.min_rate)
    .bind(
        presets
            .get("weekend_premium_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .bind(
        presets
            .get("holiday_premium_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .bind(
        presets
            .get("low_season_discount_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .bind(
        presets
            .get("high_season_premium_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .bind(
        presets
            .get("last_minute_days")
            .and_then(Value::as_i64)
            .unwrap_or(3) as i32,
    )
    .bind(
        presets
            .get("last_minute_discount_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .bind(
        presets
            .get("long_stay_threshold_days")
            .and_then(Value::as_i64)
            .unwrap_or(7) as i32,
    )
    .bind(
        presets
            .get("long_stay_discount_pct")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
    .fetch_one(pool)
    .await
    .map_err(db_error)?;

    let data = strategy_row_to_json(&row);

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.org_id),
        Some(&user_id),
        "create",
        "pricing_rule_sets",
        data.get("id").and_then(Value::as_str),
        None,
        Some(data.clone()),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": data })),
    ))
}

async fn update_strategy(
    State(state): State<AppState>,
    Path(path): Path<StrategyPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateStrategyInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, PRICING_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    // Build SET clauses dynamically
    let mut sets: Vec<String> = vec!["updated_at = now()".to_string()];
    let mut bind_idx = 3u32; // $1 = strategy_id, $2 = org_id

    let cached_presets = payload
        .strategy
        .as_ref()
        .map(|s| strategy_presets(s))
        .transpose()?;

    if cached_presets.is_some() {
        sets.push(format!("name = ${bind_idx}"));
        bind_idx += 1;
        sets.push(format!("description = ${bind_idx}"));
        bind_idx += 1;
        for key in [
            "weekend_premium_pct",
            "holiday_premium_pct",
            "low_season_discount_pct",
            "high_season_premium_pct",
            "last_minute_days",
            "last_minute_discount_pct",
            "long_stay_threshold_days",
            "long_stay_discount_pct",
        ] {
            sets.push(format!("{key} = ${bind_idx}"));
            bind_idx += 1;
        }
    }
    if payload.min_rate.is_some() {
        sets.push(format!("min_rate = ${bind_idx}"));
        bind_idx += 1;
    }
    if payload.is_active.is_some() {
        sets.push(format!("is_active = ${bind_idx}"));
        let _ = bind_idx;
    }

    let set_clause = sets.join(", ");
    let sql = format!(
        "UPDATE pricing_rule_sets SET {set_clause}
         WHERE id = $1::uuid AND org_id = $2::uuid
         RETURNING id, org_id, name, description, is_active,
                   min_rate::float8, max_rate::float8,
                   weekend_premium_pct::float8, holiday_premium_pct::float8,
                   low_season_discount_pct::float8, high_season_premium_pct::float8,
                   last_minute_days, last_minute_discount_pct::float8,
                   long_stay_threshold_days, long_stay_discount_pct::float8,
                   created_at::text, updated_at::text"
    );

    let mut query = sqlx::query(&sql)
        .bind(&path.strategy_id)
        .bind(&payload.org_id);

    if let (Some(ref strategy), Some(ref presets)) = (&payload.strategy, &cached_presets) {
        query = query
            .bind(strategy.as_str())
            .bind(strategy_description(strategy));
        for key in [
            "weekend_premium_pct",
            "holiday_premium_pct",
            "low_season_discount_pct",
            "high_season_premium_pct",
        ] {
            query = query.bind(presets.get(key).and_then(Value::as_f64).unwrap_or(0.0));
        }
        query = query.bind(
            presets
                .get("last_minute_days")
                .and_then(Value::as_i64)
                .unwrap_or(3) as i32,
        );
        query = query.bind(
            presets
                .get("last_minute_discount_pct")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        );
        query = query.bind(
            presets
                .get("long_stay_threshold_days")
                .and_then(Value::as_i64)
                .unwrap_or(7) as i32,
        );
        query = query.bind(
            presets
                .get("long_stay_discount_pct")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        );
    }
    if let Some(min_rate) = payload.min_rate {
        query = query.bind(min_rate);
    }
    if let Some(is_active) = payload.is_active {
        // If activating, deactivate others first
        if is_active {
            sqlx::query(
                "UPDATE pricing_rule_sets SET is_active = FALSE WHERE org_id = $1::uuid AND id <> $2::uuid AND is_active = TRUE",
            )
            .bind(&payload.org_id)
            .bind(&path.strategy_id)
            .execute(pool)
            .await
            .map_err(db_error)?;
        }
        query = query.bind(is_active);
    }

    let row = query.fetch_optional(pool).await.map_err(db_error)?;

    match row {
        Some(r) => {
            let data = strategy_row_to_json(&r);
            write_audit_log(
                state.db_pool.as_ref(),
                Some(&payload.org_id),
                Some(&user_id),
                "update",
                "pricing_rule_sets",
                Some(&path.strategy_id),
                None,
                Some(data.clone()),
            )
            .await;
            Ok(Json(json!({ "data": data })))
        }
        None => Err(AppError::NotFound("Strategy not found.".to_string())),
    }
}

fn strategy_description(strategy: &str) -> &'static str {
    match strategy {
        "aggressive_growth" => {
            "Maximize revenue per booking with higher premiums and minimal discounts"
        }
        "maximum_occupancy" => "Fill every unit with generous discounts and moderate premiums",
        "balanced" => "Optimize revenue and occupancy with moderate adjustments",
        _ => "",
    }
}

fn strategy_row_to_json(r: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": r.try_get::<sqlx::types::Uuid, _>("id")
            .map(|u| u.to_string()).unwrap_or_default(),
        "org_id": r.try_get::<sqlx::types::Uuid, _>("org_id")
            .map(|u| u.to_string()).unwrap_or_default(),
        "name": r.try_get::<String, _>("name").unwrap_or_default(),
        "description": r.try_get::<Option<String>, _>("description").unwrap_or(None),
        "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
        "min_rate": r.try_get::<Option<f64>, _>("min_rate").unwrap_or(None),
        "max_rate": r.try_get::<Option<f64>, _>("max_rate").unwrap_or(None),
        "weekend_premium_pct": r.try_get::<Option<f64>, _>("weekend_premium_pct").unwrap_or(None),
        "holiday_premium_pct": r.try_get::<Option<f64>, _>("holiday_premium_pct").unwrap_or(None),
        "low_season_discount_pct": r.try_get::<Option<f64>, _>("low_season_discount_pct").unwrap_or(None),
        "high_season_premium_pct": r.try_get::<Option<f64>, _>("high_season_premium_pct").unwrap_or(None),
        "last_minute_days": r.try_get::<Option<i32>, _>("last_minute_days").unwrap_or(None),
        "last_minute_discount_pct": r.try_get::<Option<f64>, _>("last_minute_discount_pct").unwrap_or(None),
        "long_stay_threshold_days": r.try_get::<Option<i32>, _>("long_stay_threshold_days").unwrap_or(None),
        "long_stay_discount_pct": r.try_get::<Option<f64>, _>("long_stay_discount_pct").unwrap_or(None),
        "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
        "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
    })
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Database query failed");
    AppError::Dependency("External service request failed.".to_string())
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

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}
