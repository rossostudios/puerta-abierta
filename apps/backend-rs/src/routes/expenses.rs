use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateExpenseInput,
        ExpenseApprovalInput, ExpensePath, ExpensesQuery, UpdateExpenseInput,
    },
    services::{audit::write_audit_log, enrichment::enrich_expenses, fx::get_usd_to_pyg_rate},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/expenses",
            axum::routing::get(list_expenses).post(create_expense),
        )
        .route(
            "/expenses/{expense_id}/approve",
            axum::routing::post(approve_expense),
        )
        .route(
            "/expenses/{expense_id}/reject",
            axum::routing::post(reject_expense),
        )
        .route(
            "/expenses/{expense_id}",
            axum::routing::get(get_expense)
                .patch(update_expense)
                .delete(delete_expense),
        )
}

async fn list_expenses(
    State(state): State<AppState>,
    Query(query): Query<ExpensesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let rows = list_expense_rows(pool, &query).await?;
    let enriched = enrich_expenses(pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_expense(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateExpenseInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "accountant"],
    )
    .await?;
    let pool = db_pool(&state)?;

    let mut record = remove_nulls(serialize_to_map(&payload));
    record.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let receipt_url = string_from_map(&record, "receipt_url").unwrap_or_default();
    if receipt_url.is_empty() {
        return Err(AppError::BadRequest("receipt_url is required.".to_string()));
    }
    record.insert("receipt_url".to_string(), Value::String(receipt_url));

    let reservation_id = string_from_map(&record, "reservation_id").unwrap_or_default();
    if !reservation_id.is_empty() {
        attach_reservation_unit_property(
            pool,
            &payload.organization_id,
            &reservation_id,
            &mut record,
        )
        .await?;
    }

    let currency = string_from_map(&record, "currency")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "PYG".to_string())
        .to_uppercase();
    record.insert("currency".to_string(), Value::String(currency.clone()));

    if currency == "USD" {
        if !record.contains_key("fx_rate_to_pyg") {
            let fetched =
                get_usd_to_pyg_rate(&state.http_client, payload.expense_date.trim()).await;
            if let Some(rate) = fetched {
                record.insert("fx_rate_to_pyg".to_string(), json!(rate));
            } else {
                return Err(AppError::BadRequest(
                    "fx_rate_to_pyg is required for USD expenses (auto-fetch failed).".to_string(),
                ));
            }
        }
    } else {
        record.remove("fx_rate_to_pyg");
    }

    // IVA auto-calculation (10% in Paraguay)
    if payload.iva_applicable {
        let iva = payload.iva_amount.unwrap_or_else(|| {
            let base = payload.amount;
            (base * 0.10 * 100.0).round() / 100.0
        });
        record.insert("iva_amount".to_string(), json!(iva));
        record.insert("iva_applicable".to_string(), json!(true));
    }

    // Auto-categorize if no category provided
    let has_category = record
        .get("category")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    if !has_category {
        let vendor = string_from_map(&record, "vendor").unwrap_or_default();
        let desc = string_from_map(&record, "description").unwrap_or_default();
        if let Some(category) =
            crate::services::expense_categorization::auto_categorize(&vendor, &desc, payload.amount)
        {
            record.insert("category".to_string(), Value::String(category.to_string()));
        }
    }

    let created = create_row(pool, "expenses", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "expenses",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    let mut enriched = enrich_expenses(pool, vec![created], &payload.organization_id).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(enriched.pop().unwrap_or_else(|| Value::Object(Map::new()))),
    ))
}

async fn get_expense(
    State(state): State<AppState>,
    Path(path): Path<ExpensePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "expenses", &path.expense_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut enriched = enrich_expenses(pool, vec![record], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_expense(
    State(state): State<AppState>,
    Path(path): Path<ExpensePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateExpenseInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "expenses", &path.expense_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "accountant"]).await?;

    let mut patch = remove_nulls(serialize_to_map(&payload));

    if patch.contains_key("receipt_url") {
        let receipt_url = string_from_map(&patch, "receipt_url").unwrap_or_default();
        if receipt_url.is_empty() {
            return Err(AppError::BadRequest(
                "receipt_url cannot be empty.".to_string(),
            ));
        }
        patch.insert("receipt_url".to_string(), Value::String(receipt_url));
    }

    if patch.contains_key("reservation_id") {
        let reservation_id = string_from_map(&patch, "reservation_id").unwrap_or_default();
        if !reservation_id.is_empty() {
            attach_reservation_unit_property(pool, &org_id, &reservation_id, &mut patch).await?;
        }
    }

    let mut currency: Option<String> = None;
    if patch.contains_key("currency") {
        let next_currency = string_from_map(&patch, "currency")
            .unwrap_or_default()
            .to_uppercase();
        if next_currency.is_empty() {
            return Err(AppError::BadRequest(
                "currency cannot be empty.".to_string(),
            ));
        }
        patch.insert("currency".to_string(), Value::String(next_currency.clone()));
        currency = Some(next_currency);
    }

    let effective_currency = currency
        .clone()
        .or_else(|| string_from_value(record.get("currency")))
        .unwrap_or_else(|| "PYG".to_string())
        .to_uppercase();
    let effective_date = string_from_map(&patch, "expense_date")
        .or_else(|| string_from_value(record.get("expense_date")))
        .unwrap_or_default();

    if effective_currency == "USD" {
        if !patch.contains_key("fx_rate_to_pyg") && record.get("fx_rate_to_pyg").is_none() {
            let fetched = get_usd_to_pyg_rate(&state.http_client, effective_date.trim()).await;
            if let Some(rate) = fetched {
                patch.insert("fx_rate_to_pyg".to_string(), json!(rate));
            } else {
                return Err(AppError::BadRequest(
                    "fx_rate_to_pyg is required for USD expenses (auto-fetch failed).".to_string(),
                ));
            }
        }
    } else {
        patch.insert("fx_rate_to_pyg".to_string(), Value::Null);
    }

    let updated = update_row(pool, "expenses", &path.expense_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "expenses",
        Some(&path.expense_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut enriched = enrich_expenses(pool, vec![updated], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn delete_expense(
    State(state): State<AppState>,
    Path(path): Path<ExpensePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "expenses", &path.expense_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "accountant"]).await?;

    let deleted = delete_row(pool, "expenses", &path.expense_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "expenses",
        Some(&path.expense_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}

async fn approve_expense(
    State(state): State<AppState>,
    Path(path): Path<ExpensePath>,
    headers: HeaderMap,
    Json(_payload): Json<ExpenseApprovalInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "expenses", &path.expense_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let mut patch = Map::new();
    patch.insert(
        "approval_status".to_string(),
        Value::String("approved".to_string()),
    );
    patch.insert("approved_by".to_string(), Value::String(user_id.clone()));
    patch.insert(
        "approved_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "expenses", &path.expense_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "approve",
        "expenses",
        Some(&path.expense_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut enriched = enrich_expenses(pool, vec![updated], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn reject_expense(
    State(state): State<AppState>,
    Path(path): Path<ExpensePath>,
    headers: HeaderMap,
    Json(_payload): Json<ExpenseApprovalInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "expenses", &path.expense_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    let mut patch = Map::new();
    patch.insert(
        "approval_status".to_string(),
        Value::String("rejected".to_string()),
    );
    patch.insert("approved_by".to_string(), Value::String(user_id.clone()));
    patch.insert(
        "approved_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "expenses", &path.expense_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "reject",
        "expenses",
        Some(&path.expense_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut enriched = enrich_expenses(pool, vec![updated], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn list_expense_rows(pool: &sqlx::PgPool, query: &ExpensesQuery) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM expenses t WHERE organization_id = ",
    );
    builder.push_bind(query.org_id.clone());

    if let Some(category) = non_empty_opt(query.category.as_deref()) {
        builder.push(" AND category = ");
        builder.push_bind(category);
    }
    if let Some(currency) = non_empty_opt(query.currency.as_deref()) {
        builder.push(" AND currency = ");
        builder.push_bind(currency);
    }
    if let Some(payment_method) = non_empty_opt(query.payment_method.as_deref()) {
        builder.push(" AND payment_method = ");
        builder.push_bind(payment_method);
    }
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        builder.push(" AND property_id = ");
        builder.push_bind(property_id);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        builder.push(" AND unit_id = ");
        builder.push_bind(unit_id);
    }
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        builder.push(" AND reservation_id = ");
        builder.push_bind(reservation_id);
    }
    if let Some(from_date) = non_empty_opt(query.from_date.as_deref()) {
        builder.push(" AND expense_date >= ");
        builder.push_bind(from_date);
    }
    if let Some(to_date) = non_empty_opt(query.to_date.as_deref()) {
        builder.push(" AND expense_date <= ");
        builder.push_bind(to_date);
    }
    if let Some(vendor_name) = non_empty_opt(query.vendor_name.as_deref()) {
        builder.push(" AND vendor_name ILIKE ");
        builder.push_bind(format!("%{vendor_name}%"));
    }
    if let Some(approval_status) = non_empty_opt(query.approval_status.as_deref()) {
        builder.push(" AND approval_status = ");
        builder.push_bind(approval_status);
    }

    builder.push(" ORDER BY expense_date DESC LIMIT ");
    builder.push_bind(clamp_limit_in_range(query.limit, 1, 2000));

    let rows = builder.build().fetch_all(pool).await.map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

async fn attach_reservation_unit_property(
    pool: &sqlx::PgPool,
    org_id: &str,
    reservation_id: &str,
    target: &mut Map<String, Value>,
) -> AppResult<()> {
    let reservation = get_row(pool, "reservations", reservation_id, "id").await?;
    if value_str(&reservation, "organization_id") != org_id {
        return Err(AppError::BadRequest(
            "reservation_id does not belong to this organization.".to_string(),
        ));
    }

    let unit_id = value_str(&reservation, "unit_id");
    if unit_id.is_empty() {
        return Err(AppError::BadRequest(
            "reservation_id is missing unit_id.".to_string(),
        ));
    }
    target.insert("unit_id".to_string(), Value::String(unit_id.clone()));

    let unit = get_row(pool, "units", &unit_id, "id").await?;
    if value_str(&unit, "organization_id") != org_id {
        return Err(AppError::BadRequest(
            "reservation unit does not belong to this organization.".to_string(),
        ));
    }

    if let Some(property_id) = string_from_value(unit.get("property_id")).filter(|v| !v.is_empty())
    {
        target.insert("property_id".to_string(), Value::String(property_id));
    }

    Ok(())
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

fn string_from_map(map: &Map<String, Value>, key: &str) -> Option<String> {
    string_from_value(map.get(key))
}

fn string_from_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToOwned::to_owned)
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}
