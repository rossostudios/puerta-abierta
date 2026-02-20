use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    state::AppState,
    tenancy::assert_org_member,
};

const ANOMALY_ALERTS_INBOX_SQL: &str = "SELECT
            id::text AS id,
            severity,
            title,
            description,
            detected_at::text AS created_at
         FROM anomaly_alerts
         WHERE organization_id = $1::uuid
           AND is_dismissed = false
         ORDER BY detected_at DESC
         LIMIT 40";

const EXPIRING_LEASES_INBOX_SQL: &str = "SELECT
            id::text AS id,
            ends_on::text AS ends_on,
            created_at::text AS created_at
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status IN ('active', 'delinquent')
           AND ends_on IS NOT NULL
           AND ends_on BETWEEN current_date AND (current_date + interval '30 days')::date
         ORDER BY ends_on ASC
         LIMIT 40";

#[derive(Debug, Clone, Deserialize)]
struct AgentInboxQuery {
    org_id: String,
    limit: Option<i64>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route("/agent/inbox", axum::routing::get(get_agent_inbox))
}

async fn get_agent_inbox(
    State(state): State<AppState>,
    Query(query): Query<AgentInboxQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let limit = query.limit.unwrap_or(60).clamp(1, 200);
    let pool = db_pool(&state)?;

    let mut items: Vec<Value> = Vec::new();
    load_pending_approvals(pool, &query.org_id, &mut items).await?;
    load_anomaly_alerts(pool, &query.org_id, &mut items).await?;
    load_overdue_tasks(pool, &query.org_id, &mut items).await?;
    load_expiring_leases(pool, &query.org_id, &mut items).await?;
    load_stalled_applications(pool, &query.org_id, &mut items).await?;

    items.sort_by(|left, right| {
        let left_priority = priority_rank(left, "priority");
        let right_priority = priority_rank(right, "priority");
        right_priority
            .cmp(&left_priority)
            .then_with(|| value_str(right, "created_at").cmp(&value_str(left, "created_at")))
    });

    items.truncate(limit as usize);

    Ok(Json(json!({
        "organization_id": query.org_id,
        "data": items,
        "count": items.len(),
    })))
}

async fn load_pending_approvals(
    pool: &sqlx::PgPool,
    org_id: &str,
    out: &mut Vec<Value>,
) -> AppResult<()> {
    let rows = sqlx::query(
        "SELECT
            id::text AS id,
            agent_slug,
            tool_name,
            created_at::text AS created_at
         FROM agent_approvals
         WHERE organization_id = $1::uuid
           AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 40",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to load pending approvals for agent inbox");
        AppError::Dependency("Failed to load agent inbox approvals.".to_string())
    })?;

    for row in rows {
        let id = row.try_get::<String, _>("id").unwrap_or_default();
        let agent_slug = row.try_get::<String, _>("agent_slug").unwrap_or_default();
        let tool_name = row.try_get::<String, _>("tool_name").unwrap_or_default();
        let created_at = row.try_get::<String, _>("created_at").unwrap_or_default();

        out.push(json!({
            "id": id,
            "kind": "approval",
            "priority": "high",
            "title": format!("Approval needed: {}", tool_name),
            "body": format!("Agent '{}' requested '{}'", agent_slug, tool_name),
            "link_path": "/app/chats",
            "created_at": created_at,
        }));
    }

    Ok(())
}

async fn load_anomaly_alerts(
    pool: &sqlx::PgPool,
    org_id: &str,
    out: &mut Vec<Value>,
) -> AppResult<()> {
    let rows = sqlx::query(ANOMALY_ALERTS_INBOX_SQL)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Failed to load anomaly alerts for agent inbox");
            AppError::Dependency("Failed to load agent inbox anomalies.".to_string())
        })?;

    for row in rows {
        let id = row.try_get::<String, _>("id").unwrap_or_default();
        let severity = row
            .try_get::<String, _>("severity")
            .unwrap_or_else(|_| "warning".to_string())
            .to_ascii_lowercase();
        let priority = if severity == "critical" {
            "critical"
        } else {
            "high"
        };

        out.push(json!({
            "id": id,
            "kind": "anomaly",
            "priority": priority,
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "body": row.try_get::<String, _>("description").unwrap_or_default(),
            "link_path": "/module/owner-statements",
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
    }

    Ok(())
}

async fn load_overdue_tasks(
    pool: &sqlx::PgPool,
    org_id: &str,
    out: &mut Vec<Value>,
) -> AppResult<()> {
    let rows = sqlx::query(
        "SELECT
            id::text AS id,
            title,
            priority,
            COALESCE(due_at, created_at)::text AS created_at
         FROM tasks
         WHERE organization_id = $1::uuid
           AND status IN ('todo', 'in_progress')
           AND due_at IS NOT NULL
           AND due_at < now()
         ORDER BY due_at ASC
         LIMIT 40",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to load overdue tasks for agent inbox");
        AppError::Dependency("Failed to load agent inbox tasks.".to_string())
    })?;

    for row in rows {
        let id = row.try_get::<String, _>("id").unwrap_or_default();
        let task_title = row.try_get::<String, _>("title").unwrap_or_default();
        let raw_priority = row
            .try_get::<String, _>("priority")
            .unwrap_or_else(|_| "medium".to_string())
            .to_ascii_lowercase();
        let priority = if matches!(raw_priority.as_str(), "urgent" | "high") {
            "high"
        } else {
            "medium"
        };

        out.push(json!({
            "id": id,
            "kind": "task",
            "priority": priority,
            "title": format!("Overdue task: {}", task_title),
            "body": "Task is past due and still open.",
            "link_path": "/module/tasks",
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
    }

    Ok(())
}

async fn load_expiring_leases(
    pool: &sqlx::PgPool,
    org_id: &str,
    out: &mut Vec<Value>,
) -> AppResult<()> {
    let rows = sqlx::query(EXPIRING_LEASES_INBOX_SQL)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Failed to load expiring leases for agent inbox");
            AppError::Dependency("Failed to load agent inbox leases.".to_string())
        })?;

    for row in rows {
        let id = row.try_get::<String, _>("id").unwrap_or_default();
        let ends_on = row.try_get::<String, _>("ends_on").unwrap_or_default();

        out.push(json!({
            "id": id,
            "kind": "lease",
            "priority": "medium",
            "title": "Lease expiring soon",
            "body": format!("Lease expires on {}", ends_on),
            "link_path": "/module/leases",
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
    }

    Ok(())
}

async fn load_stalled_applications(
    pool: &sqlx::PgPool,
    org_id: &str,
    out: &mut Vec<Value>,
) -> AppResult<()> {
    let rows = sqlx::query(
        "SELECT
            id::text AS id,
            status::text AS status,
            updated_at::text AS created_at
         FROM application_submissions
         WHERE organization_id = $1::uuid
           AND status IN ('new', 'screening', 'qualified', 'visit_scheduled')
           AND updated_at < (now() - interval '48 hours')
         ORDER BY updated_at ASC
         LIMIT 40",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to load stalled applications for agent inbox");
        AppError::Dependency("Failed to load agent inbox applications.".to_string())
    })?;

    for row in rows {
        let id = row.try_get::<String, _>("id").unwrap_or_default();
        let status = row.try_get::<String, _>("status").unwrap_or_default();

        out.push(json!({
            "id": id,
            "kind": "application",
            "priority": "medium",
            "title": "Application stalled",
            "body": format!("Application has been in '{}' for more than 48h.", status),
            "link_path": "/module/applications",
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
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

fn value_str(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn priority_rank(value: &Value, key: &str) -> i32 {
    let raw = value_str(value, key).to_ascii_lowercase();
    match raw.as_str() {
        "critical" => 4,
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{ANOMALY_ALERTS_INBOX_SQL, EXPIRING_LEASES_INBOX_SQL};

    #[test]
    fn anomaly_inbox_query_targets_anomaly_alerts_table() {
        assert!(ANOMALY_ALERTS_INBOX_SQL.contains("FROM anomaly_alerts"));
        assert!(ANOMALY_ALERTS_INBOX_SQL.contains("is_dismissed = false"));
    }

    #[test]
    fn expiring_leases_query_uses_ends_on_column() {
        assert!(EXPIRING_LEASES_INBOX_SQL.contains("ends_on"));
        assert!(!EXPIRING_LEASES_INBOX_SQL.contains("end_date"));
    }
}
