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
    services::messaging::process_queued_messages,
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
            "/webhooks/whatsapp",
            axum::routing::post(whatsapp_webhook).get(whatsapp_webhook_verify),
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
    let expected_key = state
        .config
        .internal_api_key
        .as_deref()
        .unwrap_or_default();
    if !expected_key.is_empty() && api_key != expected_key {
        return Err(AppError::Unauthorized(
            "Invalid or missing API key.".to_string(),
        ));
    }

    let pool = db_pool(&state)?;
    let (sent, failed) = process_queued_messages(pool, &state.http_client, &state.config).await;

    Ok(Json(json!({ "sent": sent, "failed": failed })))
}

/// WhatsApp webhook verification (GET) — responds to Meta verification challenge.
async fn whatsapp_webhook_verify(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> AppResult<impl IntoResponse> {
    let mode = params.get("hub.mode").map(String::as_str).unwrap_or("");
    let token = params.get("hub.verify_token").map(String::as_str).unwrap_or("");
    let challenge = params.get("hub.challenge").map(String::as_str).unwrap_or("");

    if mode == "subscribe" && !token.is_empty() {
        Ok(challenge.to_string())
    } else {
        Err(AppError::Forbidden("Invalid verification request.".to_string()))
    }
}

/// WhatsApp webhook (POST) — receives delivery status updates.
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
                    if let Some(statuses) = change
                        .get("value")
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
