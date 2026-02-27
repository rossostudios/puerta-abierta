use std::time::Duration;

use chrono::{Datelike, Timelike, Utc};
use tokio::time::sleep;

use crate::state::AppState;

/// Spawn the background scheduler that runs periodic jobs.
///
/// Each job runs in its own `tokio::spawn` so a failure in one job
/// never crashes the scheduler loop or other jobs.
pub async fn run_background_scheduler(state: AppState) {
    tracing::info!("Background scheduler started");

    let pool = match state.db_pool.as_ref() {
        Some(p) => p.clone(),
        None => {
            tracing::warn!("Scheduler: no database pool configured, exiting");
            return;
        }
    };

    let workflow_interval =
        Duration::from_secs(state.config.workflow_poll_interval_seconds.max(30));
    let ical_interval = Duration::from_secs(state.config.ical_sync_interval_minutes.max(5) * 60);
    let message_interval = Duration::from_secs(state.config.message_poll_interval_seconds.max(30));

    let mut last_workflow_run = tokio::time::Instant::now();
    let mut last_ical_run = tokio::time::Instant::now();
    let mut last_message_run = tokio::time::Instant::now();
    let mut last_rate_limit_cleanup = tokio::time::Instant::now();
    let mut last_daily_run: Option<u32> = None;

    loop {
        sleep(Duration::from_secs(15)).await;

        let now_instant = tokio::time::Instant::now();
        let now_utc = Utc::now();
        let today = now_utc.date_naive();

        // --- Workflow job processing (every N seconds) ---
        if now_instant.duration_since(last_workflow_run) >= workflow_interval {
            last_workflow_run = now_instant;
            let pool = pool.clone();
            tokio::spawn(async move {
                let summary = crate::services::workflows::process_workflow_jobs(&pool, 100).await;
                if summary.picked > 0 {
                    tracing::info!(
                        picked = summary.picked,
                        succeeded = summary.succeeded,
                        failed = summary.failed,
                        "Scheduler: processed workflow jobs"
                    );
                }
            });
        }

        // --- iCal sync (every N minutes) ---
        if now_instant.duration_since(last_ical_run) >= ical_interval {
            last_ical_run = now_instant;
            let pool = pool.clone();
            let client = state.http_client.clone();
            tokio::spawn(async move {
                let result =
                    crate::services::ical::sync_all_ical_integrations(&pool, &client).await;
                let synced = result.get("synced").and_then(|v| v.as_u64()).unwrap_or(0);
                if synced > 0 {
                    tracing::info!(synced, "Scheduler: iCal sync completed");
                }
            });
        }

        // --- S19: Message processing poll (every N seconds) ---
        if now_instant.duration_since(last_message_run) >= message_interval {
            last_message_run = now_instant;
            let pool = pool.clone();
            let client = state.http_client.clone();
            let config = state.config.clone();
            tokio::spawn(async move {
                let (sent, failed) =
                    crate::services::messaging::process_queued_messages(&pool, &client, &config)
                        .await;
                if sent > 0 || failed > 0 {
                    tracing::info!(sent, failed, "Scheduler: processed queued messages");
                }
            });
        }

        // --- S17: Hourly rate limit table cleanup ---
        if now_instant.duration_since(last_rate_limit_cleanup) >= Duration::from_secs(3600) {
            last_rate_limit_cleanup = now_instant;
            let pool = pool.clone();
            tokio::spawn(async move {
                let current_hour = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64
                    / 3600;
                let cutoff = current_hour - 24;
                let result = sqlx::query("DELETE FROM agent_rate_limits WHERE hour_bucket < $1")
                    .bind(cutoff)
                    .execute(&pool)
                    .await;
                if let Ok(r) = result {
                    if r.rows_affected() > 0 {
                        tracing::info!(
                            deleted = r.rows_affected(),
                            "Scheduler: cleaned up old rate limit entries"
                        );
                    }
                }
            });
        }

        // --- Daily jobs (run once per calendar day) ---
        let today_ordinal = today.ordinal();
        if last_daily_run == Some(today_ordinal) {
            continue;
        }

        // Run daily jobs at or after 05:00 UTC
        if now_utc.hour() < 5 {
            continue;
        }

        last_daily_run = Some(today_ordinal);
        tracing::info!("Scheduler: running daily jobs for {today}");

        // 05:00 — SLA breach scan
        {
            let pool = pool.clone();
            let engine_mode = state.config.workflow_engine_mode;
            tokio::spawn(async move {
                run_sla_breach_scan(&pool, engine_mode).await;
            });
        }

        // 06:00 — Daily pricing recommendations per active org
        {
            let st = state.clone();
            tokio::spawn(async move {
                crate::services::dynamic_pricing::run_daily_pricing_recommendations(&st).await;
            });
        }

        // 06:00 — Anomaly scan per active org
        {
            let st = state.clone();
            tokio::spawn(async move {
                run_anomaly_scan_all_orgs(&st).await;
            });
        }

        // 07:00 — Lease renewal scan
        {
            let pool = pool.clone();
            let app_url = state.config.app_public_url.clone();
            let engine_mode = state.config.workflow_engine_mode;
            tokio::spawn(async move {
                let result = crate::services::lease_renewal::run_lease_renewal_scan(
                    &pool,
                    None,
                    &app_url,
                    engine_mode,
                )
                .await;
                tracing::info!(
                    offers_60d = result.offers_sent_60d,
                    reminders_30d = result.reminders_sent_30d,
                    "Scheduler: lease renewal scan completed"
                );
            });
        }

        // 08:00 — Daily collection cycle
        {
            let pool = pool.clone();
            let app_url = state.config.app_public_url.clone();
            tokio::spawn(async move {
                let result = crate::services::collection_cycle::run_daily_collection_cycle(
                    &pool, None, &app_url,
                )
                .await;
                tracing::info!(
                    activated = result.activated,
                    reminders = result.reminders_queued,
                    "Scheduler: daily collection cycle completed"
                );
            });
        }

        // 08:15 — Daily bank transaction reconciliation
        {
            let st = state.clone();
            tokio::spawn(async move {
                crate::services::reconciliation::run_daily_reconciliation(&st).await;
            });
        }

        // 08:30 — Daily lease deadline alert scan
        {
            let st = state.clone();
            tokio::spawn(async move {
                crate::services::lease_abstraction::run_daily_deadline_scan(&st).await;
            });
        }

        // 08:45 — Auto-generate owner statements (1st of month only)
        if today.day() == 1 {
            let pool = pool.clone();
            let engine_mode = state.config.workflow_engine_mode;
            tokio::spawn(async move {
                let org_ids: Vec<(String,)> = sqlx::query_as(
                    "SELECT id::text FROM organizations WHERE is_active = true LIMIT 100",
                )
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

                let mut total = 0u32;
                for (org_id,) in &org_ids {
                    total += crate::routes::owner_statements::auto_generate_monthly_statements(
                        &pool,
                        org_id,
                        engine_mode,
                    )
                    .await;
                }
                if total > 0 {
                    tracing::info!(total, "Scheduler: owner statements auto-generated");
                }
            });
        }

        // 09:00 — Stalled application scan (>48h without response)
        {
            let pool = pool.clone();
            let engine_mode = state.config.workflow_engine_mode;
            tokio::spawn(async move {
                run_stalled_application_scan(&pool, engine_mode).await;
            });
        }

        // 09:30 — Run scheduled agent playbooks
        {
            let st = state.clone();
            tokio::spawn(async move {
                run_scheduled_agent_playbooks(&st).await;
            });
        }

        // 10:00 — Nightly portfolio snapshot capture
        {
            let pool = pool.clone();
            tokio::spawn(async move {
                run_portfolio_snapshots(&pool).await;
            });
        }

        // 10:30 — Maintenance SLA monitoring
        {
            let pool = pool.clone();
            tokio::spawn(async move {
                run_maintenance_sla_scan(&pool).await;
            });
        }

        // 06:30 — S23: Daily outbound OTA rate/availability sync
        {
            let st = state.clone();
            tokio::spawn(async move {
                crate::services::airbnb::sync_all_outbound_rates(&st).await;
            });
        }

        // 11:00 — Weekly demand forecast (Sundays only)
        if today.weekday() == chrono::Weekday::Sun {
            let st = state.clone();
            tokio::spawn(async move {
                run_weekly_demand_forecast(&st).await;
            });

            // S23: Weekly ML feature computation (Sundays)
            let st2 = state.clone();
            tokio::spawn(async move {
                crate::services::ml_pipeline::compute_all_features(&st2).await;
            });
        }

        // 11:30 — Daily agent health metrics collection
        {
            let st = state.clone();
            tokio::spawn(async move {
                crate::services::ai_agent::collect_daily_agent_health(&st).await;
            });
        }

        // 12:00 — Expired memory cleanup
        {
            let pool = pool.clone();
            tokio::spawn(async move {
                run_memory_cleanup(&pool).await;
            });
        }

        // 12:30 — Execute due agent schedules (cron-based playbooks)
        {
            let st = state.clone();
            tokio::spawn(async move {
                run_cron_agent_playbooks(&st).await;
            });
        }
    }
}

/// Delete expired agent memories.
async fn run_memory_cleanup(pool: &sqlx::PgPool) {
    let result =
        sqlx::query("DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at < now()")
            .execute(pool)
            .await;

    match result {
        Ok(r) => {
            if r.rows_affected() > 0 {
                tracing::info!(
                    deleted = r.rows_affected(),
                    "Scheduler: expired agent memories cleaned up"
                );
            }
        }
        Err(e) => tracing::warn!(error = %e, "Scheduler: memory cleanup failed"),
    }
}

/// Execute agent playbooks that have cron-based trigger_type and matching schedule.
async fn run_cron_agent_playbooks(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    // Fetch playbooks with trigger_type='schedule' that haven't run today
    let rows = sqlx::query_as::<_, (String, String, String, serde_json::Value)>(
        "SELECT id::text, organization_id::text, name, steps
         FROM agent_playbooks
         WHERE trigger_type = 'schedule'
           AND is_active = true
           AND (last_run_at IS NULL OR last_run_at::date < CURRENT_DATE)
         LIMIT 20",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut ran = 0u32;
    for (playbook_id, org_id, name, _steps) in &rows {
        // Execute via supervisor agent
        let params = crate::services::ai_agent::RunAiAgentChatParams {
            org_id,
            role: "operator",
            message: &format!("Execute playbook: {name}"),
            conversation: &[],
            allow_mutations: true,
            confirm_write: true,
            agent_name: "Operations Copilot",
            agent_prompt: None,
            allowed_tools: None,
            agent_slug: Some("supervisor"),
            chat_id: None,
            requested_by_user_id: None,
            preferred_model: None,
            max_steps_override: None,
            runtime_context: None,
        };

        match crate::services::ai_agent::run_ai_agent_chat(state, params).await {
            Ok(_) => ran += 1,
            Err(e) => {
                tracing::warn!(playbook = %name, error = %e, "Cron playbook failed");
            }
        }

        // Update last_run_at
        let _ = sqlx::query("UPDATE agent_playbooks SET last_run_at = now() WHERE id = $1::uuid")
            .bind(playbook_id)
            .execute(pool)
            .await;
    }

    if ran > 0 {
        tracing::info!(ran, "Scheduler: cron agent playbooks completed");
    }
}

/// Generate demand forecasts for all active organizations.
async fn run_weekly_demand_forecast(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    let org_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true LIMIT 100")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let mut generated = 0u32;
    for (org_id,) in &org_ids {
        let args = serde_json::Map::new();
        match crate::services::tenant_screening::tool_forecast_demand(state, org_id, &args).await {
            Ok(result) => {
                if result
                    .get("ok")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
                {
                    generated += 1;
                }
            }
            Err(e) => {
                tracing::warn!(org_id, error = %e, "Scheduler: demand forecast failed");
            }
        }
    }

    if generated > 0 {
        tracing::info!(
            orgs = generated,
            "Scheduler: weekly demand forecasts completed"
        );
    }
}

/// Scan for tasks whose SLA has been breached but not yet flagged.
async fn run_sla_breach_scan(pool: &sqlx::PgPool, engine_mode: crate::config::WorkflowEngineMode) {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id::text, organization_id::text, title
         FROM tasks
         WHERE status NOT IN ('done', 'cancelled')
           AND sla_due_at IS NOT NULL
           AND sla_breached_at IS NULL
           AND sla_due_at <= now()
         LIMIT 500",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let count = rows.len();
    for (task_id, org_id, _title) in rows {
        let mut patch = serde_json::Map::new();
        patch.insert(
            "sla_breached_at".to_string(),
            serde_json::Value::String(Utc::now().to_rfc3339()),
        );

        if let Ok(updated) =
            crate::repository::table_service::update_row(pool, "tasks", &task_id, &patch, "id")
                .await
        {
            let mut ctx = serde_json::Map::new();
            ctx.insert(
                "task_id".to_string(),
                serde_json::Value::String(task_id.clone()),
            );
            if let Some(obj) = updated.as_object() {
                for key in [
                    "property_id",
                    "unit_id",
                    "assigned_user_id",
                    "priority",
                    "title",
                ] {
                    if let Some(v) = obj.get(key) {
                        if !v.is_null() {
                            ctx.insert(key.to_string(), v.clone());
                        }
                    }
                }
            }
            crate::services::workflows::fire_trigger(
                pool,
                &org_id,
                "task_overdue_24h",
                &ctx,
                engine_mode,
            )
            .await;
        }
    }

    if count > 0 {
        tracing::info!(count, "Scheduler: SLA breach scan completed");
    }
}

/// Run anomaly scan for all active organizations.
async fn run_anomaly_scan_all_orgs(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    let org_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true LIMIT 100")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let mut scanned = 0u32;
    for (org_id,) in &org_ids {
        match crate::services::anomaly_detection::run_anomaly_scan(state, org_id).await {
            Ok(anomalies) => {
                if !anomalies.is_empty() {
                    tracing::info!(
                        org_id,
                        count = anomalies.len(),
                        "Scheduler: anomalies detected"
                    );
                }
                scanned += 1;
            }
            Err(e) => {
                tracing::warn!(org_id, error = %e, "Scheduler: anomaly scan failed");
            }
        }
    }

    if scanned > 0 {
        tracing::info!(orgs = scanned, "Scheduler: anomaly scans completed");
    }
}

/// Run scheduled agent playbooks from the agent_schedules table.
async fn run_scheduled_agent_playbooks(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    // Fetch due schedules
    let rows = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT id::text, org_id::text, agent_slug, playbook_name, message
         FROM agent_schedules
         WHERE is_active = true
           AND (next_run_at IS NULL OR next_run_at <= now())
         LIMIT 50",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut ran = 0_u32;
    for (schedule_id, org_id, agent_slug, _playbook_name, message) in &rows {
        let agent: Option<(String,)> = sqlx::query_as(
            "SELECT name FROM ai_agents WHERE slug = $1 AND is_active = true LIMIT 1",
        )
        .bind(agent_slug)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let Some((agent_name,)) = agent else {
            tracing::warn!(agent_slug, "Scheduled agent not found or inactive");
            continue;
        };

        let target_tools = crate::services::agent_specs::allowed_tools_for_slug(agent_slug);
        let target_prompt =
            crate::services::agent_specs::get_agent_spec(agent_slug).map(|spec| spec.system_prompt);

        let params = crate::services::ai_agent::RunAiAgentChatParams {
            org_id,
            role: "operator",
            message,
            conversation: &[],
            allow_mutations: true,
            confirm_write: true,
            agent_name: &agent_name,
            agent_prompt: target_prompt,
            allowed_tools: target_tools.as_deref(),
            agent_slug: Some(agent_slug),
            chat_id: None,
            requested_by_user_id: None,
            preferred_model: None,
            max_steps_override: None,
            runtime_context: None,
        };

        match crate::services::ai_agent::run_ai_agent_chat(state, params).await {
            Ok(_) => ran += 1,
            Err(e) => {
                tracing::warn!(agent_slug, error = %e, "Scheduled playbook failed");
            }
        }

        // Update last_run_at and compute next_run_at
        sqlx::query(
            "UPDATE agent_schedules SET last_run_at = now(),
             next_run_at = now() + interval '24 hours'
             WHERE id = $1::uuid",
        )
        .bind(schedule_id)
        .execute(pool)
        .await
        .ok();
    }

    if ran > 0 {
        tracing::info!(ran, "Scheduler: agent playbooks completed");
    }
}

/// Capture nightly portfolio snapshots for all active organizations.
async fn run_portfolio_snapshots(pool: &sqlx::PgPool) {
    let org_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true LIMIT 100")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    for (org_id,) in &org_ids {
        crate::services::portfolio::capture_portfolio_snapshot(pool, org_id).await;
    }

    if !org_ids.is_empty() {
        tracing::info!(
            orgs = org_ids.len(),
            "Scheduler: portfolio snapshots captured"
        );
    }
}

/// Scan for maintenance requests with breached SLAs.
async fn run_maintenance_sla_scan(pool: &sqlx::PgPool) {
    let breached = sqlx::query(
        "UPDATE maintenance_requests
         SET sla_breached = true, updated_at = now()
         WHERE status NOT IN ('completed', 'closed')
           AND sla_breached = false
           AND (
               (sla_response_deadline IS NOT NULL AND sla_response_deadline < now())
               OR (sla_resolution_deadline IS NOT NULL AND sla_resolution_deadline < now())
           )
         RETURNING id::text, organization_id::text",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if !breached.is_empty() {
        tracing::info!(
            count = breached.len(),
            "Scheduler: maintenance SLA breaches flagged"
        );
    }
}

/// Scan for applications stalled >48h and fire workflow trigger.
async fn run_stalled_application_scan(
    pool: &sqlx::PgPool,
    engine_mode: crate::config::WorkflowEngineMode,
) {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT id::text, organization_id::text
         FROM application_submissions
         WHERE status IN ('new', 'submitted')
           AND created_at < now() - interval '48 hours'
           AND first_response_at IS NULL
         LIMIT 500",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let count = rows.len();
    for (app_id, org_id) in rows {
        let mut ctx = serde_json::Map::new();
        ctx.insert(
            "application_id".to_string(),
            serde_json::Value::String(app_id),
        );
        crate::services::workflows::fire_trigger(
            pool,
            &org_id,
            "application_stalled_48h",
            &ctx,
            engine_mode,
        )
        .await;
    }

    if count > 0 {
        tracing::info!(count, "Scheduler: stalled application scan completed");
    }
}
