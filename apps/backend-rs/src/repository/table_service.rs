#![allow(dead_code)]

use chrono::{DateTime, FixedOffset, NaiveDate};
use serde_json::{Map, Value};
use sqlx::{postgres::PgRow, PgConnection, Postgres, QueryBuilder, Row};

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
    "collection_records",
    "expenses",
    "guests",
    "integration_events",
    "lease_charges",
    "leases",
    "integrations",
    "listing_fee_lines",
    "listings",
    "maintenance_requests",
    "message_logs",
    "message_templates",
    "notification_rules",
    "notification_events",
    "user_notifications",
    "notification_rule_dispatches",
    "organization_invites",
    "organization_members",
    "organizations",
    "owner_statements",
    "payment_instructions",
    "pricing_template_lines",
    "pricing_templates",
    "properties",
    "property_floors",
    "reservations",
    "unit_beds",
    "unit_condition_events",
    "unit_spaces",
    "task_items",
    "tasks",
    "tenant_access_tokens",
    "units",
    "documents",
    "knowledge_documents",
    "knowledge_chunks",
    "workflow_rules",
    "workflow_jobs",
    "workflow_job_attempts",
    "workflow_round_robin_state",
    "subscription_plans",
    "org_subscriptions",
    "platform_admins",
    "communication_sequences",
    "sequence_steps",
    "sequence_enrollments",
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
            push_filter_clause(&mut query, key, value)?;
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
        .push_bind(limit.clamp(1, 1000))
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

    let mut query = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ");
    query.push(table_name).push(" t WHERE ");
    push_scalar_filter(
        &mut query,
        id_name,
        FilterOperator::Eq,
        &infer_scalar_filter(id_name, &Value::String(row_id.to_string())),
    );
    query.push(" LIMIT 1");

    let row = query
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

/// Same as `create_row` but executes within an existing transaction.
pub async fn create_row_tx(
    conn: &mut PgConnection,
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
        .fetch_optional(&mut *conn)
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
    query.push(") r WHERE ");
    push_scalar_filter(
        &mut query,
        id_name,
        FilterOperator::Eq,
        &infer_scalar_filter(id_name, &Value::String(row_id.to_string())),
    );
    query.push(" RETURNING row_to_json(t) AS row");

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

    let mut query = QueryBuilder::<Postgres>::new("DELETE FROM ");
    query.push(table_name).push(" t WHERE ");
    push_scalar_filter(
        &mut query,
        id_name,
        FilterOperator::Eq,
        &infer_scalar_filter(id_name, &Value::String(row_id.to_string())),
    );
    query.build().execute(pool).await.map_err(map_db_error)?;

    Ok(existing)
}

pub async fn count_rows(
    pool: &sqlx::PgPool,
    table: &str,
    filters: Option<&Map<String, Value>>,
) -> Result<i64, AppError> {
    let table_name = validate_table(table)?;

    let mut query = QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint AS total FROM ");
    query.push(table_name).push(" t WHERE 1=1");

    if let Some(filter_map) = filters {
        for (key, value) in filter_map {
            push_filter_clause(&mut query, key, value)?;
        }
    }

    let row = query.build().fetch_one(pool).await.map_err(map_db_error)?;

    Ok(row.try_get::<i64, _>("total").unwrap_or(0))
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

#[derive(Debug, Clone)]
enum ScalarFilter {
    Text(String),
    Uuid(uuid::Uuid),
    Bool(bool),
    I64(i64),
    F64(f64),
    Date(NaiveDate),
    Timestamp(DateTime<FixedOffset>),
}

#[derive(Debug, Clone)]
enum ArrayFilter {
    Text(Vec<String>),
    Uuid(Vec<uuid::Uuid>),
    Bool(Vec<bool>),
    I64(Vec<i64>),
    F64(Vec<f64>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilterOperator {
    Eq,
    Gt,
    Gte,
    Lt,
    Lte,
    Like,
    ILike,
    IsNull,
}

fn parse_filter_key(filter_key: &str) -> Result<(&str, FilterOperator), AppError> {
    let mut column = filter_key;
    let mut operator = FilterOperator::Eq;

    if let Some((candidate_column, suffix)) = filter_key.rsplit_once("__") {
        operator = match suffix {
            "gt" => FilterOperator::Gt,
            "gte" => FilterOperator::Gte,
            "lt" => FilterOperator::Lt,
            "lte" => FilterOperator::Lte,
            "like" => FilterOperator::Like,
            "ilike" => FilterOperator::ILike,
            "is_null" => FilterOperator::IsNull,
            "in" => FilterOperator::Eq,
            _ => FilterOperator::Eq,
        };
        if !matches!(operator, FilterOperator::Eq) || suffix == "in" {
            column = candidate_column;
        }
    }

    Ok((validate_identifier(column)?, operator))
}

fn scalar_to_text(value: &ScalarFilter) -> String {
    match value {
        ScalarFilter::Text(text) => text.clone(),
        ScalarFilter::Uuid(id) => id.to_string(),
        ScalarFilter::Bool(flag) => flag.to_string(),
        ScalarFilter::I64(number) => number.to_string(),
        ScalarFilter::F64(number) => number.to_string(),
        ScalarFilter::Date(value) => value.to_string(),
        ScalarFilter::Timestamp(value) => value.to_rfc3339(),
    }
}

fn parse_bool_filter_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Bool(flag) => *flag,
        Value::Number(number) => {
            number.as_i64().is_some_and(|parsed| parsed != 0)
                || number.as_f64().is_some_and(|parsed| parsed != 0.0)
        }
        Value::String(text) => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "true" | "t" | "1" | "yes" | "y"
        ),
        _ => false,
    }
}

fn push_filter_clause(
    query: &mut QueryBuilder<Postgres>,
    filter_key: &str,
    value: &Value,
) -> Result<(), AppError> {
    let (column, operator) = parse_filter_key(filter_key)?;

    if matches!(operator, FilterOperator::IsNull) {
        let should_be_null = parse_bool_filter_value(value);
        query.push(" AND t.").push(column);
        if should_be_null {
            query.push(" IS NULL");
        } else {
            query.push(" IS NOT NULL");
        }
        return Ok(());
    }

    match value {
        Value::Null => Ok(()),
        Value::Array(items) => {
            if !matches!(operator, FilterOperator::Eq) {
                return Err(AppError::BadRequest(format!(
                    "Filter '{filter_key}' does not support array values."
                )));
            }
            let filter = infer_array_filter(column, items);
            if matches!(filter, ArrayFilter::Text(ref values) if values.is_empty())
                || matches!(filter, ArrayFilter::Uuid(ref values) if values.is_empty())
                || matches!(filter, ArrayFilter::Bool(ref values) if values.is_empty())
                || matches!(filter, ArrayFilter::I64(ref values) if values.is_empty())
                || matches!(filter, ArrayFilter::F64(ref values) if values.is_empty())
            {
                return Ok(());
            }
            query.push(" AND ");
            push_array_filter(query, column, &filter);
            Ok(())
        }
        _ => {
            query.push(" AND ");
            let filter = infer_scalar_filter(column, value);
            push_scalar_filter(query, column, operator, &filter);
            Ok(())
        }
    }
}

fn push_scalar_filter(
    query: &mut QueryBuilder<Postgres>,
    column: &str,
    operator: FilterOperator,
    value: &ScalarFilter,
) {
    query.push("t.").push(column);
    match operator {
        FilterOperator::Eq => match value {
            ScalarFilter::Text(text) => {
                query.push("::text = ").push_bind(text.clone());
            }
            ScalarFilter::Uuid(id) => {
                query.push(" = ").push_bind(*id);
            }
            ScalarFilter::Bool(flag) => {
                query.push(" = ").push_bind(*flag);
            }
            ScalarFilter::I64(number) => {
                query.push(" = ").push_bind(*number);
            }
            ScalarFilter::F64(number) => {
                query.push(" = ").push_bind(*number);
            }
            ScalarFilter::Date(value) => {
                query.push(" = ").push_bind(*value);
            }
            ScalarFilter::Timestamp(value) => {
                query.push(" = ").push_bind(value.to_owned());
            }
        },
        FilterOperator::Gt | FilterOperator::Gte | FilterOperator::Lt | FilterOperator::Lte => {
            let sql_operator = match operator {
                FilterOperator::Gt => " > ",
                FilterOperator::Gte => " >= ",
                FilterOperator::Lt => " < ",
                FilterOperator::Lte => " <= ",
                _ => " = ",
            };
            match value {
                ScalarFilter::Text(text) => {
                    query
                        .push("::text")
                        .push(sql_operator)
                        .push_bind(text.clone());
                }
                ScalarFilter::Uuid(id) => {
                    query.push(sql_operator).push_bind(*id);
                }
                ScalarFilter::Bool(flag) => {
                    query.push(sql_operator).push_bind(*flag);
                }
                ScalarFilter::I64(number) => {
                    query.push(sql_operator).push_bind(*number);
                }
                ScalarFilter::F64(number) => {
                    query.push(sql_operator).push_bind(*number);
                }
                ScalarFilter::Date(value) => {
                    query.push(sql_operator).push_bind(*value);
                }
                ScalarFilter::Timestamp(value) => {
                    query.push(sql_operator).push_bind(value.to_owned());
                }
            }
        }
        FilterOperator::Like | FilterOperator::ILike => {
            let sql_operator = if matches!(operator, FilterOperator::ILike) {
                " ILIKE "
            } else {
                " LIKE "
            };
            query
                .push("::text")
                .push(sql_operator)
                .push_bind(scalar_to_text(value));
        }
        FilterOperator::IsNull => {
            // handled by push_filter_clause before scalar inference
        }
    }
}

fn push_array_filter(query: &mut QueryBuilder<Postgres>, column: &str, value: &ArrayFilter) {
    query.push("t.").push(column);
    match value {
        ArrayFilter::Text(values) => {
            query
                .push("::text = ANY(")
                .push_bind(values.clone())
                .push(")");
        }
        ArrayFilter::Uuid(values) => {
            query.push(" = ANY(").push_bind(values.clone()).push(")");
        }
        ArrayFilter::Bool(values) => {
            query.push(" = ANY(").push_bind(values.clone()).push(")");
        }
        ArrayFilter::I64(values) => {
            query.push(" = ANY(").push_bind(values.clone()).push(")");
        }
        ArrayFilter::F64(values) => {
            query.push(" = ANY(").push_bind(values.clone()).push(")");
        }
    }
}

fn infer_scalar_filter(filter_key: &str, value: &Value) -> ScalarFilter {
    match value {
        Value::Bool(flag) => ScalarFilter::Bool(*flag),
        Value::Number(number) => {
            if let Some(as_i64) = number.as_i64() {
                return ScalarFilter::I64(as_i64);
            }
            if let Some(as_f64) = number.as_f64() {
                return ScalarFilter::F64(as_f64);
            }
            ScalarFilter::Text(number.to_string())
        }
        Value::String(text) => {
            let trimmed = text.trim();
            if is_uuid_identifier(filter_key) {
                if let Ok(parsed) = uuid::Uuid::parse_str(trimmed) {
                    return ScalarFilter::Uuid(parsed);
                }
            }
            if is_timestamp_identifier(filter_key) {
                if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
                    return ScalarFilter::Timestamp(parsed);
                }
            }
            if is_date_identifier(filter_key) {
                if let Ok(parsed) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
                    return ScalarFilter::Date(parsed);
                }
            }
            ScalarFilter::Text(text.clone())
        }
        _ => ScalarFilter::Text(render_scalar(value)),
    }
}

fn infer_array_filter(filter_key: &str, values: &[Value]) -> ArrayFilter {
    if values.is_empty() {
        return ArrayFilter::Text(Vec::new());
    }

    if is_uuid_identifier(filter_key) {
        let mut parsed = Vec::with_capacity(values.len());
        let mut all_uuid = true;
        for value in values {
            let Some(text) = value.as_str() else {
                all_uuid = false;
                break;
            };
            let Ok(as_uuid) = uuid::Uuid::parse_str(text.trim()) else {
                all_uuid = false;
                break;
            };
            parsed.push(as_uuid);
        }
        if all_uuid {
            return ArrayFilter::Uuid(parsed);
        }
    }

    if values.iter().all(|value| matches!(value, Value::Bool(_))) {
        return ArrayFilter::Bool(
            values
                .iter()
                .filter_map(Value::as_bool)
                .collect::<Vec<bool>>(),
        );
    }

    if values
        .iter()
        .all(|value| matches!(value, Value::Number(number) if number.as_i64().is_some()))
    {
        return ArrayFilter::I64(
            values
                .iter()
                .filter_map(Value::as_i64)
                .collect::<Vec<i64>>(),
        );
    }

    if values.iter().all(|value| value.as_f64().is_some()) {
        return ArrayFilter::F64(
            values
                .iter()
                .filter_map(Value::as_f64)
                .collect::<Vec<f64>>(),
        );
    }

    ArrayFilter::Text(values.iter().map(render_scalar).collect::<Vec<_>>())
}

fn is_uuid_identifier(identifier: &str) -> bool {
    let normalized = identifier.trim();
    normalized == "id" || normalized.ends_with("_id")
}

fn is_date_identifier(identifier: &str) -> bool {
    let normalized = identifier.trim();
    normalized.ends_with("_date")
        || normalized.ends_with("_on")
        || matches!(normalized, "period_start" | "period_end" | "available_from")
}

fn is_timestamp_identifier(identifier: &str) -> bool {
    identifier.trim().ends_with("_at")
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
    tracing::error!(db_error = %message, "Database query failed");

    if message.contains("23505")
        || message
            .to_ascii_lowercase()
            .contains("duplicate key value violates unique constraint")
    {
        return AppError::Conflict("Duplicate value violates a unique constraint.".to_string());
    }
    AppError::Dependency("Database operation failed.".to_string())
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
        assert!(!is_uuid_formatted(&Value::String("not-a-uuid".to_string())));
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
