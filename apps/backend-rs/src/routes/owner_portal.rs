use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use axum::extract::Path;
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha1::Digest;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::clamp_limit_in_range,
    state::AppState,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/public/owner/request-access",
            axum::routing::post(request_access),
        )
        .route("/public/owner/verify", axum::routing::post(verify_token))
        .route("/owner/dashboard", axum::routing::get(owner_dashboard))
        .route("/owner/statements", axum::routing::get(owner_statements))
        .route(
            "/owner/statements/{statement_id}",
            axum::routing::get(owner_statement_detail),
        )
        .route("/owner/properties", axum::routing::get(owner_properties))
        .route("/owner/reservations", axum::routing::get(owner_reservations))
}

#[derive(Debug, Deserialize)]
struct RequestAccessInput {
    email: String,
}

#[derive(Debug, Deserialize)]
struct VerifyTokenInput {
    token: String,
}

#[derive(Debug, Deserialize)]
struct OwnerListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Debug, Deserialize)]
struct StatementIdPath {
    statement_id: String,
}

fn default_limit() -> i64 {
    200
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database is not configured.".to_string())
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

fn val_f64(row: &Value, key: &str) -> f64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// Request an access link for an owner (org member with owner_admin role).
async fn request_access(
    State(state): State<AppState>,
    Json(payload): Json<RequestAccessInput>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() {
        return Err(AppError::BadRequest("email is required.".to_string()));
    }

    // Find the user by email
    let user = get_row(pool, "app_users", &email, "email")
        .await
        .map_err(|_| AppError::NotFound("No user found with this email.".to_string()))?;

    let user_id = val_str(&user, "id");

    // Find org memberships with owner_admin role
    let mut filters = Map::new();
    filters.insert("user_id".to_string(), Value::String(user_id.clone()));
    filters.insert("role".to_string(), Value::String("owner_admin".to_string()));
    let memberships = list_rows(pool, "organization_members", Some(&filters), 10, 0, "created_at", false).await?;

    if memberships.is_empty() {
        return Err(AppError::Forbidden(
            "No owner organization found for this email.".to_string(),
        ));
    }

    // Use the first org membership
    let org_id = val_str(&memberships[0], "organization_id");

    // Generate token
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let mut record = Map::new();
    record.insert("owner_email".to_string(), Value::String(email.clone()));
    record.insert("organization_id".to_string(), Value::String(org_id));
    record.insert("token_hash".to_string(), Value::String(token_hash));

    create_row(pool, "owner_access_tokens", &record).await?;

    // In production, send via email/WhatsApp. For now, return the token for testing.
    let app_base_url = std::env::var("NEXT_PUBLIC_APP_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let _magic_link = format!("{app_base_url}/owner/login?token={raw_token}");

    Ok((
        axum::http::StatusCode::OK,
        Json(json!({
            "message": "Access link sent to your registered contact.",
            "email": email,
        })),
    ))
}

/// Verify an owner access token.
async fn verify_token(
    State(state): State<AppState>,
    Json(payload): Json<VerifyTokenInput>,
) -> AppResult<Json<Value>> {
    let pool = db_pool(&state)?;
    let raw_token = payload.token.trim();
    if raw_token.is_empty() {
        return Err(AppError::BadRequest("token is required.".to_string()));
    }

    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let token_record = get_row(pool, "owner_access_tokens", &token_hash, "token_hash")
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?;

    // Check expiry
    if let Some(expires_at) = token_record
        .as_object()
        .and_then(|o| o.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                return Err(AppError::Unauthorized(
                    "Token has expired. Request a new access link.".to_string(),
                ));
            }
        }
    }

    // Update last_used_at
    let token_id = val_str(&token_record, "id");
    let mut patch = Map::new();
    patch.insert(
        "last_used_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    let _ = update_row(pool, "owner_access_tokens", &token_id, &patch, "id").await;

    let org_id = val_str(&token_record, "organization_id");
    let email = val_str(&token_record, "owner_email");

    Ok(Json(json!({
        "authenticated": true,
        "organization_id": org_id,
        "email": email,
        "token_hash": token_hash,
    })))
}

/// Owner dashboard — summary of properties, occupancy, revenue.
async fn owner_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id) = require_owner(&state, &headers).await?;

    // Load org
    let org = get_row(pool, "organizations", &org_id, "id").await.ok();

    // Count properties
    let mut prop_filters = Map::new();
    prop_filters.insert("organization_id".to_string(), Value::String(org_id.clone()));
    let properties = list_rows(pool, "properties", Some(&prop_filters), 500, 0, "created_at", false).await?;

    // Count units
    let units = list_rows(pool, "units", Some(&prop_filters), 500, 0, "created_at", false).await?;

    // Active leases
    let leases = list_rows(pool, "leases", Some(&prop_filters), 500, 0, "created_at", false).await?;
    let active_leases: Vec<&Value> = leases
        .iter()
        .filter(|l| {
            let s = val_str(l, "lease_status");
            s == "active"
        })
        .collect();

    // Active reservations
    let reservations = list_rows(pool, "reservations", Some(&prop_filters), 500, 0, "created_at", false).await?;
    let active_reservations: Vec<&Value> = reservations
        .iter()
        .filter(|r| {
            let s = val_str(r, "reservation_status");
            s == "confirmed" || s == "checked_in"
        })
        .collect();

    // Revenue from collections (paid)
    let collections = list_rows(pool, "collection_records", Some(&prop_filters), 2000, 0, "due_date", false).await?;
    let total_collected: f64 = collections
        .iter()
        .filter(|c| val_str(c, "status") == "paid")
        .map(|c| val_f64(c, "amount"))
        .sum();

    // Pending owner statements
    let statements = list_rows(pool, "owner_statements", Some(&prop_filters), 500, 0, "created_at", false).await?;
    let pending_statements: Vec<&Value> = statements
        .iter()
        .filter(|s| {
            let status = val_str(s, "status");
            status == "draft" || status == "pending"
        })
        .collect();

    let occupancy_rate = if units.is_empty() {
        0.0
    } else {
        (active_leases.len() + active_reservations.len()) as f64 / units.len() as f64 * 100.0
    };

    // Revenue by month (last 6 months)
    let today = Utc::now().date_naive();
    let six_months_ago = today - chrono::Duration::days(180);
    let mut revenue_by_month: std::collections::BTreeMap<String, f64> = std::collections::BTreeMap::new();
    for c in &collections {
        if val_str(c, "status") != "paid" {
            continue;
        }
        let paid_at = val_str(c, "paid_at");
        let date_str = if paid_at.is_empty() { val_str(c, "due_date") } else { paid_at };
        if date_str.is_empty() {
            continue;
        }
        let date_key = date_str.get(..7).unwrap_or("").to_string();
        if date_key.is_empty() {
            continue;
        }
        if let Ok(d) = NaiveDate::parse_from_str(&format!("{date_key}-01"), "%Y-%m-%d") {
            if d >= six_months_ago {
                *revenue_by_month.entry(date_key).or_default() += val_f64(c, "amount");
            }
        }
    }
    let revenue_by_month_arr: Vec<Value> = revenue_by_month
        .iter()
        .map(|(month, amount)| json!({ "month": month, "amount": amount }))
        .collect();

    // Revenue by property
    let mut revenue_by_prop: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for c in &collections {
        if val_str(c, "status") != "paid" {
            continue;
        }
        let prop_id = val_str(c, "property_id");
        if !prop_id.is_empty() {
            *revenue_by_prop.entry(prop_id).or_default() += val_f64(c, "amount");
        }
    }
    // Resolve property names
    let property_name_map: std::collections::HashMap<String, String> = properties
        .iter()
        .map(|p| (val_str(p, "id"), val_str(p, "name")))
        .collect();
    let revenue_by_property_arr: Vec<Value> = revenue_by_prop
        .iter()
        .map(|(pid, amount)| {
            let name = property_name_map.get(pid).cloned().unwrap_or_default();
            json!({ "property_id": pid, "property_name": name, "amount": amount })
        })
        .collect();

    // Upcoming reservations (next 30 days)
    let thirty_days = today + chrono::Duration::days(30);
    let upcoming: Vec<&Value> = reservations
        .iter()
        .filter(|r| {
            let status = val_str(r, "status");
            if !["pending", "confirmed"].contains(&status.as_str()) {
                return false;
            }
            let ci = val_str(r, "check_in_date");
            if let Ok(d) = NaiveDate::parse_from_str(&ci, "%Y-%m-%d") {
                d >= today && d <= thirty_days
            } else {
                false
            }
        })
        .collect();

    Ok(Json(json!({
        "organization": org,
        "summary": {
            "total_properties": properties.len(),
            "total_units": units.len(),
            "active_leases": active_leases.len(),
            "active_reservations": active_reservations.len(),
            "occupancy_rate": (occupancy_rate * 10.0).round() / 10.0,
            "total_collected": total_collected,
            "pending_statements": pending_statements.len(),
        },
        "revenue_by_month": revenue_by_month_arr,
        "revenue_by_property": revenue_by_property_arr,
        "upcoming_reservations": upcoming,
    })))
}

/// List owner statements.
async fn owner_statements(
    State(state): State<AppState>,
    Query(query): Query<OwnerListQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id) = require_owner(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));

    let rows = list_rows(
        pool,
        "owner_statements",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

/// Get statement detail with associated collections + expenses.
async fn owner_statement_detail(
    State(state): State<AppState>,
    Path(path): Path<StatementIdPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id) = require_owner(&state, &headers).await?;

    let statement = get_row(pool, "owner_statements", &path.statement_id, "id").await?;
    let stmt_org = val_str(&statement, "organization_id");
    if stmt_org != org_id {
        return Err(AppError::Forbidden("Statement does not belong to this organization.".to_string()));
    }

    // Fetch collections for the statement period
    let mut coll_filters = Map::new();
    coll_filters.insert("organization_id".to_string(), Value::String(org_id.clone()));
    let collections = list_rows(pool, "collection_records", Some(&coll_filters), 2000, 0, "due_date", true)
        .await
        .unwrap_or_default();

    // Filter to the statement period
    let period_start = val_str(&statement, "period_start");
    let period_end = val_str(&statement, "period_end");
    let period_collections: Vec<&Value> = if !period_start.is_empty() && !period_end.is_empty() {
        collections
            .iter()
            .filter(|c| {
                let due = val_str(c, "due_date");
                val_str(c, "status") == "paid" && due >= period_start && due <= period_end
            })
            .collect()
    } else {
        Vec::new()
    };

    // Fetch expenses for the period
    let mut exp_filters = Map::new();
    exp_filters.insert("organization_id".to_string(), Value::String(org_id));
    let expenses = list_rows(pool, "expenses", Some(&exp_filters), 2000, 0, "expense_date", true)
        .await
        .unwrap_or_default();

    let period_expenses: Vec<&Value> = if !period_start.is_empty() && !period_end.is_empty() {
        expenses
            .iter()
            .filter(|e| {
                let d = val_str(e, "expense_date");
                d >= period_start && d <= period_end
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(Json(json!({
        "statement": statement,
        "collections": period_collections,
        "expenses": period_expenses,
    })))
}

/// List owner's properties.
async fn owner_properties(
    State(state): State<AppState>,
    Query(query): Query<OwnerListQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id) = require_owner(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));

    let rows = list_rows(
        pool,
        "properties",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "name",
        true,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

/// List owner's reservations.
async fn owner_reservations(
    State(state): State<AppState>,
    Query(query): Query<OwnerListQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let (pool, org_id) = require_owner(&state, &headers).await?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));

    let rows = list_rows(
        pool,
        "reservations",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

/// Authenticate an owner from the x-owner-token header.
async fn require_owner<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
) -> AppResult<(&'a sqlx::PgPool, String)> {
    let pool = db_pool(state)?;

    let raw_token = headers
        .get("x-owner-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing x-owner-token header.".to_string()))?;

    let token_hash = hex::encode(sha1::Sha1::digest(raw_token.as_bytes()));

    let token_record = get_row(pool, "owner_access_tokens", &token_hash, "token_hash")
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired token.".to_string()))?;

    // Check expiry
    if let Some(expires_at) = token_record
        .as_object()
        .and_then(|o| o.get("expires_at"))
        .and_then(Value::as_str)
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            if Utc::now() > expiry {
                return Err(AppError::Unauthorized("Token has expired.".to_string()));
            }
        }
    }

    let org_id = val_str(&token_record, "organization_id");
    if org_id.is_empty() {
        return Err(AppError::Unauthorized("Invalid token.".to_string()));
    }

    Ok((pool, org_id))
}

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}
