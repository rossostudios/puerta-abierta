use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, CreateNotificationRuleInput,
        NotificationRulePath, NotificationRulesQuery, UpdateNotificationRuleInput,
    },
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const NOTIFICATION_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/notification-rules",
            axum::routing::get(list_notification_rules).post(create_notification_rule),
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
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
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
/// Protected by API key in production (checked via middleware/config).
async fn process_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    // Validate internal API key
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
    .await?;

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
        filters.insert(
            "organization_id".to_string(),
            Value::String(org_id.clone()),
        );
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

            // Queue the message
            let mut msg = Map::new();
            msg.insert(
                "organization_id".to_string(),
                Value::String(org_id.clone()),
            );
            msg.insert("channel".to_string(), Value::String(channel.clone()));
            msg.insert("recipient".to_string(), Value::String(recipient));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            );

            // Build payload with template variables
            let mut payload_map = Map::new();
            payload_map.insert(
                "trigger_event".to_string(),
                Value::String(trigger.clone()),
            );
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
            payload_map.insert(
                "due_date".to_string(),
                Value::String(due_date.clone()),
            );
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

    Ok(Json(json!({
        "processed": processed,
        "errors": errors,
        "date": today.to_string(),
    })))
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
