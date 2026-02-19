use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CollectionPath, CollectionsQuery,
        CreateCollectionInput, MarkCollectionPaidInput,
    },
    services::{analytics::write_analytics_event, audit::write_audit_log, workflows::fire_trigger},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const COLLECTION_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/collections",
            axum::routing::get(list_collections).post(create_collection),
        )
        .route(
            "/collections/{collection_id}",
            axum::routing::get(get_collection),
        )
        .route(
            "/collections/{collection_id}/mark-paid",
            axum::routing::post(mark_collection_paid),
        )
}

async fn list_collections(
    State(state): State<AppState>,
    Query(query): Query<CollectionsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    if let Some(status) = non_empty_opt(query.status.as_deref()) {
        filters.insert("status".to_string(), Value::String(status));
    }
    if let Some(lease_id) = non_empty_opt(query.lease_id.as_deref()) {
        filters.insert("lease_id".to_string(), Value::String(lease_id));
    }

    let mut rows = list_rows(
        pool,
        "collection_records",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    if let Some(due_from) = non_empty_opt(query.due_from.as_deref()) {
        rows.retain(|row| {
            row.as_object()
                .and_then(|obj| obj.get("due_date"))
                .and_then(Value::as_str)
                .is_some_and(|due_date| due_date >= due_from.as_str())
        });
    }
    if let Some(due_to) = non_empty_opt(query.due_to.as_deref()) {
        rows.retain(|row| {
            row.as_object()
                .and_then(|obj| obj.get("due_date"))
                .and_then(Value::as_str)
                .is_some_and(|due_date| due_date <= due_to.as_str())
        });
    }

    let enriched = enrich_collection_rows(pool, rows).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateCollectionInput>,
) -> AppResult<impl IntoResponse> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        COLLECTION_EDIT_ROLES,
    )
    .await?;
    let pool = db_pool(&state)?;

    let lease = get_row(pool, "leases", &payload.lease_id, "id").await?;
    if value_str(&lease, "organization_id") != payload.organization_id {
        return Err(AppError::BadRequest(
            "lease_id does not belong to this organization.".to_string(),
        ));
    }

    let mut record = remove_nulls(serialize_to_map(&payload));
    record.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let created = create_row(pool, "collection_records", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "collection_records",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    refresh_lease_status(pool, &payload.lease_id).await?;

    let mut enriched = enrich_collection_rows(pool, vec![created]).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(enriched.pop().unwrap_or_else(|| Value::Object(Map::new()))),
    ))
}

async fn get_collection(
    State(state): State<AppState>,
    Path(path): Path<CollectionPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "collection_records", &path.collection_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut enriched = enrich_collection_rows(pool, vec![record]).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn mark_collection_paid(
    State(state): State<AppState>,
    Path(path): Path<CollectionPath>,
    headers: HeaderMap,
    Json(payload): Json<MarkCollectionPaidInput>,
) -> AppResult<Json<Value>> {
    ensure_lease_collections_enabled(&state)?;

    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "collection_records", &path.collection_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, COLLECTION_EDIT_ROLES).await?;

    let now_iso = Utc::now().to_rfc3339();

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("paid".to_string()));
    patch.insert(
        "paid_at".to_string(),
        Value::String(payload.paid_at.unwrap_or(now_iso)),
    );
    if let Some(payment_method) = payload.payment_method {
        patch.insert("payment_method".to_string(), Value::String(payment_method));
    }
    if let Some(payment_reference) = payload.payment_reference {
        patch.insert(
            "payment_reference".to_string(),
            Value::String(payment_reference),
        );
    }
    if let Some(notes) = payload.notes {
        patch.insert("notes".to_string(), Value::String(notes));
    }

    let updated = update_row(
        pool,
        "collection_records",
        &path.collection_id,
        &patch,
        "id",
    )
    .await?;

    if let Some(lease_charge_id) = updated
        .as_object()
        .and_then(|obj| obj.get("lease_charge_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let mut lease_patch = Map::new();
        lease_patch.insert("status".to_string(), Value::String("paid".to_string()));
        let _ = update_row(pool, "lease_charges", lease_charge_id, &lease_patch, "id").await;
    }

    let lease_id = value_str(&updated, "lease_id");
    if !lease_id.is_empty() {
        refresh_lease_status(pool, &lease_id).await?;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "status_transition",
        "collection_records",
        Some(&path.collection_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    let mut analytics_payload = Map::new();
    analytics_payload.insert(
        "collection_id".to_string(),
        Value::String(path.collection_id.clone()),
    );
    analytics_payload.insert(
        "lease_id".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("lease_id"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    analytics_payload.insert(
        "amount".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("amount"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    analytics_payload.insert(
        "currency".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("currency"))
            .cloned()
            .unwrap_or(Value::Null),
    );

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&org_id),
        "collection_paid",
        Some(Value::Object(analytics_payload)),
    )
    .await;

    // Emit workflow trigger for collection payments.
    let mut workflow_context = Map::new();
    workflow_context.insert(
        "collection_id".to_string(),
        Value::String(path.collection_id.clone()),
    );
    workflow_context.insert(
        "lease_id".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("lease_id"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    workflow_context.insert(
        "amount".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("amount"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    workflow_context.insert(
        "currency".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("currency"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    workflow_context.insert(
        "property_id".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("property_id"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    workflow_context.insert(
        "unit_id".to_string(),
        updated
            .as_object()
            .and_then(|obj| obj.get("unit_id"))
            .cloned()
            .unwrap_or(Value::Null),
    );

    if let Some(lease_id) = updated
        .as_object()
        .and_then(|obj| obj.get("lease_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Ok(lease) = get_row(pool, "leases", lease_id, "id").await {
            if let Some(phone) = lease
                .as_object()
                .and_then(|obj| obj.get("tenant_phone_e164"))
                .cloned()
            {
                workflow_context.insert("tenant_phone_e164".to_string(), phone);
            }
            if let Some(name) = lease
                .as_object()
                .and_then(|obj| obj.get("tenant_full_name"))
                .cloned()
            {
                workflow_context.insert("tenant_full_name".to_string(), name);
            }
        }
    }

    fire_trigger(
        pool,
        &org_id,
        "payment_received",
        &workflow_context,
        state.config.workflow_engine_mode,
    )
    .await;

    let mut enriched = enrich_collection_rows(pool, vec![updated]).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn refresh_lease_status(pool: &sqlx::PgPool, lease_id: &str) -> AppResult<()> {
    let lease = get_row(pool, "leases", lease_id, "id").await?;
    let status = value_str(&lease, "lease_status");
    if status != "active" && status != "delinquent" {
        return Ok(());
    }

    let today_iso = Utc::now().date_naive().to_string();
    let unpaid = list_rows(
        pool,
        "collection_records",
        Some(&json_map(&[
            ("lease_id", Value::String(lease_id.to_string())),
            (
                "status",
                Value::Array(
                    ["scheduled", "pending", "late"]
                        .iter()
                        .map(|value| Value::String((*value).to_string()))
                        .collect(),
                ),
            ),
        ])),
        500,
        0,
        "created_at",
        false,
    )
    .await?;

    let has_overdue = unpaid.iter().any(|row| {
        row.as_object()
            .and_then(|obj| obj.get("due_date"))
            .and_then(Value::as_str)
            .is_some_and(|due_date| !due_date.is_empty() && due_date < today_iso.as_str())
    });

    let next_status = if has_overdue { "delinquent" } else { "active" };
    if next_status != status {
        let mut patch = Map::new();
        patch.insert(
            "lease_status".to_string(),
            Value::String(next_status.to_string()),
        );
        update_row(pool, "leases", lease_id, &patch, "id").await?;
    }

    Ok(())
}

async fn enrich_collection_rows(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let lease_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|obj| obj.get("lease_id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    let mut lease_index: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    if !lease_ids.is_empty() {
        let lease_count = lease_ids.len() as i64;
        let leases = list_rows(
            pool,
            "leases",
            Some(&json_map(&[(
                "id",
                Value::Array(lease_ids.iter().cloned().map(Value::String).collect()),
            )])),
            std::cmp::max(200, lease_count),
            0,
            "created_at",
            false,
        )
        .await?;

        for lease in leases {
            if let Some(lease_id) = lease
                .as_object()
                .and_then(|obj| obj.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lease_index.insert(lease_id.to_string(), lease);
            }
        }
    }

    let mut enriched = Vec::with_capacity(rows.len());
    for mut row in rows {
        if let Some(row_obj) = row.as_object_mut() {
            if let Some(lease_id) = row_obj
                .get("lease_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if let Some(lease) = lease_index.get(lease_id).and_then(Value::as_object) {
                    row_obj.insert(
                        "tenant_full_name".to_string(),
                        lease
                            .get("tenant_full_name")
                            .cloned()
                            .unwrap_or(Value::Null),
                    );
                    row_obj.insert(
                        "lease_status".to_string(),
                        lease.get("lease_status").cloned().unwrap_or(Value::Null),
                    );
                    row_obj.insert(
                        "property_id".to_string(),
                        lease.get("property_id").cloned().unwrap_or(Value::Null),
                    );
                    row_obj.insert(
                        "unit_id".to_string(),
                        lease.get("unit_id").cloned().unwrap_or(Value::Null),
                    );
                }
            }
        }
        enriched.push(row);
    }

    Ok(enriched)
}

fn ensure_lease_collections_enabled(state: &AppState) -> AppResult<()> {
    if state.config.lease_collections_enabled {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "Lease collections endpoints are disabled.".to_string(),
    ))
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
