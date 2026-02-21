use axum::{
    extract::{Path, Query, State},
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

const APPROVER_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];
const MUTATION_TOOLS: &[&str] = &["create_row", "update_row", "delete_row"];

#[derive(Debug, Clone, Deserialize)]
struct ApprovalOrgQuery {
    org_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ApprovalPath {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ApprovalPolicyPath {
    tool_name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ReviewApprovalInput {
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateApprovalPolicyInput {
    #[serde(default)]
    approval_mode: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/agent/approvals", axum::routing::get(list_approvals))
        .route(
            "/agent/approvals/{id}/approve",
            axum::routing::post(approve_approval),
        )
        .route(
            "/agent/approvals/{id}/reject",
            axum::routing::post(reject_approval),
        )
        .route(
            "/agent/approval-policies",
            axum::routing::get(list_approval_policies),
        )
        .route(
            "/agent/approval-policies/{tool_name}",
            axum::routing::patch(update_approval_policy),
        )
}

async fn list_approvals(
    State(state): State<AppState>,
    Query(query): Query<ApprovalOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    assert_approver_role(&membership)?;

    let pool = db_pool(&state)?;
    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM agent_approvals t
         WHERE organization_id = $1::uuid
           AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 100",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to list approvals");
        AppError::Dependency("Failed to list approvals.".to_string())
    })?;

    let data: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect();

    Ok(Json(json!({
        "organization_id": query.org_id,
        "data": data,
        "count": data.len(),
    })))
}

async fn approve_approval(
    State(state): State<AppState>,
    Path(path): Path<ApprovalPath>,
    Query(query): Query<ApprovalOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<ReviewApprovalInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    assert_approver_role(&membership)?;

    let pool = db_pool(&state)?;

    let row = sqlx::query(
        "UPDATE agent_approvals
         SET status = 'approved',
             reviewed_by = $1::uuid,
             review_note = $2,
             reviewed_at = now(),
             execution_key = COALESCE(execution_key, gen_random_uuid()::text)
         WHERE id = $3::uuid
           AND organization_id = $4::uuid
           AND status = 'pending'
         RETURNING row_to_json(agent_approvals.*) AS row",
    )
    .bind(&user_id)
    .bind(payload.note.as_deref())
    .bind(&path.id)
    .bind(&query.org_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to approve");
        AppError::Dependency("Failed to approve.".to_string())
    })?;

    let approval = row
        .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Approval not found or already reviewed.".to_string()))?;

    let tool_name = approval
        .as_object()
        .and_then(|obj| obj.get("tool_name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_args = approval
        .as_object()
        .and_then(|obj| obj.get("tool_args"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let execution_result = match crate::services::ai_agent::execute_approved_tool(
        &state,
        &query.org_id,
        &tool_name,
        &tool_args,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => json!({ "ok": false, "error": error.detail_message() }),
    };

    let execution_ok = execution_result
        .as_object()
        .and_then(|obj| obj.get("ok"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let final_status = if execution_ok {
        "executed"
    } else {
        "execution_failed"
    };

    let finalized = sqlx::query(
        "UPDATE agent_approvals
         SET status = $1,
             execution_result = $2,
             executed_at = now()
         WHERE id = $3::uuid
           AND organization_id = $4::uuid
         RETURNING row_to_json(agent_approvals.*) AS row",
    )
    .bind(final_status)
    .bind(execution_result.clone())
    .bind(&path.id)
    .bind(&query.org_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to finalize approval execution");
        AppError::Dependency("Failed to finalize approval execution.".to_string())
    })?
    .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
    .ok_or_else(|| AppError::Internal("Approval finalization failed.".to_string()))?;

    // Write agent evaluation record for feedback loop
    let agent_slug = approval
        .as_object()
        .and_then(|obj| obj.get("agent_slug"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    write_agent_evaluation(pool, &query.org_id, agent_slug, "approved", &path.id).await;

    Ok(Json(json!({
        "ok": true,
        "approval": finalized,
        "execution_result": execution_result,
    })))
}

async fn reject_approval(
    State(state): State<AppState>,
    Path(path): Path<ApprovalPath>,
    Query(query): Query<ApprovalOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<ReviewApprovalInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    assert_approver_role(&membership)?;

    let pool = db_pool(&state)?;

    let row = sqlx::query(
        "UPDATE agent_approvals
         SET status = 'rejected',
             reviewed_by = $1::uuid,
             review_note = $2,
             reviewed_at = now()
         WHERE id = $3::uuid
           AND organization_id = $4::uuid
           AND status = 'pending'
         RETURNING row_to_json(agent_approvals.*) AS row",
    )
    .bind(&user_id)
    .bind(payload.note.as_deref())
    .bind(&path.id)
    .bind(&query.org_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to reject");
        AppError::Dependency("Failed to reject.".to_string())
    })?;

    let approval = row
        .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Approval not found or already reviewed.".to_string()))?;

    // Write agent evaluation record for feedback loop
    let agent_slug = approval
        .as_object()
        .and_then(|obj| obj.get("agent_slug"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    write_agent_evaluation(pool, &query.org_id, agent_slug, "rejected", &path.id).await;

    Ok(Json(json!({
        "ok": true,
        "approval": approval,
    })))
}

async fn list_approval_policies(
    State(state): State<AppState>,
    Query(query): Query<ApprovalOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = db_pool(&state)?;
    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM agent_approval_policies t
         WHERE organization_id = $1::uuid
         ORDER BY tool_name ASC",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to list approval policies");
        AppError::Dependency("Failed to list approval policies.".to_string())
    })?;

    let mut policies = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    for tool_name in MUTATION_TOOLS {
        let has_policy = policies.iter().any(|policy| {
            policy
                .as_object()
                .and_then(|obj| obj.get("tool_name"))
                .and_then(Value::as_str)
                .is_some_and(|value| value == *tool_name)
        });
        if !has_policy {
            policies.push(json!({
                "organization_id": query.org_id,
                "tool_name": tool_name,
                "approval_mode": "required",
                "enabled": true,
            }));
        }
    }

    policies.sort_by(|a, b| {
        let left = a
            .as_object()
            .and_then(|obj| obj.get("tool_name"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right = b
            .as_object()
            .and_then(|obj| obj.get("tool_name"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        left.cmp(right)
    });

    Ok(Json(json!({
        "organization_id": query.org_id,
        "data": policies,
    })))
}

async fn update_approval_policy(
    State(state): State<AppState>,
    Path(path): Path<ApprovalPolicyPath>,
    Query(query): Query<ApprovalOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<UpdateApprovalPolicyInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    assert_approver_role(&membership)?;

    let tool_name = path.tool_name.trim();
    if !MUTATION_TOOLS.contains(&tool_name) {
        return Err(AppError::BadRequest(format!(
            "Tool '{}' does not support approval policy overrides.",
            tool_name
        )));
    }

    let pool = db_pool(&state)?;

    let existing = sqlx::query(
        "SELECT approval_mode, enabled
         FROM agent_approval_policies
         WHERE organization_id = $1::uuid
           AND tool_name = $2
         LIMIT 1",
    )
    .bind(&query.org_id)
    .bind(tool_name)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to read approval policy");
        AppError::Dependency("Failed to read approval policy.".to_string())
    })?;

    let current_mode = existing
        .as_ref()
        .and_then(|row| row.try_get::<String, _>("approval_mode").ok())
        .unwrap_or_else(|| "required".to_string());
    let current_enabled = existing
        .as_ref()
        .and_then(|row| row.try_get::<bool, _>("enabled").ok())
        .unwrap_or(true);

    let next_mode = payload
        .approval_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(current_mode.as_str())
        .to_ascii_lowercase();
    if !matches!(next_mode.as_str(), "required" | "auto") {
        return Err(AppError::BadRequest(
            "approval_mode must be one of: required, auto.".to_string(),
        ));
    }

    let next_enabled = payload.enabled.unwrap_or(current_enabled);

    let row = sqlx::query(
        "INSERT INTO agent_approval_policies (
            organization_id,
            tool_name,
            approval_mode,
            enabled,
            updated_by,
            updated_at
         ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, now())
         ON CONFLICT (organization_id, tool_name)
         DO UPDATE SET
            approval_mode = EXCLUDED.approval_mode,
            enabled = EXCLUDED.enabled,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
         RETURNING row_to_json(agent_approval_policies.*) AS row",
    )
    .bind(&query.org_id)
    .bind(tool_name)
    .bind(&next_mode)
    .bind(next_enabled)
    .bind(&user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to update approval policy");
        AppError::Dependency("Failed to update approval policy.".to_string())
    })?;

    let policy = row
        .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::Internal("Failed to persist approval policy.".to_string()))?;

    Ok(Json(json!({
        "ok": true,
        "policy": policy,
    })))
}

fn assert_approver_role(membership: &Value) -> AppResult<()> {
    let role = membership
        .as_object()
        .and_then(|obj| obj.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("viewer")
        .to_ascii_lowercase();

    if APPROVER_ROLES.contains(&role.as_str()) {
        return Ok(());
    }

    Err(AppError::Forbidden(
        "This action requires approver permissions.".to_string(),
    ))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

/// Write an agent_evaluation record after approval or rejection.
/// These records feed the confidence feedback loop in ai_guest_reply.
async fn write_agent_evaluation(
    pool: &sqlx::PgPool,
    org_id: &str,
    agent_slug: &str,
    outcome: &str,
    approval_id: &str,
) {
    let _ = sqlx::query(
        "INSERT INTO agent_evaluations (organization_id, agent_slug, outcome, approval_id, created_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, now())"
    )
    .bind(org_id)
    .bind(agent_slug)
    .bind(outcome)
    .bind(approval_id)
    .execute(pool)
    .await
    .map_err(|error| {
        tracing::warn!(error = %error, "Failed to write agent evaluation record");
    });
}
