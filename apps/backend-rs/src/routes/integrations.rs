use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit, clamp_limit_in_range, remove_nulls, serialize_to_map, AuditLogPath,
        AuditLogsQuery, CreateIntegrationInput, IntegrationEventPath, IntegrationEventsQuery,
        IntegrationPath, IntegrationsQuery, UpdateIntegrationInput,
    },
    services::{
        audit::write_audit_log, enrichment::enrich_integrations,
        ical::sync_listing_ical_reservations,
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        // --- Integrations CRUD ---
        .route(
            "/integrations",
            axum::routing::get(list_integrations).post(create_integration),
        )
        .route(
            "/integrations/{integration_id}",
            axum::routing::get(get_integration)
                .patch(update_integration)
                .delete(delete_integration),
        )
        .route(
            "/integrations/{integration_id}/sync-ical",
            axum::routing::post(sync_integration_ical),
        )
        .route(
            "/integrations/{integration_id}/sync-airbnb",
            axum::routing::post(sync_integration_airbnb),
        )
        .route(
            "/integrations/airbnb/auth-url",
            axum::routing::post(airbnb_auth_url),
        )
        .route(
            "/integrations/airbnb/callback",
            axum::routing::post(airbnb_callback),
        )
        // --- Integration events ---
        .route(
            "/integration-events",
            axum::routing::get(list_integration_events).post(create_integration_event),
        )
        .route(
            "/integration-events/{event_id}",
            axum::routing::get(get_integration_event),
        )
        .route(
            "/integrations/webhooks/{provider}",
            axum::routing::post(ingest_integration_webhook),
        )
        // --- Audit logs ---
        .route("/audit-logs", axum::routing::get(list_audit_logs))
        .route("/audit-logs/{log_id}", axum::routing::get(get_audit_log))
}

// ========== Integrations CRUD ==========

async fn list_integrations(
    State(state): State<AppState>,
    Query(query): Query<IntegrationsQuery>,
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
    if let Some(kind) = non_empty_opt(query.kind.as_deref()) {
        filters.insert("kind".to_string(), Value::String(kind));
    }

    let rows = list_rows(
        pool,
        "integrations",
        Some(&filters),
        clamp_limit(query.limit),
        0,
        "created_at",
        false,
    )
    .await?;
    let enriched = enrich_integrations(pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_integration(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateIntegrationInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;
    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "integrations", &record).await?;
    let entity_id = value_str(&created, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "integrations",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn get_integration(
    State(state): State<AppState>,
    Path(path): Path<IntegrationPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "integrations", &path.integration_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;
    let mut enriched = enrich_integrations(pool, vec![record], &org_id).await?;
    let first = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok(Json(first))
}

async fn update_integration(
    State(state): State<AppState>,
    Path(path): Path<IntegrationPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateIntegrationInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "integrations", &path.integration_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let patch = remove_nulls(serialize_to_map(&payload));
    let updated = update_row(pool, "integrations", &path.integration_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "integrations",
        Some(&path.integration_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;
    let mut enriched = enrich_integrations(pool, vec![updated], &org_id).await?;
    let first = enriched.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok(Json(first))
}

async fn delete_integration(
    State(state): State<AppState>,
    Path(path): Path<IntegrationPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "integrations", &path.integration_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;
    let deleted = delete_row(pool, "integrations", &path.integration_id, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "integrations",
        Some(&path.integration_id),
        Some(deleted.clone()),
        None,
    )
    .await;
    Ok(Json(deleted))
}

async fn sync_integration_ical(
    State(state): State<AppState>,
    Path(path): Path<IntegrationPath>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "integrations", &path.integration_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let integration_event = create_row(
        pool,
        "integration_events",
        &serde_json::from_value::<Map<String, Value>>(json!({
            "organization_id": org_id,
            "provider": "ical",
            "event_type": "listing_sync_requested",
            "payload": json!({"integration_id": path.integration_id, "requested_by_user_id": user_id}).to_string(),
            "status": "received",
        }))
        .unwrap_or_default(),
    )
    .await?;

    let event_id = value_str(&integration_event, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "create",
        "integration_events",
        Some(&event_id),
        None,
        Some(integration_event.clone()),
    )
    .await;

    let now_iso = chrono::Utc::now().to_rfc3339();

    match sync_listing_ical_reservations(pool, &state.http_client, &record, &user_id).await {
        Ok(result) => {
            let processed_at = result
                .get("processed_at")
                .and_then(Value::as_str)
                .unwrap_or(&now_iso)
                .to_string();

            let mut ie_payload: Map<String, Value> = serde_json::from_value(
                integration_event
                    .get("payload")
                    .cloned()
                    .unwrap_or(json!({})),
            )
            .unwrap_or_default();
            if let Some(result_obj) = result.as_object() {
                for (k, v) in result_obj {
                    ie_payload.insert(k.clone(), v.clone());
                }
            }

            let mut error_message = Value::Null;
            if let Some(errs) = result.get("errors").and_then(Value::as_array) {
                if !errs.is_empty() {
                    error_message =
                        Value::String(format!("Completed with {} error(s).", errs.len()));
                }
            }

            let _ = update_row(
                pool,
                "integration_events",
                &event_id,
                &serde_json::from_value::<Map<String, Value>>(json!({
                    "status": "processed",
                    "processed_at": processed_at,
                    "payload": Value::Object(ie_payload).to_string(),
                    "error_message": error_message,
                }))
                .unwrap_or_default(),
                "id",
            )
            .await;

            write_audit_log(
                state.db_pool.as_ref(),
                Some(&org_id),
                Some(&user_id),
                "sync",
                "integrations",
                Some(&path.integration_id),
                None,
                Some(
                    json!({"provider": "ical"})
                        .as_object()
                        .map(|o| {
                            let mut merged = o.clone();
                            if let Some(ro) = result.as_object() {
                                for (k, v) in ro {
                                    merged.insert(k.clone(), v.clone());
                                }
                            }
                            Value::Object(merged)
                        })
                        .unwrap_or(result.clone()),
                ),
            )
            .await;

            let mut response = json!({
                "status": "processed",
                "integration_id": path.integration_id,
                "integration_event_id": event_id,
            });
            if let Some(result_obj) = result.as_object() {
                for (k, v) in result_obj {
                    response[k] = v.clone();
                }
            }

            Ok((StatusCode::ACCEPTED, Json(response)))
        }
        Err(e) => {
            let _ = update_row(
                pool,
                "integration_events",
                &event_id,
                &serde_json::from_value::<Map<String, Value>>(json!({
                    "status": "failed",
                    "processed_at": now_iso,
                    "error_message": e.detail_message(),
                }))
                .unwrap_or_default(),
                "id",
            )
            .await;
            Err(e)
        }
    }
}

// ========== Integration events ==========

async fn list_integration_events(
    State(state): State<AppState>,
    Query(query): Query<IntegrationEventsQuery>,
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
    if let Some(provider) = non_empty_opt(query.provider.as_deref()) {
        filters.insert("provider".to_string(), Value::String(provider));
    }
    if let Some(event_type) = non_empty_opt(query.event_type.as_deref()) {
        filters.insert("event_type".to_string(), Value::String(event_type));
    }
    if let Some(status) = non_empty_opt(query.status.as_deref()) {
        filters.insert("status".to_string(), Value::String(status));
    }

    let rows = list_rows(
        pool,
        "integration_events",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "received_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_integration_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let Some(payload_obj) = payload.as_object() else {
        return Err(AppError::BadRequest(
            "payload must be an object.".to_string(),
        ));
    };

    let organization_id = payload_obj
        .get("organization_id")
        .or_else(|| payload_obj.get("org_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::BadRequest("organization_id is required.".to_string()))?;

    let provider = payload_obj
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::BadRequest("provider is required.".to_string()))?;

    let event_type = payload_obj
        .get("event_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::BadRequest("event_type is required.".to_string()))?;

    let body = payload_obj
        .get("payload")
        .cloned()
        .ok_or_else(|| AppError::BadRequest("payload is required.".to_string()))?;

    assert_org_role(
        &state,
        &user_id,
        &organization_id,
        &["owner_admin", "operator"],
    )
    .await?;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(organization_id),
    );
    record.insert("provider".to_string(), Value::String(provider));
    record.insert("event_type".to_string(), Value::String(event_type));
    if let Some(external_event_id) = payload_obj
        .get("external_event_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "external_event_id".to_string(),
            Value::String(external_event_id.to_string()),
        );
    }
    record.insert("payload".to_string(), body);
    record.insert("status".to_string(), Value::String("received".to_string()));

    let created = create_row(pool, "integration_events", &record).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn get_integration_event(
    State(state): State<AppState>,
    Path(path): Path<IntegrationEventPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "integration_events", &path.event_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    if org_id.is_empty() {
        return Err(AppError::Forbidden(
            "Forbidden: integration event is missing organization context.".to_string(),
        ));
    }
    assert_org_member(&state, &user_id, &org_id).await?;
    Ok(Json(record))
}

#[derive(Debug, Deserialize)]
struct IngestWebhookQuery {
    org_id: String,
    event_type: String,
    external_event_id: Option<String>,
}

async fn ingest_integration_webhook(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(query): Query<IngestWebhookQuery>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    assert_org_role(
        &state,
        &user_id,
        &query.org_id,
        &["owner_admin", "operator"],
    )
    .await?;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    record.insert("provider".to_string(), Value::String(provider));
    record.insert(
        "event_type".to_string(),
        Value::String(query.event_type.clone()),
    );
    if let Some(external_event_id) = non_empty_opt(query.external_event_id.as_deref()) {
        record.insert(
            "external_event_id".to_string(),
            Value::String(external_event_id),
        );
    }
    record.insert("payload".to_string(), payload);
    record.insert("status".to_string(), Value::String("received".to_string()));

    let created = create_row(pool, "integration_events", &record).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

// ========== Audit logs ==========

async fn list_audit_logs(
    State(state): State<AppState>,
    Query(query): Query<AuditLogsQuery>,
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
    if let Some(action) = non_empty_opt(query.action.as_deref()) {
        filters.insert("action".to_string(), Value::String(action));
    }
    if let Some(entity_name) = non_empty_opt(query.entity_name.as_deref()) {
        filters.insert("entity_name".to_string(), Value::String(entity_name));
    }

    let rows = list_rows(
        pool,
        "audit_logs",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 2000),
        0,
        "created_at",
        false,
    )
    .await?;
    Ok(Json(json!({ "data": rows })))
}

async fn get_audit_log(
    State(state): State<AppState>,
    Path(path): Path<AuditLogPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let row = sqlx::query("SELECT row_to_json(t) AS row FROM audit_logs t WHERE id = $1 LIMIT 1")
        .bind(path.log_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    let record = row
        .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("audit_logs record not found.".to_string()))?;

    let org_id = value_str(&record, "organization_id");
    if org_id.is_empty() {
        return Err(AppError::Forbidden(
            "Forbidden: audit log is missing organization context.".to_string(),
        ));
    }
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

// ========== Helpers ==========

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

// ========== Airbnb Connected API ==========

#[derive(Debug, Deserialize)]
struct AirbnbAuthUrlInput {
    org_id: String,
    integration_id: String,
}

#[derive(Debug, Deserialize)]
struct AirbnbCallbackInput {
    org_id: String,
    integration_id: String,
    code: String,
}

async fn airbnb_auth_url(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AirbnbAuthUrlInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, &["owner_admin", "operator"]).await?;

    let config = crate::services::airbnb::AirbnbConfig::from_env()
        .ok_or_else(|| AppError::Dependency("Airbnb API credentials not configured.".to_string()))?;

    let state_param = format!("{}:{}", payload.org_id, payload.integration_id);
    let auth_url = config.auth_url(&state_param);

    Ok(Json(json!({ "auth_url": auth_url })))
}

async fn airbnb_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AirbnbCallbackInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.org_id, &["owner_admin", "operator"]).await?;
    let pool = db_pool(&state)?;

    let config = crate::services::airbnb::AirbnbConfig::from_env()
        .ok_or_else(|| AppError::Dependency("Airbnb API credentials not configured.".to_string()))?;

    let token_response =
        crate::services::airbnb::exchange_code(&state.http_client, &config, &payload.code)
            .await
            .map_err(|e| AppError::Dependency(e))?;

    // Store tokens in integration metadata
    sqlx::query(
        "UPDATE integrations SET
           metadata = COALESCE(metadata, '{}'::jsonb) ||
             jsonb_build_object(
               'airbnb_access_token', $2::text,
               'airbnb_refresh_token', COALESCE($3::text, ''),
               'airbnb_token_expires_at', COALESCE($4::bigint, 0)::text
             ),
           updated_at = now()
         WHERE id = $1::uuid",
    )
    .bind(&payload.integration_id)
    .bind(&token_response.access_token)
    .bind(&token_response.refresh_token)
    .bind(token_response.expires_at)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to store Airbnb tokens");
        AppError::Dependency("Failed to save Airbnb connection.".to_string())
    })?;

    write_audit_log(
        Some(pool),
        Some(&payload.org_id),
        Some(&user_id),
        "airbnb_connected",
        "integrations",
        Some(&payload.integration_id),
        None,
        None,
    )
    .await;

    Ok(Json(json!({
        "ok": true,
        "message": "Airbnb account connected successfully.",
        "integration_id": payload.integration_id,
    })))
}

async fn sync_integration_airbnb(
    State(state): State<AppState>,
    Path(path): Path<IntegrationPath>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "integrations", &path.integration_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    let unit_id = value_str(&record, "unit_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    // Get stored tokens
    let (access_token, listing_id) =
        crate::services::airbnb::get_integration_airbnb_token(pool, &path.integration_id)
            .await
            .map_err(AppError::Dependency)?;

    // Log sync event
    let integration_event = create_row(
        pool,
        "integration_events",
        &serde_json::from_value::<Map<String, Value>>(json!({
            "organization_id": org_id,
            "provider": "airbnb",
            "event_type": "listing_sync_requested",
            "payload": json!({"integration_id": path.integration_id, "requested_by_user_id": user_id}).to_string(),
            "status": "received",
        }))
        .unwrap_or_default(),
    )
    .await?;
    let event_id = value_str(&integration_event, "id");

    match crate::services::airbnb::sync_airbnb_integration(
        pool,
        &state.http_client,
        &path.integration_id,
        &access_token,
        &listing_id,
        &org_id,
        &unit_id,
    )
    .await
    {
        Ok(report) => {
            // Mark event as processed
            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("processed".to_string()));
            let _ = update_row(pool, "integration_events", &event_id, &patch, "id").await;

            Ok((
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "integration_id": path.integration_id,
                    "sync_report": report,
                })),
            ))
        }
        Err(err_msg) => {
            // Mark event as failed
            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("failed".to_string()));
            let _ = update_row(pool, "integration_events", &event_id, &patch, "id").await;

            // Store error on integration
            sqlx::query(
                "UPDATE integrations SET ical_sync_error = $2, last_ical_sync_at = now()
                 WHERE id = $1::uuid",
            )
            .bind(&path.integration_id)
            .bind(&err_msg)
            .execute(pool)
            .await
            .ok();

            Err(AppError::Dependency(err_msg))
        }
    }
}
