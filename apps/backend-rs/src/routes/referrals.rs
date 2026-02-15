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
    repository::table_service::{create_row, list_rows, update_row},
    state::AppState,
    tenancy::assert_org_member,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/referrals/my-code", axum::routing::get(get_my_code))
        .route("/referrals/generate", axum::routing::post(generate_code))
        .route("/referrals/validate", axum::routing::get(validate_code))
        .route("/referrals/redeem", axum::routing::post(redeem_code))
        .route("/referrals/history", axum::routing::get(referral_history))
}

#[derive(Debug, serde::Deserialize)]
struct OrgQuery {
    org_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct CodeQuery {
    code: String,
}

#[derive(Debug, serde::Deserialize)]
struct RedeemInput {
    code: String,
    redeemed_by_org_id: String,
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database not configured.".to_string())
    })
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn generate_referral_code() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let chars: Vec<char> = "ABCDEFGHJKMNPQRSTUVWXYZ23456789".chars().collect();
    let mut code = String::with_capacity(8);
    let mut n = seed;
    for _ in 0..8 {
        code.push(chars[(n % chars.len() as u128) as usize]);
        n /= chars.len() as u128;
        n = n.wrapping_add(seed.wrapping_mul(31));
    }
    format!("PA-{code}")
}

/// Get the current user's referral code for an org (creates one if none exists).
async fn get_my_code(
    State(state): State<AppState>,
    Query(query): Query<OrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    // Look for existing code
    let mut filters = Map::new();
    filters.insert(
        "referrer_org_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    let rows = list_rows(pool, "referral_codes", Some(&filters), 1, 0, "created_at", false).await;

    if let Ok(rows) = rows {
        if let Some(row) = rows.into_iter().next() {
            return Ok(Json(json!({ "referral": row })));
        }
    }

    // Generate a new code
    let code = generate_referral_code();
    let mut record = Map::new();
    record.insert(
        "referrer_org_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    record.insert(
        "referrer_user_id".to_string(),
        Value::String(user_id),
    );
    record.insert("code".to_string(), Value::String(code));
    record.insert("max_uses".to_string(), json!(10));
    record.insert("times_used".to_string(), json!(0));
    record.insert(
        "reward_type".to_string(),
        Value::String("free_month".to_string()),
    );
    record.insert("is_active".to_string(), Value::Bool(true));

    let created = create_row(pool, "referral_codes", &record).await?;
    Ok(Json(json!({ "referral": created })))
}

/// Generate a fresh referral code for an org.
async fn generate_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<OrgQuery>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.org_id).await?;
    let pool = db_pool(&state)?;

    let code = generate_referral_code();
    let mut record = Map::new();
    record.insert(
        "referrer_org_id".to_string(),
        Value::String(payload.org_id.clone()),
    );
    record.insert(
        "referrer_user_id".to_string(),
        Value::String(user_id),
    );
    record.insert("code".to_string(), Value::String(code));
    record.insert("max_uses".to_string(), json!(10));
    record.insert("times_used".to_string(), json!(0));
    record.insert(
        "reward_type".to_string(),
        Value::String("free_month".to_string()),
    );
    record.insert("is_active".to_string(), Value::Bool(true));

    let created = create_row(pool, "referral_codes", &record).await?;
    Ok((axum::http::StatusCode::CREATED, Json(json!({ "referral": created }))))
}

/// Validate a referral code (public, used during signup).
async fn validate_code(
    State(state): State<AppState>,
    Query(query): Query<CodeQuery>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("code".to_string(), Value::String(query.code.trim().to_uppercase()));
    filters.insert("is_active".to_string(), Value::Bool(true));

    let rows = list_rows(pool, "referral_codes", Some(&filters), 1, 0, "created_at", false)
        .await
        .unwrap_or_default();

    if let Some(row) = rows.into_iter().next() {
        let times_used = row
            .as_object()
            .and_then(|o| o.get("times_used"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let max_uses = row
            .as_object()
            .and_then(|o| o.get("max_uses"))
            .and_then(Value::as_i64)
            .unwrap_or(10);

        if times_used >= max_uses {
            return Ok(Json(json!({ "valid": false, "reason": "Code has reached maximum uses." })));
        }

        Ok(Json(json!({
            "valid": true,
            "reward_type": val_str(&row, "reward_type"),
        })))
    } else {
        Ok(Json(json!({ "valid": false, "reason": "Invalid code." })))
    }
}

/// Redeem a referral code (called after a new org subscribes).
async fn redeem_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RedeemInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.redeemed_by_org_id).await?;
    let pool = db_pool(&state)?;

    let code = payload.code.trim().to_uppercase();

    // Find the referral code
    let mut filters = Map::new();
    filters.insert("code".to_string(), Value::String(code.clone()));
    filters.insert("is_active".to_string(), Value::Bool(true));

    let rows = list_rows(pool, "referral_codes", Some(&filters), 1, 0, "created_at", false)
        .await?;
    let referral = rows
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Invalid or inactive referral code.".to_string()))?;

    let referral_id = val_str(&referral, "id");
    let referrer_org_id = val_str(&referral, "referrer_org_id");

    // Don't allow self-referral
    if referrer_org_id == payload.redeemed_by_org_id {
        return Err(AppError::Forbidden(
            "Cannot redeem your own referral code.".to_string(),
        ));
    }

    let times_used = referral
        .as_object()
        .and_then(|o| o.get("times_used"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let max_uses = referral
        .as_object()
        .and_then(|o| o.get("max_uses"))
        .and_then(Value::as_i64)
        .unwrap_or(10);

    if times_used >= max_uses {
        return Err(AppError::Forbidden(
            "This referral code has reached its maximum number of uses.".to_string(),
        ));
    }

    // Increment times_used
    let mut patch = Map::new();
    patch.insert("times_used".to_string(), json!(times_used + 1));
    if times_used + 1 >= max_uses {
        patch.insert("is_active".to_string(), Value::Bool(false));
    }
    update_row(pool, "referral_codes", &referral_id, &patch, "id").await?;

    // Record the redemption
    let mut redemption = Map::new();
    redemption.insert(
        "referral_code_id".to_string(),
        Value::String(referral_id.clone()),
    );
    redemption.insert("code".to_string(), Value::String(code));
    redemption.insert(
        "referrer_org_id".to_string(),
        Value::String(referrer_org_id),
    );
    redemption.insert(
        "redeemed_by_org_id".to_string(),
        Value::String(payload.redeemed_by_org_id),
    );
    redemption.insert(
        "redeemed_by_user_id".to_string(),
        Value::String(user_id),
    );
    redemption.insert(
        "reward_type".to_string(),
        Value::String(val_str(&referral, "reward_type")),
    );
    redemption.insert(
        "status".to_string(),
        Value::String("pending".to_string()),
    );

    let created = create_row(pool, "referral_redemptions", &redemption).await?;

    Ok(Json(json!({
        "redemption": created,
        "message": "Referral code redeemed successfully. Reward will be applied."
    })))
}

/// List referral history for an org (who used my codes).
async fn referral_history(
    State(state): State<AppState>,
    Query(query): Query<OrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "referrer_org_id".to_string(),
        Value::String(query.org_id.clone()),
    );

    let redemptions = list_rows(
        pool,
        "referral_redemptions",
        Some(&filters),
        50,
        0,
        "created_at",
        false,
    )
    .await
    .unwrap_or_default();

    Ok(Json(json!({ "data": redemptions })))
}
