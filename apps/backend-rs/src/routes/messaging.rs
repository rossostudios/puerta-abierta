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
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateMessageTemplateInput,
        MessageTemplatesQuery, SendMessageInput, TemplatePath,
    },
    services::audit::write_audit_log,
    services::collection_cycle::run_daily_collection_cycle,
    services::ical::sync_all_ical_integrations,
    services::lease_renewal::run_lease_renewal_scan,
    services::messaging::process_queued_messages,
    services::sequences::process_sequences,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/message-templates",
            axum::routing::get(list_templates).post(create_template),
        )
        .route(
            "/message-templates/{template_id}",
            axum::routing::get(get_template),
        )
        .route("/messages/send", axum::routing::post(send_message))
        .route(
            "/internal/process-messages",
            axum::routing::post(process_messages),
        )
        .route(
            "/internal/collection-cycle",
            axum::routing::post(run_collection_cycle),
        )
        .route(
            "/webhooks/whatsapp",
            axum::routing::post(whatsapp_webhook).get(whatsapp_webhook_verify),
        )
        .route(
            "/internal/sync-ical",
            axum::routing::post(sync_ical),
        )
        .route(
            "/internal/process-sequences",
            axum::routing::post(process_sequences_endpoint),
        )
}

async fn list_templates(
    State(state): State<AppState>,
    Query(query): Query<MessageTemplatesQuery>,
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
    if let Some(channel) = non_empty_opt(query.channel.as_deref()) {
        filters.insert("channel".to_string(), Value::String(channel));
    }

    let rows = list_rows(
        pool,
        "message_templates",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateMessageTemplateInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "operator"],
    )
    .await?;
    let pool = db_pool(&state)?;

    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "message_templates", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "message_templates",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_template(
    State(state): State<AppState>,
    Path(path): Path<TemplatePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "message_templates", &path.template_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "operator"],
    )
    .await?;
    let pool = db_pool(&state)?;

    let mut log = remove_nulls(serialize_to_map(&payload));
    log.insert("status".to_string(), Value::String("queued".to_string()));
    if !log.contains_key("scheduled_at") {
        log.insert(
            "scheduled_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    }

    let created = create_row(pool, "message_logs", &log).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "message_logs",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::ACCEPTED, Json(created)))
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

/// Internal cron-compatible endpoint that processes queued messages.
async fn process_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let expected_key = state.config.internal_api_key.as_deref().unwrap_or_default();
    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;
    let (sent, failed) = process_queued_messages(pool, &state.http_client, &state.config).await;

    Ok(Json(json!({ "sent": sent, "failed": failed })))
}

/// Internal cron-compatible endpoint that runs the daily collection cycle.
/// Activates upcoming collections, sends reminders, marks late, escalates.
async fn run_collection_cycle(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let expected_key = state.config.internal_api_key.as_deref().unwrap_or_default();
    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;

    // Optional org_id filter from query/body
    let org_id: Option<String> = headers
        .get("x-org-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let collection_result = run_daily_collection_cycle(
        pool,
        org_id.as_deref(),
        &state.config.app_public_url,
    )
    .await;

    let renewal_result = run_lease_renewal_scan(
        pool,
        org_id.as_deref(),
        &state.config.app_public_url,
    )
    .await;

    Ok(Json(json!({
        "collections": serde_json::to_value(&collection_result).unwrap_or_default(),
        "renewals": {
            "offers_sent_60d": renewal_result.offers_sent_60d,
            "reminders_sent_30d": renewal_result.reminders_sent_30d,
            "expired": renewal_result.expired,
        },
    })))
}

/// Internal cron-compatible endpoint that syncs all iCal integrations.
async fn sync_ical(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let expected_key = state.config.internal_api_key.as_deref().unwrap_or_default();
    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;
    let result = sync_all_ical_integrations(pool, &state.http_client).await;

    Ok(Json(result))
}

/// WhatsApp webhook verification (GET) — responds to Meta verification challenge.
async fn whatsapp_webhook_verify(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> AppResult<impl IntoResponse> {
    let mode = params.get("hub.mode").map(String::as_str).unwrap_or("");
    let token = params
        .get("hub.verify_token")
        .map(String::as_str)
        .unwrap_or("");
    let challenge = params
        .get("hub.challenge")
        .map(String::as_str)
        .unwrap_or("");

    let expected_token = state
        .config
        .whatsapp_verify_token
        .as_deref()
        .unwrap_or_default();

    if mode == "subscribe"
        && !token.is_empty()
        && (expected_token.is_empty() || token == expected_token)
    {
        Ok(challenge.to_string())
    } else {
        Err(AppError::Forbidden(
            "Invalid verification request.".to_string(),
        ))
    }
}

/// WhatsApp webhook (POST) — receives delivery status updates AND inbound messages.
async fn whatsapp_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> AppResult<impl IntoResponse> {
    let pool = db_pool(&state)?;

    // Parse WhatsApp Cloud API webhook format
    if let Some(entries) = payload.get("entry").and_then(Value::as_array) {
        for entry in entries {
            if let Some(changes) = entry.get("changes").and_then(Value::as_array) {
                for change in changes {
                    let value_obj = change.get("value");

                    // ── Handle inbound messages ──
                    if let Some(messages) = value_obj
                        .and_then(|v| v.get("messages"))
                        .and_then(Value::as_array)
                    {
                        for msg in messages {
                            let sender_phone = msg
                                .get("from")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let wa_msg_id = msg
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let msg_type = msg
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("text");

                            if sender_phone.is_empty() {
                                continue;
                            }

                            let text = match msg_type {
                                "text" => msg
                                    .get("text")
                                    .and_then(|t| t.get("body"))
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                "image" | "document" | "video" | "audio" => {
                                    format!("[{msg_type} attachment]")
                                }
                                _ => format!("[{msg_type}]"),
                            };

                            let media_url = msg
                                .get(msg_type)
                                .and_then(|m| m.get("link").or(m.get("url")))
                                .and_then(Value::as_str);

                            // Try to match sender to a guest or tenant
                            let org_id = match_phone_to_org(pool, sender_phone).await;

                            let _ = crate::services::messaging::create_inbound_message(
                                pool,
                                org_id.as_deref(),
                                sender_phone,
                                &text,
                                media_url,
                                wa_msg_id,
                            )
                            .await;

                            // AI auto-reply for guest messages
                            if let Some(oid) = &org_id {
                                if msg_type == "text" && !text.is_empty() {
                                    let pool = pool.clone();
                                    let http = state.http_client.clone();
                                    let config = state.config.clone();
                                    let oid = oid.clone();
                                    let phone = sender_phone.to_string();
                                    let body = text.clone();
                                    tokio::spawn(async move {
                                        if let Some((reply, confidence)) =
                                            crate::services::ai_guest_reply::generate_ai_reply(
                                                &pool, &http, &config, &oid, &phone, &body,
                                            )
                                            .await
                                        {
                                            crate::services::ai_guest_reply::queue_ai_reply(
                                                &pool, &oid, &phone, &reply, confidence,
                                            )
                                            .await;
                                        }
                                    });
                                }
                            }
                        }
                    }

                    // ── Handle delivery status updates ──
                    if let Some(statuses) = value_obj
                        .and_then(|v| v.get("statuses"))
                        .and_then(Value::as_array)
                    {
                        for status_update in statuses {
                            let wa_msg_id = status_update
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let status = status_update
                                .get("status")
                                .and_then(Value::as_str)
                                .unwrap_or_default();

                            if wa_msg_id.is_empty() || status.is_empty() {
                                continue;
                            }

                            // Map WhatsApp status to our status
                            let our_status = match status {
                                "sent" => "sent",
                                "delivered" => "delivered",
                                "read" => "delivered",
                                "failed" => "failed",
                                _ => continue,
                            };

                            // Find message_log by provider_response containing this wa_msg_id
                            // and update its status
                            let messages = list_rows(
                                pool,
                                "message_logs",
                                Some(&{
                                    let mut f = serde_json::Map::new();
                                    f.insert(
                                        "status".to_string(),
                                        Value::String("sent".to_string()),
                                    );
                                    f
                                }),
                                200,
                                0,
                                "sent_at",
                                false,
                            )
                            .await
                            .unwrap_or_default();

                            for msg in &messages {
                                let provider_msg_id = msg
                                    .as_object()
                                    .and_then(|o| o.get("provider_response"))
                                    .and_then(|pr| pr.get("messages"))
                                    .and_then(Value::as_array)
                                    .and_then(|arr| arr.first())
                                    .and_then(|m| m.get("id"))
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();

                                if provider_msg_id == wa_msg_id {
                                    let msg_id = value_str(msg, "id");
                                    if !msg_id.is_empty() {
                                        let mut patch = serde_json::Map::new();
                                        patch.insert(
                                            "status".to_string(),
                                            Value::String(our_status.to_string()),
                                        );
                                        let _ =
                                            update_row(pool, "message_logs", &msg_id, &patch, "id")
                                                .await;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(axum::http::StatusCode::OK)
}

/// Internal cron-compatible endpoint that processes communication sequences.
async fn process_sequences_endpoint(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let api_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let expected_key = state.config.internal_api_key.as_deref().unwrap_or_default();
    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;
    let (sent, errors) = process_sequences(pool).await;

    Ok(Json(json!({ "sent": sent, "errors": errors })))
}

/// Try to find an organization by matching a phone number to guests or tenants.
async fn match_phone_to_org(pool: &sqlx::PgPool, phone: &str) -> Option<String> {
    // Check guests first
    let mut filters = serde_json::Map::new();
    filters.insert(
        "phone_e164".to_string(),
        Value::String(phone.to_string()),
    );
    if let Ok(guests) = list_rows(pool, "guests", Some(&filters), 1, 0, "created_at", false).await {
        if let Some(guest) = guests.first() {
            let org_id = value_str(guest, "organization_id");
            if !org_id.is_empty() {
                return Some(org_id);
            }
        }
    }

    // Check leases (tenant phone)
    let mut lease_filters = serde_json::Map::new();
    lease_filters.insert(
        "tenant_phone_e164".to_string(),
        Value::String(phone.to_string()),
    );
    if let Ok(leases) = list_rows(pool, "leases", Some(&lease_filters), 1, 0, "created_at", false).await {
        if let Some(lease) = leases.first() {
            let org_id = value_str(lease, "organization_id");
            if !org_id.is_empty() {
                return Some(org_id);
            }
        }
    }

    None
}
