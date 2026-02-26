use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateNotificationRuleInput,
        NotificationRulePath, NotificationRulesMetadataQuery, NotificationRulesQuery,
        UpdateNotificationRuleInput,
    },
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const NOTIFICATION_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];

struct TriggerMetadata {
    value: &'static str,
    label_en: &'static str,
    label_es: &'static str,
    mode: &'static str,
}

const NOTIFICATION_TRIGGER_METADATA: &[TriggerMetadata] = &[
    TriggerMetadata {
        value: "collection_overdue",
        label_en: "Collection overdue",
        label_es: "Cobro vencido",
        mode: "event",
    },
    TriggerMetadata {
        value: "collection_escalated",
        label_en: "Collection escalated",
        label_es: "Cobro escalado",
        mode: "event",
    },
    TriggerMetadata {
        value: "maintenance_submitted",
        label_en: "Maintenance submitted",
        label_es: "Mantenimiento recibido",
        mode: "event",
    },
    TriggerMetadata {
        value: "maintenance_acknowledged",
        label_en: "Maintenance acknowledged",
        label_es: "Mantenimiento confirmado",
        mode: "event",
    },
    TriggerMetadata {
        value: "maintenance_scheduled",
        label_en: "Maintenance scheduled",
        label_es: "Mantenimiento programado",
        mode: "event",
    },
    TriggerMetadata {
        value: "maintenance_completed",
        label_en: "Maintenance completed",
        label_es: "Mantenimiento completado",
        mode: "event",
    },
    TriggerMetadata {
        value: "guest_message_received",
        label_en: "Guest message received",
        label_es: "Mensaje del huésped recibido",
        mode: "event",
    },
    TriggerMetadata {
        value: "message_send_failed",
        label_en: "Message send failed",
        label_es: "Error de envío",
        mode: "event",
    },
    TriggerMetadata {
        value: "application_status_changed",
        label_en: "Application status changed",
        label_es: "Cambio de estado de aplicación",
        mode: "event",
    },
    TriggerMetadata {
        value: "application_received",
        label_en: "Application received (legacy)",
        label_es: "Aplicación recibida (legado)",
        mode: "legacy",
    },
    TriggerMetadata {
        value: "payment_confirmed",
        label_en: "Payment confirmed (legacy)",
        label_es: "Pago confirmado (legado)",
        mode: "legacy",
    },
    TriggerMetadata {
        value: "rent_due_3d",
        label_en: "Rent due in 3 days (legacy)",
        label_es: "Alquiler vence en 3 días (legado)",
        mode: "legacy",
    },
    TriggerMetadata {
        value: "rent_due_1d",
        label_en: "Rent due in 1 day (legacy)",
        label_es: "Alquiler vence en 1 día (legado)",
        mode: "legacy",
    },
    TriggerMetadata {
        value: "rent_overdue_1d",
        label_en: "Rent overdue 1 day (legacy)",
        label_es: "Alquiler vencido 1 día (legado)",
        mode: "legacy",
    },
    TriggerMetadata {
        value: "rent_overdue_7d",
        label_en: "Rent overdue 7 days (legacy)",
        label_es: "Alquiler vencido 7 días (legado)",
        mode: "legacy",
    },
];

const NOTIFICATION_CHANNELS: &[&str] = &["whatsapp", "email", "sms"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/notification-rules",
            axum::routing::get(list_notification_rules).post(create_notification_rule),
        )
        .route(
            "/notification-rules/metadata",
            axum::routing::get(notification_rules_metadata),
        )
        .route(
            "/notification-rules/{rule_id}",
            axum::routing::get(get_notification_rule).patch(update_notification_rule),
        )
        .route(
            "/internal/process-notifications",
            axum::routing::post(process_notifications),
        )
}

async fn list_notification_rules(
    State(state): State<AppState>,
    Query(query): Query<NotificationRulesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let org_id = query.org_id.to_string();
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id));
    if let Some(is_active) = query.is_active {
        filters.insert(
            "is_active".to_string(),
            Value::String(is_active.to_string()),
        );
    }

    let rows = list_rows(
        pool,
        "notification_rules",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 200),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn notification_rules_metadata(
    State(state): State<AppState>,
    Query(query): Query<NotificationRulesMetadataQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let org_id = query.org_id.to_string();
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(json!({
        "channels": NOTIFICATION_CHANNELS,
        "triggers": NOTIFICATION_TRIGGER_METADATA
            .iter()
            .map(|trigger| {
                json!({
                    "value": trigger.value,
                    "label_en": trigger.label_en,
                    "label_es": trigger.label_es,
                    "mode": trigger.mode,
                })
            })
            .collect::<Vec<_>>()
    })))
}

async fn create_notification_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateNotificationRuleInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        NOTIFICATION_EDIT_ROLES,
    )
    .await?;
    let pool = db_pool(&state)?;

    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "notification_rules", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "notification_rules",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_notification_rule(
    State(state): State<AppState>,
    Path(path): Path<NotificationRulePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "notification_rules", &path.rule_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn update_notification_rule(
    State(state): State<AppState>,
    Path(path): Path<NotificationRulePath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateNotificationRuleInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let existing = get_row(pool, "notification_rules", &path.rule_id, "id").await?;
    let org_id = value_str(&existing, "organization_id");
    assert_org_role(&state, &user_id, &org_id, NOTIFICATION_EDIT_ROLES).await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    if patch.is_empty() {
        return Ok(Json(existing));
    }

    let updated = update_row(pool, "notification_rules", &path.rule_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "notification_rules",
        Some(&path.rule_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

/// Internal cron-compatible endpoint for processing pending notifications.
/// Mode is controlled by NOTIFICATION_RULES_ENFORCED:
/// - false => legacy date-based processing (existing behavior)
/// - true  => event-driven idempotent processing from notification_events
async fn process_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    // Validate internal API key
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

    if state.config.notification_rules_enforced {
        let (processed, errors) = process_event_rules(pool).await;
        return Ok(Json(json!({
            "mode": "event_rules",
            "processed": processed,
            "errors": errors,
        })));
    }

    let (processed, errors, date) = process_legacy_rules(pool).await;
    Ok(Json(json!({
        "mode": "legacy",
        "processed": processed,
        "errors": errors,
        "date": date,
    })))
}

async fn process_legacy_rules(pool: &sqlx::PgPool) -> (u32, u32, String) {
    let today = chrono::Utc::now().date_naive();
    let mut processed = 0u32;
    let mut errors = 0u32;

    // Fetch all active notification rules across all orgs
    let rules = list_rows(
        pool,
        "notification_rules",
        Some(&{
            let mut f = Map::new();
            f.insert("is_active".to_string(), Value::String("true".to_string()));
            f
        }),
        1000,
        0,
        "created_at",
        true,
    )
    .await
    .unwrap_or_default();

    for rule in &rules {
        let trigger = value_str(rule, "trigger_event");
        let org_id = value_str(rule, "organization_id");
        let channel = value_str(rule, "channel");

        if org_id.is_empty() || trigger.is_empty() {
            continue;
        }

        // Determine which collections match this trigger
        let target_date = match trigger.as_str() {
            "rent_due_3d" => Some(today + chrono::Duration::days(3)),
            "rent_due_1d" => Some(today + chrono::Duration::days(1)),
            "rent_overdue_1d" => Some(today - chrono::Duration::days(1)),
            "rent_overdue_7d" => Some(today - chrono::Duration::days(7)),
            _ => None,
        };

        let Some(target) = target_date else {
            continue;
        };

        let target_str = target.to_string();
        let mut filters = Map::new();
        filters.insert("organization_id".to_string(), Value::String(org_id.clone()));
        filters.insert(
            "status".to_string(),
            Value::Array(
                ["scheduled", "pending", "late"]
                    .iter()
                    .map(|s| Value::String((*s).to_string()))
                    .collect(),
            ),
        );

        let collections = list_rows(
            pool,
            "collection_records",
            Some(&filters),
            500,
            0,
            "due_date",
            true,
        )
        .await
        .unwrap_or_default();

        for collection in &collections {
            let due_date = value_str(collection, "due_date");
            if due_date != target_str {
                continue;
            }

            let lease_id = value_str(collection, "lease_id");
            if lease_id.is_empty() {
                continue;
            }

            let lease = match get_row(pool, "leases", &lease_id, "id").await {
                Ok(l) => l,
                Err(_) => continue,
            };

            let recipient = match channel.as_str() {
                "whatsapp" => value_str(&lease, "tenant_phone_e164"),
                "email" => value_str(&lease, "tenant_email"),
                _ => continue,
            };

            if recipient.is_empty() {
                continue;
            }

            let mut msg = Map::new();
            msg.insert("organization_id".to_string(), Value::String(org_id.clone()));
            msg.insert("channel".to_string(), Value::String(channel.clone()));
            msg.insert("recipient".to_string(), Value::String(recipient));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            );

            let mut payload_map = Map::new();
            payload_map.insert("trigger_event".to_string(), Value::String(trigger.clone()));
            payload_map.insert(
                "tenant_name".to_string(),
                Value::String(value_str(&lease, "tenant_full_name")),
            );
            payload_map.insert(
                "amount".to_string(),
                collection
                    .as_object()
                    .and_then(|o| o.get("amount"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            payload_map.insert(
                "currency".to_string(),
                Value::String(value_str(collection, "currency")),
            );
            payload_map.insert("due_date".to_string(), Value::String(due_date.clone()));
            payload_map.insert(
                "collection_id".to_string(),
                Value::String(value_str(collection, "id")),
            );
            msg.insert("payload".to_string(), Value::Object(payload_map));

            if let Some(template_id) = rule
                .as_object()
                .and_then(|o| o.get("message_template_id"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                msg.insert(
                    "template_id".to_string(),
                    Value::String(template_id.to_string()),
                );
            }

            match create_row(pool, "message_logs", &msg).await {
                Ok(_) => processed += 1,
                Err(_) => errors += 1,
            }
        }
    }

    (processed, errors, today.to_string())
}

async fn process_event_rules(pool: &sqlx::PgPool) -> (u32, u32) {
    let mut processed = 0u32;
    let mut errors = 0u32;

    let rules = list_rows(
        pool,
        "notification_rules",
        Some(&{
            let mut f = Map::new();
            f.insert("is_active".to_string(), Value::String("true".to_string()));
            f
        }),
        1000,
        0,
        "created_at",
        true,
    )
    .await
    .unwrap_or_default();

    for rule in &rules {
        let rule_id = value_str(rule, "id");
        let trigger = value_str(rule, "trigger_event");
        let org_id = value_str(rule, "organization_id");
        let channel = value_str(rule, "channel");

        if rule_id.is_empty() || trigger.is_empty() || org_id.is_empty() || channel.is_empty() {
            continue;
        }

        let events = match sqlx::query(
            "SELECT id::text AS id, event_type, title, body, link_path, payload
             FROM notification_events
             WHERE organization_id = $1::uuid
             ORDER BY occurred_at DESC
             LIMIT 500",
        )
        .bind(&org_id)
        .fetch_all(pool)
        .await
        {
            Ok(rows) => rows,
            Err(_) => {
                errors += 1;
                continue;
            }
        };

        for event in events {
            let event_id = event.try_get::<String, _>("id").unwrap_or_default();
            let event_type = event.try_get::<String, _>("event_type").unwrap_or_default();
            if event_id.is_empty() || !event_matches_trigger(&event_type, &trigger) {
                continue;
            }

            let payload = event
                .try_get::<Option<Value>, _>("payload")
                .ok()
                .flatten()
                .and_then(|value| value.as_object().cloned())
                .unwrap_or_default();

            let recipient = dispatch_recipient(&channel, &payload);
            if recipient.is_empty() {
                continue;
            }

            let dispatch_id = match sqlx::query(
                "INSERT INTO notification_rule_dispatches
                    (notification_rule_id, event_id, recipient, channel)
                 VALUES ($1::uuid, $2::uuid, $3, $4::message_channel)
                 ON CONFLICT (notification_rule_id, event_id, recipient, channel)
                 DO NOTHING
                 RETURNING id::text AS id",
            )
            .bind(&rule_id)
            .bind(&event_id)
            .bind(&recipient)
            .bind(&channel)
            .fetch_optional(pool)
            .await
            {
                Ok(row) => row.and_then(|value| value.try_get::<String, _>("id").ok()),
                Err(_) => {
                    errors += 1;
                    None
                }
            };

            let Some(dispatch_id) = dispatch_id else {
                continue;
            };

            let title = event.try_get::<String, _>("title").unwrap_or_default();
            let body = event.try_get::<String, _>("body").unwrap_or_default();
            let link_path = event
                .try_get::<Option<String>, _>("link_path")
                .ok()
                .flatten();

            let mut msg = Map::new();
            msg.insert("organization_id".to_string(), Value::String(org_id.clone()));
            msg.insert("channel".to_string(), Value::String(channel.clone()));
            msg.insert("recipient".to_string(), Value::String(recipient.clone()));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            );
            msg.insert(
                "direction".to_string(),
                Value::String("outbound".to_string()),
            );

            if let Some(template_id) = rule
                .as_object()
                .and_then(|o| o.get("message_template_id"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                msg.insert(
                    "template_id".to_string(),
                    Value::String(template_id.to_string()),
                );
            }

            let mut outbound_payload = payload.clone();
            outbound_payload.insert("body".to_string(), Value::String(body.clone()));
            outbound_payload.insert("title".to_string(), Value::String(title));
            outbound_payload.insert("trigger_event".to_string(), Value::String(trigger.clone()));
            outbound_payload.insert(
                "notification_event_id".to_string(),
                Value::String(event_id.clone()),
            );
            if let Some(link_path) = link_path {
                outbound_payload.insert("link_path".to_string(), Value::String(link_path));
            }
            msg.insert("payload".to_string(), Value::Object(outbound_payload));

            match create_row(pool, "message_logs", &msg).await {
                Ok(created_log) => {
                    let message_log_id = value_str(&created_log, "id");
                    if !message_log_id.is_empty() {
                        let _ = sqlx::query(
                            "UPDATE notification_rule_dispatches
                             SET message_log_id = $1::uuid
                             WHERE id = $2::uuid",
                        )
                        .bind(message_log_id)
                        .bind(dispatch_id)
                        .execute(pool)
                        .await;
                    }
                    processed += 1;
                }
                Err(_) => {
                    errors += 1;
                }
            }
        }
    }

    (processed, errors)
}

fn event_matches_trigger(event_type: &str, trigger: &str) -> bool {
    if event_type == trigger {
        return true;
    }

    matches!(
        (event_type, trigger),
        ("collection_overdue", "rent_overdue_1d")
            | ("collection_escalated", "rent_overdue_7d")
            | ("application_status_changed", "application_received")
    )
}

fn dispatch_recipient(channel: &str, payload: &Map<String, Value>) -> String {
    let keys = match channel {
        "email" => [
            "recipient_email",
            "tenant_email",
            "email",
            "recipient",
            "submitted_by_email",
        ]
        .as_slice(),
        _ => [
            "recipient_phone",
            "tenant_phone_e164",
            "phone_e164",
            "recipient",
            "guest_phone_e164",
            "submitted_by_phone",
        ]
        .as_slice(),
    };

    for key in keys {
        if let Some(value) = payload
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
    }

    String::new()
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Database is not configured. Set DATABASE_URL (legacy SUPABASE_DB_URL is also supported).".to_string(),
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

#[cfg(test)]
mod tests {
    use super::{dispatch_recipient, event_matches_trigger};
    use serde_json::json;

    #[test]
    fn event_matches_exact_and_legacy_aliases() {
        assert!(event_matches_trigger(
            "collection_overdue",
            "collection_overdue"
        ));
        assert!(event_matches_trigger(
            "collection_overdue",
            "rent_overdue_1d"
        ));
        assert!(event_matches_trigger(
            "collection_escalated",
            "rent_overdue_7d"
        ));
        assert!(event_matches_trigger(
            "application_status_changed",
            "application_received"
        ));
        assert!(!event_matches_trigger(
            "maintenance_submitted",
            "rent_due_3d"
        ));
    }

    #[test]
    fn dispatch_recipient_uses_channel_specific_keys() {
        let payload = json!({
            "recipient_email": "team@example.com",
            "recipient_phone": "+595981000000",
            "tenant_email": "tenant@example.com",
            "tenant_phone_e164": "+595982000000"
        });
        let map = payload.as_object().expect("payload object");

        assert_eq!(dispatch_recipient("email", map), "team@example.com");
        assert_eq!(dispatch_recipient("whatsapp", map), "+595981000000");
        assert_eq!(dispatch_recipient("sms", map), "+595981000000");
    }

    #[test]
    fn dispatch_recipient_returns_empty_when_missing() {
        let payload = json!({
            "irrelevant": "value"
        });
        let map = payload.as_object().expect("payload object");
        assert!(dispatch_recipient("email", map).is_empty());
        assert!(dispatch_recipient("whatsapp", map).is_empty());
    }
}
