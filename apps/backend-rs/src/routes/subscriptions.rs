use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const BILLING_ROLES: &[&str] = &["owner_admin"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/subscription-plans", axum::routing::get(list_plans))
        .route(
            "/billing/current",
            axum::routing::get(get_current_subscription),
        )
        .route("/billing/subscribe", axum::routing::post(subscribe))
        .route("/billing/cancel", axum::routing::post(cancel_subscription))
        .route(
            "/public/subscription-plans",
            axum::routing::get(list_public_plans),
        )
        .route(
            "/billing/usage",
            axum::routing::get(get_usage_summary),
        )
}

#[derive(Debug, serde::Deserialize)]
struct PlansQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    20
}

#[derive(Debug, serde::Deserialize)]
struct BillingOrgQuery {
    org_id: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct SubscribeInput {
    organization_id: String,
    plan_id: String,
}

/// List all active subscription plans (authenticated).
async fn list_plans(
    State(state): State<AppState>,
    Query(query): Query<PlansQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let _user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("is_active".to_string(), Value::Bool(true));

    let rows = list_rows(
        pool,
        "subscription_plans",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 50),
        0,
        "sort_order",
        true,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

/// Public plan listing (no auth).
async fn list_public_plans(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("is_active".to_string(), Value::Bool(true));

    let rows = list_rows(
        pool,
        "subscription_plans",
        Some(&filters),
        20,
        0,
        "sort_order",
        true,
    )
    .await?;

    // Return only public-safe fields
    let public: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": val_str(&row, "id"),
                "name": val_str(&row, "name"),
                "max_properties": row.as_object().and_then(|o| o.get("max_properties")).cloned().unwrap_or(Value::Null),
                "max_units": row.as_object().and_then(|o| o.get("max_units")).cloned().unwrap_or(Value::Null),
                "max_users": row.as_object().and_then(|o| o.get("max_users")).cloned().unwrap_or(Value::Null),
                "price_usd": row.as_object().and_then(|o| o.get("price_usd")).cloned().unwrap_or(Value::Null),
                "price_pyg": row.as_object().and_then(|o| o.get("price_pyg")).cloned().unwrap_or(Value::Null),
                "features": row.as_object().and_then(|o| o.get("features")).cloned().unwrap_or(json!({})),
            })
        })
        .collect();

    Ok(Json(json!({ "data": public })))
}

/// Get current subscription for an org.
async fn get_current_subscription(
    State(state): State<AppState>,
    Query(query): Query<BillingOrgQuery>,
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

    let rows = list_rows(
        pool,
        "org_subscriptions",
        Some(&filters),
        1,
        0,
        "created_at",
        false,
    )
    .await?;

    if let Some(sub) = rows.into_iter().next() {
        // Enrich with plan details
        let plan_id = val_str(&sub, "plan_id");
        let plan = if !plan_id.is_empty() {
            get_row(pool, "subscription_plans", &plan_id, "id")
                .await
                .ok()
        } else {
            None
        };

        // Count current usage
        let mut org_filter = Map::new();
        org_filter.insert(
            "organization_id".to_string(),
            Value::String(query.org_id.clone()),
        );

        let properties = list_rows(pool, "properties", Some(&org_filter), 1000, 0, "id", true)
            .await
            .unwrap_or_default();
        let units = list_rows(pool, "units", Some(&org_filter), 10000, 0, "id", true)
            .await
            .unwrap_or_default();
        let members = list_rows(
            pool,
            "organization_members",
            Some(&org_filter),
            1000,
            0,
            "id",
            true,
        )
        .await
        .unwrap_or_default();

        Ok(Json(json!({
            "subscription": sub,
            "plan": plan,
            "usage": {
                "properties": properties.len(),
                "units": units.len(),
                "users": members.len(),
            }
        })))
    } else {
        Ok(Json(json!({
            "subscription": null,
            "plan": null,
            "usage": { "properties": 0, "units": 0, "users": 0 }
        })))
    }
}

/// Subscribe to a plan (creates org_subscriptions record).
/// In production this would create a Stripe checkout session.
async fn subscribe(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SubscribeInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, BILLING_ROLES).await?;
    let pool = db_pool(&state)?;

    // Verify plan exists
    let plan = get_row(pool, "subscription_plans", &payload.plan_id, "id").await?;
    let plan_name = val_str(&plan, "name");

    // Check for existing subscription
    let mut org_filter = Map::new();
    org_filter.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    let existing = list_rows(
        pool,
        "org_subscriptions",
        Some(&org_filter),
        1,
        0,
        "created_at",
        false,
    )
    .await?;

    if let Some(existing_sub) = existing.into_iter().next() {
        // Update existing subscription
        let sub_id = val_str(&existing_sub, "id");
        let mut patch = Map::new();
        patch.insert(
            "plan_id".to_string(),
            Value::String(payload.plan_id.clone()),
        );
        patch.insert("status".to_string(), Value::String("active".to_string()));

        let updated = update_row(pool, "org_subscriptions", &sub_id, &patch, "id").await?;

        write_audit_log(
            state.db_pool.as_ref(),
            Some(&payload.organization_id),
            Some(&user_id),
            "update_subscription",
            "org_subscriptions",
            Some(&sub_id),
            Some(existing_sub),
            Some(updated.clone()),
        )
        .await;

        return Ok((
            axum::http::StatusCode::OK,
            Json(json!({
                "subscription": updated,
                "plan": plan,
            })),
        ));
    }

    // Create new subscription
    let trial_days = state.config.stripe_trial_days;
    let trial_ends = chrono::Utc::now() + chrono::Duration::days(trial_days as i64);

    let is_free = plan_name.to_lowercase() == "free";
    let status = if is_free { "active" } else { "trialing" };

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    record.insert(
        "plan_id".to_string(),
        Value::String(payload.plan_id.clone()),
    );
    record.insert("status".to_string(), Value::String(status.to_string()));
    if !is_free {
        record.insert(
            "trial_ends_at".to_string(),
            Value::String(trial_ends.to_rfc3339()),
        );
    }
    record.insert(
        "current_period_start".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let created = create_row(pool, "org_subscriptions", &record).await?;
    let entity_id = val_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "subscribe",
        "org_subscriptions",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "subscription": created,
            "plan": plan,
        })),
    ))
}

/// Cancel subscription.
async fn cancel_subscription(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BillingOrgQuery>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, BILLING_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut org_filter = Map::new();
    org_filter.insert(
        "organization_id".to_string(),
        Value::String(payload.org_id.clone()),
    );
    let existing = list_rows(
        pool,
        "org_subscriptions",
        Some(&org_filter),
        1,
        0,
        "created_at",
        false,
    )
    .await?;

    let sub = existing
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("No active subscription found.".to_string()))?;

    let sub_id = val_str(&sub, "id");
    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("cancelled".to_string()));
    patch.insert(
        "cancelled_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "org_subscriptions", &sub_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.org_id),
        Some(&user_id),
        "cancel_subscription",
        "org_subscriptions",
        Some(&sub_id),
        Some(sub),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(json!({ "subscription": updated })))
}

/// Get usage summary for the current billing period.
async fn get_usage_summary(
    State(state): State<AppState>,
    Query(query): Query<BillingOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let summary = crate::services::metering::get_usage_summary(pool, &query.org_id).await;
    Ok(Json(summary))
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
