use std::{collections::BTreeMap, env};

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    config::WorkflowEngineMode,
    repository::table_service::{create_row, get_row, list_rows, update_row},
};

#[derive(Debug, Clone, Serialize, Default)]
pub struct ProcessWorkflowJobsSummary {
    pub picked: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
    pub retried: u32,
}

#[derive(Debug)]
struct WorkflowJob {
    id: String,
    organization_id: String,
    workflow_rule_id: Option<String>,
    action_type: String,
    action_config: Value,
    context: Map<String, Value>,
    attempts: i32,
    max_attempts: i32,
}

enum ExecutionOutcome {
    Succeeded,
    Skipped(String),
}

/// Fire a workflow trigger event for an organization.
///
/// Queue mode:
/// - Enqueue durable jobs into `workflow_jobs`.
///
/// Legacy mode:
/// - Execute immediately (or delayed in-memory sleep) to preserve old behavior.
pub async fn fire_trigger(
    pool: &sqlx::PgPool,
    org_id: &str,
    trigger_event: &str,
    context: &Map<String, Value>,
    engine_mode: WorkflowEngineMode,
) {
    let queue_mode = engine_mode == WorkflowEngineMode::Queue && queue_enabled_for_org(org_id);

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert("is_active".to_string(), Value::Bool(true));
    filters.insert(
        "trigger_event".to_string(),
        Value::String(trigger_event.to_string()),
    );

    let rules = match list_rows(
        pool,
        "workflow_rules",
        Some(&filters),
        200,
        0,
        "created_at",
        true,
    )
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            warn!(?error, "workflow fire_trigger: could not load rules");
            return;
        }
    };

    for rule in rules {
        let rule_id = val_str(&rule, "id");
        let action_type = val_str(&rule, "action_type");
        let action_config = rule
            .as_object()
            .and_then(|obj| obj.get("action_config"))
            .cloned()
            .unwrap_or_else(|| json!({}));

        let delay_minutes = rule
            .as_object()
            .and_then(|obj| obj.get("delay_minutes"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);

        let normalized_config = normalize_action_config(&action_type, &action_config);

        if queue_mode {
            if rule_id.is_empty() {
                warn!(
                    trigger_event,
                    "workflow fire_trigger: skipping rule without id"
                );
                continue;
            }
            let run_at = Utc::now() + Duration::minutes(delay_minutes);
            if let Err(error) = enqueue_workflow_job(
                pool,
                org_id,
                &rule_id,
                trigger_event,
                &action_type,
                &normalized_config,
                context,
                run_at,
            )
            .await
            {
                warn!(?error, rule_id, trigger_event, "workflow enqueue failed");
            }
            continue;
        }

        if delay_minutes > 0 {
            let pool = pool.clone();
            let org_id = org_id.to_string();
            let rule_id = rule_id.clone();
            let action_type = action_type.clone();
            let normalized_config = normalized_config.clone();
            let context = context.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(
                    (delay_minutes as u64).saturating_mul(60),
                ))
                .await;
                if let Err(error) = execute_action(
                    &pool,
                    &org_id,
                    Some(rule_id.as_str()),
                    &action_type,
                    &normalized_config,
                    &context,
                )
                .await
                {
                    warn!(?error, "workflow legacy delayed action failed");
                }
            });
            continue;
        }

        if let Err(error) = execute_action(
            pool,
            org_id,
            Some(rule_id.as_str()),
            &action_type,
            &normalized_config,
            context,
        )
        .await
        {
            warn!(?error, "workflow legacy action failed");
        }
    }
}

fn queue_enabled_for_org(org_id: &str) -> bool {
    let raw = env::var("WORKFLOW_QUEUE_ORG_ALLOWLIST").unwrap_or_default();
    queue_enabled_for_org_allowlist(org_id, &raw)
}

fn queue_enabled_for_org_allowlist(org_id: &str, raw_allowlist: &str) -> bool {
    let target = org_id.trim();
    if target.is_empty() {
        return false;
    }

    let allowlist = raw_allowlist
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if allowlist.is_empty() {
        return true;
    }

    allowlist.iter().any(|value| *value == target)
}

/// Process queued workflow jobs using row-level locking and retry policy.
pub async fn process_workflow_jobs(
    pool: &sqlx::PgPool,
    batch_size: i64,
) -> ProcessWorkflowJobsSummary {
    let jobs = claim_jobs(pool, batch_size).await;
    let mut summary = ProcessWorkflowJobsSummary {
        picked: jobs.len() as u32,
        ..ProcessWorkflowJobsSummary::default()
    };

    for job in jobs {
        let started_at = Utc::now();
        let normalized_config = normalize_action_config(&job.action_type, &job.action_config);

        let result = execute_action(
            pool,
            &job.organization_id,
            job.workflow_rule_id.as_deref(),
            &job.action_type,
            &normalized_config,
            &job.context,
        )
        .await;

        let finished_at = Utc::now();

        match result {
            Ok(ExecutionOutcome::Succeeded) => {
                summary.succeeded += 1;
                let _ = record_attempt(
                    pool,
                    &job,
                    "succeeded",
                    None,
                    &normalized_config,
                    started_at,
                    finished_at,
                )
                .await;
                let _ = mark_job_succeeded(pool, &job.id).await;
            }
            Ok(ExecutionOutcome::Skipped(reason)) => {
                summary.skipped += 1;
                let _ = record_attempt(
                    pool,
                    &job,
                    "skipped",
                    Some(&reason),
                    &normalized_config,
                    started_at,
                    finished_at,
                )
                .await;
                let _ = mark_job_skipped(pool, &job.id, &reason).await;
            }
            Err(error) => {
                let _ = record_attempt(
                    pool,
                    &job,
                    "failed",
                    Some(&error),
                    &normalized_config,
                    started_at,
                    finished_at,
                )
                .await;

                if job.attempts >= job.max_attempts {
                    summary.failed += 1;
                    let _ = mark_job_failed(pool, &job.id, &error).await;
                } else {
                    summary.retried += 1;
                    let backoff = retry_backoff_seconds(job.attempts);
                    let retry_at = Utc::now() + Duration::seconds(backoff);
                    let _ = requeue_job(pool, &job.id, &error, retry_at).await;
                }
            }
        }
    }

    if summary.picked > 0 {
        info!(
            picked = summary.picked,
            succeeded = summary.succeeded,
            skipped = summary.skipped,
            failed = summary.failed,
            retried = summary.retried,
            "processed workflow jobs"
        );
    }

    summary
}

async fn enqueue_workflow_job(
    pool: &sqlx::PgPool,
    org_id: &str,
    rule_id: &str,
    trigger_event: &str,
    action_type: &str,
    action_config: &Value,
    context: &Map<String, Value>,
    run_at: DateTime<Utc>,
) -> Result<(), String> {
    let org_uuid =
        Uuid::parse_str(org_id).map_err(|error| format!("invalid org_id '{org_id}': {error}"))?;
    let rule_uuid = Uuid::parse_str(rule_id)
        .map_err(|error| format!("invalid rule_id '{rule_id}': {error}"))?;

    let dedupe_key = generate_dedupe_key(
        org_id,
        rule_id,
        trigger_event,
        action_type,
        action_config,
        context,
    );

    sqlx::query(
        r#"
        INSERT INTO workflow_jobs (
          organization_id,
          workflow_rule_id,
          trigger_event,
          action_type,
          action_config,
          context,
          run_at,
          dedupe_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (dedupe_key) DO NOTHING
        "#,
    )
    .bind(org_uuid)
    .bind(rule_uuid)
    .bind(trigger_event)
    .bind(action_type)
    .bind(action_config)
    .bind(Value::Object(context.clone()))
    .bind(run_at)
    .bind(dedupe_key)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn claim_jobs(pool: &sqlx::PgPool, batch_size: i64) -> Vec<WorkflowJob> {
    let rows = sqlx::query_scalar::<_, Value>(
        r#"
        WITH picked AS (
          SELECT id
          FROM workflow_jobs
          WHERE status = 'queued'
            AND run_at <= now()
          ORDER BY run_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE workflow_jobs w
        SET status = 'running',
            started_at = now(),
            attempts = w.attempts + 1,
            updated_at = now()
        FROM picked
        WHERE w.id = picked.id
        RETURNING row_to_json(w) AS row
        "#,
    )
    .bind(batch_size.clamp(1, 500))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .filter_map(|row| parse_job_row(&row))
        .collect()
}

fn parse_job_row(row: &Value) -> Option<WorkflowJob> {
    let object = row.as_object()?;

    Some(WorkflowJob {
        id: str_from_obj(object, "id").to_string(),
        organization_id: str_from_obj(object, "organization_id").to_string(),
        workflow_rule_id: non_empty_opt(object.get("workflow_rule_id").and_then(Value::as_str)),
        action_type: str_from_obj(object, "action_type").to_string(),
        action_config: object
            .get("action_config")
            .cloned()
            .unwrap_or_else(|| json!({})),
        context: object
            .get("context")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        attempts: object
            .get("attempts")
            .and_then(Value::as_i64)
            .unwrap_or(1)
            .max(1) as i32,
        max_attempts: object
            .get("max_attempts")
            .and_then(Value::as_i64)
            .unwrap_or(3)
            .max(1) as i32,
    })
}

async fn record_attempt(
    pool: &sqlx::PgPool,
    job: &WorkflowJob,
    status: &str,
    reason: Option<&str>,
    normalized_action_config: &Value,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
) -> Result<(), String> {
    let mut attempt = Map::new();
    attempt.insert(
        "workflow_job_id".to_string(),
        Value::String(job.id.to_string()),
    );
    attempt.insert(
        "organization_id".to_string(),
        Value::String(job.organization_id.to_string()),
    );
    attempt.insert("attempt_number".to_string(), json!(job.attempts));
    attempt.insert("status".to_string(), Value::String(status.to_string()));
    attempt.insert(
        "reason".to_string(),
        reason
            .map(|item| Value::String(item.to_string()))
            .unwrap_or(Value::Null),
    );
    attempt.insert(
        "normalized_action_config".to_string(),
        normalized_action_config.clone(),
    );
    attempt.insert(
        "context_snapshot".to_string(),
        Value::Object(job.context.clone()),
    );
    attempt.insert(
        "started_at".to_string(),
        Value::String(started_at.to_rfc3339()),
    );
    attempt.insert(
        "finished_at".to_string(),
        Value::String(finished_at.to_rfc3339()),
    );

    create_row(pool, "workflow_job_attempts", &attempt)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn mark_job_succeeded(pool: &sqlx::PgPool, job_id: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE workflow_jobs SET status = 'succeeded', finished_at = now(), last_error = NULL, updated_at = now() WHERE id = $1::uuid",
    )
    .bind(job_id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

async fn mark_job_skipped(pool: &sqlx::PgPool, job_id: &str, reason: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE workflow_jobs SET status = 'skipped', finished_at = now(), last_error = $2, updated_at = now() WHERE id = $1::uuid",
    )
    .bind(job_id)
    .bind(truncate_reason(reason))
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

async fn requeue_job(
    pool: &sqlx::PgPool,
    job_id: &str,
    error: &str,
    retry_at: DateTime<Utc>,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE workflow_jobs
        SET status = 'queued',
            run_at = $2,
            started_at = NULL,
            last_error = $3,
            updated_at = now()
        WHERE id = $1::uuid
        "#,
    )
    .bind(job_id)
    .bind(retry_at)
    .bind(truncate_reason(error))
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|err| err.to_string())
}

async fn mark_job_failed(pool: &sqlx::PgPool, job_id: &str, error: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE workflow_jobs SET status = 'failed', finished_at = now(), last_error = $2, updated_at = now() WHERE id = $1::uuid",
    )
    .bind(job_id)
    .bind(truncate_reason(error))
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn retry_backoff_seconds(attempts: i32) -> i64 {
    let clamped = attempts.saturating_sub(1).clamp(0, 5) as u32;
    let seconds = 30_i64.saturating_mul(1_i64 << clamped);
    seconds.min(900)
}

async fn execute_action(
    pool: &sqlx::PgPool,
    org_id: &str,
    workflow_rule_id: Option<&str>,
    action_type: &str,
    action_config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    match action_type {
        "create_task" => execute_create_task(pool, org_id, action_config, context).await,
        "send_notification" => {
            execute_send_notification(pool, org_id, action_config, context).await
        }
        "send_whatsapp" => execute_send_whatsapp(pool, org_id, action_config, context).await,
        "update_status" => execute_update_status(pool, org_id, action_config, context).await,
        "create_expense" => execute_create_expense(pool, org_id, action_config, context).await,
        "assign_task_round_robin" => {
            execute_assign_task_round_robin(pool, org_id, workflow_rule_id, action_config, context)
                .await
        }
        other => Ok(ExecutionOutcome::Skipped(format!(
            "unsupported action_type '{other}'"
        ))),
    }
}

async fn execute_create_task(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let title_template = config
        .as_object()
        .and_then(|obj| obj.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Auto-generated task");

    let task_type = config
        .as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("custom");

    let priority = config
        .as_object()
        .and_then(|obj| obj.get("priority"))
        .and_then(Value::as_str)
        .unwrap_or("medium");

    let mut task = Map::new();
    task.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    task.insert(
        "title".to_string(),
        Value::String(resolve_template(title_template, context)),
    );
    task.insert("type".to_string(), Value::String(task_type.to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert("priority".to_string(), Value::String(priority.to_string()));

    if let Some(property_id) = context.get("property_id") {
        task.insert("property_id".to_string(), property_id.clone());
    }
    if let Some(unit_id) = context.get("unit_id") {
        task.insert("unit_id".to_string(), unit_id.clone());
    }
    if let Some(reservation_id) = context.get("reservation_id") {
        task.insert("reservation_id".to_string(), reservation_id.clone());
    }

    if let Some(assigned_user_id) = config
        .as_object()
        .and_then(|obj| obj.get("assigned_user_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        task.insert(
            "assigned_user_id".to_string(),
            Value::String(assigned_user_id.to_string()),
        );
    } else if let Some(assigned_role) = config
        .as_object()
        .and_then(|obj| obj.get("assigned_role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let members = find_org_members_by_role(pool, org_id, assigned_role)
            .await
            .map_err(|error| error.to_string())?;
        if let Some(member) = members.first() {
            let user_id = val_str(member, "user_id");
            if !user_id.is_empty() {
                task.insert("assigned_user_id".to_string(), Value::String(user_id));
            }
        }
    }

    create_row(pool, "tasks", &task)
        .await
        .map_err(|error| error.to_string())?;

    Ok(ExecutionOutcome::Succeeded)
}

async fn execute_send_notification(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let channel = config
        .as_object()
        .and_then(|obj| obj.get("channel"))
        .and_then(Value::as_str)
        .unwrap_or("whatsapp")
        .trim()
        .to_ascii_lowercase();

    if !matches!(channel.as_str(), "whatsapp" | "email" | "sms") {
        return Ok(ExecutionOutcome::Skipped(format!(
            "unsupported notification channel '{channel}'"
        )));
    }

    let recipient = resolve_recipient(&channel, config, context);
    if recipient.is_empty() {
        return Ok(ExecutionOutcome::Skipped(
            "recipient could not be resolved".to_string(),
        ));
    }

    let template_hint = config
        .as_object()
        .and_then(|obj| obj.get("template_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let template_id = match template_hint {
        Some(hint) => resolve_template_id(pool, org_id, hint).await,
        None => None,
    };

    let body = config
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(Value::as_str)
        .map(|template| resolve_template(template, context));

    let subject = config
        .as_object()
        .and_then(|obj| obj.get("subject"))
        .and_then(Value::as_str)
        .map(|template| resolve_template(template, context));

    let mut payload = Map::new();
    if let Some(body) = body {
        if !body.trim().is_empty() {
            payload.insert("body".to_string(), Value::String(body));
        }
    }
    if let Some(subject) = subject {
        if !subject.trim().is_empty() {
            payload.insert("subject".to_string(), Value::String(subject));
        }
    }
    payload.insert("variables".to_string(), Value::Object(context.clone()));

    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String(channel));
    msg.insert("recipient".to_string(), Value::String(recipient));
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );
    msg.insert("payload".to_string(), Value::Object(payload));

    if let Some(template_id) = template_id {
        msg.insert("template_id".to_string(), Value::String(template_id));
    }
    if let Some(reservation_id) = context.get("reservation_id") {
        msg.insert("reservation_id".to_string(), reservation_id.clone());
    }
    if let Some(guest_id) = context.get("guest_id") {
        msg.insert("guest_id".to_string(), guest_id.clone());
    }

    create_row(pool, "message_logs", &msg)
        .await
        .map_err(|error| error.to_string())?;

    Ok(ExecutionOutcome::Succeeded)
}

async fn execute_send_whatsapp(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let recipient = resolve_recipient("whatsapp", config, context);
    if recipient.is_empty() {
        return Ok(ExecutionOutcome::Skipped(
            "recipient could not be resolved".to_string(),
        ));
    }

    let body = config
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(Value::as_str)
        .map(|template| resolve_template(template, context));

    let template_hint = config
        .as_object()
        .and_then(|obj| obj.get("template_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let template_id = match template_hint {
        Some(hint) => resolve_template_id(pool, org_id, hint).await,
        None => None,
    };

    if body
        .as_deref()
        .map(str::trim)
        .is_none_or(|value| value.is_empty())
        && template_id.is_none()
    {
        return Ok(ExecutionOutcome::Skipped(
            "missing body/template for whatsapp".to_string(),
        ));
    }

    let mut payload = Map::new();
    if let Some(body) = body {
        if !body.trim().is_empty() {
            payload.insert("body".to_string(), Value::String(body));
        }
    }
    if let Some(name) = config
        .as_object()
        .and_then(|obj| obj.get("whatsapp_template_name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.insert(
            "whatsapp_template_name".to_string(),
            Value::String(name.to_string()),
        );
    }

    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
    msg.insert("recipient".to_string(), Value::String(recipient));
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );
    msg.insert("payload".to_string(), Value::Object(payload));

    if let Some(template_id) = template_id {
        msg.insert("template_id".to_string(), Value::String(template_id));
    }
    if let Some(reservation_id) = context.get("reservation_id") {
        msg.insert("reservation_id".to_string(), reservation_id.clone());
    }
    if let Some(guest_id) = context.get("guest_id") {
        msg.insert("guest_id".to_string(), guest_id.clone());
    }

    create_row(pool, "message_logs", &msg)
        .await
        .map_err(|error| error.to_string())?;

    Ok(ExecutionOutcome::Succeeded)
}

async fn execute_update_status(
    pool: &sqlx::PgPool,
    _org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let entity_type = config
        .as_object()
        .and_then(|obj| obj.get("entity_type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("reservation");

    let target_status = config
        .as_object()
        .and_then(|obj| obj.get("target_status"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let Some(target_status) = target_status else {
        return Ok(ExecutionOutcome::Skipped(
            "target_status is required".to_string(),
        ));
    };

    let entity_id = config
        .as_object()
        .and_then(|obj| obj.get("entity_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| match entity_type {
            "reservation" => context
                .get("reservation_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            "lease" => context
                .get("lease_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            "task" => context
                .get("task_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            _ => None,
        });

    let Some(entity_id) = entity_id else {
        return Ok(ExecutionOutcome::Skipped(
            "entity_id could not be resolved".to_string(),
        ));
    };

    let (table, status_field) = match entity_type {
        "reservation" => ("reservations", "status"),
        "lease" => ("leases", "lease_status"),
        "task" => ("tasks", "status"),
        _ => {
            return Ok(ExecutionOutcome::Skipped(format!(
                "unsupported entity_type '{entity_type}'"
            )));
        }
    };

    let current = get_row(pool, table, &entity_id, "id")
        .await
        .map_err(|error| error.to_string())?;
    let current_status = val_str(&current, status_field);

    if current_status == target_status {
        return Ok(ExecutionOutcome::Skipped(
            "entity already has target status".to_string(),
        ));
    }

    if !is_allowed_status_transition(entity_type, &current_status, target_status) {
        return Ok(ExecutionOutcome::Skipped(format!(
            "forbidden transition: {entity_type} {current_status} -> {target_status}"
        )));
    }

    let mut patch = Map::new();
    patch.insert(
        status_field.to_string(),
        Value::String(target_status.to_string()),
    );

    if entity_type == "task" && target_status == "done" {
        patch.insert(
            "completed_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    }

    if entity_type == "reservation" && target_status == "cancelled" {
        if let Some(cancel_reason) = config
            .as_object()
            .and_then(|obj| obj.get("cancel_reason"))
            .and_then(Value::as_str)
        {
            patch.insert(
                "cancel_reason".to_string(),
                Value::String(cancel_reason.to_string()),
            );
        }
    }

    update_row(pool, table, &entity_id, &patch, "id")
        .await
        .map_err(|error| error.to_string())?;

    Ok(ExecutionOutcome::Succeeded)
}

async fn execute_create_expense(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let Some(amount) = parse_canonical_amount(config).ok() else {
        return Ok(ExecutionOutcome::Skipped(
            "invalid amount for create_expense".to_string(),
        ));
    };

    if amount <= 0.0 {
        return Ok(ExecutionOutcome::Skipped(
            "create_expense amount must be greater than 0".to_string(),
        ));
    }

    let category = config
        .as_object()
        .and_then(|obj| obj.get("category"))
        .and_then(Value::as_str)
        .unwrap_or("other");

    let currency = config
        .as_object()
        .and_then(|obj| obj.get("currency"))
        .and_then(Value::as_str)
        .or_else(|| context.get("currency").and_then(Value::as_str))
        .unwrap_or("PYG");

    let mut expense = Map::new();
    expense.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    expense.insert("category".to_string(), Value::String(category.to_string()));
    expense.insert(
        "expense_date".to_string(),
        Value::String(Utc::now().date_naive().to_string()),
    );
    expense.insert("amount".to_string(), json!(amount));
    expense.insert("currency".to_string(), Value::String(currency.to_string()));
    expense.insert(
        "payment_method".to_string(),
        Value::String(
            config
                .as_object()
                .and_then(|obj| obj.get("payment_method"))
                .and_then(Value::as_str)
                .unwrap_or("bank_transfer")
                .to_string(),
        ),
    );
    expense.insert("receipt_url".to_string(), Value::String(String::new()));

    if let Some(description) = config
        .as_object()
        .and_then(|obj| obj.get("description"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        expense.insert("notes".to_string(), Value::String(description.to_string()));
    }

    if let Some(property_id) = context.get("property_id") {
        expense.insert("property_id".to_string(), property_id.clone());
    }
    if let Some(unit_id) = context.get("unit_id") {
        expense.insert("unit_id".to_string(), unit_id.clone());
    }
    if let Some(reservation_id) = context.get("reservation_id") {
        expense.insert("reservation_id".to_string(), reservation_id.clone());
    }

    create_row(pool, "expenses", &expense)
        .await
        .map_err(|error| error.to_string())?;

    Ok(ExecutionOutcome::Succeeded)
}

async fn execute_assign_task_round_robin(
    pool: &sqlx::PgPool,
    org_id: &str,
    workflow_rule_id: Option<&str>,
    config: &Value,
    context: &Map<String, Value>,
) -> Result<ExecutionOutcome, String> {
    let Some(rule_id) = workflow_rule_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(ExecutionOutcome::Skipped(
            "assign_task_round_robin requires workflow_rule_id".to_string(),
        ));
    };

    let role = config
        .as_object()
        .and_then(|obj| obj.get("assigned_role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("operator");

    let members = find_org_members_by_role(pool, org_id, role)
        .await
        .map_err(|error| error.to_string())?;

    let eligible = members
        .into_iter()
        .filter_map(|member| {
            let user_id = val_str(&member, "user_id");
            if user_id.is_empty() {
                return None;
            }
            Some(user_id)
        })
        .collect::<Vec<_>>();

    if eligible.is_empty() {
        return Ok(ExecutionOutcome::Skipped(format!(
            "no eligible members for role '{role}'"
        )));
    }

    let current_cursor = get_round_robin_cursor(pool, org_id, rule_id, role).await;
    let (index, next_cursor) = next_round_robin_position(current_cursor, eligible.len());
    let selected_user_id = eligible[index].clone();

    let mut task_config = config.as_object().cloned().unwrap_or_default();
    task_config.insert(
        "assigned_user_id".to_string(),
        Value::String(selected_user_id.clone()),
    );

    execute_create_task(pool, org_id, &Value::Object(task_config), context).await?;

    if let Err(error) =
        upsert_round_robin_state(pool, org_id, rule_id, role, &selected_user_id, next_cursor).await
    {
        warn!(?error, "round robin state upsert failed");
    }

    Ok(ExecutionOutcome::Succeeded)
}

async fn resolve_template_id(pool: &sqlx::PgPool, org_id: &str, hint: &str) -> Option<String> {
    if Uuid::parse_str(hint).is_ok() {
        return Some(hint.to_string());
    }

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert("template_key".to_string(), Value::String(hint.to_string()));

    list_rows(
        pool,
        "message_templates",
        Some(&filters),
        1,
        0,
        "created_at",
        false,
    )
    .await
    .ok()
    .and_then(|rows| rows.first().cloned())
    .map(|row| val_str(&row, "id"))
    .filter(|id| !id.is_empty())
}

fn resolve_recipient(channel: &str, config: &Value, context: &Map<String, Value>) -> String {
    let by_field = config
        .as_object()
        .and_then(|obj| obj.get("recipient_field"))
        .and_then(Value::as_str)
        .and_then(|field| context.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if let Some(value) = by_field {
        return value;
    }

    let explicit = config
        .as_object()
        .and_then(|obj| obj.get("recipient"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if let Some(value) = explicit {
        return value;
    }

    match channel {
        "email" => {
            first_context_string(context, &["recipient_email", "tenant_email", "guest_email"])
        }
        "sms" | "whatsapp" => first_context_string(
            context,
            &[
                "recipient_phone_e164",
                "tenant_phone_e164",
                "guest_phone_e164",
                "guest_phone",
                "recipient",
            ],
        ),
        _ => String::new(),
    }
}

fn first_context_string(context: &Map<String, Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = context
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

async fn get_round_robin_cursor(
    pool: &sqlx::PgPool,
    org_id: &str,
    rule_id: &str,
    role: &str,
) -> usize {
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert(
        "workflow_rule_id".to_string(),
        Value::String(rule_id.to_string()),
    );
    filters.insert("role".to_string(), Value::String(role.to_string()));

    list_rows(
        pool,
        "workflow_round_robin_state",
        Some(&filters),
        1,
        0,
        "created_at",
        false,
    )
    .await
    .ok()
    .and_then(|rows| rows.into_iter().next())
    .and_then(|row| {
        row.as_object()
            .and_then(|obj| obj.get("cursor_index"))
            .and_then(Value::as_i64)
    })
    .unwrap_or(0)
    .max(0) as usize
}

async fn upsert_round_robin_state(
    pool: &sqlx::PgPool,
    org_id: &str,
    rule_id: &str,
    role: &str,
    last_user_id: &str,
    cursor_index: usize,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO workflow_round_robin_state (
          organization_id,
          workflow_rule_id,
          role,
          last_user_id,
          cursor_index
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
        ON CONFLICT (organization_id, workflow_rule_id, role)
        DO UPDATE SET
          last_user_id = EXCLUDED.last_user_id,
          cursor_index = EXCLUDED.cursor_index,
          updated_at = now()
        "#,
    )
    .bind(org_id)
    .bind(rule_id)
    .bind(role)
    .bind(last_user_id)
    .bind(cursor_index as i64)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn next_round_robin_position(cursor: usize, size: usize) -> (usize, usize) {
    if size == 0 {
        return (0, 0);
    }
    let index = cursor % size;
    let next = (index + 1) % size;
    (index, next)
}

async fn find_org_members_by_role(
    pool: &sqlx::PgPool,
    org_id: &str,
    role: &str,
) -> Result<Vec<Value>, crate::error::AppError> {
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert("role".to_string(), Value::String(role.to_string()));

    list_rows(
        pool,
        "organization_members",
        Some(&filters),
        100,
        0,
        "created_at",
        true,
    )
    .await
}

fn parse_canonical_amount(config: &Value) -> Result<f64, String> {
    let obj = config
        .as_object()
        .ok_or_else(|| "expected action config object".to_string())?;

    if let Some(amount) = obj.get("amount").and_then(parse_numeric_value) {
        return Ok(amount);
    }

    if let Some(minor) = obj.get("amount_minor").and_then(parse_numeric_value) {
        return Ok(minor / 100.0);
    }

    if let Some(cents) = obj.get("amount_cents").and_then(parse_numeric_value) {
        return Ok(cents / 100.0);
    }

    Err("amount is missing".to_string())
}

fn parse_numeric_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(raw) => {
            let cleaned = raw.replace(',', ".").trim().to_string();
            if cleaned.is_empty() {
                return None;
            }
            cleaned.parse::<f64>().ok()
        }
        _ => None,
    }
}

/// Normalize action config to canonical keys while keeping backward compatibility
/// with legacy templates/rules.
pub fn normalize_action_config(action_type: &str, raw: &Value) -> Value {
    let mut config = raw.as_object().cloned().unwrap_or_default();

    match action_type {
        "create_task" | "assign_task_round_robin" => {
            alias_key(&mut config, "task_type", "type");
            alias_key(&mut config, "title_template", "title");
            alias_key(&mut config, "assignee_role", "assigned_role");
        }
        "send_notification" | "send_whatsapp" => {
            alias_key(&mut config, "template", "template_id");
            alias_key(&mut config, "message", "body");
            alias_key(&mut config, "recipient_phone", "recipient");
            alias_key(&mut config, "recipient_email", "recipient");
        }
        "update_status" => {
            alias_key(&mut config, "status", "target_status");
            alias_key(&mut config, "entity", "entity_type");
        }
        "create_expense" => {
            alias_key(&mut config, "value", "amount");
            if !config.contains_key("amount") {
                if let Some(amount_minor) = config
                    .get("amount_minor")
                    .and_then(parse_numeric_value)
                    .or_else(|| config.get("amount_cents").and_then(parse_numeric_value))
                {
                    config.insert("amount".to_string(), json!(amount_minor / 100.0));
                }
            }
        }
        _ => {}
    }

    Value::Object(config)
}

fn alias_key(config: &mut Map<String, Value>, old_key: &str, new_key: &str) {
    if config.contains_key(new_key) {
        return;
    }
    if let Some(value) = config.get(old_key).cloned() {
        config.insert(new_key.to_string(), value);
    }
}

pub fn generate_dedupe_key(
    org_id: &str,
    workflow_rule_id: &str,
    trigger_event: &str,
    action_type: &str,
    action_config: &Value,
    context: &Map<String, Value>,
) -> String {
    let payload = json!({
        "organization_id": org_id,
        "workflow_rule_id": workflow_rule_id,
        "trigger_event": trigger_event,
        "action_type": action_type,
        "action_config": canonicalize_json(action_config),
        "context": canonicalize_json(&Value::Object(context.clone())),
    });

    let mut hasher = Sha1::new();
    hasher.update(payload.to_string().as_bytes());
    format!("wf:{}", hex_digest(&hasher.finalize()))
}

fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted = map
                .iter()
                .map(|(key, item)| (key.clone(), canonicalize_json(item)))
                .collect::<BTreeMap<_, _>>();

            let mut obj = Map::new();
            for (key, item) in sorted {
                obj.insert(key, item);
            }
            Value::Object(obj)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        _ => value.clone(),
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

pub fn is_allowed_status_transition(entity_type: &str, current: &str, next: &str) -> bool {
    match entity_type {
        "reservation" => match current {
            "pending" => matches!(next, "confirmed" | "cancelled"),
            "confirmed" => matches!(next, "checked_in" | "cancelled" | "no_show"),
            "checked_in" => next == "checked_out",
            "checked_out" | "cancelled" | "no_show" => false,
            _ => false,
        },
        "lease" => match current {
            "draft" => matches!(next, "active" | "terminated"),
            "active" => matches!(next, "delinquent" | "terminated" | "completed"),
            "delinquent" => matches!(next, "active" | "terminated" | "completed"),
            "terminated" | "completed" => false,
            _ => false,
        },
        "task" => match current {
            "todo" => matches!(next, "in_progress" | "done" | "cancelled"),
            "in_progress" => matches!(next, "done" | "cancelled"),
            "done" | "cancelled" => false,
            _ => false,
        },
        _ => false,
    }
}

/// Simple template variable replacement: replaces {{key}} with context values.
fn resolve_template(template: &str, context: &Map<String, Value>) -> String {
    let mut result = template.to_string();
    for (key, value) in context {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => continue,
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}

fn str_from_obj<'a>(obj: &'a Map<String, Value>, key: &str) -> &'a str {
    obj.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
}

fn val_str(row: &Value, key: &str) -> String {
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

fn truncate_reason(reason: &str) -> String {
    reason.chars().take(1_000).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        generate_dedupe_key, is_allowed_status_transition, next_round_robin_position,
        normalize_action_config, queue_enabled_for_org_allowlist,
    };
    use serde_json::{json, Map, Value};

    #[test]
    fn normalizes_legacy_task_config() {
        let raw = json!({
            "task_type": "maintenance",
            "title_template": "Fix {{unit}}"
        });
        let normalized = normalize_action_config("create_task", &raw);
        assert_eq!(
            normalized.get("type").and_then(Value::as_str),
            Some("maintenance")
        );
        assert_eq!(
            normalized.get("title").and_then(Value::as_str),
            Some("Fix {{unit}}")
        );
    }

    #[test]
    fn normalizes_legacy_template_alias() {
        let raw = json!({ "template": "rent_overdue" });
        let normalized = normalize_action_config("send_notification", &raw);
        assert_eq!(
            normalized.get("template_id").and_then(Value::as_str),
            Some("rent_overdue")
        );
    }

    #[test]
    fn dedupe_key_is_stable_across_object_key_order() {
        let cfg_a = json!({"title":"A","type":"cleaning"});
        let cfg_b = json!({"type":"cleaning","title":"A"});

        let mut ctx_a = Map::new();
        ctx_a.insert("lease_id".to_string(), Value::String("l1".to_string()));
        ctx_a.insert("unit_id".to_string(), Value::String("u1".to_string()));

        let mut ctx_b = Map::new();
        ctx_b.insert("unit_id".to_string(), Value::String("u1".to_string()));
        ctx_b.insert("lease_id".to_string(), Value::String("l1".to_string()));

        let key_a = generate_dedupe_key(
            "org-1",
            "rule-1",
            "lease_created",
            "create_task",
            &cfg_a,
            &ctx_a,
        );
        let key_b = generate_dedupe_key(
            "org-1",
            "rule-1",
            "lease_created",
            "create_task",
            &cfg_b,
            &ctx_b,
        );

        assert_eq!(key_a, key_b);
    }

    #[test]
    fn round_robin_cursor_advances_cyclically() {
        assert_eq!(next_round_robin_position(0, 3), (0, 1));
        assert_eq!(next_round_robin_position(1, 3), (1, 2));
        assert_eq!(next_round_robin_position(2, 3), (2, 0));
        assert_eq!(next_round_robin_position(5, 3), (2, 0));
    }

    #[test]
    fn validates_reservation_status_transitions() {
        assert!(is_allowed_status_transition(
            "reservation",
            "pending",
            "confirmed"
        ));
        assert!(is_allowed_status_transition(
            "reservation",
            "confirmed",
            "checked_in"
        ));
        assert!(!is_allowed_status_transition(
            "reservation",
            "checked_out",
            "confirmed"
        ));
    }

    #[test]
    fn validates_task_status_transitions() {
        assert!(is_allowed_status_transition("task", "todo", "in_progress"));
        assert!(is_allowed_status_transition("task", "in_progress", "done"));
        assert!(!is_allowed_status_transition("task", "done", "todo"));
    }

    #[test]
    fn validates_lease_status_transitions() {
        assert!(is_allowed_status_transition("lease", "draft", "active"));
        assert!(is_allowed_status_transition(
            "lease",
            "delinquent",
            "active"
        ));
        assert!(!is_allowed_status_transition(
            "lease",
            "completed",
            "active"
        ));
    }

    #[test]
    fn queue_allowlist_defaults_to_all_orgs_when_empty() {
        assert!(queue_enabled_for_org_allowlist("org-1", ""));
        assert!(queue_enabled_for_org_allowlist("org-1", " , "));
    }

    #[test]
    fn queue_allowlist_matches_trimmed_org_ids() {
        assert!(queue_enabled_for_org_allowlist(
            "org-b",
            "org-a, org-b ,org-c"
        ));
        assert!(!queue_enabled_for_org_allowlist(
            "org-z",
            "org-a,org-b,org-c"
        ));
    }

    #[test]
    fn queue_allowlist_rejects_empty_target_org() {
        assert!(!queue_enabled_for_org_allowlist("", "org-a"));
        assert!(!queue_enabled_for_org_allowlist(" ", "org-a"));
    }
}
