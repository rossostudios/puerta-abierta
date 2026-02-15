#![allow(dead_code)]

use serde_json::{Map, Value};
use sqlx::{postgres::PgRow, Postgres, QueryBuilder, Row};

use crate::error::AppError;

const ALLOWED_TABLES: &[&str] = &[
    "ai_agents",
    "ai_chat_messages",
    "ai_chats",
    "app_users",
    "application_events",
    "application_submissions",
    "audit_logs",
    "calendar_blocks",
    "channels",
    "collection_records",
    "expenses",
    "guests",
    "integration_events",
    "lease_charges",
    "leases",
    "listings",
    "marketplace_listing_fee_lines",
    "marketplace_listings",
    "maintenance_requests",
    "message_logs",
    "message_templates",
    "notification_rules",
    "organization_invites",
    "organization_members",
    "organizations",
    "owner_statements",
    "payment_instructions",
    "pricing_template_lines",
    "pricing_templates",
    "properties",
    "reservations",
    "task_items",
    "tasks",
    "tenant_access_tokens",
    "units",
    "documents",
    "workflow_rules",
    "subscription_plans",
    "org_subscriptions",
    "platform_admins",
];

pub async fn list_rows(
    pool: &sqlx::PgPool,
    table: &str,
    filters: Option<&Map<String, Value>>,
    limit: i64,
    offset: i64,
    order_by: &str,
    ascending: bool,
) -> Result<Vec<Value>, AppError> {
    let table_name = validate_table(table)?;
    let order_name = if order_by.trim().is_empty() {
        "created_at"
    } else {
        validate_identifier(order_by)?
    };

    let mut query = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ");
    query.push(table_name).push(" t WHERE 1=1");

    if let Some(filter_map) = filters {
        for (key, value) in filter_map {
            let filter_key = validate_identifier(key)?;
            match value {
                Value::Null => {}
                Value::Array(items) => {
                    let values = items.iter().map(render_scalar).collect::<Vec<_>>();
                    if values.is_empty() {
                        continue;
                    }
                    query
                        .push(" AND (to_jsonb(t) ->> ")
                        .push_bind(filter_key)
                        .push(") = ANY(")
                        .push_bind(values)
                        .push(")");
                }
                _ => {
                    query
                        .push(" AND (to_jsonb(t) ->> ")
                        .push_bind(filter_key)
                        .push(") = ")
                        .push_bind(render_scalar(value));
                }
            }
        }
    }

    query.push(" ORDER BY t.").push(order_name);
    if ascending {
        query.push(" ASC");
    } else {
        query.push(" DESC");
    }
    query
        .push(" LIMIT ")
        .push_bind(limit.max(1))
        .push(" OFFSET ")
        .push_bind(offset.max(0));

    let rows = query.build().fetch_all(pool).await.map_err(map_db_error)?;
    Ok(read_rows(rows))
}

pub async fn get_row(
    pool: &sqlx::PgPool,
    table: &str,
    row_id: &str,
    id_field: &str,
) -> Result<Value, AppError> {
    let table_name = validate_table(table)?;
    let id_name = validate_identifier(id_field)?;

    let row = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" LIMIT 1")
        .build()
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound(format!("{table_name} record not found.")))
}

pub async fn create_row(
    pool: &sqlx::PgPool,
    table: &str,
    payload: &Map<String, Value>,
) -> Result<Value, AppError> {
    let table_name = validate_table(table)?;
    if payload.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Could not create {table_name} record."
        )));
    }

    let mut keys = payload.keys().cloned().collect::<Vec<_>>();
    keys.sort_unstable();
    for key in &keys {
        validate_identifier(key)?;
    }

    // Use jsonb_populate_record so PostgreSQL resolves column types (uuid,
    // enum, boolean, numeric …) automatically from the table definition.
    let mut query = QueryBuilder::<Postgres>::new("INSERT INTO ");
    query.push(table_name).push(" (");
    {
        let mut separated = query.separated(", ");
        for key in &keys {
            separated.push(validate_identifier(key)?);
        }
    }
    query.push(") SELECT ");
    {
        let mut separated = query.separated(", ");
        for key in &keys {
            separated.push("r.");
            separated.push_unseparated(validate_identifier(key)?);
        }
    }
    query
        .push(" FROM jsonb_populate_record(NULL::")
        .push(table_name)
        .push(", ");
    query.push_bind(Value::Object(payload.clone()));
    query
        .push(") r RETURNING row_to_json(")
        .push(table_name)
        .push(".*) AS row");

    let row = query
        .build()
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::Internal(format!("Could not create {table_name} record.")))
}

pub async fn update_row(
    pool: &sqlx::PgPool,
    table: &str,
    row_id: &str,
    payload: &Map<String, Value>,
    id_field: &str,
) -> Result<Value, AppError> {
    let table_name = validate_table(table)?;
    let id_name = validate_identifier(id_field)?;
    if payload.is_empty() {
        return Err(AppError::BadRequest("No fields to update.".to_string()));
    }

    let mut keys = payload.keys().cloned().collect::<Vec<_>>();
    keys.sort_unstable();
    for key in &keys {
        validate_identifier(key)?;
    }

    let mut query = QueryBuilder::<Postgres>::new("UPDATE ");
    query.push(table_name).push(" t SET ");
    {
        let mut separated = query.separated(", ");
        for key in &keys {
            let col = validate_identifier(key)?;
            separated.push(col);
            separated.push_unseparated(" = r.");
            separated.push_unseparated(col);
        }
    }
    query
        .push(" FROM jsonb_populate_record(NULL::")
        .push(table_name)
        .push(", ");
    query.push_bind(Value::Object(payload.clone()));
    query
        .push(") r WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" RETURNING row_to_json(t) AS row");

    let row = query
        .build()
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound(format!("{table_name} record not found.")))
}

pub async fn delete_row(
    pool: &sqlx::PgPool,
    table: &str,
    row_id: &str,
    id_field: &str,
) -> Result<Value, AppError> {
    let existing = get_row(pool, table, row_id, id_field).await?;
    let table_name = validate_table(table)?;
    let id_name = validate_identifier(id_field)?;

    QueryBuilder::<Postgres>::new("DELETE FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .build()
        .execute(pool)
        .await
        .map_err(map_db_error)?;

    Ok(existing)
}

pub fn date_overlap(start: &str, end: &str, periods: &[Map<String, Value>]) -> bool {
    periods.iter().any(|period| {
        let from = period
            .get("from")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let to = period.get("to").and_then(Value::as_str).unwrap_or_default();
        !(end <= from || start >= to)
    })
}

fn read_rows(rows: Vec<PgRow>) -> Vec<Value> {
    rows.into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect()
}

fn validate_table(table: &str) -> Result<&str, AppError> {
    let normalized = validate_identifier(table)?;
    if ALLOWED_TABLES.contains(&normalized) {
        return Ok(normalized);
    }
    Err(AppError::Forbidden(format!(
        "Table '{normalized}' is not allowed."
    )))
}

fn validate_identifier(identifier: &str) -> Result<&str, AppError> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Identifier cannot be empty.".to_string(),
        ));
    }
    if !trimmed.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
    }) {
        return Err(AppError::BadRequest(format!(
            "Invalid identifier '{trimmed}'."
        )));
    }
    if trimmed
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_digit())
    {
        return Err(AppError::BadRequest(format!(
            "Invalid identifier '{trimmed}'."
        )));
    }
    Ok(trimmed)
}

fn render_scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

pub(crate) fn is_uuid_formatted(value: &Value) -> bool {
    if let Value::String(text) = value {
        uuid::Uuid::try_parse(text).is_ok()
    } else {
        false
    }
}

fn map_db_error(error: sqlx::Error) -> AppError {
    let message = error.to_string();
    if message.contains("23505")
        || message
            .to_ascii_lowercase()
            .contains("duplicate key value violates unique constraint")
    {
        return AppError::Conflict("Duplicate value violates a unique constraint.".to_string());
    }
    AppError::Dependency(format!("Supabase request failed: {message}"))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::{date_overlap, is_uuid_formatted};
    use sqlx::{Postgres, QueryBuilder};

    #[test]
    fn overlap_uses_inclusive_exclusive_semantics() {
        let periods = vec![
            Map::from_iter([
                ("from".to_string(), Value::String("2026-01-10".to_string())),
                ("to".to_string(), Value::String("2026-01-12".to_string())),
            ]),
            Map::from_iter([
                ("from".to_string(), Value::String("2026-01-20".to_string())),
                ("to".to_string(), Value::String("2026-01-25".to_string())),
            ]),
        ];
        assert!(date_overlap("2026-01-11", "2026-01-13", &periods));
        assert!(!date_overlap("2026-01-12", "2026-01-20", &periods));
        assert!(!date_overlap("2026-01-25", "2026-01-30", &periods));
        assert!(date_overlap("2026-01-19", "2026-01-21", &periods));
        let _ = json!({"ok": true});
    }

    #[test]
    fn uuid_detection() {
        assert!(is_uuid_formatted(&Value::String(
            "550e8400-e29b-41d4-a716-446655440000".to_string()
        )));
        assert!(is_uuid_formatted(&Value::String(
            "550E8400-E29B-41D4-A716-446655440000".to_string()
        )));
        assert!(!is_uuid_formatted(&Value::String(
            "not-a-uuid".to_string()
        )));
        assert!(!is_uuid_formatted(&Value::String(String::new())));
        assert!(!is_uuid_formatted(&Value::Bool(true)));
        assert!(!is_uuid_formatted(&Value::Null));
    }

    #[test]
    fn insert_sql_uses_jsonb_populate_record() {
        let mut payload = Map::new();
        payload.insert("name".to_string(), Value::String("Acme".to_string()));
        payload.insert(
            "owner_user_id".to_string(),
            Value::String("550e8400-e29b-41d4-a716-446655440000".to_string()),
        );
        payload.insert(
            "profile_type".to_string(),
            Value::String("management_company".to_string()),
        );

        let mut keys = payload.keys().cloned().collect::<Vec<_>>();
        keys.sort_unstable();

        let mut query = QueryBuilder::<Postgres>::new("INSERT INTO organizations (");
        {
            let mut separated = query.separated(", ");
            for key in &keys {
                separated.push(key.as_str());
            }
        }
        query.push(") SELECT ");
        {
            let mut separated = query.separated(", ");
            for key in &keys {
                separated.push("r.");
                separated.push_unseparated(key.as_str());
            }
        }
        query.push(" FROM jsonb_populate_record(NULL::organizations, ");
        query.push_bind(Value::Object(payload));
        query.push(") r");

        let sql = query.sql();
        assert!(
            sql.contains("jsonb_populate_record(NULL::organizations"),
            "Expected jsonb_populate_record in SQL but got: {sql}"
        );
        assert!(
            sql.contains("SELECT r.name, r.owner_user_id, r.profile_type"),
            "Expected r.col references in SQL but got: {sql}"
        );
    }

    #[test]
    fn update_sql_uses_jsonb_populate_record() {
        let mut payload = Map::new();
        payload.insert("name".to_string(), Value::String("Acme".to_string()));
        payload.insert(
            "owner_user_id".to_string(),
            Value::String("550e8400-e29b-41d4-a716-446655440000".to_string()),
        );

        let mut keys = payload.keys().cloned().collect::<Vec<_>>();
        keys.sort_unstable();

        let mut query = QueryBuilder::<Postgres>::new("UPDATE organizations t SET ");
        {
            let mut separated = query.separated(", ");
            for key in &keys {
                separated.push(key.as_str());
                separated.push_unseparated(" = r.");
                separated.push_unseparated(key.as_str());
            }
        }
        query.push(" FROM jsonb_populate_record(NULL::organizations, ");
        query.push_bind(Value::Object(payload));
        query.push(") r");

        let sql = query.sql();
        assert!(
            sql.contains("jsonb_populate_record(NULL::organizations"),
            "Expected jsonb_populate_record in SQL but got: {sql}"
        );
        assert!(
            sql.contains("name = r.name, owner_user_id = r.owner_user_id"),
            "Expected col = r.col pattern in SQL but got: {sql}"
        );
    }
}
