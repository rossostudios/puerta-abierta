use serde_json::{json, Map, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    services::{
        agent_chats,
        agent_runtime_v2::RuntimeExecutionIds,
        agent_specs::get_agent_spec,
        ai_agent::{execute_approved_tool, run_ai_agent_chat, RunAiAgentChatParams},
    },
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRunMode {
    Copilot,
    Autonomous,
}

impl AgentRunMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Copilot => "copilot",
            Self::Autonomous => "autonomous",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "copilot" => Ok(Self::Copilot),
            "autonomous" => Ok(Self::Autonomous),
            _ => Err(AppError::BadRequest(
                "mode must be 'copilot' or 'autonomous'.".to_string(),
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CreateAgentRunParams {
    pub org_id: String,
    pub user_id: String,
    pub role: String,
    pub mode: AgentRunMode,
    pub agent_slug: String,
    pub task: String,
    pub context: Value,
    pub preferred_provider: Option<String>,
    pub preferred_model: Option<String>,
    pub allow_mutations: bool,
    pub chat_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ListAgentRunsParams {
    pub status: Option<String>,
    pub mode: Option<String>,
    pub limit: i64,
}

#[derive(Debug, Clone)]
pub struct PreparedAgentRun {
    pub run_id: String,
    pub runtime_ids: RuntimeExecutionIds,
    pub preferred_model: Option<String>,
}

pub async fn list_runs(
    state: &AppState,
    org_id: &str,
    params: &ListAgentRunsParams,
) -> AppResult<Vec<Value>> {
    let pool = db_pool(state)?;
    let limit = params.limit.clamp(1, 100);
    let status = params
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let mode = params
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM (
           SELECT
             r.*,
             (
               SELECT COUNT(*)::int
               FROM agent_approvals a
               WHERE a.agent_run_id = r.id
                 AND a.status = 'pending'
             ) AS pending_approvals
           FROM agent_runs r
           WHERE r.organization_id = $1::uuid
             AND ($2 = '' OR r.status = $2)
             AND ($3 = '' OR r.mode = $3)
           ORDER BY r.created_at DESC
           LIMIT $4
         ) t",
    )
    .bind(org_id)
    .bind(status)
    .bind(mode)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to list agent runs."))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

pub async fn get_run(state: &AppState, org_id: &str, run_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM (
           SELECT
             r.*,
             (
               SELECT COUNT(*)::int
               FROM agent_approvals a
               WHERE a.agent_run_id = r.id
                 AND a.status = 'pending'
             ) AS pending_approvals
           FROM agent_runs r
           WHERE r.organization_id = $1::uuid
             AND r.id = $2::uuid
           LIMIT 1
         ) t",
    )
    .bind(org_id)
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load agent run."))?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Agent run not found.".to_string()))
}

pub async fn list_run_events(
    state: &AppState,
    org_id: &str,
    run_id: &str,
) -> AppResult<Vec<Value>> {
    let pool = db_pool(state)?;
    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM agent_run_events t
         WHERE t.organization_id = $1::uuid
           AND t.run_id = $2::uuid
         ORDER BY t.created_at ASC",
    )
    .bind(org_id)
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load run events."))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

pub async fn create_run(state: &AppState, params: CreateAgentRunParams) -> AppResult<Value> {
    let prepared = begin_run(state, &params).await?;

    let execution = match params.mode {
        AgentRunMode::Copilot => {
            execute_copilot_run(
                state,
                &params,
                &prepared.run_id,
                &prepared.runtime_ids,
                prepared.preferred_model.as_deref(),
            )
            .await
        }
        AgentRunMode::Autonomous => {
            execute_autonomous_run(
                state,
                &params,
                &prepared.run_id,
                &prepared.runtime_ids,
                prepared.preferred_model.as_deref(),
            )
            .await
        }
    };

    match execution {
        Ok(execution) => {
            complete_run_from_result(
                state,
                &params.org_id,
                &prepared.run_id,
                execution.chat_id.as_deref(),
                &execution.result,
                &prepared.runtime_ids,
            )
            .await?;
        }
        Err(error) => {
            mark_run_failed(
                state,
                &params.org_id,
                &prepared.run_id,
                &prepared.runtime_ids,
                &error.detail_message(),
            )
            .await?;
        }
    }

    get_run(state, &params.org_id, &prepared.run_id).await
}

pub async fn begin_run(
    state: &AppState,
    params: &CreateAgentRunParams,
) -> AppResult<PreparedAgentRun> {
    let pool = db_pool(state)?;
    let preferred_provider = normalize_optional(&params.preferred_provider);
    let preferred_model = resolve_preferred_model(
        state,
        preferred_provider.as_deref(),
        params.preferred_model.as_deref(),
    );

    let run_row = sqlx::query(
        "INSERT INTO agent_runs (
            organization_id,
            chat_id,
            agent_slug,
            mode,
            status,
            task,
            context,
            preferred_provider,
            preferred_model,
            allow_mutations,
            created_by_user_id,
            started_at
         ) VALUES (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            'queued',
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::uuid,
            now()
         )
         RETURNING id::text AS id",
    )
    .bind(&params.org_id)
    .bind(params.chat_id.as_deref())
    .bind(&params.agent_slug)
    .bind(params.mode.as_str())
    .bind(params.task.trim())
    .bind(&params.context)
    .bind(preferred_provider.as_deref())
    .bind(preferred_model.as_deref())
    .bind(params.allow_mutations)
    .bind(&params.user_id)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to create agent run."))?;

    let run_id = run_row
        .try_get::<String, _>("id")
        .map_err(|error| AppError::Internal(error.to_string()))?;

    insert_run_event(
        pool,
        &params.org_id,
        &run_id,
        "status",
        json!({ "status": "queued" }),
    )
    .await;

    sqlx::query(
        "UPDATE agent_runs
         SET status = 'running', started_at = now()
         WHERE id = $1::uuid
           AND organization_id = $2::uuid",
    )
    .bind(&run_id)
    .bind(&params.org_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to start agent run."))?;

    insert_run_event(
        pool,
        &params.org_id,
        &run_id,
        "status",
        json!({ "status": "running" }),
    )
    .await;

    Ok(PreparedAgentRun {
        runtime_ids: RuntimeExecutionIds {
            run_id: run_id.clone(),
            trace_id: Uuid::new_v4().to_string(),
        },
        run_id,
        preferred_model,
    })
}

pub async fn complete_run_from_result(
    state: &AppState,
    org_id: &str,
    run_id: &str,
    chat_id: Option<&str>,
    result: &Map<String, Value>,
    runtime_ids: &RuntimeExecutionIds,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let tool_trace = result
        .get("tool_trace")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for item in &tool_trace {
        let tool_name = item
            .get("tool")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("tool");

        let tool_args = item.get("args").cloned().unwrap_or_else(|| json!({}));
        insert_run_event(
            pool,
            org_id,
            run_id,
            "tool_call",
            json!({
                "tool_name": tool_name,
                "args": tool_args,
            }),
        )
        .await;

        insert_run_event(
            pool,
            org_id,
            run_id,
            "tool_result",
            json!({
                "tool_name": tool_name,
                "ok": item.get("ok").and_then(Value::as_bool).unwrap_or(false),
                "preview": item.get("preview").cloned().unwrap_or(Value::Null),
            }),
        )
        .await;
    }

    let reply = result
        .get("reply")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    if !reply.is_empty() {
        insert_run_event(pool, org_id, run_id, "text_delta", json!({ "text": reply })).await;
    }

    let trace = load_trace_for_run(pool, run_id).await?;
    let pending_approvals = list_pending_approvals_for_run(pool, run_id).await?;
    let status = if pending_approvals.is_empty() {
        "completed"
    } else {
        insert_run_event(
            pool,
            org_id,
            run_id,
            "approval_required",
            json!({
                "approval_ids": pending_approvals,
                "count": pending_approvals.len(),
            }),
        )
        .await;
        "waiting_for_approval"
    };

    insert_run_event(pool, org_id, run_id, "status", json!({ "status": status })).await;

    let model_used = result
        .get("model_used")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            trace
                .get("model_used")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let provider = trace
        .get("provider")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| model_provider_from_model(model_used.as_deref()));
    let token_usage = json!({
        "prompt_tokens": trace.get("prompt_tokens").and_then(Value::as_i64).unwrap_or(0),
        "completion_tokens": trace.get("completion_tokens").and_then(Value::as_i64).unwrap_or(0),
        "total_tokens": trace.get("total_tokens").and_then(Value::as_i64).unwrap_or(0),
        "latency_ms": trace.get("latency_ms").and_then(Value::as_i64).unwrap_or(0),
        "cache_creation_input_tokens": trace
            .get("cache_creation_input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        "cache_read_input_tokens": trace
            .get("cache_read_input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    });
    let cost_estimate = estimate_cost_usd(
        model_used.as_deref(),
        token_usage
            .get("prompt_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0) as u64,
        token_usage
            .get("completion_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0) as u64,
    );

    sqlx::query(
        "UPDATE agent_runs
         SET chat_id = COALESCE($1::uuid, chat_id),
             status = $2,
             provider = $3,
             model = $4,
             token_usage = $5,
             cost_estimate_usd = $6,
             result = $7,
             runtime_trace_id = $8,
             completed_at = now(),
             error_message = NULL
         WHERE id = $9::uuid
           AND organization_id = $10::uuid",
    )
    .bind(chat_id)
    .bind(status)
    .bind(provider.as_deref())
    .bind(model_used.as_deref())
    .bind(token_usage)
    .bind(cost_estimate)
    .bind(Value::Object(result.clone()))
    .bind(Some(runtime_ids.trace_id.as_str()))
    .bind(run_id)
    .bind(org_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to finalize agent run."))?;

    get_run(state, org_id, run_id).await
}

pub async fn mark_run_failed(
    state: &AppState,
    org_id: &str,
    run_id: &str,
    runtime_ids: &RuntimeExecutionIds,
    error_message: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    insert_run_event(
        pool,
        org_id,
        run_id,
        "error",
        json!({ "message": error_message }),
    )
    .await;
    insert_run_event(
        pool,
        org_id,
        run_id,
        "status",
        json!({ "status": "failed" }),
    )
    .await;

    sqlx::query(
        "UPDATE agent_runs
         SET status = 'failed',
             error_message = $1,
             runtime_trace_id = $2,
             completed_at = now()
         WHERE id = $3::uuid
           AND organization_id = $4::uuid",
    )
    .bind(error_message)
    .bind(runtime_ids.trace_id.as_str())
    .bind(run_id)
    .bind(org_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to update failed agent run."))?;

    get_run(state, org_id, run_id).await
}

pub async fn cancel_run(
    state: &AppState,
    org_id: &str,
    run_id: &str,
    cancelled_by_user_id: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    sqlx::query(
        "UPDATE agent_runs
         SET status = CASE
               WHEN status IN ('completed', 'failed', 'cancelled') THEN status
               ELSE 'cancelled'
             END,
             cancelled_by_user_id = CASE
               WHEN status IN ('completed', 'failed', 'cancelled') THEN cancelled_by_user_id
               ELSE $1::uuid
             END,
             cancelled_at = CASE
               WHEN status IN ('completed', 'failed', 'cancelled') THEN cancelled_at
               ELSE now()
             END,
             completed_at = CASE
               WHEN status IN ('completed', 'failed', 'cancelled') THEN completed_at
               ELSE now()
             END
         WHERE id = $2::uuid
           AND organization_id = $3::uuid",
    )
    .bind(cancelled_by_user_id)
    .bind(run_id)
    .bind(org_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to cancel agent run."))?;

    insert_run_event(
        pool,
        org_id,
        run_id,
        "status",
        json!({ "status": "cancelled" }),
    )
    .await;

    get_run(state, org_id, run_id).await
}

pub async fn approve_run(
    state: &AppState,
    org_id: &str,
    run_id: &str,
    reviewed_by_user_id: &str,
    review_note: Option<&str>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let approvals = sqlx::query(
        "SELECT id::text AS id,
                tool_name,
                tool_args
         FROM agent_approvals
         WHERE organization_id = $1::uuid
           AND agent_run_id = $2::uuid
           AND status = 'pending'
         ORDER BY created_at ASC",
    )
    .bind(org_id)
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load pending approvals."))?;

    if approvals.is_empty() {
        return get_run(state, org_id, run_id).await;
    }

    let mut had_failure = false;
    for approval in approvals {
        let approval_id = approval
            .try_get::<String, _>("id")
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let tool_name = approval
            .try_get::<String, _>("tool_name")
            .map_err(|error| AppError::Internal(error.to_string()))?;
        let tool_args = approval
            .try_get::<Value, _>("tool_args")
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();

        let approved = sqlx::query(
            "UPDATE agent_approvals
             SET status = 'approved',
                 reviewed_by = $1::uuid,
                 review_note = $2,
                 reviewed_at = now(),
                 execution_key = COALESCE(execution_key, gen_random_uuid()::text)
             WHERE id = $3::uuid
               AND organization_id = $4::uuid
               AND status = 'pending'",
        )
        .bind(reviewed_by_user_id)
        .bind(review_note)
        .bind(&approval_id)
        .bind(org_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::from_database_error(&error, "Failed to approve run action."))?;

        if approved.rows_affected() == 0 {
            continue;
        }

        let execution_result = execute_approved_tool(state, org_id, &tool_name, &tool_args)
            .await
            .unwrap_or_else(|error| json!({ "ok": false, "error": error.detail_message() }));

        let execution_ok = execution_result
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let final_status = if execution_ok {
            "executed"
        } else {
            had_failure = true;
            "execution_failed"
        };

        sqlx::query(
            "UPDATE agent_approvals
             SET status = $1,
                 execution_result = $2,
                 executed_at = now()
             WHERE id = $3::uuid
               AND organization_id = $4::uuid",
        )
        .bind(final_status)
        .bind(&execution_result)
        .bind(&approval_id)
        .bind(org_id)
        .execute(pool)
        .await
        .map_err(|error| {
            AppError::from_database_error(&error, "Failed to finalize approved action.")
        })?;

        insert_run_event(
            pool,
            org_id,
            run_id,
            "tool_result",
            json!({
                "tool_name": tool_name,
                "approval_id": approval_id,
                "ok": execution_ok,
                "status": final_status,
            }),
        )
        .await;
    }

    let next_status = if had_failure { "failed" } else { "completed" };
    sqlx::query(
        "UPDATE agent_runs
         SET status = $1,
             completed_at = now(),
             error_message = CASE WHEN $1 = 'failed' THEN COALESCE(error_message, 'One or more approved actions failed.') ELSE error_message END
         WHERE id = $2::uuid
           AND organization_id = $3::uuid",
    )
    .bind(next_status)
    .bind(run_id)
    .bind(org_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to update run status after approval."))?;

    insert_run_event(
        pool,
        org_id,
        run_id,
        "status",
        json!({ "status": next_status }),
    )
    .await;

    get_run(state, org_id, run_id).await
}

pub async fn append_run_event(
    state: &AppState,
    org_id: &str,
    run_id: &str,
    event_type: &str,
    data: Value,
) -> AppResult<()> {
    let pool = db_pool(state)?;
    insert_run_event(pool, org_id, run_id, event_type, data).await;
    Ok(())
}

pub async fn reconcile_run_after_approval_review(
    state: &AppState,
    org_id: &str,
    run_id: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let pending_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM agent_approvals
         WHERE organization_id = $1::uuid
           AND agent_run_id = $2::uuid
           AND status = 'pending'",
    )
    .bind(org_id)
    .bind(run_id)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load run approval state."))?;

    if pending_count > 0 {
        return get_run(state, org_id, run_id).await;
    }

    let current_run = get_run(state, org_id, run_id).await?;
    let current_status = current_run
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if matches!(current_status, "completed" | "failed" | "cancelled") {
        return Ok(current_run);
    }

    let approval_summary = sqlx::query(
        "SELECT
            COUNT(*) FILTER (WHERE status = 'executed')::int AS executed_count,
            COUNT(*) FILTER (WHERE status = 'execution_failed')::int AS execution_failed_count,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count
         FROM agent_approvals
         WHERE organization_id = $1::uuid
           AND agent_run_id = $2::uuid",
    )
    .bind(org_id)
    .bind(run_id)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to summarize run approvals."))?;

    let executed_count = approval_summary
        .try_get::<i32, _>("executed_count")
        .unwrap_or(0);
    let execution_failed_count = approval_summary
        .try_get::<i32, _>("execution_failed_count")
        .unwrap_or(0);
    let rejected_count = approval_summary
        .try_get::<i32, _>("rejected_count")
        .unwrap_or(0);

    if executed_count == 0 && execution_failed_count == 0 && rejected_count == 0 {
        return Ok(current_run);
    }

    let next_status = if execution_failed_count > 0 || rejected_count > 0 {
        "failed"
    } else {
        "completed"
    };

    sqlx::query(
        "UPDATE agent_runs
         SET status = $1,
             completed_at = now(),
             error_message = CASE
               WHEN $1 = 'failed'
                 THEN COALESCE(error_message, 'One or more approved actions were rejected or failed.')
               ELSE error_message
             END
         WHERE id = $2::uuid
           AND organization_id = $3::uuid",
    )
    .bind(next_status)
    .bind(run_id)
    .bind(org_id)
    .execute(pool)
    .await
    .map_err(|error| {
        AppError::from_database_error(
            &error,
            "Failed to update run status after approval review.",
        )
    })?;

    insert_run_event(
        pool,
        org_id,
        run_id,
        "status",
        json!({ "status": next_status }),
    )
    .await;

    get_run(state, org_id, run_id).await
}

#[derive(Debug, Clone)]
struct ExecutedRun {
    chat_id: Option<String>,
    result: Map<String, Value>,
}

async fn execute_copilot_run(
    state: &AppState,
    params: &CreateAgentRunParams,
    run_id: &str,
    runtime_ids: &RuntimeExecutionIds,
    preferred_model: Option<&str>,
) -> AppResult<ExecutedRun> {
    let chat_id = if let Some(existing_chat_id) = params
        .chat_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        existing_chat_id.to_string()
    } else {
        let chat = agent_chats::create_chat(
            state,
            &params.org_id,
            &params.user_id,
            &params.agent_slug,
            Some("Casaora AI"),
            preferred_model,
        )
        .await?;

        value_str(&chat, "id")
            .ok_or_else(|| AppError::Internal("New chat did not return an id.".to_string()))?
    };

    let message = wrap_message_with_context(&params.task, &params.context);
    let result = agent_chats::send_chat_message(
        state,
        &chat_id,
        &params.org_id,
        &params.user_id,
        &params.role,
        &message,
        params.allow_mutations,
        false,
        Some(runtime_ids),
        Some(run_id),
    )
    .await?;

    Ok(executed_run_from_result(&result, Some(chat_id)))
}

async fn execute_autonomous_run(
    state: &AppState,
    params: &CreateAgentRunParams,
    run_id: &str,
    runtime_ids: &RuntimeExecutionIds,
    preferred_model: Option<&str>,
) -> AppResult<ExecutedRun> {
    let agent = get_agent_runtime_row(state, &params.org_id, &params.agent_slug).await?;
    let canonical_spec = get_agent_spec(&params.agent_slug).ok_or_else(|| {
        AppError::BadRequest("Agent spec is missing from runtime registry.".to_string())
    })?;
    let runtime_override = agent
        .get("model_override")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let model_policy_default = agent_model_policy_default(&agent);
    let effective_preferred_model = preferred_model
        .map(ToOwned::to_owned)
        .or(runtime_override)
        .or(model_policy_default);
    let max_steps_override = agent
        .get("max_steps_override")
        .and_then(Value::as_i64)
        .map(|value| value as i32)
        .or(Some(canonical_spec.max_steps));
    let allow_mutations_default = agent
        .get("allow_mutations_default")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let allowed_tools = canonical_spec.allowed_tools.map(|tools| {
        tools
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>()
    });

    let result = run_ai_agent_chat(
        state,
        RunAiAgentChatParams {
            org_id: &params.org_id,
            role: &params.role,
            message: &wrap_message_with_context(&params.task, &params.context),
            conversation: &[],
            allow_mutations: params.allow_mutations && allow_mutations_default,
            confirm_write: false,
            agent_name: canonical_spec.name,
            agent_prompt: Some(canonical_spec.system_prompt),
            allowed_tools: allowed_tools.as_deref(),
            agent_slug: Some(&params.agent_slug),
            chat_id: None,
            agent_run_id: Some(run_id),
            requested_by_user_id: Some(&params.user_id),
            preferred_model: effective_preferred_model.as_deref(),
            max_steps_override,
            runtime_context: Some(crate::services::ai_agent::RuntimeExecutionContext {
                run_id: Some(runtime_ids.run_id.as_str()),
                trace_id: Some(runtime_ids.trace_id.as_str()),
                llm_transport: None,
                is_shadow_run: false,
                shadow_of_run_id: None,
                disable_shadow: false,
            }),
        },
    )
    .await?;

    Ok(executed_run_from_result(&result, None))
}

fn executed_run_from_result(result: &Map<String, Value>, chat_id: Option<String>) -> ExecutedRun {
    ExecutedRun {
        chat_id,
        result: result.clone(),
    }
}

async fn get_agent_runtime_row(
    state: &AppState,
    org_id: &str,
    agent_slug: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM (
           SELECT
             a.*,
             COALESCE(o.is_active, a.is_active) AS effective_is_active,
             o.model_override,
             o.max_steps_override,
             o.allow_mutations_default
           FROM ai_agents a
           LEFT JOIN agent_runtime_overrides o
             ON o.organization_id = $1::uuid
            AND o.agent_slug = a.slug
           WHERE a.slug = $2
           LIMIT 1
         ) t
         WHERE t.effective_is_active = TRUE",
    )
    .bind(org_id)
    .bind(agent_slug)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        AppError::from_database_error(&error, "Failed to load agent configuration.")
    })?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("AI agent was not found.".to_string()))
}

async fn load_trace_for_run(pool: &sqlx::PgPool, run_id: &str) -> AppResult<Value> {
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM agent_traces t
         WHERE t.runtime_run_id = $1
         ORDER BY t.created_at DESC
         LIMIT 1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load run trace."))?;

    Ok(row
        .and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .unwrap_or_else(|| json!({})))
}

async fn list_pending_approvals_for_run(
    pool: &sqlx::PgPool,
    run_id: &str,
) -> AppResult<Vec<String>> {
    let rows = sqlx::query(
        "SELECT id::text AS id
         FROM agent_approvals
         WHERE agent_run_id = $1::uuid
           AND status = 'pending'
         ORDER BY created_at ASC",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::from_database_error(&error, "Failed to load pending approvals."))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<String>, _>("id").ok().flatten())
        .collect())
}

async fn insert_run_event(
    pool: &sqlx::PgPool,
    org_id: &str,
    run_id: &str,
    event_type: &str,
    data: Value,
) {
    let _ = sqlx::query(
        "INSERT INTO agent_run_events (run_id, organization_id, event_type, data)
         VALUES ($1::uuid, $2::uuid, $3, $4)",
    )
    .bind(run_id)
    .bind(org_id)
    .bind(event_type)
    .bind(data)
    .execute(pool)
    .await;
}

fn wrap_message_with_context(task: &str, context: &Value) -> String {
    let trimmed = task.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if !context.is_object() || context.as_object().is_some_and(|value| value.is_empty()) {
        return trimmed.to_string();
    }

    let context_json = serde_json::to_string(context).unwrap_or_else(|_| "{}".to_string());
    format!("[CasaoraContext]\n{context_json}\n[/CasaoraContext]\n{trimmed}")
}

pub fn split_context_from_task(raw_task: &str) -> (String, Value) {
    const CONTEXT_START: &str = "[CasaoraContext]";
    const CONTEXT_END: &str = "[/CasaoraContext]";

    let trimmed = raw_task.trim();
    if trimmed.is_empty() {
        return (String::new(), json!({}));
    }
    if !trimmed.starts_with(CONTEXT_START) {
        return (trimmed.to_string(), json!({}));
    }

    let Some(end_index) = trimmed.find(CONTEXT_END) else {
        return (trimmed.to_string(), json!({}));
    };

    let raw_context = trimmed[CONTEXT_START.len()..end_index].trim();
    let context = serde_json::from_str::<Value>(raw_context)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let task = trimmed[end_index + CONTEXT_END.len()..].trim();

    (
        if task.is_empty() {
            trimmed.to_string()
        } else {
            task.to_string()
        },
        context,
    )
}

fn normalize_optional(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_preferred_model(
    state: &AppState,
    preferred_provider: Option<&str>,
    preferred_model: Option<&str>,
) -> Option<String> {
    let preferred_model = preferred_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if preferred_model.is_some() {
        return preferred_model;
    }

    let provider = preferred_provider
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    match provider {
        "anthropic" => state
            .config
            .anthropic_model_chain()
            .first()
            .map(|model| format!("anthropic:{model}")),
        _ => state
            .config
            .openai_model_chain()
            .first()
            .map(|model| format!("openai:{model}")),
    }
}

fn agent_model_policy_default(agent: &Value) -> Option<String> {
    let policy = agent.get("model_policy")?.as_object()?;
    let default_model = policy
        .get("defaultModel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if default_model.contains(':') {
        return Some(default_model.to_string());
    }
    let default_provider = policy
        .get("defaultProvider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(format!("{default_provider}:{default_model}"))
}

fn model_provider_from_model(model: Option<&str>) -> Option<String> {
    model
        .and_then(|value| value.split_once(':').map(|(provider, _)| provider))
        .map(ToOwned::to_owned)
}

fn estimate_cost_usd(
    model: Option<&str>,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> Option<f64> {
    let (input_rate, output_rate) = match model.unwrap_or_default() {
        "openai:gpt-5.2" => (1.75_f64, 14.0_f64),
        "openai:gpt-5-mini" => (0.25_f64, 2.0_f64),
        "anthropic:claude-sonnet-4-6" => (3.0_f64, 15.0_f64),
        "anthropic:claude-haiku-4-5" => (1.0_f64, 5.0_f64),
        _ => return None,
    };

    Some(
        ((prompt_tokens as f64 / 1_000_000_f64) * input_rate)
            + ((completion_tokens as f64 / 1_000_000_f64) * output_rate),
    )
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("Database is not configured.".to_string()))
}

fn value_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::split_context_from_task;

    #[test]
    fn split_context_from_task_extracts_context_envelope() {
        let raw = "[CasaoraContext]\n{\"source\":\"listings\",\"entityIds\":[\"abc\"],\"filters\":{},\"summary\":\"Listing context\",\"returnPath\":\"/module/listings/abc\"}\n[/CasaoraContext]\nReview this draft listing";
        let (task, context) = split_context_from_task(raw);

        assert_eq!(task, "Review this draft listing");
        assert_eq!(
            context.get("source").and_then(serde_json::Value::as_str),
            Some("listings")
        );
    }

    #[test]
    fn split_context_from_task_leaves_plain_text_untouched() {
        let (task, context) = split_context_from_task("Send a rent reminder");

        assert_eq!(task, "Send a rent reminder");
        assert!(context.as_object().is_some_and(|value| value.is_empty()));
    }
}
