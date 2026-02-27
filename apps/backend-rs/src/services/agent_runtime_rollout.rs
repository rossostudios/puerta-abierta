use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;

use crate::{config::AppConfig, state::AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmTransport {
    Responses,
    ChatCompletions,
}

impl LlmTransport {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Responses => "responses",
            Self::ChatCompletions => "chat_completions",
        }
    }

    pub fn storage_value(self) -> &'static str {
        match self {
            Self::Responses => "responses",
            Self::ChatCompletions => "chat_completions",
        }
    }

    pub fn opposite(self) -> Self {
        match self {
            Self::Responses => Self::ChatCompletions,
            Self::ChatCompletions => Self::Responses,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RolloutDecision {
    pub primary_transport: LlmTransport,
    pub shadow_transport: Option<LlmTransport>,
    pub forced_legacy_by_gate: bool,
    pub gate_reason: Option<String>,
}

impl RolloutDecision {
    pub fn forced(primary_transport: LlmTransport) -> Self {
        Self {
            primary_transport,
            shadow_transport: None,
            forced_legacy_by_gate: false,
            gate_reason: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LegacyChatShimDecision {
    pub allowed: bool,
    pub reason: Option<String>,
    pub recent_calls: i64,
    pub max_calls: i64,
    pub window_days: i32,
}

#[derive(Debug, Clone)]
pub struct ParitySnapshot {
    pub run_id: String,
    pub trace_id: String,
    pub transport: LlmTransport,
    pub model_used: Option<String>,
    pub tool_count: usize,
    pub fallback_used: bool,
    pub success: bool,
    pub reply: String,
}

#[derive(Debug, Clone)]
pub struct ParityComparison {
    pub status: &'static str,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RolloutMode {
    V2,
    Legacy,
    Canary,
}

impl RolloutMode {
    fn from_raw(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "legacy" => Self::Legacy,
            "canary" => Self::Canary,
            "v2" | "responses" => Self::V2,
            _ => Self::Canary,
        }
    }
}

#[derive(Debug, Clone)]
struct RolloutSettings {
    mode: RolloutMode,
    canary_percentage: u8,
    shadow_enabled: bool,
    shadow_percentage: u8,
    gate_enabled: bool,
    gate_window_minutes: i32,
    gate_min_samples: i64,
    gate_max_error_rate: f64,
    gate_max_mismatch_rate: f64,
    legacy_chat_cutoff_at: Option<DateTime<Utc>>,
    legacy_chat_window_days: i32,
    legacy_chat_max_calls: i64,
}

impl RolloutSettings {
    fn from_config(config: &AppConfig) -> Self {
        Self {
            mode: RolloutMode::from_raw(&config.ai_agent_rollout_mode),
            canary_percentage: clamp_percentage(config.ai_agent_rollout_canary_percentage as i32),
            shadow_enabled: config.ai_agent_shadow_mode_enabled,
            shadow_percentage: clamp_percentage(config.ai_agent_shadow_mode_percentage as i32),
            gate_enabled: config.ai_agent_rollout_gate_enabled,
            gate_window_minutes: config.ai_agent_rollout_gate_window_minutes.max(5),
            gate_min_samples: config.ai_agent_rollout_gate_min_samples.max(1),
            gate_max_error_rate: clamp_rate(config.ai_agent_rollout_gate_max_error_rate),
            gate_max_mismatch_rate: clamp_rate(config.ai_agent_rollout_gate_max_mismatch_rate),
            legacy_chat_cutoff_at: parse_rfc3339_utc(
                config.ai_agent_legacy_chat_cutoff_at.as_deref(),
            ),
            legacy_chat_window_days: config.ai_agent_legacy_chat_window_days.clamp(1, 90),
            legacy_chat_max_calls: config.ai_agent_legacy_chat_max_calls.max(0),
        }
    }
}

fn clamp_percentage(value: i32) -> u8 {
    value.clamp(0, 100) as u8
}

fn clamp_rate(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn parse_rfc3339_utc(value: Option<&str>) -> Option<DateTime<Utc>> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn stable_bucket(key: &str) -> u8 {
    if key.trim().is_empty() {
        return 0;
    }

    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in key.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash % 100) as u8
}

fn text_fingerprint(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.trim().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

async fn load_rollout_settings(state: &AppState, org_id: &str) -> RolloutSettings {
    let defaults = RolloutSettings::from_config(&state.config);
    let Some(pool) = state.db_pool.as_ref() else {
        return defaults;
    };

    let row = sqlx::query(
        "SELECT
            mode,
            canary_percentage,
            shadow_enabled,
            shadow_percentage,
            gate_enabled,
            gate_window_minutes,
            gate_min_samples,
            gate_max_error_rate,
            gate_max_mismatch_rate,
            legacy_chat_cutoff_at,
            legacy_chat_window_days,
            legacy_chat_max_calls
         FROM agent_runtime_rollouts
         WHERE organization_id = $1::uuid
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await;

    let Ok(Some(row)) = row else {
        if let Err(error) = row {
            tracing::warn!(
                error = %error,
                "Could not load agent runtime rollout settings; using defaults"
            );
        }
        return defaults;
    };

    let mode = row
        .try_get::<Option<String>, _>("mode")
        .ok()
        .flatten()
        .map(|raw| RolloutMode::from_raw(&raw))
        .unwrap_or(defaults.mode);

    let canary_percentage = row
        .try_get::<Option<i32>, _>("canary_percentage")
        .ok()
        .flatten()
        .map(clamp_percentage)
        .unwrap_or(defaults.canary_percentage);

    let shadow_enabled = row
        .try_get::<Option<bool>, _>("shadow_enabled")
        .ok()
        .flatten()
        .unwrap_or(defaults.shadow_enabled);

    let shadow_percentage = row
        .try_get::<Option<i32>, _>("shadow_percentage")
        .ok()
        .flatten()
        .map(clamp_percentage)
        .unwrap_or(defaults.shadow_percentage);

    let gate_enabled = row
        .try_get::<Option<bool>, _>("gate_enabled")
        .ok()
        .flatten()
        .unwrap_or(defaults.gate_enabled);

    let gate_window_minutes = row
        .try_get::<Option<i32>, _>("gate_window_minutes")
        .ok()
        .flatten()
        .unwrap_or(defaults.gate_window_minutes)
        .max(5);

    let gate_min_samples = row
        .try_get::<Option<i64>, _>("gate_min_samples")
        .ok()
        .flatten()
        .unwrap_or(defaults.gate_min_samples)
        .max(1);

    let gate_max_error_rate = row
        .try_get::<Option<f64>, _>("gate_max_error_rate")
        .ok()
        .flatten()
        .map(clamp_rate)
        .unwrap_or(defaults.gate_max_error_rate);

    let gate_max_mismatch_rate = row
        .try_get::<Option<f64>, _>("gate_max_mismatch_rate")
        .ok()
        .flatten()
        .map(clamp_rate)
        .unwrap_or(defaults.gate_max_mismatch_rate);

    let legacy_chat_cutoff_at = row
        .try_get::<Option<DateTime<Utc>>, _>("legacy_chat_cutoff_at")
        .ok()
        .flatten()
        .or(defaults.legacy_chat_cutoff_at);

    let legacy_chat_window_days = row
        .try_get::<Option<i32>, _>("legacy_chat_window_days")
        .ok()
        .flatten()
        .unwrap_or(defaults.legacy_chat_window_days)
        .clamp(1, 90);

    let legacy_chat_max_calls = row
        .try_get::<Option<i64>, _>("legacy_chat_max_calls")
        .ok()
        .flatten()
        .unwrap_or(defaults.legacy_chat_max_calls)
        .max(0);

    RolloutSettings {
        mode,
        canary_percentage,
        shadow_enabled,
        shadow_percentage,
        gate_enabled,
        gate_window_minutes,
        gate_min_samples,
        gate_max_error_rate,
        gate_max_mismatch_rate,
        legacy_chat_cutoff_at,
        legacy_chat_window_days,
        legacy_chat_max_calls,
    }
}

async fn gate_forces_legacy(
    state: &AppState,
    org_id: &str,
    settings: &RolloutSettings,
) -> Option<String> {
    let pool = state.db_pool.as_ref()?;

    let parity_row = sqlx::query(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE parity_status IN ('mismatch', 'shadow_error'))::bigint AS failed
         FROM agent_runtime_parity_runs
         WHERE organization_id = $1::uuid
           AND completed_at IS NOT NULL
           AND completed_at >= now() - make_interval(mins => $2::int)",
    )
    .bind(org_id)
    .bind(settings.gate_window_minutes)
    .fetch_optional(pool)
    .await;

    if let Ok(Some(row)) = parity_row {
        let total = row.try_get::<i64, _>("total").unwrap_or(0);
        let failed = row.try_get::<i64, _>("failed").unwrap_or(0);
        if total >= settings.gate_min_samples {
            let mismatch_rate = failed as f64 / total as f64;
            if mismatch_rate > settings.gate_max_mismatch_rate {
                return Some(format!(
                    "Rollout gate tripped: parity mismatch rate {:.2}% exceeded threshold {:.2}%",
                    mismatch_rate * 100.0,
                    settings.gate_max_mismatch_rate * 100.0,
                ));
            }
        }
    } else if let Err(error) = parity_row {
        tracing::warn!(
            error = %error,
            "Could not evaluate parity mismatch gate; continuing rollout"
        );
    }

    let error_row = sqlx::query(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE success = FALSE)::bigint AS failed
         FROM agent_traces
         WHERE organization_id = $1::uuid
           AND is_shadow_run = FALSE
           AND llm_transport = 'responses'
           AND created_at >= now() - make_interval(mins => $2::int)",
    )
    .bind(org_id)
    .bind(settings.gate_window_minutes)
    .fetch_optional(pool)
    .await;

    if let Ok(Some(row)) = error_row {
        let total = row.try_get::<i64, _>("total").unwrap_or(0);
        let failed = row.try_get::<i64, _>("failed").unwrap_or(0);
        if total >= settings.gate_min_samples {
            let error_rate = failed as f64 / total as f64;
            if error_rate > settings.gate_max_error_rate {
                return Some(format!(
                    "Rollout gate tripped: responses error rate {:.2}% exceeded threshold {:.2}%",
                    error_rate * 100.0,
                    settings.gate_max_error_rate * 100.0,
                ));
            }
        }
    } else if let Err(error) = error_row {
        tracing::warn!(
            error = %error,
            "Could not evaluate responses error-rate gate; continuing rollout"
        );
    }

    None
}

pub async fn resolve_rollout_decision(
    state: &AppState,
    org_id: &str,
    stable_key_value: &str,
) -> RolloutDecision {
    let settings = load_rollout_settings(state, org_id).await;
    let bucket = stable_bucket(stable_key_value);
    let mut primary_transport = match settings.mode {
        RolloutMode::Legacy => LlmTransport::ChatCompletions,
        RolloutMode::V2 => LlmTransport::Responses,
        RolloutMode::Canary => {
            if bucket < settings.canary_percentage {
                LlmTransport::Responses
            } else {
                LlmTransport::ChatCompletions
            }
        }
    };

    let mut gate_reason = None;
    let mut forced_legacy_by_gate = false;
    if settings.gate_enabled && primary_transport == LlmTransport::Responses {
        gate_reason = gate_forces_legacy(state, org_id, &settings).await;
        if gate_reason.is_some() {
            forced_legacy_by_gate = true;
            primary_transport = LlmTransport::ChatCompletions;
        }
    }

    let shadow_transport = if settings.shadow_enabled && bucket < settings.shadow_percentage {
        Some(primary_transport.opposite())
    } else {
        None
    };

    RolloutDecision {
        primary_transport,
        shadow_transport,
        forced_legacy_by_gate,
        gate_reason,
    }
}

pub fn compare_parity(primary: &ParitySnapshot, shadow: &ParitySnapshot) -> ParityComparison {
    let mut reasons = Vec::new();

    if primary.reply.trim().is_empty() {
        reasons.push("Primary run returned an empty reply.".to_string());
    }
    if shadow.reply.trim().is_empty() {
        reasons.push("Shadow run returned an empty reply.".to_string());
    }

    if primary.success != shadow.success {
        reasons.push(format!(
            "Run success drift: primary={} shadow={}.",
            primary.success, shadow.success
        ));
    }

    let tool_delta = primary.tool_count.abs_diff(shadow.tool_count);
    if tool_delta > 1 {
        reasons.push(format!(
            "Tool-call drift exceeded tolerance: primary={} shadow={}.",
            primary.tool_count, shadow.tool_count
        ));
    }

    if primary.fallback_used != shadow.fallback_used {
        reasons.push(format!(
            "Fallback drift: primary={} shadow={}.",
            primary.fallback_used, shadow.fallback_used
        ));
    }

    if let (Some(primary_model), Some(shadow_model)) =
        (primary.model_used.as_deref(), shadow.model_used.as_deref())
    {
        if !primary_model.trim().is_empty()
            && !shadow_model.trim().is_empty()
            && primary_model.trim() != shadow_model.trim()
        {
            reasons.push(format!(
                "Model drift: primary='{}' shadow='{}'.",
                primary_model.trim(),
                shadow_model.trim(),
            ));
        }
    }

    let status = if reasons.is_empty() {
        "match"
    } else {
        "mismatch"
    };

    ParityComparison { status, reasons }
}

pub async fn insert_parity_pending(
    state: &AppState,
    org_id: &str,
    chat_id: Option<&str>,
    user_id: Option<&str>,
    agent_slug: &str,
    primary: &ParitySnapshot,
    shadow_transport: LlmTransport,
) -> Option<String> {
    let pool = state.db_pool.as_ref()?;
    let result = sqlx::query_scalar::<_, String>(
        "INSERT INTO agent_runtime_parity_runs (
            organization_id,
            chat_id,
            user_id,
            agent_slug,
            primary_transport,
            shadow_transport,
            primary_run_id,
            primary_trace_id,
            primary_model,
            primary_tool_count,
            primary_success,
            primary_fallback_used,
            primary_reply_hash,
            parity_status,
            mismatch_reasons
         ) VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            'pending',
            '[]'::jsonb
         )
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(chat_id)
    .bind(user_id)
    .bind(agent_slug)
    .bind(primary.transport.storage_value())
    .bind(shadow_transport.storage_value())
    .bind(&primary.run_id)
    .bind(&primary.trace_id)
    .bind(primary.model_used.as_deref())
    .bind(primary.tool_count as i32)
    .bind(primary.success)
    .bind(primary.fallback_used)
    .bind(text_fingerprint(&primary.reply))
    .fetch_optional(pool)
    .await;

    match result {
        Ok(id) => id,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "Could not insert parity pending row; shadow comparison will run without persistence"
            );
            None
        }
    }
}

pub async fn complete_parity_result(
    state: &AppState,
    parity_id: Option<&str>,
    shadow: Option<&ParitySnapshot>,
    comparison: Option<&ParityComparison>,
    error_message: Option<&str>,
) {
    let Some(parity_id) = parity_id else {
        return;
    };
    let Some(pool) = state.db_pool.as_ref() else {
        return;
    };

    let status = if error_message.is_some() {
        "shadow_error"
    } else {
        comparison.map(|item| item.status).unwrap_or("skipped")
    };
    let reasons_json = comparison
        .map(|item| {
            Value::Array(
                item.reasons
                    .iter()
                    .map(|reason| Value::String(reason.clone()))
                    .collect::<Vec<_>>(),
            )
        })
        .unwrap_or_else(|| json!([]));

    let shadow_model = shadow.and_then(|snapshot| snapshot.model_used.as_deref());
    let shadow_tool_count = shadow.map(|snapshot| snapshot.tool_count as i32);
    let shadow_success = shadow.map(|snapshot| snapshot.success);
    let shadow_fallback_used = shadow.map(|snapshot| snapshot.fallback_used);
    let shadow_reply_hash = shadow.map(|snapshot| text_fingerprint(&snapshot.reply));
    let shadow_run_id = shadow.map(|snapshot| snapshot.run_id.clone());
    let shadow_trace_id = shadow.map(|snapshot| snapshot.trace_id.clone());

    let _ = sqlx::query(
        "UPDATE agent_runtime_parity_runs
         SET
            shadow_run_id = $2,
            shadow_trace_id = $3,
            shadow_model = $4,
            shadow_tool_count = $5,
            shadow_success = $6,
            shadow_fallback_used = $7,
            shadow_reply_hash = $8,
            parity_status = $9,
            mismatch_reasons = $10::jsonb,
            error_message = $11,
            completed_at = now()
         WHERE id = $1::uuid",
    )
    .bind(parity_id)
    .bind(shadow_run_id)
    .bind(shadow_trace_id)
    .bind(shadow_model)
    .bind(shadow_tool_count)
    .bind(shadow_success)
    .bind(shadow_fallback_used)
    .bind(shadow_reply_hash)
    .bind(status)
    .bind(reasons_json)
    .bind(error_message)
    .execute(pool)
    .await
    .map_err(|error| {
        tracing::warn!(error = %error, "Could not complete parity comparison row");
    });
}

pub async fn evaluate_legacy_chat_shim(state: &AppState, org_id: &str) -> LegacyChatShimDecision {
    if !state.config.ai_agent_legacy_chat_shim_enabled {
        return LegacyChatShimDecision {
            allowed: false,
            reason: Some(
                "Legacy /agent/chat shim has been disabled. Use /agent/chats/{chatId}/messages."
                    .to_string(),
            ),
            recent_calls: 0,
            max_calls: 0,
            window_days: state.config.ai_agent_legacy_chat_window_days.clamp(1, 90),
        };
    }

    let settings = load_rollout_settings(state, org_id).await;
    let now = Utc::now();

    let Some(cutoff_at) = settings.legacy_chat_cutoff_at else {
        return LegacyChatShimDecision {
            allowed: true,
            reason: None,
            recent_calls: 0,
            max_calls: settings.legacy_chat_max_calls,
            window_days: settings.legacy_chat_window_days,
        };
    };

    if now < cutoff_at {
        return LegacyChatShimDecision {
            allowed: true,
            reason: None,
            recent_calls: 0,
            max_calls: settings.legacy_chat_max_calls,
            window_days: settings.legacy_chat_window_days,
        };
    }

    let Some(pool) = state.db_pool.as_ref() else {
        return LegacyChatShimDecision {
            allowed: true,
            reason: Some(
                "Legacy shim cutoff has passed, but telemetry is unavailable (no DB connection)."
                    .to_string(),
            ),
            recent_calls: 0,
            max_calls: settings.legacy_chat_max_calls,
            window_days: settings.legacy_chat_window_days,
        };
    };

    let recent_calls = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM audit_logs
         WHERE organization_id = $1::uuid
           AND action = 'agent.chat.legacy_shim'
           AND created_at >= now() - make_interval(days => $2::int)",
    )
    .bind(org_id)
    .bind(settings.legacy_chat_window_days)
    .fetch_optional(pool)
    .await;

    let recent_calls = match recent_calls {
        Ok(Some(value)) => value,
        Ok(None) => 0,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "Could not query legacy shim telemetry; allowing request for safety"
            );
            return LegacyChatShimDecision {
                allowed: true,
                reason: Some(
                    "Legacy shim cutoff has passed, but telemetry query failed. Request allowed."
                        .to_string(),
                ),
                recent_calls: 0,
                max_calls: settings.legacy_chat_max_calls,
                window_days: settings.legacy_chat_window_days,
            };
        }
    };

    if recent_calls <= settings.legacy_chat_max_calls {
        return LegacyChatShimDecision {
            allowed: false,
            reason: Some(format!(
                "Legacy /agent/chat sunset enforced. Last {} day(s): {} call(s), threshold {}.",
                settings.legacy_chat_window_days, recent_calls, settings.legacy_chat_max_calls,
            )),
            recent_calls,
            max_calls: settings.legacy_chat_max_calls,
            window_days: settings.legacy_chat_window_days,
        };
    }

    LegacyChatShimDecision {
        allowed: true,
        reason: Some(format!(
            "Legacy /agent/chat cutoff passed, but usage is still above threshold ({} > {}).",
            recent_calls, settings.legacy_chat_max_calls,
        )),
        recent_calls,
        max_calls: settings.legacy_chat_max_calls,
        window_days: settings.legacy_chat_window_days,
    }
}

#[cfg(test)]
mod tests {
    use super::{compare_parity, LlmTransport, ParitySnapshot};

    #[test]
    fn compare_parity_returns_match_for_close_runs() {
        let primary = ParitySnapshot {
            run_id: "run-primary".to_string(),
            trace_id: "trace-primary".to_string(),
            transport: LlmTransport::Responses,
            model_used: Some("gpt-5.2".to_string()),
            tool_count: 2,
            fallback_used: false,
            success: true,
            reply: "Done.".to_string(),
        };
        let shadow = ParitySnapshot {
            run_id: "run-shadow".to_string(),
            trace_id: "trace-shadow".to_string(),
            transport: LlmTransport::ChatCompletions,
            model_used: Some("gpt-5.2".to_string()),
            tool_count: 3,
            fallback_used: false,
            success: true,
            reply: "Done.".to_string(),
        };

        let comparison = compare_parity(&primary, &shadow);
        assert_eq!(comparison.status, "match");
        assert!(comparison.reasons.is_empty());
    }

    #[test]
    fn compare_parity_flags_mismatch_on_large_drift() {
        let primary = ParitySnapshot {
            run_id: "run-primary".to_string(),
            trace_id: "trace-primary".to_string(),
            transport: LlmTransport::Responses,
            model_used: Some("gpt-5.2".to_string()),
            tool_count: 1,
            fallback_used: false,
            success: true,
            reply: "Completed action".to_string(),
        };
        let shadow = ParitySnapshot {
            run_id: "run-shadow".to_string(),
            trace_id: "trace-shadow".to_string(),
            transport: LlmTransport::ChatCompletions,
            model_used: Some("gpt-4o-mini".to_string()),
            tool_count: 5,
            fallback_used: true,
            success: false,
            reply: "".to_string(),
        };

        let comparison = compare_parity(&primary, &shadow);
        assert_eq!(comparison.status, "mismatch");
        assert!(!comparison.reasons.is_empty());
    }
}
