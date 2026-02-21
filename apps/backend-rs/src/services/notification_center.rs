use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, list_rows},
};

const DEFAULT_RECIPIENT_ROLES: &[&str] = &["owner_admin", "operator"];

#[derive(Debug, Clone)]
pub struct EmitNotificationEventInput {
    pub organization_id: String,
    pub event_type: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub body: String,
    pub link_path: Option<String>,
    pub source_table: Option<String>,
    pub source_id: Option<String>,
    pub actor_user_id: Option<String>,
    pub payload: Map<String, Value>,
    pub dedupe_key: Option<String>,
    pub occurred_at: Option<String>,
    pub fallback_roles: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NotificationListResult {
    pub data: Vec<Value>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NotificationRetentionResult {
    pub user_notifications_deleted: i64,
    pub notification_events_deleted: i64,
}

pub async fn emit_event(
    pool: &sqlx::PgPool,
    input: EmitNotificationEventInput,
) -> AppResult<Option<Value>> {
    let organization_id = input.organization_id.trim();
    let event_type = input.event_type.trim();
    let category = input.category.trim();
    let severity = input.severity.trim();
    let title = input.title.trim();
    let body = input.body.trim();

    if organization_id.is_empty()
        || event_type.is_empty()
        || category.is_empty()
        || severity.is_empty()
    {
        return Ok(None);
    }

    let fallback_roles = if input.fallback_roles.is_empty() {
        DEFAULT_RECIPIENT_ROLES
            .iter()
            .map(|role| (*role).to_string())
            .collect::<Vec<_>>()
    } else {
        input
            .fallback_roles
            .iter()
            .map(|role| role.trim().to_string())
            .filter(|role| !role.is_empty())
            .collect::<Vec<_>>()
    };

    let dedupe_key = input
        .dedupe_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let event_row = if let Some(key) = dedupe_key.as_deref() {
        if let Some(existing) = find_event_by_dedupe_key(pool, key).await? {
            existing
        } else {
            insert_event_row(
                pool,
                organization_id,
                event_type,
                category,
                severity,
                (title, body),
                &input,
            )
            .await?
        }
    } else {
        insert_event_row(
            pool,
            organization_id,
            event_type,
            category,
            severity,
            (title, body),
            &input,
        )
        .await?
    };

    let event_id = value_str(&event_row, "id");
    if event_id.is_empty() {
        return Ok(Some(event_row));
    }

    let recipients =
        resolve_recipients(pool, organization_id, &input.payload, &fallback_roles).await?;
    for recipient_user_id in recipients {
        let _ = sqlx::query(
            "INSERT INTO user_notifications (organization_id, event_id, recipient_user_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid)
             ON CONFLICT (event_id, recipient_user_id) DO NOTHING",
        )
        .bind(organization_id)
        .bind(&event_id)
        .bind(&recipient_user_id)
        .execute(pool)
        .await
        .map_err(map_sqlx_error)?;
    }

    Ok(Some(event_row))
}

pub async fn list_for_user(
    pool: &sqlx::PgPool,
    organization_id: &str,
    user_id: &str,
    status: Option<&str>,
    category: Option<&str>,
    cursor: Option<&str>,
    limit: i64,
) -> AppResult<NotificationListResult> {
    let status_filter = status
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "read" | "unread" | "all"));
    let category_filter = category
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let cursor_iso = cursor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc).to_rfc3339());

    let rows = sqlx::query(
        "SELECT
            un.id::text AS notification_id,
            un.read_at,
            un.created_at AS delivered_at,
            ne.id::text AS event_id,
            ne.event_type,
            ne.category,
            ne.severity,
            ne.title,
            ne.body,
            ne.link_path,
            ne.source_table,
            ne.source_id,
            ne.payload,
            ne.occurred_at,
            ne.created_at AS event_created_at
         FROM user_notifications un
         JOIN notification_events ne ON ne.id = un.event_id
         WHERE un.organization_id = $1::uuid
           AND un.recipient_user_id = $2::uuid
           AND ($3::timestamptz IS NULL OR un.created_at < $3::timestamptz)
           AND (
             $4::text IS NULL
             OR $4::text = 'all'
             OR ($4::text = 'read' AND un.read_at IS NOT NULL)
             OR ($4::text = 'unread' AND un.read_at IS NULL)
           )
           AND ($5::text IS NULL OR ne.category = $5::text)
         ORDER BY un.created_at DESC
         LIMIT $6",
    )
    .bind(organization_id)
    .bind(user_id)
    .bind(cursor_iso)
    .bind(status_filter)
    .bind(category_filter)
    .bind(limit.clamp(1, 100))
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    let mut data = Vec::with_capacity(rows.len());
    for row in &rows {
        let notification_id = row
            .try_get::<String, _>("notification_id")
            .unwrap_or_default();
        let read_at = row
            .try_get::<Option<DateTime<Utc>>, _>("read_at")
            .ok()
            .flatten();
        let delivered_at = row
            .try_get::<Option<DateTime<Utc>>, _>("delivered_at")
            .ok()
            .flatten();
        let payload = row
            .try_get::<Option<Value>, _>("payload")
            .ok()
            .flatten()
            .unwrap_or_else(|| Value::Object(Map::new()));

        data.push(json!({
            "id": notification_id,
            "event_id": row.try_get::<String, _>("event_id").unwrap_or_default(),
            "event_type": row.try_get::<String, _>("event_type").unwrap_or_default(),
            "category": row.try_get::<String, _>("category").unwrap_or_default(),
            "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "body": row.try_get::<String, _>("body").unwrap_or_default(),
            "link_path": row.try_get::<Option<String>, _>("link_path").ok().flatten(),
            "source_table": row.try_get::<Option<String>, _>("source_table").ok().flatten(),
            "source_id": row.try_get::<Option<String>, _>("source_id").ok().flatten(),
            "payload": payload,
            "read_at": read_at.map(|value| value.to_rfc3339()),
            "created_at": delivered_at.map(|value| value.to_rfc3339()),
            "occurred_at": row
                .try_get::<Option<DateTime<Utc>>, _>("occurred_at")
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
            "event_created_at": row
                .try_get::<Option<DateTime<Utc>>, _>("event_created_at")
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
        }));
    }

    let next_cursor = rows
        .last()
        .and_then(|row| {
            row.try_get::<Option<DateTime<Utc>>, _>("delivered_at")
                .ok()
                .flatten()
        })
        .map(|value| value.to_rfc3339());

    Ok(NotificationListResult { data, next_cursor })
}

pub async fn unread_count(
    pool: &sqlx::PgPool,
    organization_id: &str,
    user_id: &str,
) -> AppResult<i64> {
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint AS total
         FROM user_notifications
         WHERE organization_id = $1::uuid
           AND recipient_user_id = $2::uuid
           AND read_at IS NULL",
    )
    .bind(organization_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.try_get::<i64, _>("total").unwrap_or(0))
}

pub async fn mark_read(
    pool: &sqlx::PgPool,
    organization_id: &str,
    user_id: &str,
    notification_id: &str,
) -> AppResult<Option<Value>> {
    let row = sqlx::query(
        "UPDATE user_notifications
         SET read_at = COALESCE(read_at, now())
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND recipient_user_id = $3::uuid
         RETURNING id::text AS id, read_at",
    )
    .bind(notification_id)
    .bind(organization_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.map(|item| {
        json!({
            "id": item.try_get::<String, _>("id").unwrap_or_default(),
            "read_at": item
                .try_get::<Option<DateTime<Utc>>, _>("read_at")
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339())
        })
    }))
}

pub async fn mark_all_read(
    pool: &sqlx::PgPool,
    organization_id: &str,
    user_id: &str,
) -> AppResult<i64> {
    let rows = sqlx::query(
        "UPDATE user_notifications
         SET read_at = now()
         WHERE organization_id = $1::uuid
           AND recipient_user_id = $2::uuid
           AND read_at IS NULL
         RETURNING 1",
    )
    .bind(organization_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(rows.len() as i64)
}

pub async fn purge_expired_notifications(
    pool: &sqlx::PgPool,
    retention_days: i64,
) -> AppResult<NotificationRetentionResult> {
    let days = retention_days.clamp(1, 3650);

    let row = sqlx::query(
        "WITH deleted_user_notifications AS (
            DELETE FROM user_notifications
            WHERE created_at < (now() - ($1::text || ' days')::interval)
            RETURNING event_id
          ),
          deleted_notification_events AS (
            DELETE FROM notification_events ne
            WHERE ne.created_at < (now() - ($1::text || ' days')::interval)
              AND NOT EXISTS (
                SELECT 1
                FROM user_notifications un
                WHERE un.event_id = ne.id
              )
            RETURNING id
          )
          SELECT
            (SELECT COUNT(*)::bigint FROM deleted_user_notifications) AS user_notifications_deleted,
            (SELECT COUNT(*)::bigint FROM deleted_notification_events) AS notification_events_deleted",
    )
    .bind(days.to_string())
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(NotificationRetentionResult {
        user_notifications_deleted: row
            .try_get::<i64, _>("user_notifications_deleted")
            .unwrap_or(0),
        notification_events_deleted: row
            .try_get::<i64, _>("notification_events_deleted")
            .unwrap_or(0),
    })
}

async fn insert_event_row(
    pool: &sqlx::PgPool,
    organization_id: &str,
    event_type: &str,
    category: &str,
    severity: &str,
    title_body: (&str, &str),
    input: &EmitNotificationEventInput,
) -> AppResult<Value> {
    let (title, body) = title_body;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(organization_id.to_string()),
    );
    record.insert(
        "event_type".to_string(),
        Value::String(event_type.to_string()),
    );
    record.insert("category".to_string(), Value::String(category.to_string()));
    record.insert("severity".to_string(), Value::String(severity.to_string()));
    record.insert("title".to_string(), Value::String(title.to_string()));
    record.insert("body".to_string(), Value::String(body.to_string()));

    if let Some(link_path) = input
        .link_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "link_path".to_string(),
            Value::String(link_path.to_string()),
        );
    }
    if let Some(source_table) = input
        .source_table
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "source_table".to_string(),
            Value::String(source_table.to_string()),
        );
    }
    if let Some(source_id) = input
        .source_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "source_id".to_string(),
            Value::String(source_id.to_string()),
        );
    }
    if let Some(actor_user_id) = input
        .actor_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "actor_user_id".to_string(),
            Value::String(actor_user_id.to_string()),
        );
    }
    if let Some(dedupe_key) = input
        .dedupe_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.insert(
            "dedupe_key".to_string(),
            Value::String(dedupe_key.to_string()),
        );
    }

    record.insert("payload".to_string(), Value::Object(input.payload.clone()));
    let occurred_at = input
        .occurred_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    record.insert("occurred_at".to_string(), Value::String(occurred_at));

    match create_row(pool, "notification_events", &record).await {
        Ok(created) => Ok(created),
        Err(AppError::Conflict(_)) => {
            if let Some(dedupe_key) = input
                .dedupe_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if let Some(existing) = find_event_by_dedupe_key(pool, dedupe_key).await? {
                    return Ok(existing);
                }
            }
            Err(AppError::Conflict(
                "Duplicate notification event rejected by dedupe key.".to_string(),
            ))
        }
        Err(error) => Err(error),
    }
}

async fn find_event_by_dedupe_key(
    pool: &sqlx::PgPool,
    dedupe_key: &str,
) -> AppResult<Option<Value>> {
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM notification_events t
         WHERE dedupe_key = $1
         LIMIT 1",
    )
    .bind(dedupe_key)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten()))
}

async fn resolve_recipients(
    pool: &sqlx::PgPool,
    organization_id: &str,
    payload: &Map<String, Value>,
    fallback_roles: &[String],
) -> AppResult<Vec<String>> {
    let mut recipients = BTreeSet::new();

    for key in ["assigned_user_id", "recipient_user_id"] {
        if let Some(user_id) = payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            recipients.insert(user_id.to_string());
        }
    }

    for key in ["assigned_user_ids", "recipient_user_ids"] {
        if let Some(user_ids) = payload.get(key).and_then(Value::as_array) {
            for item in user_ids {
                if let Some(user_id) = item
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    recipients.insert(user_id.to_string());
                }
            }
        }
    }

    if !recipients.is_empty() {
        return Ok(recipients.into_iter().collect());
    }

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(organization_id.to_string()),
    );
    filters.insert(
        "role".to_string(),
        Value::Array(
            fallback_roles
                .iter()
                .map(|role| Value::String(role.clone()))
                .collect(),
        ),
    );

    let members = list_rows(
        pool,
        "organization_members",
        Some(&filters),
        500,
        0,
        "created_at",
        true,
    )
    .await?;

    for member in members {
        let user_id = value_str(&member, "user_id");
        if !user_id.is_empty() {
            recipients.insert(user_id);
        }
    }

    Ok(recipients.into_iter().collect())
}

fn map_sqlx_error(error: sqlx::Error) -> AppError {
    tracing::error!(db_error = %error, "Database query failed");
    AppError::Dependency("Database operation failed.".to_string())
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

// ---------------------------------------------------------------------------
// Expo Push Notifications
// ---------------------------------------------------------------------------

/// Send push notifications to all active push tokens for a list of user IDs.
pub async fn send_push_notifications(
    pool: &sqlx::PgPool,
    http_client: &reqwest::Client,
    user_ids: &[String],
    title: &str,
    body: &str,
    data: Option<&Map<String, Value>>,
) -> u32 {
    if user_ids.is_empty() || title.is_empty() {
        return 0;
    }

    // Fetch active push tokens for these users
    let placeholders: Vec<String> = user_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("${}", i + 1))
        .collect();
    let query_str = format!(
        "SELECT token FROM push_tokens WHERE user_id::text IN ({}) AND is_active = true",
        placeholders.join(", ")
    );

    let mut query = sqlx::query(&query_str);
    for uid in user_ids {
        query = query.bind(uid);
    }

    let rows = query.fetch_all(pool).await.unwrap_or_default();

    let tokens: Vec<String> = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("token").ok())
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return 0;
    }

    // Build Expo push messages
    let messages: Vec<Value> = tokens
        .iter()
        .map(|token| {
            let mut msg = json!({
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
            });
            if let Some(data) = data {
                msg.as_object_mut()
                    .unwrap()
                    .insert("data".to_string(), Value::Object(data.clone()));
            }
            msg
        })
        .collect();

    // Send in batches of 100 (Expo limit)
    let mut sent = 0u32;
    for chunk in messages.chunks(100) {
        let result = http_client
            .post("https://exp.host/--/api/v2/push/send")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&chunk)
            .send()
            .await;

        match result {
            Ok(response) if response.status().is_success() => {
                sent += chunk.len() as u32;
            }
            Ok(response) => {
                tracing::warn!(
                    status = %response.status(),
                    "Expo push API returned non-success status"
                );
            }
            Err(error) => {
                tracing::error!(%error, "Failed to send Expo push notifications");
            }
        }
    }

    sent
}

/// Register or refresh a push token for a user.
pub async fn upsert_push_token(
    pool: &sqlx::PgPool,
    org_id: &str,
    user_id: &str,
    token: &str,
    platform: &str,
    device_id: Option<&str>,
) -> AppResult<Value> {
    let row = sqlx::query(
        "INSERT INTO push_tokens (organization_id, user_id, token, platform, device_id, is_active)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)
         ON CONFLICT (user_id, token) DO UPDATE
         SET is_active = true, platform = EXCLUDED.platform, device_id = EXCLUDED.device_id, updated_at = now()
         RETURNING id::text AS id",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(token)
    .bind(platform)
    .bind(device_id)
    .fetch_one(pool)
    .await
    .map_err(map_sqlx_error)?;

    let id = row.try_get::<String, _>("id").unwrap_or_default();
    Ok(json!({ "id": id, "ok": true }))
}

/// Deactivate a push token (e.g., on logout).
pub async fn deactivate_push_token(
    pool: &sqlx::PgPool,
    user_id: &str,
    token: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE push_tokens SET is_active = false, updated_at = now()
         WHERE user_id = $1::uuid AND token = $2",
    )
    .bind(user_id)
    .bind(token)
    .execute(pool)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}
