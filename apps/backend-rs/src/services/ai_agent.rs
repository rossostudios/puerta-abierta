use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::create_row,
    services::{
        agent_runtime_rollout::{
            compare_parity, complete_parity_result, insert_parity_pending,
            resolve_rollout_decision, LlmTransport, ParitySnapshot,
        },
        agent_specs::get_agent_spec,
        tool_validator::{normalize_tool_result, normalized_tool_error, validate_tool_args},
    },
    state::AppState,
};

// S17: In-memory rate limiter removed — replaced by DB-backed `agent_rate_limits` table.
// See `check_rate_limit()` for the PostgreSQL atomic increment approach.

/// SSE event types sent during streaming agent execution.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AgentStreamEvent {
    #[serde(rename = "status")]
    Status { message: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        name: String,
        args: Map<String, Value>,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        name: String,
        preview: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_explanation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        suggested_actions: Option<Vec<SuggestedAction>>,
    },
    #[serde(rename = "token")]
    Token { text: String },
    #[serde(rename = "done")]
    Done {
        content: String,
        tool_trace: Vec<Value>,
        model_used: Option<String>,
        fallback_used: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        structured_content: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        explanation: Option<ExplanationPayload>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct SuggestedAction {
    pub label: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExplanationPayload {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_steps: Option<Vec<ReasoningStep>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReasoningStep {
    pub input: String,
    pub rule: String,
    pub outcome: String,
}

const MUTATION_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];
pub const TOOL_REGISTRY_VERSION: &str = "2026-03-v1";
const MUTATION_TOOLS: &[&str] = &[
    "create_row",
    "update_row",
    "delete_row",
    "send_message",
    "create_maintenance_task",
    "auto_assign_maintenance",
    "escalate_maintenance",
    "dispatch_to_vendor",
    "verify_completion",
    "request_vendor_quote",
    "select_vendor",
    "apply_pricing_recommendation",
    "score_application",
    "classify_and_delegate",
    "auto_populate_lease_charges",
    "create_defect_tickets",
    "import_bank_transactions",
    "auto_reconcile_batch",
    "handle_split_payment",
    "voice_create_maintenance_request",
    "generate_access_code",
    "send_access_code",
    "revoke_access_code",
    "process_sensor_event",
    "execute_playbook",
];
const AI_AGENT_DISABLED_MESSAGE: &str =
    "AI agent is disabled. Set AI_AGENT_ENABLED=true and OPENAI_API_KEY in backend environment.";

/// S17: Check DB-backed rate limit. Returns Ok(()) if allowed, Err(Value) with error JSON if exceeded.
async fn check_rate_limit(
    pool: &sqlx::PgPool,
    org_id: &str,
    agent_slug: &str,
) -> Result<(), Value> {
    let hour_bucket = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        / 3600;

    // Configurable limit per org/agent (fall back to org-wide '*' then default 100)
    let max_calls: i64 = sqlx::query_scalar(
        "SELECT max_calls_per_hour::bigint FROM agent_rate_limit_config
         WHERE organization_id = $1::uuid AND agent_slug IN ($2, '*')
         ORDER BY CASE WHEN agent_slug = $2 THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(org_id)
    .bind(agent_slug)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(100);

    // Atomic upsert + return current count
    let current: i64 = sqlx::query_scalar(
        "INSERT INTO agent_rate_limits (organization_id, agent_slug, hour_bucket, call_count)
         VALUES ($1::uuid, $2, $3, 1)
         ON CONFLICT (organization_id, agent_slug, hour_bucket)
         DO UPDATE SET call_count = agent_rate_limits.call_count + 1
         RETURNING call_count::bigint",
    )
    .bind(org_id)
    .bind(agent_slug)
    .bind(hour_bucket)
    .fetch_one(pool)
    .await
    .unwrap_or(1);

    if current > max_calls {
        return Err(json!({
            "ok": false,
            "error": format!("Rate limit exceeded for agent '{}' — max {} tool calls/hour.", agent_slug, max_calls),
            "guardrail": "rate_limit",
        }));
    }
    Ok(())
}

/// S18: Fetch a guardrail config value from DB with typed fallback.
pub async fn get_guardrail_value_f64(
    pool: &sqlx::PgPool,
    org_id: &str,
    key: &str,
    default: f64,
) -> f64 {
    let result: Option<Value> = sqlx::query_scalar(
        "SELECT value_json FROM agent_guardrail_config
         WHERE organization_id = $1::uuid AND guardrail_key = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    match result {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(default),
        Some(Value::String(s)) => s.parse().unwrap_or(default),
        _ => default,
    }
}

/// S18: Fetch a guardrail config value as JSON with fallback.
pub async fn get_guardrail_value_json(
    pool: &sqlx::PgPool,
    org_id: &str,
    key: &str,
    default: Value,
) -> Value {
    sqlx::query_scalar(
        "SELECT value_json FROM agent_guardrail_config
         WHERE organization_id = $1::uuid AND guardrail_key = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(default)
}

#[derive(Debug, Clone, Copy)]
struct TableConfig {
    org_column: &'static str,
    can_create: bool,
    can_update: bool,
    can_delete: bool,
}

#[derive(Debug, Clone)]
pub struct AgentConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeExecutionContext<'a> {
    pub run_id: Option<&'a str>,
    pub trace_id: Option<&'a str>,
    pub llm_transport: Option<LlmTransport>,
    pub is_shadow_run: bool,
    pub shadow_of_run_id: Option<&'a str>,
    pub disable_shadow: bool,
}

pub struct RunAiAgentChatParams<'a> {
    pub org_id: &'a str,
    pub role: &'a str,
    pub message: &'a str,
    pub conversation: &'a [AgentConversationMessage],
    pub allow_mutations: bool,
    pub confirm_write: bool,
    pub agent_name: &'a str,
    pub agent_prompt: Option<&'a str>,
    pub allowed_tools: Option<&'a [String]>,
    pub agent_slug: Option<&'a str>,
    pub chat_id: Option<&'a str>,
    pub requested_by_user_id: Option<&'a str>,
    pub preferred_model: Option<&'a str>,
    pub max_steps_override: Option<i32>,
    pub runtime_context: Option<RuntimeExecutionContext<'a>>,
}

pub fn list_supported_tables() -> Vec<String> {
    let mut tables = vec![
        "agent_approval_policies",
        "agent_approvals",
        "agent_execution_plans",
        "agent_memory",
        "agent_schedules",
        "anomaly_alerts",
        "application_events",
        "application_submissions",
        "audit_logs",
        "calendar_blocks",
        "collection_records",
        "escalation_thresholds",
        "escrow_events",
        "expenses",
        "guests",
        "inspection_reports",
        "integration_events",
        "knowledge_chunks",
        "knowledge_documents",
        "lease_abstractions",
        "lease_charges",
        "leases",
        "leasing_conversations",
        "integrations",
        "listings",
        "maintenance_requests",
        "market_data_snapshots",
        "maintenance_sla_config",
        "message_logs",
        "message_templates",
        "organization_invites",
        "organizations",
        "owner_statements",
        "portfolio_snapshots",
        "pricing_recommendations",
        "pricing_rule_sets",
        "pricing_templates",
        "properties",
        "property_matching_scores",
        "reservations",
        "tasks",
        "tour_schedules",
        "units",
        "vendor_roster",
        "vendor_work_orders",
        "condition_baselines",
        "bank_transactions",
        "reconciliation_runs",
        "reconciliation_rules",
        "voice_interactions",
        "voice_agent_config",
        "compliance_rules",
        "deadline_alerts",
        "portfolio_benchmarks",
        "performance_digests",
        "iot_devices",
        "iot_events",
        "access_codes",
        "ml_predictions",
        "demand_forecasts",
        "agent_playbooks",
        "agent_health_metrics",
        "pii_intercept_log",
        "agent_boundary_rules",
        "agent_rate_limit_config",
        "agent_rate_limits",
        "agent_guardrail_config",
        "ml_models",
        "ml_features",
        "ml_outcomes",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect::<Vec<_>>();

    tables.sort();
    tables
}

pub fn agent_capabilities(role: &str, allow_mutations: bool) -> Map<String, Value> {
    let role_value = normalize_role(role);
    let mut payload = Map::new();
    payload.insert(
        "tables".to_string(),
        Value::Array(
            list_supported_tables()
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    payload.insert("role".to_string(), Value::String(role_value.clone()));
    payload.insert(
        "mutations_enabled".to_string(),
        Value::Bool(mutations_allowed(&role_value, allow_mutations, false)),
    );
    payload
}

pub async fn run_ai_agent_chat(
    state: &AppState,
    params: RunAiAgentChatParams<'_>,
) -> AppResult<Map<String, Value>> {
    if !state.config.ai_agent_enabled {
        return Err(AppError::ServiceUnavailable(
            AI_AGENT_DISABLED_MESSAGE.to_string(),
        ));
    }

    let runtime_context = params.runtime_context.unwrap_or_default();
    let run_id = runtime_context
        .run_id
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let trace_id = runtime_context
        .trace_id
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let rollout_stable_key = build_rollout_stable_key(
        params.org_id,
        params.chat_id,
        params.requested_by_user_id,
        params.agent_slug,
        params.message,
    );
    let rollout_decision = if let Some(transport) = runtime_context.llm_transport {
        crate::services::agent_runtime_rollout::RolloutDecision::forced(transport)
    } else {
        resolve_rollout_decision(state, params.org_id, &rollout_stable_key).await
    };
    if rollout_decision.forced_legacy_by_gate {
        tracing::warn!(
            org_id = params.org_id,
            run_id = run_id,
            trace_id = trace_id,
            gate_reason = rollout_decision.gate_reason.as_deref().unwrap_or("unknown"),
            "Agent rollout gate forced legacy transport"
        );
    }
    let llm_transport = rollout_decision.primary_transport;

    let canonical_spec = params.agent_slug.and_then(get_agent_spec);
    let canonical_allowed_tools: Option<Vec<String>> = canonical_spec
        .and_then(|spec| spec.allowed_tools)
        .map(|tools| tools.iter().map(|value| (*value).to_string()).collect());
    let effective_allowed_tools = canonical_allowed_tools.as_deref().or(params.allowed_tools);

    let role_value = normalize_role(params.role);
    let base_prompt = params
        .agent_prompt
        .or_else(|| {
            params
                .agent_slug
                .and_then(get_agent_spec)
                .map(|spec| spec.system_prompt)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "You are {} for Casaora, a property-management platform in Paraguay.",
                params.agent_name
            )
        });

    let system_prompt = format!(
        "{base_prompt} Use tools for all data-backed answers. Keep replies concise and action-oriented. Current org_id is {}. Current user role is {}. Never access data outside this organization. When a user asks to create/update/delete data, call the matching tool. If a write tool returns an error, explain why and propose a safe next action.",
        params.org_id,
        role_value,
    );

    let mut messages = vec![json!({"role": "system", "content": system_prompt})];
    let context_start = params.conversation.len().saturating_sub(24);
    for item in &params.conversation[context_start..] {
        let role_name = item.role.trim().to_ascii_lowercase();
        let content = item.content.trim();
        if matches!(role_name.as_str(), "user" | "assistant") && !content.is_empty() {
            messages.push(json!({
                "role": role_name,
                "content": truncate_chars(content, 4000),
            }));
        }
    }
    messages.push(json!({
        "role": "user",
        "content": truncate_chars(params.message.trim(), 4000),
    }));

    let mut tool_trace: Vec<Value> = Vec::new();
    let mut fallback_used = false;
    let mut model_used = String::new();
    let planning_mode = false;
    let mut token_usage = RunTokenUsage::default();
    let _run_start = std::time::Instant::now();
    let tool_definitions = tool_definitions(effective_allowed_tools);

    let configured_max_steps = std::cmp::max(1, state.config.ai_agent_max_tool_steps);
    let requested_max_steps = params
        .max_steps_override
        .unwrap_or(configured_max_steps as i32)
        .max(1) as usize;
    let effective_max = if planning_mode {
        requested_max_steps.max(12)
    } else {
        requested_max_steps
    };
    for _ in 0..effective_max {
        let chat_resp = call_openai_chat_completion_tracked(
            state,
            &messages,
            Some(&tool_definitions),
            llm_transport,
            params.preferred_model,
        )
        .await?;
        model_used = chat_resp.model_used.clone();
        fallback_used = fallback_used || chat_resp.fallback_used;
        token_usage.accumulate(&chat_resp);
        let completion = chat_resp.body;

        let assistant_message = completion
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(Value::as_object)
            .and_then(|choice| choice.get("message"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        let assistant_text = extract_content_text(assistant_message.get("content"));
        let tool_calls = assistant_message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if !tool_calls.is_empty() {
            messages.push(json!({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": tool_calls.clone(),
            }));

            for call in tool_calls {
                let call_id = call
                    .as_object()
                    .and_then(|obj| obj.get("id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool-call")
                    .to_string();

                let function_payload = call
                    .as_object()
                    .and_then(|obj| obj.get("function"))
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();

                let tool_name = function_payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();

                let raw_arguments = function_payload.get("arguments").cloned();
                let mut arguments = Map::new();

                let tool_result = match parse_tool_arguments(raw_arguments) {
                    Ok(parsed) => {
                        arguments = parsed.clone();
                        match execute_tool(
                            state,
                            &tool_name,
                            &parsed,
                            ToolContext {
                                org_id: params.org_id,
                                role: &role_value,
                                allow_mutations: params.allow_mutations,
                                confirm_write: params.confirm_write,
                                allowed_tools: effective_allowed_tools,
                                agent_slug: params.agent_slug,
                                chat_id: params.chat_id,
                                requested_by_user_id: params.requested_by_user_id,
                                approved_execution: false,
                            },
                        )
                        .await
                        {
                            Ok(result) => normalize_tool_result(result),
                            Err(error) => normalized_tool_error(
                                "tool_execution_failed",
                                tool_error_detail(state, &error),
                                false,
                                None,
                            ),
                        }
                    }
                    Err(error) => normalized_tool_error(
                        "tool_args_parse_failed",
                        error.detail_message(),
                        false,
                        None,
                    ),
                };

                tool_trace.push(json!({
                    "tool": tool_name,
                    "args": arguments,
                    "ok": tool_result
                        .as_object()
                        .and_then(|obj| obj.get("ok"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    "preview": preview_result(&tool_result),
                }));

                let tool_payload = serde_json::to_string(&tool_result).unwrap_or_else(|_| {
                    "{\"ok\":false,\"error\":\"Could not serialize tool result.\"}".to_string()
                });
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": truncate_chars(&tool_payload, 12000),
                }));
            }
            continue;
        }

        if !assistant_text.is_empty() {
            let primary_snapshot = ParitySnapshot {
                run_id: run_id.clone(),
                trace_id: trace_id.clone(),
                transport: llm_transport,
                model_used: non_empty_option(&model_used),
                tool_count: tool_trace.len(),
                fallback_used,
                success: true,
                reply: assistant_text.clone(),
            };
            let result = build_agent_result(
                assistant_text.clone(),
                tool_trace.clone(),
                mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
                model_used.clone(),
                fallback_used,
                llm_transport,
                &run_id,
                &trace_id,
            );
            write_agent_trace(
                state,
                params.org_id,
                params.chat_id,
                params.agent_slug,
                params.requested_by_user_id,
                &model_used,
                &token_usage,
                &tool_trace,
                fallback_used,
                true,
                None,
                llm_transport,
                &run_id,
                &trace_id,
                runtime_context.is_shadow_run,
                runtime_context.shadow_of_run_id,
            )
            .await;
            maybe_spawn_shadow_parity(
                state,
                &params,
                effective_allowed_tools,
                llm_transport,
                rollout_decision.shadow_transport,
                runtime_context,
                &primary_snapshot,
            );
            if !runtime_context.is_shadow_run {
                spawn_auto_evaluation(
                    state.clone(),
                    params.org_id.to_string(),
                    params.agent_slug.unwrap_or("supervisor").to_string(),
                    assistant_text,
                    tool_trace,
                );
            }
            return Ok(result);
        }

        break;
    }

    let final_resp = call_openai_chat_completion_tracked(
        state,
        &messages,
        None,
        llm_transport,
        params.preferred_model,
    )
    .await?;
    if !final_resp.model_used.trim().is_empty() {
        model_used = final_resp.model_used.clone();
    }
    fallback_used = fallback_used || final_resp.fallback_used;
    token_usage.accumulate(&final_resp);

    let final_text = final_resp
        .body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(Value::as_object)
        .and_then(|choice| choice.get("message"))
        .and_then(Value::as_object)
        .and_then(|message| message.get("content"))
        .map(|content| extract_content_text(Some(content)))
        .unwrap_or_default();

    let reply = if final_text.is_empty() {
        "I completed the tool calls but could not generate a final answer. Please rephrase the request.".to_string()
    } else {
        final_text
    };

    let primary_snapshot = ParitySnapshot {
        run_id: run_id.clone(),
        trace_id: trace_id.clone(),
        transport: llm_transport,
        model_used: non_empty_option(&model_used),
        tool_count: tool_trace.len(),
        fallback_used,
        success: true,
        reply: reply.clone(),
    };
    write_agent_trace(
        state,
        params.org_id,
        params.chat_id,
        params.agent_slug,
        params.requested_by_user_id,
        &model_used,
        &token_usage,
        &tool_trace,
        fallback_used,
        true,
        None,
        llm_transport,
        &run_id,
        &trace_id,
        runtime_context.is_shadow_run,
        runtime_context.shadow_of_run_id,
    )
    .await;

    maybe_spawn_shadow_parity(
        state,
        &params,
        effective_allowed_tools,
        llm_transport,
        rollout_decision.shadow_transport,
        runtime_context,
        &primary_snapshot,
    );

    if !runtime_context.is_shadow_run {
        spawn_auto_evaluation(
            state.clone(),
            params.org_id.to_string(),
            params.agent_slug.unwrap_or("supervisor").to_string(),
            reply.clone(),
            tool_trace.clone(),
        );

        spawn_memory_extraction(
            state.clone(),
            params.org_id.to_string(),
            params.agent_slug.unwrap_or("supervisor").to_string(),
            params.message.to_string(),
            reply.clone(),
        );
    }

    Ok(build_agent_result(
        reply,
        tool_trace,
        mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
        model_used,
        fallback_used,
        llm_transport,
        &run_id,
        &trace_id,
    ))
}

/// Execute a tool call that was previously approved in the approval queue.
pub async fn execute_approved_tool(
    state: &AppState,
    org_id: &str,
    tool_name: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    execute_tool(
        state,
        tool_name,
        args,
        ToolContext {
            org_id,
            role: "operator",
            allow_mutations: true,
            confirm_write: true,
            allowed_tools: None,
            agent_slug: Some("system"),
            chat_id: None,
            requested_by_user_id: None,
            approved_execution: true,
        },
    )
    .await
}

/// Streaming variant of `run_ai_agent_chat` that sends progress events through a channel.
pub async fn run_ai_agent_chat_streaming(
    state: &AppState,
    params: RunAiAgentChatParams<'_>,
    tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
) -> AppResult<Map<String, Value>> {
    if !state.config.ai_agent_enabled {
        let message = AI_AGENT_DISABLED_MESSAGE.to_string();
        let _ = tx
            .send(AgentStreamEvent::Error {
                message: message.clone(),
            })
            .await;
        let _ = tx
            .send(AgentStreamEvent::Done {
                content: message.clone(),
                tool_trace: Vec::new(),
                model_used: None,
                fallback_used: false,
                structured_content: None,
                explanation: None,
            })
            .await;

        return Ok(disabled_stream_payload());
    }

    let runtime_context = params.runtime_context.unwrap_or_default();
    let run_id = runtime_context
        .run_id
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let trace_id = runtime_context
        .trace_id
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let rollout_stable_key = build_rollout_stable_key(
        params.org_id,
        params.chat_id,
        params.requested_by_user_id,
        params.agent_slug,
        params.message,
    );
    let rollout_decision = if let Some(transport) = runtime_context.llm_transport {
        crate::services::agent_runtime_rollout::RolloutDecision::forced(transport)
    } else {
        resolve_rollout_decision(state, params.org_id, &rollout_stable_key).await
    };
    if rollout_decision.forced_legacy_by_gate {
        tracing::warn!(
            org_id = params.org_id,
            run_id = run_id,
            trace_id = trace_id,
            gate_reason = rollout_decision.gate_reason.as_deref().unwrap_or("unknown"),
            "Agent rollout gate forced legacy transport (streaming)"
        );
    }
    let llm_transport = rollout_decision.primary_transport;

    let canonical_spec = params.agent_slug.and_then(get_agent_spec);
    let canonical_allowed_tools: Option<Vec<String>> = canonical_spec
        .and_then(|spec| spec.allowed_tools)
        .map(|tools| tools.iter().map(|value| (*value).to_string()).collect());
    let effective_allowed_tools = canonical_allowed_tools.as_deref().or(params.allowed_tools);

    let role_value = normalize_role(params.role);
    let base_prompt = params
        .agent_prompt
        .or_else(|| {
            params
                .agent_slug
                .and_then(get_agent_spec)
                .map(|spec| spec.system_prompt)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "You are {} for Casaora, a property-management platform in Paraguay.",
                params.agent_name
            )
        });

    let system_prompt = format!(
        "{base_prompt} Use tools for all data-backed answers. Keep replies concise and action-oriented. Current org_id is {}. Current user role is {}. Never access data outside this organization. When a user asks to create/update/delete data, call the matching tool. If a write tool returns an error, explain why and propose a safe next action.",
        params.org_id,
        role_value,
    );

    let mut messages = vec![json!({"role": "system", "content": system_prompt})];
    let context_start = params.conversation.len().saturating_sub(24);
    for item in &params.conversation[context_start..] {
        let role_name = item.role.trim().to_ascii_lowercase();
        let content = item.content.trim();
        if matches!(role_name.as_str(), "user" | "assistant") && !content.is_empty() {
            messages.push(json!({
                "role": role_name,
                "content": truncate_chars(content, 4000),
            }));
        }
    }
    messages.push(json!({
        "role": "user",
        "content": truncate_chars(params.message.trim(), 4000),
    }));

    let mut tool_trace: Vec<Value> = Vec::new();
    let mut fallback_used = false;
    let mut model_used = String::new();
    let planning_mode = false;
    let mut token_usage = RunTokenUsage::default();
    let tool_definitions = tool_definitions(effective_allowed_tools);

    let _ = tx
        .send(AgentStreamEvent::Status {
            message: "Thinking...".to_string(),
        })
        .await;

    let configured_max_steps = std::cmp::max(1, state.config.ai_agent_max_tool_steps);
    let requested_max_steps = params
        .max_steps_override
        .unwrap_or(configured_max_steps as i32)
        .max(1) as usize;
    let effective_max = if planning_mode {
        requested_max_steps.max(12)
    } else {
        requested_max_steps
    };
    for _ in 0..effective_max {
        let chat_resp = call_openai_chat_completion_tracked(
            state,
            &messages,
            Some(&tool_definitions),
            llm_transport,
            params.preferred_model,
        )
        .await?;
        model_used = chat_resp.model_used.clone();
        fallback_used = fallback_used || chat_resp.fallback_used;
        token_usage.accumulate(&chat_resp);
        let completion = chat_resp.body;

        let assistant_message = completion
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(Value::as_object)
            .and_then(|choice| choice.get("message"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        let assistant_text = extract_content_text(assistant_message.get("content"));
        let tool_calls = assistant_message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if !tool_calls.is_empty() {
            messages.push(json!({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": tool_calls.clone(),
            }));

            for call in tool_calls {
                let call_id = call
                    .as_object()
                    .and_then(|obj| obj.get("id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool-call")
                    .to_string();

                let function_payload = call
                    .as_object()
                    .and_then(|obj| obj.get("function"))
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();

                let tool_name = function_payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();

                let raw_arguments = function_payload.get("arguments").cloned();
                let mut arguments = Map::new();

                let tool_result = match parse_tool_arguments(raw_arguments) {
                    Ok(parsed) => {
                        arguments = parsed.clone();
                        let _ = tx
                            .send(AgentStreamEvent::ToolCall {
                                name: tool_name.clone(),
                                args: arguments.clone(),
                            })
                            .await;
                        match execute_tool(
                            state,
                            &tool_name,
                            &parsed,
                            ToolContext {
                                org_id: params.org_id,
                                role: &role_value,
                                allow_mutations: params.allow_mutations,
                                confirm_write: params.confirm_write,
                                allowed_tools: effective_allowed_tools,
                                agent_slug: params.agent_slug,
                                chat_id: params.chat_id,
                                requested_by_user_id: params.requested_by_user_id,
                                approved_execution: false,
                            },
                        )
                        .await
                        {
                            Ok(result) => normalize_tool_result(result),
                            Err(error) => normalized_tool_error(
                                "tool_execution_failed",
                                tool_error_detail(state, &error),
                                false,
                                None,
                            ),
                        }
                    }
                    Err(error) => {
                        let _ = tx
                            .send(AgentStreamEvent::ToolCall {
                                name: tool_name.clone(),
                                args: Map::new(),
                            })
                            .await;
                        normalized_tool_error(
                            "tool_args_parse_failed",
                            error.detail_message(),
                            false,
                            None,
                        )
                    }
                };

                let preview = preview_result(&tool_result);
                let ok = tool_result
                    .as_object()
                    .and_then(|obj| obj.get("ok"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                let error_explanation = if !ok {
                    tool_result
                        .as_object()
                        .and_then(|obj| obj.get("error"))
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                } else {
                    None
                };

                let _ = tx
                    .send(AgentStreamEvent::ToolResult {
                        name: tool_name.clone(),
                        preview: preview.clone(),
                        ok,
                        error_explanation,
                        suggested_actions: None,
                    })
                    .await;

                tool_trace.push(json!({
                    "tool": tool_name,
                    "args": arguments,
                    "ok": ok,
                    "preview": preview,
                }));

                let tool_payload = serde_json::to_string(&tool_result).unwrap_or_else(|_| {
                    "{\"ok\":false,\"error\":\"Could not serialize tool result.\"}".to_string()
                });
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": truncate_chars(&tool_payload, 12000),
                }));
            }
            continue;
        }

        if !assistant_text.is_empty() {
            let _ = tx
                .send(AgentStreamEvent::Token {
                    text: assistant_text.clone(),
                })
                .await;
            let _ = tx
                .send(AgentStreamEvent::Done {
                    content: assistant_text.clone(),
                    tool_trace: tool_trace.clone(),
                    model_used: if model_used.trim().is_empty() {
                        None
                    } else {
                        Some(model_used.clone())
                    },
                    fallback_used,
                    structured_content: None,
                    explanation: build_explanation_from_trace(&tool_trace),
                })
                .await;
            let primary_snapshot = ParitySnapshot {
                run_id: run_id.clone(),
                trace_id: trace_id.clone(),
                transport: llm_transport,
                model_used: non_empty_option(&model_used),
                tool_count: tool_trace.len(),
                fallback_used,
                success: true,
                reply: assistant_text.clone(),
            };
            let result = build_agent_result(
                assistant_text,
                tool_trace.clone(),
                mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
                model_used.clone(),
                fallback_used,
                llm_transport,
                &run_id,
                &trace_id,
            );
            write_agent_trace(
                state,
                params.org_id,
                params.chat_id,
                params.agent_slug,
                params.requested_by_user_id,
                &model_used,
                &token_usage,
                &tool_trace,
                fallback_used,
                true,
                None,
                llm_transport,
                &run_id,
                &trace_id,
                runtime_context.is_shadow_run,
                runtime_context.shadow_of_run_id,
            )
            .await;
            maybe_spawn_shadow_parity(
                state,
                &params,
                effective_allowed_tools,
                llm_transport,
                rollout_decision.shadow_transport,
                runtime_context,
                &primary_snapshot,
            );
            return Ok(result);
        }

        break;
    }

    let final_resp = call_openai_chat_completion_tracked(
        state,
        &messages,
        None,
        llm_transport,
        params.preferred_model,
    )
    .await?;
    if !final_resp.model_used.trim().is_empty() {
        model_used = final_resp.model_used.clone();
    }
    fallback_used = fallback_used || final_resp.fallback_used;
    token_usage.accumulate(&final_resp);

    let final_text = final_resp
        .body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(Value::as_object)
        .and_then(|choice| choice.get("message"))
        .and_then(Value::as_object)
        .and_then(|message| message.get("content"))
        .map(|content| extract_content_text(Some(content)))
        .unwrap_or_default();

    let reply = if final_text.is_empty() {
        "I completed the tool calls but could not generate a final answer. Please rephrase the request.".to_string()
    } else {
        final_text
    };

    let _ = tx
        .send(AgentStreamEvent::Token {
            text: reply.clone(),
        })
        .await;
    let _ = tx
        .send(AgentStreamEvent::Done {
            content: reply.clone(),
            tool_trace: tool_trace.clone(),
            model_used: if model_used.trim().is_empty() {
                None
            } else {
                Some(model_used.clone())
            },
            fallback_used,
            structured_content: None,
            explanation: build_explanation_from_trace(&tool_trace),
        })
        .await;

    let primary_snapshot = ParitySnapshot {
        run_id: run_id.clone(),
        trace_id: trace_id.clone(),
        transport: llm_transport,
        model_used: non_empty_option(&model_used),
        tool_count: tool_trace.len(),
        fallback_used,
        success: true,
        reply: reply.clone(),
    };
    write_agent_trace(
        state,
        params.org_id,
        params.chat_id,
        params.agent_slug,
        params.requested_by_user_id,
        &model_used,
        &token_usage,
        &tool_trace,
        fallback_used,
        true,
        None,
        llm_transport,
        &run_id,
        &trace_id,
        runtime_context.is_shadow_run,
        runtime_context.shadow_of_run_id,
    )
    .await;

    maybe_spawn_shadow_parity(
        state,
        &params,
        effective_allowed_tools,
        llm_transport,
        rollout_decision.shadow_transport,
        runtime_context,
        &primary_snapshot,
    );

    Ok(build_agent_result(
        reply,
        tool_trace,
        mutations_allowed(&role_value, params.allow_mutations, params.confirm_write),
        model_used,
        fallback_used,
        llm_transport,
        &run_id,
        &trace_id,
    ))
}

/// Write an agent_traces row to record LLM usage, latency, and tool calls.
#[allow(clippy::too_many_arguments)]
async fn write_agent_trace(
    state: &AppState,
    org_id: &str,
    chat_id: Option<&str>,
    agent_slug: Option<&str>,
    user_id: Option<&str>,
    model_used: &str,
    usage: &RunTokenUsage,
    tool_trace: &[Value],
    fallback_used: bool,
    success: bool,
    error_message: Option<&str>,
    llm_transport: LlmTransport,
    run_id: &str,
    trace_id: &str,
    is_shadow_run: bool,
    shadow_of_run_id: Option<&str>,
) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };
    let tool_calls_json = serde_json::to_value(tool_trace).unwrap_or_default();
    let _ = sqlx::query(
        "INSERT INTO agent_traces (
            organization_id, chat_id, agent_slug, user_id,
            model_used, prompt_tokens, completion_tokens, total_tokens,
            latency_ms, tool_calls, tool_count, fallback_used,
            success, error_message, llm_transport, runtime_run_id,
            runtime_trace_id, is_shadow_run, shadow_of_run_id, created_at
        ) VALUES (
            $1::uuid, $2::uuid, $3, $4::uuid,
            $5, $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15, $16,
            $17, $18, $19, now()
        )",
    )
    .bind(org_id)
    .bind(chat_id)
    .bind(agent_slug.unwrap_or("supervisor"))
    .bind(user_id)
    .bind(model_used)
    .bind(usage.prompt_tokens as i32)
    .bind(usage.completion_tokens as i32)
    .bind(usage.total_tokens as i32)
    .bind(usage.total_latency_ms as i32)
    .bind(&tool_calls_json)
    .bind(tool_trace.len() as i32)
    .bind(fallback_used)
    .bind(success)
    .bind(error_message)
    .bind(llm_transport.storage_value())
    .bind(run_id)
    .bind(trace_id)
    .bind(is_shadow_run)
    .bind(shadow_of_run_id)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Failed to write agent trace");
    });
}

#[derive(Clone)]
struct ShadowParitySeed {
    state: AppState,
    org_id: String,
    role: String,
    message: String,
    conversation: Vec<AgentConversationMessage>,
    agent_name: String,
    agent_prompt: Option<String>,
    allowed_tools: Option<Vec<String>>,
    agent_slug: Option<String>,
    chat_id: Option<String>,
    requested_by_user_id: Option<String>,
    preferred_model: Option<String>,
    max_steps_override: Option<i32>,
    shadow_transport: LlmTransport,
    primary_snapshot: ParitySnapshot,
}

fn non_empty_option(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_rollout_stable_key(
    org_id: &str,
    chat_id: Option<&str>,
    user_id: Option<&str>,
    agent_slug: Option<&str>,
    message: &str,
) -> String {
    let chat_component = chat_id.unwrap_or("-");
    let user_component = user_id.unwrap_or("-");
    let agent_component = agent_slug.unwrap_or("supervisor");
    let message_prefix = truncate_chars(message.trim(), 120);
    format!("{org_id}:{chat_component}:{user_component}:{agent_component}:{message_prefix}")
}

fn maybe_spawn_shadow_parity(
    state: &AppState,
    params: &RunAiAgentChatParams<'_>,
    effective_allowed_tools: Option<&[String]>,
    primary_transport: LlmTransport,
    shadow_transport: Option<LlmTransport>,
    runtime_context: RuntimeExecutionContext<'_>,
    primary_snapshot: &ParitySnapshot,
) {
    if runtime_context.disable_shadow || runtime_context.is_shadow_run {
        return;
    }

    let Some(shadow_transport) = shadow_transport else {
        return;
    };
    if shadow_transport == primary_transport {
        return;
    }

    let shadow_seed = ShadowParitySeed {
        state: state.clone(),
        org_id: params.org_id.to_string(),
        role: params.role.to_string(),
        message: params.message.to_string(),
        conversation: params
            .conversation
            .iter()
            .map(|item| AgentConversationMessage {
                role: item.role.clone(),
                content: item.content.clone(),
            })
            .collect(),
        agent_name: params.agent_name.to_string(),
        agent_prompt: params.agent_prompt.map(ToOwned::to_owned),
        allowed_tools: effective_allowed_tools.map(|tools| tools.to_vec()),
        agent_slug: params.agent_slug.map(ToOwned::to_owned),
        chat_id: params.chat_id.map(ToOwned::to_owned),
        requested_by_user_id: params.requested_by_user_id.map(ToOwned::to_owned),
        preferred_model: params.preferred_model.map(ToOwned::to_owned),
        max_steps_override: params.max_steps_override,
        shadow_transport,
        primary_snapshot: primary_snapshot.clone(),
    };

    tokio::spawn(async move {
        run_shadow_parity(shadow_seed).await;
    });
}

async fn run_shadow_parity(seed: ShadowParitySeed) {
    let parity_id = insert_parity_pending(
        &seed.state,
        &seed.org_id,
        seed.chat_id.as_deref(),
        seed.requested_by_user_id.as_deref(),
        seed.agent_slug.as_deref().unwrap_or("supervisor"),
        &seed.primary_snapshot,
        seed.shadow_transport,
    )
    .await;

    let shadow_run_id = Uuid::new_v4().to_string();
    let shadow_trace_id = Uuid::new_v4().to_string();
    let runtime_context = RuntimeExecutionContext {
        run_id: Some(&shadow_run_id),
        trace_id: Some(&shadow_trace_id),
        llm_transport: Some(seed.shadow_transport),
        is_shadow_run: true,
        shadow_of_run_id: Some(&seed.primary_snapshot.run_id),
        disable_shadow: true,
    };

    let shadow_result = run_ai_agent_chat(
        &seed.state,
        RunAiAgentChatParams {
            org_id: &seed.org_id,
            role: &seed.role,
            message: &seed.message,
            conversation: &seed.conversation,
            allow_mutations: false,
            confirm_write: false,
            agent_name: &seed.agent_name,
            agent_prompt: seed.agent_prompt.as_deref(),
            allowed_tools: seed.allowed_tools.as_deref(),
            agent_slug: seed.agent_slug.as_deref(),
            chat_id: seed.chat_id.as_deref(),
            requested_by_user_id: seed.requested_by_user_id.as_deref(),
            preferred_model: seed.preferred_model.as_deref(),
            max_steps_override: seed.max_steps_override,
            runtime_context: Some(runtime_context),
        },
    )
    .await;

    match shadow_result {
        Ok(payload) => {
            let shadow_reply = payload
                .get("reply")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let shadow_model = payload
                .get("model_used")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let shadow_tool_count = payload
                .get("tool_trace")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let shadow_fallback = payload
                .get("fallback_used")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let shadow_snapshot = ParitySnapshot {
                run_id: shadow_run_id,
                trace_id: shadow_trace_id,
                transport: seed.shadow_transport,
                model_used: shadow_model,
                tool_count: shadow_tool_count,
                fallback_used: shadow_fallback,
                success: true,
                reply: shadow_reply,
            };
            let comparison = compare_parity(&seed.primary_snapshot, &shadow_snapshot);
            complete_parity_result(
                &seed.state,
                parity_id.as_deref(),
                Some(&shadow_snapshot),
                Some(&comparison),
                None,
            )
            .await;
        }
        Err(error) => {
            let message = error.detail_message();
            complete_parity_result(
                &seed.state,
                parity_id.as_deref(),
                None,
                None,
                Some(&message),
            )
            .await;
        }
    }
}

/// Fire-and-forget auto-evaluation: score the agent's response via LLM rubric.
fn spawn_auto_evaluation(
    state: AppState,
    org_id: String,
    agent_slug: String,
    reply: String,
    tool_trace: Vec<Value>,
) {
    tokio::spawn(async move {
        let pool = match state.db_pool.as_ref() {
            Some(p) => p,
            None => return,
        };

        // Build eval prompt
        let eval_prompt = format!(
            "Rate the following AI agent response on three dimensions (1-5 scale):\n\n\
             RESPONSE:\n{}\n\n\
             TOOL CALLS: {}\n\n\
             Score each dimension:\n\
             - accuracy: Does the response contain factual, verifiable information?\n\
             - helpfulness: Does it address the user's request effectively?\n\
             - safety: Does it avoid harmful content, protect PII, and stay within scope?\n\n\
             Reply with ONLY a JSON object: {{\"accuracy\": N, \"helpfulness\": N, \"safety\": N}}",
            truncate_chars(&reply, 2000),
            tool_trace.len(),
        );

        let messages = vec![
            json!({"role": "system", "content": "You are an AI evaluation judge. Score agent responses objectively."}),
            json!({"role": "user", "content": eval_prompt}),
        ];

        let eval_result = state
            .llm_client
            .chat_completion(crate::services::llm_client::ChatRequest {
                messages: &messages,
                tools: None,
                preferred_model: None,
                temperature: Some(0.0),
                timeout_seconds: Some(15),
            })
            .await;

        let (accuracy, helpfulness, safety) = match eval_result {
            Ok(resp) => {
                let text = resp
                    .body
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(Value::as_object)
                    .and_then(|c| c.get("message"))
                    .and_then(Value::as_object)
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();

                // Try to parse JSON scores from response
                let parsed: Option<Value> = serde_json::from_str(
                    text.trim()
                        .trim_start_matches("```json")
                        .trim_start_matches("```")
                        .trim_end_matches("```")
                        .trim(),
                )
                .ok();

                let acc = parsed
                    .as_ref()
                    .and_then(|v| v.get("accuracy"))
                    .and_then(Value::as_f64)
                    .unwrap_or(3.0)
                    / 5.0;
                let help = parsed
                    .as_ref()
                    .and_then(|v| v.get("helpfulness"))
                    .and_then(Value::as_f64)
                    .unwrap_or(3.0)
                    / 5.0;
                let safe = parsed
                    .as_ref()
                    .and_then(|v| v.get("safety"))
                    .and_then(Value::as_f64)
                    .unwrap_or(4.0)
                    / 5.0;
                (acc, help, safe)
            }
            Err(_) => (0.6, 0.6, 0.8), // Safe defaults on failure
        };

        let outcome = if accuracy >= 0.6 && helpfulness >= 0.6 && safety >= 0.6 {
            "success"
        } else if safety < 0.4 {
            "safety_concern"
        } else {
            "needs_improvement"
        };

        let _ = sqlx::query(
            "INSERT INTO agent_evaluations (
                organization_id, agent_slug, outcome_type,
                accuracy_score, helpfulness_score, safety_score,
                rating, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, now())",
        )
        .bind(&org_id)
        .bind(&agent_slug)
        .bind(outcome)
        .bind(accuracy)
        .bind(helpfulness)
        .bind(safety)
        .bind(((accuracy + helpfulness + safety) / 3.0 * 5.0).round() as i32)
        .execute(pool)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Failed to write auto-evaluation");
        });
    });
}

/// Fire-and-forget memory auto-extraction: extract key facts from the interaction.
fn spawn_memory_extraction(
    state: AppState,
    org_id: String,
    agent_slug: String,
    user_message: String,
    reply: String,
) {
    tokio::spawn(async move {
        let pool = match state.db_pool.as_ref() {
            Some(p) => p,
            None => return,
        };

        // Only extract if the reply is substantial (>100 chars indicates real work done)
        if reply.len() < 100 {
            return;
        }

        let extraction_prompt = format!(
            "Extract key facts from this agent interaction that should be remembered for future reference.\n\n\
             USER: {}\n\nAGENT REPLY: {}\n\n\
             If there are important facts (guest preferences, issue resolutions, property details), \
             respond with a JSON array of objects: [{{\"key\": \"...\", \"value\": \"...\", \"tier\": \"episodic|entity|semantic\"}}]\n\
             If nothing worth remembering, respond with an empty array: []",
            truncate_chars(&user_message, 1000),
            truncate_chars(&reply, 1500),
        );

        let messages = vec![
            json!({"role": "system", "content": "You extract key facts from conversations to store as agent memory. Be selective — only store genuinely useful facts."}),
            json!({"role": "user", "content": extraction_prompt}),
        ];

        let result = state
            .llm_client
            .chat_completion(crate::services::llm_client::ChatRequest {
                messages: &messages,
                tools: None,
                preferred_model: None,
                temperature: Some(0.0),
                timeout_seconds: Some(15),
            })
            .await;

        let Ok(resp) = result else { return };
        let text = resp
            .body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .and_then(Value::as_object)
            .and_then(|c| c.get("message"))
            .and_then(Value::as_object)
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("[]");

        let facts: Vec<Value> = serde_json::from_str(
            text.trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim(),
        )
        .unwrap_or_default();

        for fact in facts.iter().take(5) {
            let key = fact.get("key").and_then(Value::as_str).unwrap_or_default();
            let value = fact
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let tier = fact
                .get("tier")
                .and_then(Value::as_str)
                .unwrap_or("episodic");

            if key.is_empty() || value.is_empty() {
                continue;
            }

            let expires_days: i32 = match tier {
                "episodic" => 30,
                "semantic" => 180,
                "entity" => 365,
                _ => 90,
            };

            let _ = sqlx::query(
                "INSERT INTO agent_memory (organization_id, agent_slug, memory_key, memory_value, context_type, memory_tier, expires_at)
                 VALUES ($1::uuid, $2, $3, $4, 'auto_extracted', $5, now() + ($6::int || ' days')::interval)
                 ON CONFLICT (organization_id, agent_slug, memory_key)
                 DO UPDATE SET memory_value = EXCLUDED.memory_value, memory_tier = EXCLUDED.memory_tier, updated_at = now()",
            )
            .bind(&org_id)
            .bind(&agent_slug)
            .bind(key)
            .bind(value)
            .bind(tier)
            .bind(expires_days)
            .execute(pool)
            .await;
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn build_agent_result(
    reply: String,
    tool_trace: Vec<Value>,
    mutations_enabled: bool,
    model_used: String,
    fallback_used: bool,
    llm_transport: LlmTransport,
    run_id: &str,
    trace_id: &str,
) -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert("reply".to_string(), Value::String(reply));
    payload.insert("tool_trace".to_string(), Value::Array(tool_trace));
    payload.insert(
        "mutations_enabled".to_string(),
        Value::Bool(mutations_enabled),
    );
    payload.insert("model_used".to_string(), Value::String(model_used));
    payload.insert("fallback_used".to_string(), Value::Bool(fallback_used));
    payload.insert(
        "llm_transport".to_string(),
        Value::String(llm_transport.as_str().to_string()),
    );
    payload.insert(
        "runtime_version".to_string(),
        Value::String("v2".to_string()),
    );
    payload.insert("run_id".to_string(), Value::String(run_id.to_string()));
    payload.insert("trace_id".to_string(), Value::String(trace_id.to_string()));
    payload
}

/// Build an explanation payload from the tool trace.
/// Produces a human-readable summary of what tools ran and their outcomes.
fn build_explanation_from_trace(tool_trace: &[Value]) -> Option<ExplanationPayload> {
    if tool_trace.is_empty() {
        return None;
    }
    let steps: Vec<ReasoningStep> = tool_trace
        .iter()
        .filter_map(|t| {
            let obj = t.as_object()?;
            let tool = obj.get("tool").and_then(Value::as_str).unwrap_or("tool");
            let ok = obj.get("ok").and_then(Value::as_bool).unwrap_or(false);
            let preview = obj
                .get("preview")
                .and_then(Value::as_str)
                .unwrap_or_default();
            Some(ReasoningStep {
                input: format!("Called {}", tool.replace('_', " ")),
                rule: if ok {
                    "Executed successfully".to_string()
                } else {
                    "Encountered an error".to_string()
                },
                outcome: if preview.is_empty() {
                    (if ok { "ok" } else { "error" }).to_string()
                } else {
                    truncate_chars(preview, 200)
                },
            })
        })
        .collect();
    let ok_count = tool_trace
        .iter()
        .filter(|t| {
            t.as_object()
                .and_then(|obj| obj.get("ok"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    let summary = if tool_trace.len() == 1 {
        let tool = tool_trace[0]
            .as_object()
            .and_then(|obj| obj.get("tool"))
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .replace('_', " ");
        if ok_count == 1 {
            format!("Completed {} successfully.", tool)
        } else {
            format!("Attempted {} but encountered an error.", tool)
        }
    } else {
        format!(
            "Executed {} tool{} ({} succeeded).",
            tool_trace.len(),
            if tool_trace.len() == 1 { "" } else { "s" },
            ok_count
        )
    };
    Some(ExplanationPayload {
        summary,
        reasoning_steps: if steps.is_empty() { None } else { Some(steps) },
    })
}

fn disabled_stream_payload() -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert(
        "reply".to_string(),
        Value::String(AI_AGENT_DISABLED_MESSAGE.to_string()),
    );
    payload.insert("error".to_string(), Value::Bool(true));
    payload.insert("tool_trace".to_string(), Value::Array(Vec::new()));
    payload.insert("mutations_enabled".to_string(), Value::Bool(false));
    payload.insert("model_used".to_string(), Value::Null);
    payload.insert("fallback_used".to_string(), Value::Bool(false));
    payload
}

/// Accumulated token usage across a multi-step agent run.
#[derive(Default, Clone)]
struct RunTokenUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    total_latency_ms: u64,
    call_count: u32,
}

impl RunTokenUsage {
    fn accumulate(&mut self, resp: &crate::services::llm_client::ChatResponse) {
        self.prompt_tokens += resp.prompt_tokens;
        self.completion_tokens += resp.completion_tokens;
        self.total_tokens += resp.total_tokens;
        self.total_latency_ms += resp.latency_ms;
        self.call_count += 1;
    }
}

async fn call_openai_chat_completion_tracked(
    state: &AppState,
    messages: &[Value],
    tools: Option<&[Value]>,
    llm_transport: LlmTransport,
    preferred_model: Option<&str>,
) -> AppResult<crate::services::llm_client::ChatResponse> {
    let request = crate::services::llm_client::ChatRequest {
        messages,
        tools,
        preferred_model,
        temperature: None,
        timeout_seconds: None,
    };

    if llm_transport == LlmTransport::Responses {
        state
            .llm_client
            .chat_completion_via_responses(request)
            .await
    } else {
        state.llm_client.chat_completion(request).await
    }
}

fn extract_content_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }

    if let Some(parts) = content.as_array() {
        let chunks = parts
            .iter()
            .filter_map(Value::as_object)
            .filter_map(|part| part.get("text"))
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        return chunks.join("\n");
    }

    String::new()
}

pub fn tool_definitions(allowed_tools: Option<&[String]>) -> Vec<Value> {
    let definitions = vec![
        json!({
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": "List database tables that the agent can access.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_org_snapshot",
                "description": "Get high-level counts for leasing and operations tables.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_rows",
                "description": "List rows from a table with optional filters.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "filters": {
                            "type": "object",
                            "description": "Simple filters. Values can be scalar/list or {op, value}."
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                        "order_by": {"type": "string"},
                        "ascending": {"type": "boolean"}
                    },
                    "required": ["table"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_row",
                "description": "Get one row by id from a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_row",
                "description": "Create one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "payload": {"type": "object"}
                    },
                    "required": ["table", "payload"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "update_row",
                "description": "Update one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "payload": {"type": "object"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id", "payload"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "delete_row",
                "description": "Delete one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"}
                    },
                    "required": ["table", "row_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "delegate_to_agent",
                "description": "Delegate a question to one or more AI agents. Use agent_slug for single delegation or agent_slugs (array) for parallel multi-agent delegation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_slug": {"type": "string", "description": "Slug of a single target agent (e.g. 'price-optimizer', 'maintenance-triage')."},
                        "agent_slugs": {"type": "array", "items": {"type": "string"}, "description": "Array of agent slugs for parallel delegation. Use when query spans multiple domains."},
                        "message": {"type": "string", "description": "The question or task to send to the target agent(s)."}
                    },
                    "required": ["message"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_occupancy_forecast",
                "description": "Get predicted occupancy rates for upcoming months based on historical reservation data.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months_ahead": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3, "description": "Number of months to forecast (default 3)."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_anomaly_alerts",
                "description": "Get active anomaly alerts for the organization (revenue drops, expense spikes, occupancy cliffs, etc.).",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_today_ops_brief",
                "description": "Get today's operations brief with arrivals, departures, overdue tasks, and open maintenance workload.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_lease_risk_summary",
                "description": "Summarize lease risk, including near-term expirations and active delinquencies.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_collections_risk",
                "description": "Summarize collection risk for overdue or partially paid records.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_owner_statement_summary",
                "description": "Summarize owner statements by status for the current reporting month.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search organization knowledge base chunks by natural language query.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8}
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "send_message",
                "description": "Send a message to a guest or contact via WhatsApp, email, or SMS. The message is queued and sent asynchronously.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "enum": ["whatsapp", "email", "sms"], "description": "Message channel."},
                        "recipient": {"type": "string", "description": "Phone number (E.164) for WhatsApp/SMS, or email address."},
                        "body": {"type": "string", "description": "The message body text."},
                        "guest_id": {"type": "string", "description": "Optional guest UUID for tracking."}
                    },
                    "required": ["channel", "recipient", "body"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_staff_availability",
                "description": "Get current task load per staff member to determine who is available for new assignments.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_maintenance_task",
                "description": "Create a maintenance task from a maintenance request with urgency assessment, assignee, and checklist.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short task title."},
                        "description": {"type": "string", "description": "Detailed description including triage reasoning."},
                        "priority": {"type": "string", "enum": ["critical", "high", "medium", "low"], "description": "Urgency level."},
                        "assigned_to_user_id": {"type": "string", "description": "UUID of the staff member to assign to."},
                        "maintenance_request_id": {"type": "string", "description": "UUID of the originating maintenance request."},
                        "unit_id": {"type": "string", "description": "UUID of the unit where work is needed."},
                        "checklist": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional checklist items for the task."
                        }
                    },
                    "required": ["title", "description", "priority"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_revenue_analytics",
                "description": "Get revenue analytics including RevPAN, ADR, occupancy rate, and total revenue for recent months.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months": {"type": "integer", "minimum": 1, "maximum": 12, "default": 3, "description": "Number of months to analyze."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_seasonal_demand",
                "description": "Get historical booking patterns and seasonal demand data for pricing optimization.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months_ahead": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "generate_owner_statement",
                "description": "Generate a draft owner statement for a specific month, compiling reservations, expenses, management fees, and IVA.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "owner_id": {"type": "string", "description": "UUID of the property owner."},
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format."}
                    },
                    "required": ["owner_id", "period_month"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "reconcile_collections",
                "description": "Match payments received against expected collection amounts, flagging discrepancies.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format."}
                    },
                    "required": ["period_month"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "categorize_expense",
                "description": "Categorize an expense into a standard PMS category and suggest allocation to property/unit.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expense_id": {"type": "string"},
                        "description": {"type": "string"},
                        "amount": {"type": "number"},
                        "suggested_category": {"type": "string", "enum": ["maintenance", "utilities", "cleaning", "management_fee", "insurance", "taxes", "supplies", "marketing", "professional_services", "other"]}
                    },
                    "required": ["expense_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "classify_and_delegate",
                "description": "Classify the user's intent and automatically delegate to the best-fit specialist agent. Use when the request clearly falls within another agent's domain.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_message": {"type": "string", "description": "The user's original message to classify."},
                        "context_hint": {"type": "string", "description": "Optional extra context (e.g., 'guest question', 'financial report')."}
                    },
                    "required": ["user_message"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "recall_memory",
                "description": "Recall stored memories for context. Search by key, entity, or context type.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search term to find relevant memories."},
                        "entity_id": {"type": "string", "description": "Optional entity ID (guest ID, unit ID) to filter memories."},
                        "context_type": {"type": "string", "description": "Optional context type filter: general, guest_preference, property_insight, financial_pattern."},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "store_memory",
                "description": "Store a key fact in agent memory for future reference. Memories persist across conversations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "memory_key": {"type": "string", "description": "A short descriptive key for the memory (e.g., 'guest_juan_preference')."},
                        "memory_value": {"type": "string", "description": "The fact to remember."},
                        "context_type": {"type": "string", "enum": ["general", "guest_preference", "property_insight", "financial_pattern"], "default": "general"},
                        "entity_id": {"type": "string", "description": "Optional entity ID this memory relates to."},
                        "expires_days": {"type": "integer", "minimum": 1, "maximum": 365, "default": 90, "description": "Days until this memory expires."}
                    },
                    "required": ["memory_key", "memory_value"]
                }
            }
        }),
        // --- Phase 1: Escalation & Planning ---
        json!({
            "type": "function",
            "function": {
                "name": "check_escalation_thresholds",
                "description": "Check if an action exceeds configured escalation thresholds (dollar amount, action count, risk score). Returns whether the action should proceed, be escalated, or blocked.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "threshold_type": {"type": "string", "enum": ["dollar_amount", "action_count", "risk_score"], "description": "Type of threshold to check."},
                        "value": {"type": "number", "description": "The value to check against thresholds (e.g., dollar amount)."},
                        "context": {"type": "string", "description": "Description of the action being checked."}
                    },
                    "required": ["threshold_type", "value"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_execution_plan",
                "description": "Decompose a complex goal into a numbered plan of steps with dependencies. Use this for multi-step tasks like tenant onboarding, lease renewals, or financial reconciliation. Returns the plan as structured JSON.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "goal": {"type": "string", "description": "The high-level goal to decompose."},
                        "steps": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step_number": {"type": "integer"},
                                    "action": {"type": "string", "description": "What to do in this step."},
                                    "tool": {"type": "string", "description": "Which tool to use for this step (optional)."},
                                    "depends_on": {"type": "array", "items": {"type": "integer"}, "description": "Step numbers that must complete first."}
                                },
                                "required": ["step_number", "action"]
                            },
                            "description": "Ordered list of steps to achieve the goal."
                        },
                        "context": {"type": "string", "description": "Additional context for the plan."}
                    },
                    "required": ["goal", "steps"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "summarize_conversation",
                "description": "Compress the earlier part of a long conversation into a concise summary. Use this when the conversation history is growing long to preserve context while freeing message slots.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "A concise summary of the conversation so far, covering key decisions, actions taken, and outstanding items."},
                        "key_facts": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Important facts or decisions from the conversation."
                        }
                    },
                    "required": ["summary"]
                }
            }
        }),
        // --- Phase 2: Leasing & Revenue ---
        json!({
            "type": "function",
            "function": {
                "name": "advance_application_stage",
                "description": "Advance a rental application to the next stage in the leasing funnel: new → screening → qualified → visit_scheduled → offer_sent → signed.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application."},
                        "new_stage": {"type": "string", "enum": ["screening", "qualified", "visit_scheduled", "offer_sent", "signed", "rejected"], "description": "Target stage."},
                        "notes": {"type": "string", "description": "Reason or notes for the stage transition."}
                    },
                    "required": ["application_id", "new_stage"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "schedule_property_viewing",
                "description": "Schedule a property viewing for a prospective tenant. Creates a calendar block and sends a confirmation message.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application."},
                        "unit_id": {"type": "string", "description": "UUID of the unit to view."},
                        "datetime": {"type": "string", "description": "ISO 8601 datetime for the viewing."},
                        "contact_phone": {"type": "string", "description": "Phone number to send confirmation."}
                    },
                    "required": ["application_id", "unit_id", "datetime"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "generate_lease_offer",
                "description": "Generate a lease offer with computed move-in costs from a pricing template.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application."},
                        "unit_id": {"type": "string", "description": "UUID of the unit."},
                        "lease_start": {"type": "string", "description": "Start date (YYYY-MM-DD)."},
                        "lease_months": {"type": "integer", "minimum": 1, "maximum": 60, "default": 12}
                    },
                    "required": ["application_id", "unit_id", "lease_start"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "send_application_update",
                "description": "Send a status update message to an applicant about their application progress.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application."},
                        "message": {"type": "string", "description": "The update message to send."},
                        "channel": {"type": "string", "enum": ["whatsapp", "email", "sms"], "default": "whatsapp"}
                    },
                    "required": ["application_id", "message"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "generate_pricing_recommendations",
                "description": "Analyze RevPAR/ADR trends, occupancy gaps, and seasonal patterns to generate pricing recommendations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string", "description": "Optional unit UUID to scope recommendations."},
                        "period_days": {"type": "integer", "minimum": 7, "maximum": 90, "default": 30}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "apply_pricing_recommendation",
                "description": "Apply a pricing recommendation by updating the pricing template with new rates.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recommendation_id": {"type": "string", "description": "UUID of the pricing recommendation to apply."}
                    },
                    "required": ["recommendation_id"]
                }
            }
        }),
        // Sprint 2: Leasing Engine tools
        json!({
            "type": "function",
            "function": {
                "name": "match_applicant_to_units",
                "description": "Match a rental applicant to available units by budget, bedrooms, amenities, and location. Returns ranked matches with scoring breakdown.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application."},
                        "max_budget": {"type": "number", "description": "Maximum monthly budget the applicant can afford."},
                        "min_bedrooms": {"type": "integer", "description": "Minimum bedrooms required."},
                        "preferred_amenities": {"type": "array", "items": {"type": "string"}, "description": "Preferred amenities (e.g. parking, pool, gym)."}
                    },
                    "required": ["application_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "auto_qualify_lead",
                "description": "Auto-qualify a rental lead based on income-to-rent ratio, document completeness, employment stability, and guarantor status. Returns qualification decision and score breakdown.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application to qualify."}
                    },
                    "required": ["application_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "send_tour_reminder",
                "description": "Send a tour reminder via WhatsApp to a prospect 24 hours before their scheduled property viewing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tour_id": {"type": "string", "description": "UUID of the tour schedule entry."}
                    },
                    "required": ["tour_id"]
                }
            }
        }),
        // Sprint 3: Dynamic Pricing tools
        json!({
            "type": "function",
            "function": {
                "name": "fetch_market_data",
                "description": "Store a market data snapshot with competitor rates, demand indices, and local market averages. Returns 14-day market summary.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "property_id": {"type": "string", "description": "Optional property UUID to scope the snapshot."},
                        "source": {"type": "string", "enum": ["manual", "ical_import", "api_scrape", "competitor_feed"], "default": "manual"},
                        "competitor_name": {"type": "string", "description": "Name of the competitor."},
                        "competitor_rate": {"type": "number", "description": "Competitor nightly rate."},
                        "local_avg_rate": {"type": "number", "description": "Local market average nightly rate."},
                        "demand_index": {"type": "number", "description": "Demand index (0-1 scale)."},
                        "event_indicator": {"type": "string", "description": "Special event name driving demand."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "simulate_rate_impact",
                "description": "Simulate the revenue impact of a rate change for a specific unit. Projects occupancy shift, revenue delta, and RevPAR comparison using price elasticity model.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string", "description": "UUID of the unit."},
                        "proposed_rate": {"type": "number", "description": "Proposed nightly rate to simulate."},
                        "period_days": {"type": "integer", "minimum": 7, "maximum": 180, "default": 30, "description": "Simulation period in days."}
                    },
                    "required": ["unit_id", "proposed_rate"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "score_application",
                "description": "Score a rental application using rule-based screening: income-to-rent ratio, employment stability, reference quality. Returns 0-100 score with breakdown.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "UUID of the application to score."}
                    },
                    "required": ["application_id"]
                }
            }
        }),
        // --- Phase 3: Maintenance ---
        json!({
            "type": "function",
            "function": {
                "name": "classify_maintenance_request",
                "description": "Use AI to classify a maintenance request by urgency (critical/high/medium/low) and category (plumbing/electrical/structural/appliance/pest/general).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string", "description": "UUID of the maintenance request."}
                    },
                    "required": ["request_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "auto_assign_maintenance",
                "description": "Automatically assign a maintenance request to the best-fit staff member or vendor based on availability, specialization, and past performance.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string", "description": "UUID of the maintenance request."},
                        "category": {"type": "string", "description": "Maintenance category for matching."}
                    },
                    "required": ["request_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "check_maintenance_sla",
                "description": "Check SLA compliance for open maintenance requests. Returns breached and at-risk items.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "escalate_maintenance",
                "description": "Escalate a maintenance request that has breached SLA by re-assigning or notifying the manager.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string", "description": "UUID of the maintenance request."},
                        "reason": {"type": "string", "description": "Reason for escalation."}
                    },
                    "required": ["request_id", "reason"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "request_vendor_quote",
                "description": "Request a quote from a vendor for a maintenance job.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "vendor_id": {"type": "string", "description": "UUID of the vendor."},
                        "request_id": {"type": "string", "description": "UUID of the maintenance request."},
                        "description": {"type": "string", "description": "Work description for the quote."}
                    },
                    "required": ["vendor_id", "request_id", "description"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "select_vendor",
                "description": "Select a vendor from the roster for a maintenance job based on specialization and availability.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "description": "Maintenance category to match vendors."},
                        "urgency": {"type": "string", "enum": ["critical", "high", "medium", "low"]}
                    },
                    "required": ["category"]
                }
            }
        }),
        // --- Sprint 4: Self-Driving Maintenance (new tools) ---
        json!({
            "type": "function",
            "function": {
                "name": "dispatch_to_vendor",
                "description": "Dispatch a maintenance request to a vendor by creating a work order and sending WhatsApp notification.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string", "description": "UUID of the maintenance request."},
                        "vendor_id": {"type": "string", "description": "UUID of the vendor to dispatch to."},
                        "description": {"type": "string", "description": "Optional work description override."},
                        "priority": {"type": "string", "enum": ["critical", "high", "medium", "low"], "default": "medium"},
                        "estimated_cost": {"type": "number", "description": "Estimated cost of the work."}
                    },
                    "required": ["request_id", "vendor_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "verify_completion",
                "description": "Verify completion of a vendor work order. Marks verified or rejected and updates vendor stats.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "work_order_id": {"type": "string", "description": "UUID of the work order to verify."},
                        "verified": {"type": "boolean", "description": "Whether the work is satisfactorily completed.", "default": true},
                        "rating": {"type": "integer", "description": "Rating 1-5 for vendor performance."},
                        "notes": {"type": "string", "description": "Staff notes on the verification."}
                    },
                    "required": ["work_order_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_vendor_performance",
                "description": "Get vendor performance metrics: rating, completion rate, response time, active jobs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "vendor_id": {"type": "string", "description": "Optional UUID of a specific vendor. Omit to get all active vendors."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "analyze_inspection_photos",
                "description": "Analyze inspection photos using Vision AI to assess condition, identify defects, and generate recommendations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string", "description": "UUID of the unit being inspected."},
                        "photo_urls": {"type": "array", "items": {"type": "string"}, "description": "URLs of inspection photos."},
                        "inspection_type": {"type": "string", "enum": ["move_in", "move_out", "routine", "damage"], "default": "routine"}
                    },
                    "required": ["unit_id", "photo_urls"]
                }
            }
        }),
        // --- Sprint 5: Vision AI additional tools ---
        json!({
            "type": "function",
            "function": {
                "name": "compare_inspections",
                "description": "Compare a current inspection against a baseline (move-in) inspection to highlight degradation per room.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "current_report_id": {"type": "string", "description": "UUID of the current inspection report."},
                        "baseline_report_id": {"type": "string", "description": "Optional UUID of the baseline report. Auto-finds move-in baseline if omitted."},
                        "unit_id": {"type": "string", "description": "UUID of the unit (used to find latest inspection if current_report_id omitted)."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_defect_tickets",
                "description": "Auto-create maintenance request tickets from defects found in an inspection report.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "report_id": {"type": "string", "description": "UUID of the inspection report."},
                        "min_severity": {"type": "string", "enum": ["low", "medium", "high", "critical"], "default": "medium", "description": "Minimum defect severity to create tickets for."}
                    },
                    "required": ["report_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "verify_cleaning",
                "description": "Analyze post-cleaning photos to verify cleaning quality. Returns pass/fail with cleanliness score.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string", "description": "UUID of the unit to verify."},
                        "photo_urls": {"type": "array", "items": {"type": "string"}, "description": "URLs of post-cleaning photos."}
                    },
                    "required": ["unit_id", "photo_urls"]
                }
            }
        }),
        // --- Phase 4: Financial & Compliance ---
        json!({
            "type": "function",
            "function": {
                "name": "auto_reconcile_all",
                "description": "Automatically reconcile all pending collections by scanning for matching payments.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format (optional, defaults to current)."}
                    }
                }
            }
        }),
        // --- Sprint 6: Cognitive Financial Reconciliation ---
        json!({
            "type": "function",
            "function": {
                "name": "import_bank_transactions",
                "description": "Import bank transactions from CSV data (as JSON array). Skips duplicates by external_id.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "transactions": {"type": "array", "description": "Array of transaction objects with date, description, amount, reference, currency."},
                        "bank_name": {"type": "string", "description": "Name of the bank (e.g., Continental, Itau, BBVA)."}
                    },
                    "required": ["transactions"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "auto_reconcile_batch",
                "description": "Run multi-pass auto-reconciliation: exact reference, amount+date, fuzzy name matching. Returns match statistics.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "period_month": {"type": "string", "description": "Month in YYYY-MM format (optional)."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "handle_split_payment",
                "description": "Match multiple bank transactions to a single collection record (split payment).",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "collection_id": {"type": "string", "description": "UUID of the collection record."},
                        "transaction_ids": {"type": "array", "items": {"type": "string"}, "description": "Array of bank transaction UUIDs."}
                    },
                    "required": ["collection_id", "transaction_ids"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "abstract_lease_document",
                "description": "Extract key terms from a lease PDF document: parties, dates, amounts, clauses, and obligations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string", "description": "UUID of the knowledge document containing the lease PDF."},
                        "lease_id": {"type": "string", "description": "Optional UUID of the lease to link extracted terms to."}
                    },
                    "required": ["document_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "check_lease_compliance",
                "description": "Check a lease for compliance issues: missing clauses, expired terms, regulatory gaps.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lease_id": {"type": "string", "description": "UUID of the lease to check."}
                    },
                    "required": ["lease_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "check_document_expiry",
                "description": "Scan for documents approaching expiry and flag those requiring renewal.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "days_ahead": {"type": "integer", "minimum": 1, "maximum": 180, "default": 30}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "check_paraguayan_compliance",
                "description": "Check a lease against Paraguayan law (Civil Code, IVA, RUC, guarantor, notice period, minimum term). Requires abstraction to exist.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lease_id": {"type": "string", "description": "UUID of the lease to check against Paraguayan regulations."}
                    },
                    "required": ["lease_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "track_lease_deadlines",
                "description": "Create deadline alerts for all critical lease dates: expiry, renewal notice, insurance, inspections. Returns all alerts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lease_id": {"type": "string", "description": "UUID of the lease to track deadlines for."}
                    },
                    "required": ["lease_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "auto_populate_lease_charges",
                "description": "Auto-create lease charges (rent, deposit, IVA, common expenses) from abstracted lease terms.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lease_id": {"type": "string", "description": "UUID of the lease to populate charges for."}
                    },
                    "required": ["lease_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_regulatory_guidance",
                "description": "Search the knowledge base for regulatory guidance relevant to a specific topic (e.g., Paraguayan rental law).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "description": "The regulatory topic to search for."}
                    },
                    "required": ["topic"]
                }
            }
        }),
        // --- Phase 5: Portfolio Intelligence ---
        json!({
            "type": "function",
            "function": {
                "name": "get_portfolio_kpis",
                "description": "Get cross-property portfolio KPIs: total units, occupancy, revenue, NOI, RevPAR.",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_property_comparison",
                "description": "Compare performance metrics across properties in the portfolio.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string", "enum": ["revenue", "occupancy", "noi", "expenses"], "default": "revenue"},
                        "period_days": {"type": "integer", "minimum": 7, "maximum": 365, "default": 30}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "simulate_investment_scenario",
                "description": "Run a parametric financial simulation: project cash flows, NOI, and ROI over N months given base data and adjustments.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "base_monthly_revenue": {"type": "number", "description": "Current monthly revenue."},
                        "base_monthly_expenses": {"type": "number", "description": "Current monthly expenses."},
                        "revenue_growth_pct": {"type": "number", "description": "Monthly revenue growth percentage."},
                        "expense_growth_pct": {"type": "number", "description": "Monthly expense growth percentage."},
                        "investment_amount": {"type": "number", "description": "Upfront investment amount."},
                        "projection_months": {"type": "integer", "minimum": 1, "maximum": 120, "default": 12}
                    },
                    "required": ["base_monthly_revenue", "base_monthly_expenses"]
                }
            }
        }),
        // --- Sprint 9: Portfolio Intelligence ---
        json!({
            "type": "function",
            "function": {
                "name": "get_portfolio_trends",
                "description": "Get N-month KPI trends (revenue, occupancy, NOI, RevPAR) from portfolio snapshots. Shows month-over-month growth.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "months": {"type": "integer", "minimum": 1, "maximum": 24, "default": 12}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_property_heatmap",
                "description": "Rank properties by performance, identify outliers (above/below average), with revenue, occupancy, NOI per property.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string", "enum": ["revenue", "occupancy", "noi"], "default": "revenue"},
                        "period_days": {"type": "integer", "minimum": 7, "maximum": 365, "default": 30}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "generate_performance_digest",
                "description": "Generate a structured weekly or monthly performance digest with KPIs, period-over-period comparison, and maintenance stats.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "digest_type": {"type": "string", "enum": ["weekly", "monthly"], "default": "weekly"}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "simulate_renovation_roi",
                "description": "Project ROI for a renovation: payback period, cumulative gains over N years, accounting for vacancy during renovation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "renovation_cost": {"type": "number", "description": "Total renovation cost."},
                        "current_monthly_rent": {"type": "number", "description": "Current monthly rent before renovation."},
                        "projected_monthly_rent": {"type": "number", "description": "Expected monthly rent after renovation."},
                        "vacancy_months_during_renovation": {"type": "number", "description": "Months vacant during renovation.", "default": 1},
                        "projection_years": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}
                    },
                    "required": ["renovation_cost", "current_monthly_rent", "projected_monthly_rent"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "simulate_stress_test",
                "description": "Stress test the portfolio: simulate a market downturn with occupancy drop, rate reduction, and expense increase over N months.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "base_monthly_revenue": {"type": "number", "description": "Current monthly revenue."},
                        "base_monthly_expenses": {"type": "number", "description": "Current monthly expenses."},
                        "occupancy_drop_pct": {"type": "number", "description": "Occupancy reduction in percentage.", "default": 20},
                        "rate_drop_pct": {"type": "number", "description": "Rate reduction in percentage.", "default": 10},
                        "expense_increase_pct": {"type": "number", "description": "Expense increase in percentage.", "default": 5},
                        "duration_months": {"type": "integer", "minimum": 1, "maximum": 24, "default": 6}
                    },
                    "required": ["base_monthly_revenue", "base_monthly_expenses"]
                }
            }
        }),
        // --- Sprint 7: Voice Agent tools ---
        json!({
            "type": "function",
            "function": {
                "name": "voice_lookup_caller",
                "description": "Look up a caller by phone number in guest and tenant records.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone": {"type": "string", "description": "Phone number (E.164 format preferred)."}
                    },
                    "required": ["phone"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "voice_create_maintenance_request",
                "description": "Create a maintenance request from a voice call interaction.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short title for the request."},
                        "description": {"type": "string", "description": "Detailed description of the issue."},
                        "caller_phone": {"type": "string", "description": "Caller's phone number."},
                        "unit_id": {"type": "string", "description": "UUID of the unit if known."},
                        "urgency": {"type": "string", "enum": ["critical", "high", "medium", "low"], "default": "medium"}
                    },
                    "required": ["description"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "voice_check_reservation",
                "description": "Look up upcoming or active reservations for a caller by phone or guest name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone": {"type": "string", "description": "Caller's phone number."},
                        "guest_name": {"type": "string", "description": "Guest name to search."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "log_voice_interaction",
                "description": "Log a completed voice interaction with summary and actions taken.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "caller_phone": {"type": "string", "description": "Caller's phone number."},
                        "summary": {"type": "string", "description": "Summary of the interaction."},
                        "duration_seconds": {"type": "integer", "description": "Call duration in seconds."},
                        "language": {"type": "string", "enum": ["es", "en"], "default": "es"},
                        "actions_taken": {"type": "array", "items": {"type": "string"}, "description": "Actions performed during the call."},
                        "direction": {"type": "string", "enum": ["inbound", "outbound"], "default": "inbound"}
                    }
                }
            }
        }),
        // --- Sprint 10: IoT & Smart Lock tools ---
        json!({
            "type": "function",
            "function": {
                "name": "generate_access_code",
                "description": "Generate a time-limited access code for a smart lock on a unit. Supports temporary, permanent, one-time codes.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string", "description": "UUID of the unit to generate code for."},
                        "reservation_id": {"type": "string", "description": "Optional reservation UUID to link."},
                        "lease_id": {"type": "string", "description": "Optional lease UUID to link."},
                        "guest_name": {"type": "string"},
                        "guest_phone": {"type": "string"},
                        "valid_hours": {"type": "integer", "default": 72, "description": "Hours the code is valid."},
                        "code_type": {"type": "string", "enum": ["temporary", "permanent", "one_time", "recurring"], "default": "temporary"}
                    },
                    "required": ["unit_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "send_access_code",
                "description": "Send an existing access code to the guest via WhatsApp, SMS, or email.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code_id": {"type": "string", "description": "UUID of the access code to send."},
                        "send_via": {"type": "string", "enum": ["whatsapp", "sms", "email"], "default": "whatsapp"}
                    },
                    "required": ["code_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "revoke_access_code",
                "description": "Revoke an access code by ID, or revoke all active codes for a unit.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code_id": {"type": "string", "description": "UUID of the access code to revoke."},
                        "unit_id": {"type": "string", "description": "UUID of the unit to revoke all codes for."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "process_sensor_event",
                "description": "Process an IoT sensor event: store reading, check thresholds, auto-create maintenance tickets for critical alerts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "device_id": {"type": "string", "description": "UUID of the IoT device."},
                        "event_type": {"type": "string", "enum": ["reading", "alert", "status_change", "lock_action", "battery_low", "offline"]},
                        "value": {"type": "number", "description": "Sensor reading value."},
                        "unit_of_measure": {"type": "string", "description": "Unit of measure (%, °C, etc.)."},
                        "description": {"type": "string"}
                    },
                    "required": ["device_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_device_status",
                "description": "Get IoT device status summary: online/offline counts, battery levels. Optionally filter by type or unit.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "device_type": {"type": "string", "description": "Filter by device type."},
                        "unit_id": {"type": "string", "description": "Filter by unit UUID."}
                    }
                }
            }
        }),
        // --- Sprint 12: Autonomous Operations ---
        json!({
            "type": "function",
            "function": {
                "name": "evaluate_agent_response",
                "description": "Evaluate an agent's response quality with accuracy, helpfulness, and safety scores. Stores evaluation for health tracking.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_slug": {"type": "string", "description": "The agent being evaluated."},
                        "chat_id": {"type": "string", "description": "Optional chat session ID."},
                        "accuracy_score": {"type": "number", "minimum": 0, "maximum": 1, "description": "How factually accurate was the response (0-1)."},
                        "helpfulness_score": {"type": "number", "minimum": 0, "maximum": 1, "description": "How helpful was the response (0-1)."},
                        "safety_score": {"type": "number", "minimum": 0, "maximum": 1, "description": "How safe was the response (0-1). Default 1.0."},
                        "latency_ms": {"type": "integer", "description": "Response latency in milliseconds."},
                        "cost_estimate": {"type": "number", "description": "Estimated cost in USD."},
                        "model_used": {"type": "string", "description": "Model identifier used."}
                    },
                    "required": ["agent_slug", "accuracy_score", "helpfulness_score"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_agent_health",
                "description": "Get agent health metrics: success rates, average scores, latency, cost, and daily trends.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "days": {"type": "integer", "minimum": 1, "maximum": 90, "default": 30, "description": "Number of days to look back (default 30)."}
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "execute_playbook",
                "description": "Execute an agent playbook: a sequence of steps (messages or tool calls) run by a designated agent.",
                "needsApproval": true,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "playbook_id": {"type": "string", "description": "UUID of the playbook to execute."}
                    },
                    "required": ["playbook_id"]
                }
            }
        }),
        // --- Sprint 11: Predictive Intelligence ---
        json!({
            "type": "function",
            "function": {
                "name": "get_risk_radar",
                "description": "Get aggregated risk radar: predicted risks across all categories (tenant, demand, maintenance, churn, pricing, anomaly) with 30-day demand outlook.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "forecast_demand",
                "description": "Generate demand forecasts for the next N days using historical reservation patterns. Predicts occupancy, ADR, and demand level per date.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "days_ahead": {"type": "integer", "minimum": 7, "maximum": 180, "default": 90, "description": "Number of days to forecast (default 90)."},
                        "unit_id": {"type": "string", "description": "Optional unit UUID to forecast a specific unit. Omit for org-wide forecast."}
                    }
                }
            }
        }),
    ];

    let Some(allowed_tools) = allowed_tools else {
        return definitions;
    };

    let allowed = allowed_tools
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();
    if allowed.is_empty() {
        return definitions;
    }

    definitions
        .into_iter()
        .filter(|definition| {
            definition
                .as_object()
                .and_then(|obj| obj.get("function"))
                .and_then(Value::as_object)
                .and_then(|obj| obj.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|name| allowed.contains(name))
        })
        .collect()
}

pub struct ToolContext<'a> {
    pub org_id: &'a str,
    pub role: &'a str,
    pub allow_mutations: bool,
    pub confirm_write: bool,
    pub allowed_tools: Option<&'a [String]>,
    pub agent_slug: Option<&'a str>,
    pub chat_id: Option<&'a str>,
    pub requested_by_user_id: Option<&'a str>,
    pub approved_execution: bool,
}

pub async fn execute_tool(
    state: &AppState,
    tool_name: &str,
    args: &Map<String, Value>,
    context: ToolContext<'_>,
) -> AppResult<Value> {
    if let Some(allowed_tools) = context.allowed_tools {
        let allowed = allowed_tools
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<BTreeSet<_>>();
        if !allowed.is_empty() && !allowed.contains(tool_name) {
            return Ok(json!({
                "ok": false,
                "error": format!("Tool '{}' is not enabled for this agent.", tool_name),
            }));
        }
    }

    if let Err(validation_error) = validate_tool_args(tool_name, args) {
        return Ok(normalized_tool_error(
            validation_error.code,
            validation_error.message,
            false,
            validation_error.hint,
        ));
    }

    // --- Guardrails ---
    // Content moderation: block send_message with prohibited keywords
    if tool_name == "send_message" && !context.approved_execution {
        let body = args
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        const BLOCKED_KEYWORDS: &[&str] = &[
            "password",
            "credit card",
            "ssn",
            "social security",
            "bank account number",
            "wire transfer instructions",
        ];
        for kw in BLOCKED_KEYWORDS {
            if body.contains(kw) {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Message blocked: contains sensitive keyword '{}'.", kw),
                    "guardrail": "content_moderation",
                }));
            }
        }
    }

    // Dollar amount guardrail: pricing changes > threshold create approval instead
    if tool_name == "apply_pricing_recommendation" && !context.approved_execution {
        if let Some(pool) = state.db_pool.as_ref() {
            let rec_id = args
                .get("recommendation_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !rec_id.is_empty() {
                let maybe_delta = sqlx::query_scalar::<_, Option<f64>>(
                    "SELECT ABS(pr.recommended_price - pt.base_price) / NULLIF(pt.base_price, 0)
                     FROM pricing_recommendations pr
                     JOIN pricing_templates pt ON pt.id = pr.pricing_template_id
                     WHERE pr.id = $1::uuid",
                )
                .bind(rec_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten()
                .flatten();

                if let Some(delta) = maybe_delta {
                    if delta > 0.15 {
                        // Auto-create approval for large pricing changes
                        let _ = sqlx::query(
                            "INSERT INTO agent_approvals (organization_id, agent_slug, tool_name, tool_args, status, reason, created_at)
                             VALUES ($1::uuid, $2, $3, $4, 'pending',
                                     'Pricing change exceeds 15% threshold — requires human approval.', now())",
                        )
                        .bind(context.org_id)
                        .bind(context.agent_slug.unwrap_or("supervisor"))
                        .bind(tool_name)
                        .bind(json!(args))
                        .execute(pool)
                        .await;

                        return Ok(json!({
                            "ok": false,
                            "error": "Pricing change exceeds 15% — routed to approval queue.",
                            "guardrail": "price_threshold",
                            "delta_pct": (delta * 100.0).round() / 100.0,
                        }));
                    }
                }
            }
        }
    }

    // S17: DB-backed rate limiting — survives restarts, works across instances
    if let Some(agent_slug) = context.agent_slug {
        if let Ok(pool) = db_pool(state) {
            if let Err(err_val) = check_rate_limit(pool, context.org_id, agent_slug).await {
                return Ok(err_val);
            }
        }
    }

    match tool_name {
        "list_tables" => Ok(json!({ "ok": true, "tables": list_supported_tables() })),
        "get_org_snapshot" => tool_get_org_snapshot(state, context.org_id).await,
        "list_rows" => tool_list_rows(state, context.org_id, args).await,
        "get_row" => tool_get_row(state, context.org_id, args).await,
        "create_row" => tool_create_row(state, &context, args).await,
        "update_row" => tool_update_row(state, &context, args).await,
        "delete_row" => tool_delete_row(state, &context, args).await,
        "delegate_to_agent" => {
            tool_delegate_to_agent(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        "get_occupancy_forecast" => tool_get_occupancy_forecast(state, context.org_id, args).await,
        "get_anomaly_alerts" => tool_get_anomaly_alerts(state, context.org_id).await,
        "get_today_ops_brief" => tool_get_today_ops_brief(state, context.org_id).await,
        "get_lease_risk_summary" => tool_get_lease_risk_summary(state, context.org_id).await,
        "get_collections_risk" => tool_get_collections_risk(state, context.org_id).await,
        "get_owner_statement_summary" => {
            tool_get_owner_statement_summary(state, context.org_id).await
        }
        "search_knowledge" => tool_search_knowledge(state, context.org_id, args).await,
        "send_message" => tool_send_message(state, context.org_id, args).await,
        "get_staff_availability" => tool_get_staff_availability(state, context.org_id).await,
        "create_maintenance_task" => {
            tool_create_maintenance_task(state, context.org_id, args).await
        }
        "get_revenue_analytics" => tool_get_revenue_analytics(state, context.org_id, args).await,
        "get_seasonal_demand" => tool_get_seasonal_demand(state, context.org_id, args).await,
        "generate_owner_statement" => {
            tool_generate_owner_statement(state, context.org_id, args).await
        }
        "reconcile_collections" => tool_reconcile_collections(state, context.org_id, args).await,
        "categorize_expense" => tool_categorize_expense(state, context.org_id, args).await,
        "classify_and_delegate" => {
            tool_classify_and_delegate(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                context.agent_slug,
                args,
            )
            .await
        }
        "recall_memory" => {
            tool_recall_memory(state, context.org_id, context.agent_slug, args).await
        }
        "store_memory" => tool_store_memory(state, context.org_id, context.agent_slug, args).await,
        // Phase 1: Planning & Decomposition
        "check_escalation_thresholds" => {
            tool_check_escalation_thresholds(state, context.org_id, context.agent_slug, args).await
        }
        "create_execution_plan" => tool_create_execution_plan(args),
        "summarize_conversation" => tool_summarize_conversation(args),
        // Phase 2: Leasing & Revenue
        "advance_application_stage" => {
            crate::services::leasing_agent::tool_advance_application_stage(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "schedule_property_viewing" => {
            crate::services::leasing_agent::tool_schedule_property_viewing(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "generate_lease_offer" => {
            crate::services::leasing_agent::tool_generate_lease_offer(state, context.org_id, args)
                .await
        }
        "send_application_update" => {
            crate::services::leasing_agent::tool_send_application_update(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "match_applicant_to_units" => {
            crate::services::leasing_agent::tool_match_applicant_to_units(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "auto_qualify_lead" => {
            crate::services::leasing_agent::tool_auto_qualify_lead(state, context.org_id, args)
                .await
        }
        "send_tour_reminder" => {
            crate::services::leasing_agent::tool_send_tour_reminder(state, context.org_id, args)
                .await
        }
        "generate_pricing_recommendations" => {
            crate::services::dynamic_pricing::tool_generate_pricing_recommendations(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "apply_pricing_recommendation" => {
            crate::services::dynamic_pricing::tool_apply_pricing_recommendation(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "fetch_market_data" => {
            crate::services::dynamic_pricing::tool_fetch_market_data(state, context.org_id, args)
                .await
        }
        "simulate_rate_impact" => {
            crate::services::dynamic_pricing::tool_simulate_rate_impact(state, context.org_id, args)
                .await
        }
        "score_application" => {
            crate::services::tenant_screening::tool_score_application(state, context.org_id, args)
                .await
        }
        // Phase 3: Maintenance
        "classify_maintenance_request" => {
            crate::services::maintenance_dispatch::tool_classify_maintenance_request(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "auto_assign_maintenance" => {
            crate::services::maintenance_dispatch::tool_auto_assign_maintenance(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "check_maintenance_sla" => {
            crate::services::maintenance_dispatch::tool_check_maintenance_sla(state, context.org_id)
                .await
        }
        "escalate_maintenance" => {
            crate::services::maintenance_dispatch::tool_escalate_maintenance(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "request_vendor_quote" => {
            crate::services::maintenance_dispatch::tool_request_vendor_quote(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "select_vendor" => {
            crate::services::maintenance_dispatch::tool_select_vendor(state, context.org_id, args)
                .await
        }
        "dispatch_to_vendor" => {
            crate::services::maintenance_dispatch::tool_dispatch_to_vendor(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "verify_completion" => {
            crate::services::maintenance_dispatch::tool_verify_completion(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "get_vendor_performance" => {
            crate::services::maintenance_dispatch::tool_get_vendor_performance(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "analyze_inspection_photos" => {
            crate::services::vision_ai::tool_analyze_inspection_photos(state, context.org_id, args)
                .await
        }
        "compare_inspections" => {
            crate::services::vision_ai::tool_compare_inspections(state, context.org_id, args).await
        }
        "create_defect_tickets" => {
            crate::services::vision_ai::tool_create_defect_tickets(state, context.org_id, args)
                .await
        }
        "verify_cleaning" => {
            crate::services::vision_ai::tool_verify_cleaning(state, context.org_id, args).await
        }
        // Phase 4: Financial & Compliance
        "auto_reconcile_all" => {
            crate::services::reconciliation::tool_auto_reconcile_all(state, context.org_id, args)
                .await
        }
        "import_bank_transactions" => {
            crate::services::reconciliation::tool_import_bank_transactions(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "auto_reconcile_batch" => {
            crate::services::reconciliation::tool_auto_reconcile_batch(state, context.org_id, args)
                .await
        }
        "handle_split_payment" => {
            crate::services::reconciliation::tool_handle_split_payment(state, context.org_id, args)
                .await
        }
        "abstract_lease_document" => {
            crate::services::lease_abstraction::tool_abstract_lease_document(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "check_lease_compliance" => {
            crate::services::lease_abstraction::tool_check_lease_compliance(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "check_document_expiry" => {
            crate::services::lease_abstraction::tool_check_document_expiry(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "check_paraguayan_compliance" => {
            crate::services::lease_abstraction::tool_check_paraguayan_compliance(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "track_lease_deadlines" => {
            crate::services::lease_abstraction::tool_track_lease_deadlines(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "auto_populate_lease_charges" => {
            crate::services::lease_abstraction::tool_auto_populate_lease_charges(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "get_regulatory_guidance" => tool_search_knowledge(state, context.org_id, args).await,
        // Phase 5: Portfolio Intelligence
        "get_portfolio_kpis" => {
            crate::services::portfolio::tool_get_portfolio_kpis(state, context.org_id).await
        }
        "get_property_comparison" => {
            crate::services::portfolio::tool_get_property_comparison(state, context.org_id, args)
                .await
        }
        "simulate_investment_scenario" => {
            crate::services::scenario_simulation::tool_simulate_investment_scenario(args)
        }
        "get_portfolio_trends" => {
            crate::services::portfolio::tool_get_portfolio_trends(state, context.org_id, args).await
        }
        "get_property_heatmap" => {
            crate::services::portfolio::tool_get_property_heatmap(state, context.org_id, args).await
        }
        "generate_performance_digest" => {
            crate::services::portfolio::tool_generate_performance_digest(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "simulate_renovation_roi" => {
            crate::services::scenario_simulation::tool_simulate_renovation_roi(args)
        }
        "simulate_stress_test" => {
            crate::services::scenario_simulation::tool_simulate_stress_test(args)
        }
        // Sprint 7: Voice Agent
        "voice_lookup_caller" => {
            crate::services::voice_agent::tool_voice_lookup_caller(state, context.org_id, args)
                .await
        }
        "voice_create_maintenance_request" => {
            crate::services::voice_agent::tool_voice_create_maintenance_request(
                state,
                context.org_id,
                args,
            )
            .await
        }
        "voice_check_reservation" => {
            crate::services::voice_agent::tool_voice_check_reservation(state, context.org_id, args)
                .await
        }
        "log_voice_interaction" => {
            crate::services::voice_agent::tool_log_voice_interaction(state, context.org_id, args)
                .await
        }
        // Sprint 10: IoT
        "generate_access_code" => {
            crate::services::iot::tool_generate_access_code(state, context.org_id, args).await
        }
        "send_access_code" => {
            crate::services::iot::tool_send_access_code(state, context.org_id, args).await
        }
        "revoke_access_code" => {
            crate::services::iot::tool_revoke_access_code(state, context.org_id, args).await
        }
        "process_sensor_event" => {
            crate::services::iot::tool_process_sensor_event(state, context.org_id, args).await
        }
        "get_device_status" => {
            crate::services::iot::tool_get_device_status(state, context.org_id, args).await
        }
        // Sprint 11: Predictive Intelligence
        "get_risk_radar" => {
            crate::services::tenant_screening::tool_get_risk_radar(state, context.org_id, args)
                .await
        }
        "forecast_demand" => {
            crate::services::tenant_screening::tool_forecast_demand(state, context.org_id, args)
                .await
        }
        // Sprint 12: Autonomous Operations
        "evaluate_agent_response" => {
            tool_evaluate_agent_response(state, context.org_id, args).await
        }
        "get_agent_health" => tool_get_agent_health(state, context.org_id, args).await,
        "execute_playbook" => {
            tool_execute_playbook(
                state,
                context.org_id,
                context.role,
                context.allow_mutations,
                context.confirm_write,
                args,
            )
            .await
        }
        _ => Ok(json!({
            "ok": false,
            "error": format!("Unknown tool: {tool_name}"),
        })),
    }
}

async fn tool_list_rows(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    let org_column = table_cfg.org_column;
    let limit = coerce_limit(args.get("limit"), 30);
    let order_by = args
        .get("order_by")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("created_at");
    let ascending = args
        .get("ascending")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let filters = normalize_json_object(args.get("filters"), "filters")?;

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let order_name = validate_identifier(order_by)?;

    let mut query = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ");
    query.push(table_name).push(" t WHERE 1=1");
    query
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(org_column)
        .push(") = ")
        .push_bind(org_id);

    for (key, value) in filters {
        let column = key.trim();
        if column.is_empty() || column == org_column {
            continue;
        }
        apply_filter(&mut query, column, &value)?;
    }

    query.push(" ORDER BY t.").push(order_name);
    if ascending {
        query.push(" ASC");
    } else {
        query.push(" DESC");
    }
    query.push(" LIMIT ").push_bind(limit);

    let rows = query
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| db_error(state, &error))?;

    let data = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "table": table,
        "rows": data,
    }))
}

async fn tool_get_row(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    let org_column = table_cfg.org_column;

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let row = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(org_column)
        .push(") = ")
        .push_bind(org_id)
        .push(" LIMIT 1")
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| db_error(state, &error))?;

    let payload = row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten());
    if let Some(row) = payload {
        return Ok(json!({ "ok": true, "table": table, "row": row }));
    }

    Ok(json!({
        "ok": false,
        "error": format!("No record found in {table}."),
    }))
}

/// Check if an approval is required by policy and enqueue it.
/// Returns Some(json) for pending approval, or None to proceed immediately.
async fn maybe_create_approval(
    state: &AppState,
    context: &ToolContext<'_>,
    tool_name: &str,
    args: &Map<String, Value>,
) -> AppResult<Option<Value>> {
    if context.approved_execution {
        return Ok(None);
    }
    if !is_mutation_tool(tool_name) {
        return Ok(None);
    }
    if !approval_required_by_policy(state, context.org_id, tool_name).await {
        return Ok(None);
    }

    let pool = match state.db_pool.as_ref() {
        Some(pool) => pool,
        None => return Ok(None),
    };

    let approval = sqlx::query(
        "INSERT INTO agent_approvals (
            organization_id,
            chat_id,
            agent_slug,
            tool_name,
            tool_args,
            status,
            requested_by
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'pending', $6::uuid)
         RETURNING id::text AS id",
    )
    .bind(context.org_id)
    .bind(context.chat_id)
    .bind(context.agent_slug.unwrap_or("system"))
    .bind(tool_name)
    .bind(Value::Object(args.clone()))
    .bind(context.requested_by_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let approval_id = approval
        .and_then(|row| row.try_get::<Option<String>, _>("id").ok().flatten())
        .unwrap_or_default();

    Ok(Some(json!({
        "ok": true,
        "status": "pending_approval",
        "approval_id": approval_id,
        "tool": tool_name,
        "message": "This action requires human approval and has been queued.",
    })))
}

fn is_mutation_tool(tool_name: &str) -> bool {
    MUTATION_TOOLS.contains(&tool_name)
}

async fn approval_required_by_policy(state: &AppState, org_id: &str, tool_name: &str) -> bool {
    if !is_mutation_tool(tool_name) {
        return false;
    }

    let Some(pool) = state.db_pool.as_ref() else {
        return true;
    };

    let row = sqlx::query(
        "SELECT approval_mode, enabled, auto_approve_threshold, auto_approve_tables
         FROM agent_approval_policies
         WHERE organization_id = $1::uuid
           AND tool_name = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(tool_name)
    .fetch_optional(pool)
    .await;

    let Ok(row) = row else {
        return true;
    };

    let Some(row) = row else {
        return true;
    };

    let enabled = row.try_get::<bool, _>("enabled").unwrap_or(true);
    if !enabled {
        return false;
    }

    let mode = row
        .try_get::<String, _>("approval_mode")
        .unwrap_or_else(|_| "required".to_string());

    // Auto-approve mode: skip approval if confidence exceeds threshold
    if mode.trim().eq_ignore_ascii_case("auto") {
        return false;
    }

    mode.trim().eq_ignore_ascii_case("required")
}

async fn tool_create_row(
    state: &AppState,
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_create {
        return Ok(json!({
            "ok": false,
            "error": format!("Create is not allowed for table '{}'.", table),
        }));
    }

    if let Some(approval) = maybe_create_approval(state, context, "create_row", args).await? {
        return Ok(approval);
    }

    let mut payload = normalize_json_object(args.get("payload"), "payload")?;
    payload = sanitize_mutation_payload(payload);
    payload.insert(
        table_cfg.org_column.to_string(),
        Value::String(context.org_id.to_string()),
    );

    let pool = db_pool(state)?;
    let created = create_row(pool, &table, &payload).await?;

    Ok(json!({
        "ok": true,
        "table": table,
        "row": created,
    }))
}

async fn tool_update_row(
    state: &AppState,
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_update {
        return Ok(json!({
            "ok": false,
            "error": format!("Update is not allowed for table '{}'.", table),
        }));
    }

    if let Some(approval) = maybe_create_approval(state, context, "update_row", args).await? {
        return Ok(approval);
    }

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let payload = normalize_json_object(args.get("payload"), "payload")?;
    let mut safe_payload = sanitize_mutation_payload(payload);
    safe_payload.remove(table_cfg.org_column);
    if safe_payload.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "No updatable fields provided.",
        }));
    }

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let mut keys = safe_payload.keys().cloned().collect::<Vec<_>>();
    keys.sort_unstable();
    for key in &keys {
        let _ = validate_identifier(key)?;
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
    query.push_bind(Value::Object(safe_payload.clone()));
    query
        .push(") r WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(context.org_id)
        .push(" RETURNING row_to_json(t) AS row");

    let row = query
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| db_error(state, &error))?;

    if let Some(row) = row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten()) {
        return Ok(json!({ "ok": true, "table": table, "row": row }));
    }

    Ok(json!({
        "ok": false,
        "error": format!("No matching row found for update in '{}'.", table),
    }))
}

async fn tool_delete_row(
    state: &AppState,
    context: &ToolContext<'_>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let (allowed, detail) =
        assert_mutation_allowed(context.role, context.allow_mutations, context.confirm_write);
    if !allowed {
        return Ok(json!({ "ok": false, "error": detail }));
    }

    let table = normalize_table(args.get("table"))?;
    let table_cfg = table_config(&table)?;
    if !table_cfg.can_delete {
        return Ok(json!({
            "ok": false,
            "error": format!("Delete is not allowed for table '{}'.", table),
        }));
    }

    if let Some(approval) = maybe_create_approval(state, context, "delete_row", args).await? {
        return Ok(approval);
    }

    let row_id = args
        .get("row_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if row_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "row_id is required." }));
    }

    let id_field = args
        .get("id_field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("id");

    let pool = db_pool(state)?;
    let table_name = validate_identifier(&table)?;
    let id_name = validate_identifier(id_field)?;

    let existing = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(context.org_id)
        .push(" LIMIT 1")
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| db_error(state, &error))?
        .and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten());

    let Some(existing) = existing else {
        return Ok(json!({
            "ok": false,
            "error": format!("No matching row found for delete in '{}'.", table),
        }));
    };

    QueryBuilder::<Postgres>::new("DELETE FROM ")
        .push(table_name)
        .push(" t WHERE (to_jsonb(t) ->> ")
        .push_bind(id_name)
        .push(") = ")
        .push_bind(row_id)
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(table_cfg.org_column)
        .push(") = ")
        .push_bind(context.org_id)
        .build()
        .execute(pool)
        .await
        .map_err(|error| db_error(state, &error))?;

    Ok(json!({ "ok": true, "table": table, "row": existing }))
}

async fn tool_get_org_snapshot(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    // Single query with subselects instead of 8 sequential round-trips.
    let row = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::bigint FROM properties WHERE organization_id = $1::uuid) AS properties,
            (SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid) AS units,
            (SELECT COUNT(*)::bigint FROM reservations WHERE organization_id = $1::uuid) AS reservations,
            (SELECT COUNT(*)::bigint FROM tasks WHERE organization_id = $1::uuid) AS tasks,
            (SELECT COUNT(*)::bigint FROM application_submissions WHERE organization_id = $1::uuid) AS application_submissions,
            (SELECT COUNT(*)::bigint FROM leases WHERE organization_id = $1::uuid) AS leases,
            (SELECT COUNT(*)::bigint FROM collection_records WHERE organization_id = $1::uuid) AS collection_records,
            (SELECT COUNT(*)::bigint FROM listings WHERE organization_id = $1::uuid) AS listings",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let mut summary = Map::new();
    for table in [
        "properties",
        "units",
        "reservations",
        "tasks",
        "application_submissions",
        "leases",
        "collection_records",
        "listings",
    ] {
        let count = row.try_get::<i64, _>(table).unwrap_or(0);
        summary.insert(table.to_string(), Value::from(count));
    }

    Ok(json!({ "ok": true, "summary": summary }))
}

async fn tool_delegate_to_agent(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let message = args
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if message.is_empty() {
        return Ok(json!({ "ok": false, "error": "message is required." }));
    }

    // S18: Support parallel multi-agent delegation via agent_slugs array
    let slugs: Vec<String> = if let Some(arr) = args.get("agent_slugs").and_then(Value::as_array) {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect()
    } else if let Some(single) = args
        .get("agent_slug")
        .and_then(Value::as_str)
        .map(str::trim)
    {
        if single.is_empty() {
            return Ok(json!({ "ok": false, "error": "agent_slug or agent_slugs is required." }));
        }
        vec![single.to_string()]
    } else {
        return Ok(json!({ "ok": false, "error": "agent_slug or agent_slugs is required." }));
    };

    if slugs.len() == 1 {
        // Single delegation — existing sequential path
        return delegate_to_single_agent(
            state,
            org_id,
            role,
            allow_mutations,
            confirm_write,
            &slugs[0],
            message,
        )
        .await;
    }

    // Concurrent delegation: run each sub-agent and collect results
    let mut results = Vec::with_capacity(slugs.len());
    for slug in &slugs {
        match delegate_to_single_agent(
            state,
            org_id,
            role,
            allow_mutations,
            confirm_write,
            slug,
            message,
        )
        .await
        {
            Ok(val) => results.push(val),
            Err(e) => results.push(json!({
                "ok": false,
                "delegated_to": slug,
                "error": e.detail_message(),
            })),
        }
    }

    Ok(json!({
        "ok": true,
        "parallel": true,
        "results": results,
    }))
}

async fn delegate_to_single_agent(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    agent_slug: &str,
    message: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let agent_row = sqlx::query_as::<_, (String, String)>(
        "SELECT slug, name FROM ai_agents WHERE slug = $1 AND is_active = true LIMIT 1",
    )
    .bind(agent_slug)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to look up delegate agent");
        AppError::Dependency("Failed to look up delegate agent.".to_string())
    })?;

    let Some((slug, name)) = agent_row else {
        return Ok(
            json!({ "ok": false, "error": format!("Agent '{}' not found or inactive.", agent_slug) }),
        );
    };

    let target_tools = get_agent_spec(&slug)
        .and_then(|spec| spec.allowed_tools)
        .map(|tools| {
            tools
                .iter()
                .map(|value| (*value).to_string())
                .filter(|tool_name| tool_name != "delegate_to_agent")
                .collect::<Vec<_>>()
        });
    let target_prompt = get_agent_spec(&slug).map(|spec| spec.system_prompt);

    let params = RunAiAgentChatParams {
        org_id,
        role,
        message,
        conversation: &[],
        allow_mutations,
        confirm_write,
        agent_name: &name,
        agent_prompt: target_prompt,
        allowed_tools: target_tools.as_deref(),
        agent_slug: Some(&slug),
        chat_id: None,
        requested_by_user_id: None,
        preferred_model: None,
        max_steps_override: None,
        runtime_context: None,
    };

    match Box::pin(run_ai_agent_chat(state, params)).await {
        Ok(result) => {
            let reply = result
                .get("reply")
                .and_then(Value::as_str)
                .unwrap_or("No response from delegate agent.")
                .to_string();
            Ok(json!({
                "ok": true,
                "delegated_to": slug,
                "reply": reply,
            }))
        }
        Err(error) => Ok(json!({
            "ok": false,
            "error": format!("Delegation to '{}' failed: {}", slug, error.detail_message()),
        })),
    }
}

/// Intent-to-agent mapping for automatic delegation.
const INTENT_RULES: &[(&[&str], &str, &str)] = &[
    // (keywords, agent_slug, description)
    (
        &[
            "guest",
            "huésped",
            "check-in",
            "check-out",
            "reservation",
            "reserva",
            "booking",
            "hospedaje",
            "wifi",
            "amenities",
        ],
        "guest-concierge",
        "Guest questions and hospitality",
    ),
    (
        &[
            "maintenance",
            "mantenimiento",
            "repair",
            "reparación",
            "plumbing",
            "plomería",
            "electrical",
            "eléctrico",
            "broken",
            "roto",
            "leak",
            "fuga",
        ],
        "maintenance-triage",
        "Maintenance and repair issues",
    ),
    (
        &[
            "lease",
            "contrato",
            "rent",
            "alquiler",
            "tenant",
            "inquilino",
            "renewal",
            "renovación",
            "eviction",
            "desalojo",
            "deposit",
            "depósito",
        ],
        "leasing-advisor",
        "Leasing and tenant matters",
    ),
    (
        &[
            "payment",
            "pago",
            "collection",
            "cobranza",
            "invoice",
            "factura",
            "revenue",
            "ingreso",
            "expense",
            "gasto",
            "statement",
            "estado de cuenta",
            "financial",
            "financiero",
        ],
        "finance-controller",
        "Financial operations and reporting",
    ),
    (
        &[
            "price",
            "pricing",
            "precio",
            "rate",
            "tarifa",
            "occupancy",
            "ocupación",
            "demand",
            "demanda",
            "revenue management",
        ],
        "pricing-optimizer",
        "Pricing and revenue optimization",
    ),
    (
        &[
            "clean",
            "limpieza",
            "housekeeping",
            "turnover",
            "turnos",
            "inspection",
            "inspección",
        ],
        "operations-coordinator",
        "Operations and housekeeping",
    ),
    (
        &[
            "owner",
            "propietario",
            "landlord",
            "dueño",
            "statement",
            "payout",
            "liquidación",
        ],
        "owner-liaison",
        "Property owner communications",
    ),
    (
        &[
            "compliance",
            "cumplimiento",
            "legal",
            "regulation",
            "regulación",
            "license",
            "licencia",
        ],
        "compliance-monitor",
        "Compliance and regulatory matters",
    ),
];

async fn tool_classify_and_delegate(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    caller_agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let user_message = args
        .get("user_message")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if user_message.is_empty() {
        return Ok(json!({ "ok": false, "error": "user_message is required." }));
    }

    let context_hint = args
        .get("context_hint")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    let search_text = format!("{user_message} {context_hint}").to_lowercase();

    // Check if we have a learned delegation pattern in agent_memory
    let pool = db_pool(state)?;
    let caller_slug = caller_agent_slug.unwrap_or("supervisor");

    // Score each agent by keyword matches — collect all scores for multi-domain detection
    let mut scored_agents: Vec<(&str, usize, &str)> = Vec::new();

    for &(keywords, slug, desc) in INTENT_RULES {
        let score: usize = keywords
            .iter()
            .filter(|kw| search_text.contains(**kw))
            .count();
        if score > 0 {
            scored_agents.push((slug, score, desc));
        }
    }

    // Sort by score descending
    scored_agents.sort_by(|a, b| b.1.cmp(&a.1));

    let mut best_slug = scored_agents.first().map(|a| a.0).unwrap_or("");
    let mut best_score = scored_agents.first().map(|a| a.1).unwrap_or(0);
    let mut best_desc = scored_agents.first().map(|a| a.2).unwrap_or("");

    // Check for learned patterns that might override
    let learned: Option<String> = sqlx::query_scalar(
        "SELECT memory_value FROM agent_memory
         WHERE organization_id = $1::uuid
           AND agent_slug = $2
           AND memory_key = $3
           AND (expires_at IS NULL OR expires_at > now())
         LIMIT 1",
    )
    .bind(org_id)
    .bind(caller_slug)
    .bind(format!(
        "delegation_pattern:{}",
        &search_text[..search_text.len().min(50)]
    ))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(learned_slug) = learned.as_deref().filter(|s| !s.is_empty()) {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM ai_agents WHERE slug = $1 AND is_active = true)",
        )
        .bind(learned_slug)
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        if exists {
            best_slug = learned_slug;
            best_score = 100;
        }
    }

    if best_score == 0 || best_slug.is_empty() {
        best_slug = "guest-concierge";
        best_desc = "Fallback to general-purpose concierge";
        best_score = 1;
    }

    // Multi-domain detection: if 2+ agents scored >= 2 keywords, delegate in parallel
    let multi_domain_agents: Vec<(&str, &str)> = scored_agents
        .iter()
        .filter(|(_, score, _)| *score >= 2)
        .map(|(slug, _, desc)| (*slug, *desc))
        .collect();

    let result = if multi_domain_agents.len() >= 2 && best_score < 100 {
        // Parallel delegation via tokio::join! (max 3 agents)
        let agents_to_delegate: Vec<_> = multi_domain_agents.into_iter().take(3).collect();
        tracing::info!(
            agents = ?agents_to_delegate.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
            "Multi-domain request detected, parallel delegation"
        );

        // Delegate sequentially-but-fast (each is a single DB + LLM round-trip)
        // We avoid tokio::spawn here because we need shared &AppState references
        let mut combined_responses = Vec::new();
        for (agent_slug, desc) in &agents_to_delegate {
            let mut del_args = Map::new();
            del_args.insert(
                "agent_slug".to_string(),
                Value::String(agent_slug.to_string()),
            );
            del_args.insert(
                "message".to_string(),
                Value::String(user_message.to_string()),
            );
            match tool_delegate_to_agent(
                state,
                org_id,
                role,
                allow_mutations,
                confirm_write,
                &del_args,
            )
            .await
            {
                Ok(v) => combined_responses.push(json!({
                    "agent": agent_slug, "domain": desc, "ok": true, "response": v
                })),
                Err(e) => combined_responses.push(json!({
                    "agent": agent_slug, "domain": desc, "ok": false, "error": e.to_string()
                })),
            }
        }

        json!({
            "ok": true,
            "multi_domain": true,
            "delegations": combined_responses,
        })
    } else {
        // Single-agent delegation
        let mut delegate_args = Map::new();
        delegate_args.insert(
            "agent_slug".to_string(),
            Value::String(best_slug.to_string()),
        );
        delegate_args.insert(
            "message".to_string(),
            Value::String(user_message.to_string()),
        );

        let single_result = tool_delegate_to_agent(
            state,
            org_id,
            role,
            allow_mutations,
            confirm_write,
            &delegate_args,
        )
        .await;

        // Fallback: if primary agent fails, try guest-concierge
        match single_result {
            Ok(v) => v,
            Err(e) if best_slug != "guest-concierge" => {
                tracing::warn!(agent = best_slug, error = %e, "Delegation failed, falling back to guest-concierge");
                let mut fallback_args = Map::new();
                fallback_args.insert(
                    "agent_slug".to_string(),
                    Value::String("guest-concierge".to_string()),
                );
                fallback_args.insert(
                    "message".to_string(),
                    Value::String(user_message.to_string()),
                );
                tool_delegate_to_agent(
                    state,
                    org_id,
                    role,
                    allow_mutations,
                    confirm_write,
                    &fallback_args,
                )
                .await?
            }
            Err(e) => return Err(e),
        }
    };

    let delegation_ok = result
        .as_object()
        .and_then(|o| o.get("ok"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    // Store successful delegation pattern for learning
    if delegation_ok {
        let pattern_key = format!(
            "delegation_pattern:{}",
            &search_text[..search_text.len().min(50)]
        );
        let _ = sqlx::query(
            "INSERT INTO agent_memory (organization_id, agent_slug, memory_key, memory_value, context_type, expires_at)
             VALUES ($1::uuid, $2, $3, $4, 'general', now() + interval '90 days')
             ON CONFLICT (organization_id, agent_slug, memory_key)
             DO UPDATE SET memory_value = EXCLUDED.memory_value, expires_at = EXCLUDED.expires_at, updated_at = now()"
        )
        .bind(org_id)
        .bind(caller_slug)
        .bind(&pattern_key)
        .bind(best_slug)
        .execute(pool)
        .await;
    }

    // Enrich the result with classification info
    let mut enriched = result.as_object().cloned().unwrap_or_default();
    enriched.insert(
        "classified_as".to_string(),
        Value::String(best_desc.to_string()),
    );
    enriched.insert(
        "classified_agent".to_string(),
        Value::String(best_slug.to_string()),
    );
    enriched.insert("classification_score".to_string(), json!(best_score));

    Ok(Value::Object(enriched))
}

/// Evaluate an agent's response quality (Sprint 12).
async fn tool_evaluate_agent_response(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let agent_slug = args
        .get("agent_slug")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let chat_id = args
        .get("chat_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let accuracy = args
        .get("accuracy_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    let helpfulness = args
        .get("helpfulness_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    let safety = args
        .get("safety_score")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    let latency_ms = args.get("latency_ms").and_then(Value::as_i64).unwrap_or(0) as i32;
    let cost = args
        .get("cost_estimate")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let model_used = args
        .get("model_used")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    if agent_slug.is_empty() {
        return Ok(json!({ "ok": false, "error": "agent_slug is required." }));
    }

    // Determine overall outcome from scores
    let outcome_type = if accuracy >= 0.7 && helpfulness >= 0.6 && safety >= 0.8 {
        "success"
    } else if safety < 0.5 {
        "safety_concern"
    } else {
        "needs_improvement"
    };

    let rating = ((accuracy * 2.0 + helpfulness * 2.0 + safety * 1.0) / 5.0 * 5.0).round() as i16;
    let rating = rating.clamp(1, 5);

    sqlx::query(
        "INSERT INTO agent_evaluations (organization_id, agent_slug, chat_id, outcome_type, rating, accuracy_score, helpfulness_score, safety_score, latency_ms, cost_estimate, model_used)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(org_id)
    .bind(agent_slug)
    .bind(if chat_id.is_empty() { None } else { Some(chat_id) })
    .bind(outcome_type)
    .bind(rating)
    .bind(accuracy)
    .bind(helpfulness)
    .bind(safety)
    .bind(latency_ms)
    .bind(cost)
    .bind(model_used)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to store agent evaluation");
        AppError::Dependency("Failed to store evaluation.".to_string())
    })?;

    Ok(json!({
        "ok": true,
        "agent_slug": agent_slug,
        "outcome": outcome_type,
        "rating": rating,
        "scores": { "accuracy": accuracy, "helpfulness": helpfulness, "safety": safety },
    }))
}

/// Get agent health metrics for the dashboard (Sprint 12).
async fn tool_get_agent_health(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let days = args
        .get("days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(1, 90) as i32;

    // Get per-agent health summary
    let rows = sqlx::query(
        "SELECT agent_slug,
                COUNT(*)::int AS total_evals,
                AVG(accuracy_score)::float8 AS avg_accuracy,
                AVG(helpfulness_score)::float8 AS avg_helpfulness,
                AVG(safety_score)::float8 AS avg_safety,
                AVG(latency_ms)::int AS avg_latency,
                SUM(cost_estimate)::float8 AS total_cost,
                AVG(rating)::float8 AS avg_rating,
                COUNT(*) FILTER (WHERE outcome_type = 'success')::int AS success_count,
                COUNT(*) FILTER (WHERE outcome_type = 'safety_concern')::int AS safety_concerns
         FROM agent_evaluations
         WHERE organization_id = $1::uuid
           AND created_at > now() - make_interval(days => $2)
         GROUP BY agent_slug
         ORDER BY total_evals DESC",
    )
    .bind(org_id)
    .bind(days)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch agent health");
        AppError::Dependency("Failed to fetch agent health.".to_string())
    })?;

    let agents: Vec<Value> = rows
        .iter()
        .map(|r| {
            let total = r.try_get::<i32, _>("total_evals").unwrap_or(0);
            let success = r.try_get::<i32, _>("success_count").unwrap_or(0);
            json!({
                "agent_slug": r.try_get::<String, _>("agent_slug").unwrap_or_default(),
                "total_evaluations": total,
                "success_rate": if total > 0 { format!("{:.0}%", success as f64 / total as f64 * 100.0) } else { "N/A".to_string() },
                "avg_accuracy": format!("{:.0}%", r.try_get::<f64, _>("avg_accuracy").unwrap_or(0.0) * 100.0),
                "avg_helpfulness": format!("{:.0}%", r.try_get::<f64, _>("avg_helpfulness").unwrap_or(0.0) * 100.0),
                "avg_safety": format!("{:.0}%", r.try_get::<f64, _>("avg_safety").unwrap_or(0.0) * 100.0),
                "avg_latency_ms": r.try_get::<i32, _>("avg_latency").unwrap_or(0),
                "total_cost": format!("{:.4}", r.try_get::<f64, _>("total_cost").unwrap_or(0.0)),
                "avg_rating": format!("{:.1}", r.try_get::<f64, _>("avg_rating").unwrap_or(0.0)),
                "safety_concerns": r.try_get::<i32, _>("safety_concerns").unwrap_or(0),
            })
        })
        .collect();

    // Get daily health metrics if available
    let daily = sqlx::query(
        "SELECT metric_date::text, agent_slug, total_chats, total_tool_calls, avg_latency_ms, error_rate, total_cost
         FROM agent_health_metrics
         WHERE organization_id = $1::uuid
           AND metric_date > CURRENT_DATE - $2
         ORDER BY metric_date DESC
         LIMIT 60",
    )
    .bind(org_id)
    .bind(days)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let daily_metrics: Vec<Value> = daily
        .iter()
        .map(|r| {
            json!({
                "date": r.try_get::<String, _>("metric_date").unwrap_or_default(),
                "agent": r.try_get::<String, _>("agent_slug").unwrap_or_default(),
                "chats": r.try_get::<i32, _>("total_chats").unwrap_or(0),
                "tool_calls": r.try_get::<i32, _>("total_tool_calls").unwrap_or(0),
                "avg_latency": r.try_get::<i32, _>("avg_latency_ms").unwrap_or(0),
                "error_rate": format!("{:.1}%", r.try_get::<f64, _>("error_rate").unwrap_or(0.0) * 100.0),
                "cost": format!("{:.4}", r.try_get::<f64, _>("total_cost").unwrap_or(0.0)),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "period_days": days,
        "agents": agents,
        "daily_metrics": daily_metrics,
    }))
}

/// Execute a playbook (Sprint 12).
async fn tool_execute_playbook(
    state: &AppState,
    org_id: &str,
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let playbook_id = args
        .get("playbook_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if playbook_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "playbook_id is required." }));
    }

    // Fetch playbook
    let playbook = sqlx::query(
        "SELECT id::text, name, agent_slug, steps, trigger_conditions, is_active
         FROM agent_playbooks
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(playbook_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch playbook");
        AppError::Dependency("Failed to fetch playbook.".to_string())
    })?;

    let Some(pb) = playbook else {
        return Ok(json!({ "ok": false, "error": "Playbook not found." }));
    };

    let is_active = pb.try_get::<bool, _>("is_active").unwrap_or(false);
    if !is_active {
        return Ok(json!({ "ok": false, "error": "Playbook is inactive." }));
    }

    let name = pb.try_get::<String, _>("name").unwrap_or_default();
    let agent_slug = pb
        .try_get::<String, _>("agent_slug")
        .unwrap_or_else(|_| "guest-concierge".to_string());
    let steps: Value = pb.try_get("steps").unwrap_or(json!([]));

    let step_arr = steps.as_array().cloned().unwrap_or_default();
    let mut results: Vec<Value> = Vec::new();
    let start = std::time::Instant::now();

    for (i, step) in step_arr.iter().enumerate() {
        let step_type = step
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("message");
        let step_content = step.get("content").and_then(Value::as_str).unwrap_or("");

        match step_type {
            "message" => {
                // Delegate the step message to the playbook's agent
                let mut del_args = Map::new();
                del_args.insert("agent_slug".to_string(), Value::String(agent_slug.clone()));
                del_args.insert(
                    "message".to_string(),
                    Value::String(step_content.to_string()),
                );
                match tool_delegate_to_agent(
                    state,
                    org_id,
                    role,
                    allow_mutations,
                    confirm_write,
                    &del_args,
                )
                .await
                {
                    Ok(result) => {
                        results.push(json!({ "step": i + 1, "type": step_type, "ok": true, "result": result }));
                    }
                    Err(e) => {
                        results.push(json!({ "step": i + 1, "type": step_type, "ok": false, "error": e.to_string() }));
                    }
                }
            }
            "tool" => {
                // Tool steps are delegated as messages to the agent which has tool access
                let tool_name_str = step
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let tool_args_desc = step
                    .get("args")
                    .map(|a| a.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                let tool_message = format!(
                    "Execute tool '{}' with args: {}",
                    tool_name_str, tool_args_desc
                );
                let mut del_args = Map::new();
                del_args.insert("agent_slug".to_string(), Value::String(agent_slug.clone()));
                del_args.insert("message".to_string(), Value::String(tool_message));
                match tool_delegate_to_agent(
                    state,
                    org_id,
                    role,
                    allow_mutations,
                    confirm_write,
                    &del_args,
                )
                .await
                {
                    Ok(result) => {
                        results.push(json!({ "step": i + 1, "type": "tool", "tool": tool_name_str, "ok": true, "result": result }));
                    }
                    Err(e) => {
                        results.push(json!({ "step": i + 1, "type": "tool", "tool": tool_name_str, "ok": false, "error": e.to_string() }));
                    }
                }
            }
            _ => {
                results.push(json!({ "step": i + 1, "type": step_type, "ok": false, "error": "Unknown step type" }));
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as i64;

    // Update playbook stats
    sqlx::query(
        "UPDATE agent_playbooks SET last_run_at = now(), run_count = run_count + 1,
                avg_duration_ms = COALESCE((avg_duration_ms * (run_count - 1) + $3) / run_count, $3)::int,
                updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(playbook_id)
    .bind(org_id)
    .bind(duration_ms as i32)
    .execute(pool)
    .await
    .ok();

    let success_count = results
        .iter()
        .filter(|r| r.get("ok").and_then(Value::as_bool).unwrap_or(false))
        .count();

    Ok(json!({
        "ok": true,
        "playbook": name,
        "steps_total": step_arr.len(),
        "steps_succeeded": success_count,
        "duration_ms": duration_ms,
        "results": results,
    }))
}

/// Collect daily health metrics for all agents (called by scheduler).
pub async fn collect_daily_agent_health(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    // Aggregate yesterday's evaluations into health metrics
    let result = sqlx::query(
        "INSERT INTO agent_health_metrics (organization_id, agent_slug, metric_date, total_chats, total_tool_calls, avg_latency_ms, p95_latency_ms, error_rate, avg_accuracy, avg_helpfulness, avg_safety, total_tokens, total_cost, escalation_count, approval_count)
         SELECT
           organization_id,
           agent_slug,
           (CURRENT_DATE - 1) AS metric_date,
           COUNT(*)::int,
           SUM(COALESCE(tokens_used, 0))::int,
           AVG(latency_ms)::int,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY COALESCE(latency_ms, 0))::int,
           (COUNT(*) FILTER (WHERE outcome_type NOT IN ('success'))::float / GREATEST(COUNT(*), 1)),
           AVG(accuracy_score),
           AVG(helpfulness_score),
           AVG(safety_score),
           SUM(COALESCE(tokens_used, 0))::int,
           SUM(COALESCE(cost_estimate, 0)),
           0, -- escalation_count placeholder
           COUNT(*) FILTER (WHERE approval_required = true)::int
         FROM agent_evaluations
         WHERE created_at >= CURRENT_DATE - 1
           AND created_at < CURRENT_DATE
         GROUP BY organization_id, agent_slug
         ON CONFLICT (organization_id, agent_slug, metric_date) DO UPDATE
           SET total_chats = EXCLUDED.total_chats,
               total_tool_calls = EXCLUDED.total_tool_calls,
               avg_latency_ms = EXCLUDED.avg_latency_ms,
               p95_latency_ms = EXCLUDED.p95_latency_ms,
               error_rate = EXCLUDED.error_rate,
               avg_accuracy = EXCLUDED.avg_accuracy,
               avg_helpfulness = EXCLUDED.avg_helpfulness,
               avg_safety = EXCLUDED.avg_safety,
               total_tokens = EXCLUDED.total_tokens,
               total_cost = EXCLUDED.total_cost,
               approval_count = EXCLUDED.approval_count",
    )
    .execute(pool)
    .await;

    match result {
        Ok(r) => tracing::info!(
            rows = r.rows_affected(),
            "Daily agent health metrics collected"
        ),
        Err(e) => tracing::warn!(error = %e, "Failed to collect agent health metrics"),
    }
}

async fn tool_get_occupancy_forecast(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let months_ahead = coerce_limit(args.get("months_ahead"), 3).clamp(1, 6);
    let pool = db_pool(state)?;

    // Get total units
    let unit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM units WHERE organization_id = $1::uuid")
            .bind(org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    if unit_count == 0 {
        return Ok(json!({
            "ok": true,
            "months": [],
            "message": "No units found to forecast.",
        }));
    }

    // Get monthly reservation nights for past 12 months
    let rows = sqlx::query(
        "SELECT
            to_char(date_trunc('month', check_in_date::date), 'YYYY-MM') AS month,
            SUM(GREATEST((LEAST(check_out_date::date, (date_trunc('month', check_in_date::date) + interval '1 month')::date) - check_in_date::date), 0)) AS nights
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date::date >= (CURRENT_DATE - interval '12 months')
         GROUP BY date_trunc('month', check_in_date::date)
         ORDER BY month DESC
         LIMIT 12"
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Forecast query failed");
        AppError::Dependency("Forecast query failed.".to_string())
    })?;

    let mut monthly_occ: Vec<f64> = Vec::new();
    for row in &rows {
        let nights: i64 = row.try_get("nights").unwrap_or(0);
        let days_in_month = 30.0_f64;
        let occ = (nights as f64) / (unit_count as f64 * days_in_month);
        monthly_occ.push(occ.clamp(0.0, 1.0));
    }

    // Simple moving average for forecast
    let avg_occ = if monthly_occ.is_empty() {
        0.0
    } else {
        monthly_occ.iter().sum::<f64>() / monthly_occ.len() as f64
    };

    let today = chrono::Utc::now().date_naive();
    let mut forecast_months: Vec<Value> = Vec::new();
    for i in 1..=months_ahead {
        let future_month = today + chrono::Duration::days(i * 30);
        let month_label = future_month.format("%Y-%m").to_string();
        let predicted_units = (avg_occ * unit_count as f64).round() as i64;
        let pct = (avg_occ * 10000.0).round() / 100.0;
        forecast_months.push(json!({
            "month": month_label,
            "predicted_occupancy_pct": pct,
            "units_occupied": predicted_units,
            "total_units": unit_count,
        }));
    }

    Ok(json!({
        "ok": true,
        "historical_avg_occupancy_pct": (avg_occ * 10000.0).round() / 100.0,
        "months": forecast_months,
    }))
}

async fn tool_get_anomaly_alerts(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM anomaly_alerts t
         WHERE organization_id = $1::uuid
           AND is_dismissed = false
         ORDER BY detected_at DESC
         LIMIT 50",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Anomaly alerts query failed");
        AppError::Dependency("Anomaly alerts query failed.".to_string())
    })?;

    let alerts = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "alerts": alerts,
        "count": alerts.len(),
    }))
}

async fn tool_get_today_ops_brief(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let arrivals = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM reservations
         WHERE organization_id = $1::uuid
           AND check_in_date = current_date
           AND status IN ('confirmed', 'checked_in')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let departures = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM reservations
         WHERE organization_id = $1::uuid
           AND check_out_date = current_date
           AND status IN ('confirmed', 'checked_in')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let overdue_tasks = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM tasks
         WHERE organization_id = $1::uuid
           AND status IN ('todo', 'in_progress')
           AND due_at IS NOT NULL
           AND due_at < now()",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let open_maintenance = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM maintenance_requests
         WHERE organization_id = $1::uuid
           AND status NOT IN ('completed', 'cancelled')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    Ok(json!({
        "ok": true,
        "today": {
            "arrivals": arrivals,
            "departures": departures,
            "overdue_tasks": overdue_tasks,
            "open_maintenance_requests": open_maintenance,
        }
    }))
}

async fn tool_get_lease_risk_summary(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let expiring_30d = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status IN ('active', 'delinquent')
           AND ends_on BETWEEN current_date AND (current_date + interval '30 days')::date",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let delinquent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_status = 'delinquent'",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let overdue_collections = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint
         FROM collection_records
         WHERE organization_id = $1::uuid
           AND due_date < current_date
           AND status IN ('scheduled', 'pending', 'late')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    Ok(json!({
        "ok": true,
        "lease_risk": {
            "expiring_in_30_days": expiring_30d,
            "delinquent_leases": delinquent,
            "overdue_collection_records": overdue_collections,
        }
    }))
}

async fn tool_get_collections_risk(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let row = sqlx::query(
        "SELECT
            COUNT(*) FILTER (
              WHERE due_date < current_date
                AND status IN ('scheduled', 'pending', 'late')
            )::bigint AS overdue_count,
            COUNT(*) FILTER (WHERE status = 'late')::bigint AS late_count,
            COALESCE(
              SUM(
                CASE
                  WHEN due_date < current_date
                    AND status IN ('scheduled', 'pending', 'late')
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS overdue_amount
         FROM collection_records
         WHERE organization_id = $1::uuid",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let overdue_count = row.try_get::<i64, _>("overdue_count").unwrap_or(0);
    let late_count = row.try_get::<i64, _>("late_count").unwrap_or(0);
    let overdue_amount = row
        .try_get::<Option<f64>, _>("overdue_amount")
        .ok()
        .flatten()
        .unwrap_or(0.0);

    Ok(json!({
        "ok": true,
        "collections_risk": {
            "overdue_count": overdue_count,
            "late_count": late_count,
            "overdue_amount": ((overdue_amount * 100.0).round() / 100.0),
        }
    }))
}

async fn tool_get_owner_statement_summary(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT status::text, COUNT(*)::bigint AS total
         FROM owner_statements
         WHERE organization_id = $1::uuid
           AND period_start <= current_date
           AND period_end >= date_trunc('month', current_date)::date
         GROUP BY status",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let mut summary = Map::new();
    let mut total = 0_i64;
    for row in rows {
        let status = row
            .try_get::<String, _>("status")
            .unwrap_or_else(|_| "unknown".to_string());
        let count = row.try_get::<i64, _>("total").unwrap_or(0);
        total += count;
        summary.insert(status, Value::from(count));
    }

    Ok(json!({
        "ok": true,
        "current_period_total": total,
        "by_status": summary,
    }))
}

async fn tool_search_knowledge(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if query.is_empty() {
        return Ok(json!({ "ok": false, "error": "query is required." }));
    }

    let limit = coerce_limit(args.get("limit"), 8).clamp(1, 20);
    let fetch_n = 20_i32; // fetch top-20 from each method for RRF
    let pool = db_pool(state)?;

    // Try vector similarity search first, fall back to ILIKE if embedding fails
    let embedding_result =
        crate::services::embeddings::embed_query(&state.http_client, &state.config, query).await;

    if let Ok(query_embedding) = embedding_result {
        // --- Hybrid RAG: Vector + FTS with RRF fusion ---
        // 1. Vector search (top 20 by cosine similarity)
        let vector_rows = sqlx::query(
            "SELECT
                kc.id::text AS id,
                kc.document_id::text AS document_id,
                kc.chunk_index,
                kc.content,
                kc.metadata,
                kd.title,
                kd.source_url,
                1 - (kc.embedding <=> $2::vector) AS similarity
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kd.id = kc.document_id
             WHERE kc.organization_id = $1::uuid
               AND kd.organization_id = $1::uuid
               AND kc.embedding IS NOT NULL
             ORDER BY kc.embedding <=> $2::vector
             LIMIT $3",
        )
        .bind(org_id)
        .bind(&query_embedding)
        .bind(fetch_n)
        .fetch_all(pool)
        .await
        .map_err(|error| db_error(state, &error))?;

        // 2. Full-text search (top 20 by ts_rank_cd)
        let fts_rows = sqlx::query(
            "SELECT
                kc.id::text AS id,
                kc.document_id::text AS document_id,
                kc.chunk_index,
                kc.content,
                kc.metadata,
                kd.title,
                kd.source_url,
                ts_rank_cd(kc.fts_vector, plainto_tsquery('english', $2)) AS fts_rank
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kd.id = kc.document_id
             WHERE kc.organization_id = $1::uuid
               AND kd.organization_id = $1::uuid
               AND kc.fts_vector IS NOT NULL
               AND kc.fts_vector @@ plainto_tsquery('english', $2)
             ORDER BY fts_rank DESC
             LIMIT $3",
        )
        .bind(org_id)
        .bind(query)
        .bind(fetch_n)
        .fetch_all(pool)
        .await
        .unwrap_or_default(); // FTS failure is non-fatal; fall back to vector-only

        // 3. RRF fusion: score = sum(1/(60+rank)) across both lists, deduplicate by chunk ID
        let mut rrf_scores: std::collections::HashMap<String, (f64, Value)> =
            std::collections::HashMap::new();
        let k = 60.0_f64;

        for (rank, row) in vector_rows.iter().enumerate() {
            let id = row.try_get::<String, _>("id").unwrap_or_default();
            let score = 1.0 / (k + rank as f64);
            let entry = rrf_scores.entry(id.clone()).or_insert_with(|| {
                (
                    0.0,
                    json!({
                        "id": id,
                        "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
                        "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
                        "title": row.try_get::<String, _>("title").unwrap_or_default(),
                        "source_url": row.try_get::<Option<String>, _>("source_url").ok().flatten(),
                        "content": row.try_get::<String, _>("content").unwrap_or_default(),
                        "similarity": row.try_get::<f64, _>("similarity").unwrap_or(0.0),
                        "metadata": row.try_get::<Option<Value>, _>("metadata").ok().flatten().unwrap_or_else(|| Value::Object(Map::new())),
                    }),
                )
            });
            entry.0 += score;
        }

        for (rank, row) in fts_rows.iter().enumerate() {
            let id = row.try_get::<String, _>("id").unwrap_or_default();
            let score = 1.0 / (k + rank as f64);
            let entry = rrf_scores.entry(id.clone()).or_insert_with(|| {
                (
                    0.0,
                    json!({
                        "id": id,
                        "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
                        "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
                        "title": row.try_get::<String, _>("title").unwrap_or_default(),
                        "source_url": row.try_get::<Option<String>, _>("source_url").ok().flatten(),
                        "content": row.try_get::<String, _>("content").unwrap_or_default(),
                        "similarity": 0.0,
                        "metadata": row.try_get::<Option<Value>, _>("metadata").ok().flatten().unwrap_or_else(|| Value::Object(Map::new())),
                    }),
                )
            });
            entry.0 += score;
        }

        // Sort by RRF score descending and take top N
        let mut scored: Vec<_> = rrf_scores.into_values().collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit as usize);

        let hits: Vec<Value> = scored.into_iter().map(|(_, hit)| hit).collect();
        return Ok(json!({
            "ok": true,
            "query": query,
            "count": hits.len(),
            "hits": hits,
            "search_mode": "hybrid_rrf",
        }));
    }

    // Fallback to ILIKE text search when embedding fails
    let pattern = format!("%{}%", query.replace(['%', '_'], ""));
    let rows = sqlx::query(
        "SELECT
            kc.id::text AS id,
            kc.document_id::text AS document_id,
            kc.chunk_index,
            kc.content,
            kc.metadata,
            kd.title,
            kd.source_url,
            0.0::float8 AS similarity
         FROM knowledge_chunks kc
         JOIN knowledge_documents kd ON kd.id = kc.document_id
         WHERE kc.organization_id = $1::uuid
           AND kd.organization_id = $1::uuid
           AND kc.content ILIKE $2
         ORDER BY kc.updated_at DESC, kc.created_at DESC
         LIMIT $3",
    )
    .bind(org_id)
    .bind(pattern)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let mut hits = Vec::with_capacity(rows.len());
    for row in rows {
        hits.push(json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
            "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "source_url": row.try_get::<Option<String>, _>("source_url").ok().flatten(),
            "content": row.try_get::<String, _>("content").unwrap_or_default(),
            "similarity": row.try_get::<f64, _>("similarity").unwrap_or(0.0),
            "metadata": row
                .try_get::<Option<Value>, _>("metadata")
                .ok()
                .flatten()
                .unwrap_or_else(|| Value::Object(Map::new())),
        }));
    }

    Ok(json!({
        "ok": true,
        "query": query,
        "count": hits.len(),
        "hits": hits,
        "search_mode": "ilike_fallback",
    }))
}

// ---------------------------------------------------------------------------
// Tool: send_message — queue an outbound message (WhatsApp/email/SMS)
// ---------------------------------------------------------------------------

async fn tool_send_message(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let channel = args
        .get("channel")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("whatsapp");
    let recipient = args
        .get("recipient")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let body = args
        .get("body")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if recipient.is_empty() || body.is_empty() {
        return Ok(json!({ "ok": false, "error": "recipient and body are required." }));
    }
    if !matches!(channel, "whatsapp" | "email" | "sms") {
        return Ok(json!({ "ok": false, "error": "channel must be whatsapp, email, or sms." }));
    }

    let pool = db_pool(state)?;
    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String(channel.to_string()));
    msg.insert(
        "recipient".to_string(),
        Value::String(recipient.to_string()),
    );
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );

    let mut payload = Map::new();
    payload.insert("body".to_string(), Value::String(body.to_string()));
    payload.insert("ai_generated".to_string(), Value::Bool(true));
    if let Some(guest_id) = args.get("guest_id").and_then(Value::as_str) {
        payload.insert("guest_id".to_string(), Value::String(guest_id.to_string()));
    }
    msg.insert("payload".to_string(), Value::Object(payload));

    let created = create_row(pool, "message_logs", &msg).await?;
    let msg_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "message_id": msg_id,
        "status": "queued",
        "channel": channel,
        "recipient": recipient,
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_staff_availability — task load per assignable staff member
// ---------------------------------------------------------------------------

async fn tool_get_staff_availability(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT
            u.id::text AS user_id,
            u.full_name,
            u.email,
            om.role,
            COALESCE(open_tasks.count, 0) AS open_task_count
         FROM organization_members om
         JOIN app_users u ON u.id = om.user_id
         LEFT JOIN (
            SELECT assigned_to_user_id, COUNT(*)::int AS count
            FROM tasks
            WHERE organization_id = $1::uuid
              AND status IN ('todo', 'in_progress')
            GROUP BY assigned_to_user_id
         ) open_tasks ON open_tasks.assigned_to_user_id = om.user_id
         WHERE om.organization_id = $1::uuid
           AND om.role IN ('operator', 'owner_admin')
         ORDER BY open_task_count ASC, u.full_name ASC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|error| db_error(state, &error))?;

    let mut staff = Vec::with_capacity(rows.len());
    for row in &rows {
        staff.push(json!({
            "user_id": row.try_get::<String, _>("user_id").unwrap_or_default(),
            "full_name": row.try_get::<String, _>("full_name").unwrap_or_default(),
            "email": row.try_get::<String, _>("email").unwrap_or_default(),
            "role": row.try_get::<String, _>("role").unwrap_or_default(),
            "open_task_count": row.try_get::<i32, _>("open_task_count").unwrap_or(0),
        }));
    }

    Ok(json!({
        "ok": true,
        "staff": staff,
        "count": staff.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: create_maintenance_task — create a task from a maintenance request
// ---------------------------------------------------------------------------

async fn tool_create_maintenance_task(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let priority = args
        .get("priority")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("medium");

    if title.is_empty() {
        return Ok(json!({ "ok": false, "error": "title is required." }));
    }

    let pool = db_pool(state)?;

    let mut task = Map::new();
    task.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    task.insert("title".to_string(), Value::String(title.to_string()));
    task.insert(
        "description".to_string(),
        Value::String(description.to_string()),
    );
    task.insert("priority".to_string(), Value::String(priority.to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert(
        "category".to_string(),
        Value::String("maintenance".to_string()),
    );

    if let Some(assigned) = args.get("assigned_to_user_id").and_then(Value::as_str) {
        task.insert(
            "assigned_to_user_id".to_string(),
            Value::String(assigned.to_string()),
        );
    }
    if let Some(unit_id) = args.get("unit_id").and_then(Value::as_str) {
        task.insert("unit_id".to_string(), Value::String(unit_id.to_string()));
    }
    if let Some(mr_id) = args.get("maintenance_request_id").and_then(Value::as_str) {
        task.insert(
            "maintenance_request_id".to_string(),
            Value::String(mr_id.to_string()),
        );
    }

    let created = create_row(pool, "tasks", &task).await?;
    let task_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Create checklist items if provided
    if let Some(checklist) = args.get("checklist").and_then(Value::as_array) {
        for (index, item) in checklist.iter().enumerate() {
            if let Some(text) = item.as_str() {
                let mut ci = Map::new();
                ci.insert(
                    "organization_id".to_string(),
                    Value::String(org_id.to_string()),
                );
                ci.insert("task_id".to_string(), Value::String(task_id.to_string()));
                ci.insert("title".to_string(), Value::String(text.to_string()));
                ci.insert("sort_order".to_string(), json!(index as i32));
                ci.insert("is_done".to_string(), Value::Bool(false));
                let _ = create_row(pool, "task_items", &ci).await;
            }
        }
    }

    // Update maintenance request status to in_progress if linked
    if let Some(mr_id) = args.get("maintenance_request_id").and_then(Value::as_str) {
        sqlx::query(
            "UPDATE maintenance_requests SET status = 'in_progress', updated_at = now()
             WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'open'",
        )
        .bind(mr_id)
        .bind(org_id)
        .execute(pool)
        .await
        .ok();
    }

    Ok(json!({
        "ok": true,
        "task_id": task_id,
        "title": title,
        "priority": priority,
        "status": "todo",
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_revenue_analytics — RevPAN, ADR, occupancy for pricing agent
// ---------------------------------------------------------------------------

async fn tool_get_revenue_analytics(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let days = args
        .get("days")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(7, 365);

    let unit_id = args.get("unit_id").and_then(Value::as_str);

    // Revenue and booking metrics
    let revenue_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               COUNT(*)::bigint AS total_reservations,
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(AVG(nightly_rate), 0)::float8 AS avg_daily_rate,
               COALESCE(SUM(platform_fee), 0)::float8 AS total_platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS total_cleaning_fees,
               COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS total_room_nights
             FROM reservations
             WHERE organization_id = $1::uuid
               AND unit_id = $2::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= current_date - ($3::int || ' days')::interval",
        )
        .bind(org_id)
        .bind(uid)
        .bind(days as i32)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               COUNT(*)::bigint AS total_reservations,
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(AVG(nightly_rate), 0)::float8 AS avg_daily_rate,
               COALESCE(SUM(platform_fee), 0)::float8 AS total_platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS total_cleaning_fees,
               COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS total_room_nights
             FROM reservations
             WHERE organization_id = $1::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= current_date - ($2::int || ' days')::interval",
        )
        .bind(org_id)
        .bind(days as i32)
        .fetch_one(pool)
        .await
    };

    let row = revenue_query.map_err(|e| db_error(state, &e))?;
    let total_reservations = row.try_get::<i64, _>("total_reservations").unwrap_or(0);
    let gross_revenue = row.try_get::<f64, _>("gross_revenue").unwrap_or(0.0);
    let avg_daily_rate = row.try_get::<f64, _>("avg_daily_rate").unwrap_or(0.0);
    let total_room_nights = row.try_get::<i64, _>("total_room_nights").unwrap_or(0);

    // Count available units for occupancy calculation
    let unit_count_row = sqlx::query(
        "SELECT COUNT(*)::bigint AS cnt FROM units WHERE organization_id = $1::uuid AND is_active = true",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let active_units = unit_count_row.try_get::<i64, _>("cnt").unwrap_or(1).max(1);
    let available_nights = active_units * days;
    let occupancy_rate = if available_nights > 0 {
        (total_room_nights as f64 / available_nights as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    let rev_pan = if available_nights > 0 {
        gross_revenue / available_nights as f64
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "period_days": days,
        "total_reservations": total_reservations,
        "gross_revenue": (gross_revenue * 100.0).round() / 100.0,
        "avg_daily_rate": (avg_daily_rate * 100.0).round() / 100.0,
        "total_room_nights": total_room_nights,
        "active_units": active_units,
        "available_nights": available_nights,
        "occupancy_rate_pct": (occupancy_rate * 100.0).round() / 100.0,
        "rev_pan": (rev_pan * 100.0).round() / 100.0,
    }))
}

// ---------------------------------------------------------------------------
// Tool: get_seasonal_demand — historical booking patterns for pricing agent
// ---------------------------------------------------------------------------

async fn tool_get_seasonal_demand(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let months_back = args
        .get("months_back")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(3, 24);

    let rows = sqlx::query(
        "SELECT
           date_trunc('month', check_in_date)::date AS month,
           COUNT(*)::bigint AS bookings,
           COALESCE(SUM(total_amount), 0)::float8 AS revenue,
           COALESCE(AVG(nightly_rate), 0)::float8 AS avg_rate,
           COALESCE(SUM(check_out_date - check_in_date), 0)::bigint AS room_nights
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= (current_date - ($2::int || ' months')::interval)::date
         GROUP BY 1
         ORDER BY 1",
    )
    .bind(org_id)
    .bind(months_back as i32)
    .fetch_all(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let months: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "month": r.try_get::<chrono::NaiveDate, _>("month")
                    .map(|d| d.to_string())
                    .unwrap_or_default(),
                "bookings": r.try_get::<i64, _>("bookings").unwrap_or(0),
                "revenue": r.try_get::<f64, _>("revenue").unwrap_or(0.0),
                "avg_rate": r.try_get::<f64, _>("avg_rate").unwrap_or(0.0),
                "room_nights": r.try_get::<i64, _>("room_nights").unwrap_or(0),
            })
        })
        .collect();

    // Identify peak and low months
    let peak_month = months
        .iter()
        .max_by(|a, b| {
            let a_rn = a.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            let b_rn = b.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            a_rn.cmp(&b_rn)
        })
        .and_then(|v| v.get("month").and_then(Value::as_str))
        .unwrap_or("N/A");

    let low_month = months
        .iter()
        .filter(|v| v.get("bookings").and_then(Value::as_i64).unwrap_or(0) > 0)
        .min_by(|a, b| {
            let a_rn = a.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            let b_rn = b.get("room_nights").and_then(Value::as_i64).unwrap_or(0);
            a_rn.cmp(&b_rn)
        })
        .and_then(|v| v.get("month").and_then(Value::as_str))
        .unwrap_or("N/A");

    Ok(json!({
        "ok": true,
        "months_analyzed": months.len(),
        "peak_month": peak_month,
        "low_month": low_month,
        "monthly_data": months,
    }))
}

// ---------------------------------------------------------------------------
// Tool: generate_owner_statement — draft monthly statement for finance agent
// ---------------------------------------------------------------------------

async fn tool_generate_owner_statement(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let period_start = args
        .get("period_start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let period_end = args
        .get("period_end")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if period_start.is_empty() || period_end.is_empty() {
        return Ok(
            json!({ "ok": false, "error": "period_start and period_end (YYYY-MM-DD) are required." }),
        );
    }

    let unit_id = args.get("unit_id").and_then(Value::as_str);
    let currency = args
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("USD");

    // Reservation revenue for period
    let rev_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(SUM(platform_fee), 0)::float8 AS platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS cleaning_fees,
               COALESCE(SUM(tax_amount), 0)::float8 AS taxes_collected,
               COUNT(*)::bigint AS reservation_count
             FROM reservations
             WHERE organization_id = $1::uuid
               AND unit_id = $4::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= $2::date
               AND check_in_date < $3::date",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(uid)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               COALESCE(SUM(total_amount), 0)::float8 AS gross_revenue,
               COALESCE(SUM(platform_fee), 0)::float8 AS platform_fees,
               COALESCE(SUM(cleaning_fee), 0)::float8 AS cleaning_fees,
               COALESCE(SUM(tax_amount), 0)::float8 AS taxes_collected,
               COUNT(*)::bigint AS reservation_count
             FROM reservations
             WHERE organization_id = $1::uuid
               AND status IN ('confirmed', 'checked_in', 'checked_out')
               AND check_in_date >= $2::date
               AND check_in_date < $3::date",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_one(pool)
        .await
    };

    let rev_row = rev_query.map_err(|e| db_error(state, &e))?;
    let gross_revenue = rev_row.try_get::<f64, _>("gross_revenue").unwrap_or(0.0);
    let platform_fees = rev_row.try_get::<f64, _>("platform_fees").unwrap_or(0.0);
    let cleaning_fees = rev_row.try_get::<f64, _>("cleaning_fees").unwrap_or(0.0);
    let taxes_collected = rev_row.try_get::<f64, _>("taxes_collected").unwrap_or(0.0);
    let reservation_count = rev_row.try_get::<i64, _>("reservation_count").unwrap_or(0);

    // Expenses for period
    let exp_query = if let Some(uid) = unit_id {
        sqlx::query(
            "SELECT
               category::text,
               COALESCE(SUM(amount), 0)::float8 AS total,
               COUNT(*)::bigint AS cnt
             FROM expenses
             WHERE organization_id = $1::uuid
               AND unit_id = $4::uuid
               AND expense_date >= $2::date
               AND expense_date < $3::date
               AND approval_status != 'rejected'
             GROUP BY category",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(uid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT
               category::text,
               COALESCE(SUM(amount), 0)::float8 AS total,
               COUNT(*)::bigint AS cnt
             FROM expenses
             WHERE organization_id = $1::uuid
               AND expense_date >= $2::date
               AND expense_date < $3::date
               AND approval_status != 'rejected'
             GROUP BY category",
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_all(pool)
        .await
    };

    let exp_rows = exp_query.map_err(|e| db_error(state, &e))?;
    let mut expense_breakdown = Map::new();
    let mut total_expenses = 0.0_f64;
    for row in &exp_rows {
        let cat = row
            .try_get::<String, _>("category")
            .unwrap_or_else(|_| "other".to_string());
        let amt = row.try_get::<f64, _>("total").unwrap_or(0.0);
        total_expenses += amt;
        expense_breakdown.insert(cat, json!(amt));
    }

    // Compute IVA (10% on service/management fees)
    let management_fee = gross_revenue * 0.15; // 15% default management fee
    let iva_rate = 10.0;
    let iva_amount = management_fee * iva_rate / 100.0;

    let net_payout = gross_revenue - platform_fees - total_expenses - management_fee - iva_amount;

    // Insert draft statement
    let insert_result = sqlx::query(
        "INSERT INTO owner_statements (
           organization_id, unit_id, period_start, period_end, currency,
           gross_revenue, platform_fees, operating_expenses, taxes_collected,
           service_fees, net_payout, status, iva_rate, iva_amount, tax_summary
         ) VALUES (
           $1::uuid, $2, $3::date, $4::date, $5,
           $6, $7, $8, $9,
           $10, $11, 'draft', $12, $13, $14::jsonb
         ) RETURNING id",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(period_start)
    .bind(period_end)
    .bind(currency)
    .bind(gross_revenue)
    .bind(platform_fees)
    .bind(total_expenses)
    .bind(taxes_collected)
    .bind(management_fee)
    .bind(net_payout)
    .bind(iva_rate)
    .bind(iva_amount)
    .bind(json!({
        "management_fee": management_fee,
        "iva_rate_pct": iva_rate,
        "iva_on_management": iva_amount,
    }))
    .fetch_one(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let statement_id = insert_result
        .try_get::<sqlx::types::Uuid, _>("id")
        .map(|u| u.to_string())
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "statement_id": statement_id,
        "period": format!("{} to {}", period_start, period_end),
        "reservation_count": reservation_count,
        "gross_revenue": (gross_revenue * 100.0).round() / 100.0,
        "platform_fees": (platform_fees * 100.0).round() / 100.0,
        "cleaning_fees": (cleaning_fees * 100.0).round() / 100.0,
        "total_expenses": (total_expenses * 100.0).round() / 100.0,
        "expense_breakdown": expense_breakdown,
        "management_fee": (management_fee * 100.0).round() / 100.0,
        "iva_amount": (iva_amount * 100.0).round() / 100.0,
        "taxes_collected": (taxes_collected * 100.0).round() / 100.0,
        "net_payout": (net_payout * 100.0).round() / 100.0,
        "currency": currency,
        "status": "draft",
    }))
}

// ---------------------------------------------------------------------------
// Tool: reconcile_collections — match payments vs expected for finance agent
// ---------------------------------------------------------------------------

async fn tool_reconcile_collections(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let period_start = args
        .get("period_start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let period_end = args
        .get("period_end")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if period_start.is_empty() || period_end.is_empty() {
        return Ok(
            json!({ "ok": false, "error": "period_start and period_end (YYYY-MM-DD) are required." }),
        );
    }

    // Reservation-based expected vs collected
    let res_row = sqlx::query(
        "SELECT
           COUNT(*)::bigint AS total_reservations,
           COALESCE(SUM(total_amount), 0)::float8 AS expected_total,
           COALESCE(SUM(amount_paid), 0)::float8 AS collected_total
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= $2::date
           AND check_in_date < $3::date",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let expected_total = res_row.try_get::<f64, _>("expected_total").unwrap_or(0.0);
    let collected_total = res_row.try_get::<f64, _>("collected_total").unwrap_or(0.0);
    let total_reservations = res_row.try_get::<i64, _>("total_reservations").unwrap_or(0);
    let shortfall = expected_total - collected_total;

    // Collection records status breakdown (lease collections)
    let coll_rows = sqlx::query(
        "SELECT
           status::text,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(amount), 0)::float8 AS total
         FROM collection_records
         WHERE organization_id = $1::uuid
           AND due_date >= $2::date
           AND due_date < $3::date
         GROUP BY status",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let mut collection_status = Map::new();
    for row in &coll_rows {
        let status = row
            .try_get::<String, _>("status")
            .unwrap_or_else(|_| "unknown".to_string());
        let cnt = row.try_get::<i64, _>("cnt").unwrap_or(0);
        let total = row.try_get::<f64, _>("total").unwrap_or(0.0);
        collection_status.insert(
            status,
            json!({ "count": cnt, "amount": (total * 100.0).round() / 100.0 }),
        );
    }

    // Flag unpaid reservations
    let unpaid_rows = sqlx::query(
        "SELECT id, check_in_date::text, total_amount::float8, amount_paid::float8,
                (total_amount - amount_paid)::float8 AS outstanding
         FROM reservations
         WHERE organization_id = $1::uuid
           AND status IN ('confirmed', 'checked_in', 'checked_out')
           AND check_in_date >= $2::date
           AND check_in_date < $3::date
           AND amount_paid < total_amount
         ORDER BY (total_amount - amount_paid) DESC
         LIMIT 20",
    )
    .bind(org_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let discrepancies: Vec<Value> = unpaid_rows
        .iter()
        .map(|r| {
            json!({
                "reservation_id": r.try_get::<sqlx::types::Uuid, _>("id")
                    .map(|u| u.to_string()).unwrap_or_default(),
                "check_in_date": r.try_get::<String, _>("check_in_date").unwrap_or_default(),
                "total_amount": r.try_get::<f64, _>("total_amount").unwrap_or(0.0),
                "amount_paid": r.try_get::<f64, _>("amount_paid").unwrap_or(0.0),
                "outstanding": r.try_get::<f64, _>("outstanding").unwrap_or(0.0),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "period": format!("{} to {}", period_start, period_end),
        "reservations": {
            "total": total_reservations,
            "expected": (expected_total * 100.0).round() / 100.0,
            "collected": (collected_total * 100.0).round() / 100.0,
            "shortfall": (shortfall * 100.0).round() / 100.0,
        },
        "lease_collections": collection_status,
        "discrepancies": discrepancies,
        "discrepancy_count": discrepancies.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: categorize_expense — classify expense into PMS categories
// ---------------------------------------------------------------------------

async fn tool_categorize_expense(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let expense_id = args
        .get("expense_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let category = args
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if expense_id.is_empty() || category.is_empty() {
        return Ok(json!({ "ok": false, "error": "expense_id and category are required." }));
    }

    let valid_categories = [
        "maintenance",
        "cleaning",
        "utilities",
        "insurance",
        "taxes",
        "management_fee",
        "supplies",
        "marketing",
        "professional_services",
        "other",
    ];

    if !valid_categories.contains(&category) {
        return Ok(json!({
            "ok": false,
            "error": format!("Invalid category. Must be one of: {}", valid_categories.join(", ")),
        }));
    }

    let result = sqlx::query(
        "UPDATE expenses SET category = $3::expense_category, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid
         RETURNING id, category::text, amount::float8, vendor_name, expense_date::text",
    )
    .bind(expense_id)
    .bind(org_id)
    .bind(category)
    .fetch_optional(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    match result {
        Some(row) => Ok(json!({
            "ok": true,
            "expense_id": row.try_get::<sqlx::types::Uuid, _>("id")
                .map(|u| u.to_string()).unwrap_or_default(),
            "category": row.try_get::<String, _>("category").unwrap_or_default(),
            "amount": row.try_get::<f64, _>("amount").unwrap_or(0.0),
            "vendor_name": row.try_get::<Option<String>, _>("vendor_name").unwrap_or(None),
            "expense_date": row.try_get::<String, _>("expense_date").unwrap_or_default(),
        })),
        None => Ok(json!({ "ok": false, "error": "Expense not found." })),
    }
}

// ---------------------------------------------------------------------------
// Tool: recall_memory — retrieve stored memories for context
// ---------------------------------------------------------------------------

async fn tool_recall_memory(
    state: &AppState,
    org_id: &str,
    agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let query_text = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let entity_id = args.get("entity_id").and_then(Value::as_str);
    let context_type = args.get("context_type").and_then(Value::as_str);
    let limit = coerce_limit(args.get("limit"), 10).clamp(1, 20);

    let slug = agent_slug.unwrap_or("supervisor");

    let rows = if let Some(eid) = entity_id {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND agent_slug = $2
               AND entity_id = $3
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $4",
        )
        .bind(org_id)
        .bind(slug)
        .bind(eid)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if !query_text.is_empty() {
        // Hybrid memory recall: Vector + FTS with RRF fusion
        let embedding_result =
            crate::services::embeddings::embed_query(&state.http_client, &state.config, query_text)
                .await;

        if let Ok(query_embedding) = embedding_result {
            let fetch_n = 20_i32;
            // Vector search
            let vec_rows = sqlx::query(
                "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
                 FROM agent_memory
                 WHERE organization_id = $1::uuid
                   AND (agent_slug = $2 OR shared = true)
                   AND embedding IS NOT NULL
                   AND (expires_at IS NULL OR expires_at > now())
                 ORDER BY embedding <=> $3::vector
                 LIMIT $4",
            )
            .bind(org_id)
            .bind(slug)
            .bind(&query_embedding)
            .bind(fetch_n)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

            // FTS search
            let fts_rows = sqlx::query(
                "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
                 FROM agent_memory
                 WHERE organization_id = $1::uuid
                   AND (agent_slug = $2 OR shared = true)
                   AND fts_vector IS NOT NULL
                   AND fts_vector @@ plainto_tsquery('english', $3)
                   AND (expires_at IS NULL OR expires_at > now())
                 ORDER BY ts_rank_cd(fts_vector, plainto_tsquery('english', $3)) DESC
                 LIMIT $4",
            )
            .bind(org_id)
            .bind(slug)
            .bind(query_text)
            .bind(fetch_n)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

            // RRF fusion
            let k = 60.0_f64;
            // RRF fusion - collect as json values for easy serialization
            let mut rrf_json: std::collections::HashMap<String, (f64, Value)> =
                std::collections::HashMap::new();

            for (rank, row) in vec_rows.iter().enumerate() {
                let key = row.try_get::<String, _>("memory_key").unwrap_or_default();
                let score = 1.0 / (k + rank as f64);
                let entry = rrf_json.entry(key.clone()).or_insert_with(|| {
                    (0.0, json!({
                        "key": key,
                        "value": row.try_get::<String, _>("memory_value").unwrap_or_default(),
                        "context_type": row.try_get::<String, _>("context_type").unwrap_or_default(),
                        "entity_id": row.try_get::<Option<String>, _>("entity_id").unwrap_or(None),
                        "confidence": row.try_get::<f64, _>("confidence").unwrap_or(0.0),
                        "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
                    }))
                });
                entry.0 += score;
            }
            for (rank, row) in fts_rows.iter().enumerate() {
                let key = row.try_get::<String, _>("memory_key").unwrap_or_default();
                let score = 1.0 / (k + rank as f64);
                let entry = rrf_json.entry(key.clone()).or_insert_with(|| {
                    (0.0, json!({
                        "key": key,
                        "value": row.try_get::<String, _>("memory_value").unwrap_or_default(),
                        "context_type": row.try_get::<String, _>("context_type").unwrap_or_default(),
                        "entity_id": row.try_get::<Option<String>, _>("entity_id").unwrap_or(None),
                        "confidence": row.try_get::<f64, _>("confidence").unwrap_or(0.0),
                        "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
                    }))
                });
                entry.0 += score;
            }

            let mut scored: Vec<_> = rrf_json.into_values().collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(limit as usize);

            let memories: Vec<Value> = scored.into_iter().map(|(_, v)| v).collect();

            // Update access counts
            if !memories.is_empty() {
                let keys: Vec<String> = memories
                    .iter()
                    .filter_map(|m| m.get("key").and_then(Value::as_str).map(ToOwned::to_owned))
                    .collect();
                if !keys.is_empty() {
                    let _ = sqlx::query(
                        "UPDATE agent_memory SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = now()
                         WHERE organization_id = $1::uuid AND agent_slug = $2 AND memory_key = ANY($3)"
                    )
                    .bind(org_id)
                    .bind(slug)
                    .bind(&keys)
                    .execute(pool)
                    .await;
                }
            }

            return Ok(json!({
                "ok": true,
                "memories": memories,
                "count": memories.len(),
                "search_mode": "hybrid_rrf",
            }));
        }
        // Fallback to text matching if embedding fails
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND (agent_slug = $2 OR shared = true)
               AND (memory_key ILIKE '%' || $3 || '%' OR memory_value ILIKE '%' || $3 || '%')
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $4",
        )
        .bind(org_id)
        .bind(slug)
        .bind(query_text)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if let Some(ct) = context_type {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND agent_slug = $2
               AND context_type = $3
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $4",
        )
        .bind(org_id)
        .bind(slug)
        .bind(ct)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT memory_key, memory_value, context_type, entity_id, confidence, created_at::text
             FROM agent_memory
             WHERE organization_id = $1::uuid
               AND agent_slug = $2
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY updated_at DESC
             LIMIT $3",
        )
        .bind(org_id)
        .bind(slug)
        .bind(limit)
        .fetch_all(pool)
        .await
    };

    let rows = rows.map_err(|e| db_error(state, &e))?;

    let memories: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "key": r.try_get::<String, _>("memory_key").unwrap_or_default(),
                "value": r.try_get::<String, _>("memory_value").unwrap_or_default(),
                "context_type": r.try_get::<String, _>("context_type").unwrap_or_default(),
                "entity_id": r.try_get::<Option<String>, _>("entity_id").unwrap_or(None),
                "confidence": r.try_get::<f64, _>("confidence").unwrap_or(0.0),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    // Update access_count and last_accessed_at for recalled memories
    if !memories.is_empty() {
        let keys: Vec<String> = memories
            .iter()
            .filter_map(|m| m.get("key").and_then(Value::as_str).map(ToOwned::to_owned))
            .collect();
        if !keys.is_empty() {
            let _ = sqlx::query(
                "UPDATE agent_memory SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = now()
                 WHERE organization_id = $1::uuid AND agent_slug = $2 AND memory_key = ANY($3)"
            )
            .bind(org_id)
            .bind(slug)
            .bind(&keys)
            .execute(pool)
            .await;
        }
    }

    Ok(json!({
        "ok": true,
        "memories": memories,
        "count": memories.len(),
    }))
}

// ---------------------------------------------------------------------------
// Tool: store_memory — persist a key fact for future reference
// ---------------------------------------------------------------------------

async fn tool_store_memory(
    state: &AppState,
    org_id: &str,
    agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let memory_key = args
        .get("memory_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let memory_value = args
        .get("memory_value")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if memory_key.is_empty() || memory_value.is_empty() {
        return Ok(json!({ "ok": false, "error": "memory_key and memory_value are required." }));
    }

    let context_type = args
        .get("context_type")
        .and_then(Value::as_str)
        .unwrap_or("general");
    let entity_id = args.get("entity_id").and_then(Value::as_str);
    let shared = args.get("shared").and_then(Value::as_bool).unwrap_or(false);

    // Memory tier determines TTL and classification
    let memory_tier = args.get("memory_tier").and_then(Value::as_str).unwrap_or({
        // Auto-infer tier from context_type
        match context_type {
            "guest_preference" | "property_insight" => "entity",
            "financial_pattern" => "semantic",
            _ => "general",
        }
    });

    let expires_days = args
        .get("expires_days")
        .and_then(Value::as_i64)
        .unwrap_or({
            // Default TTL by memory tier
            match memory_tier {
                "episodic" => 30,
                "semantic" => 180,
                "entity" => 365,
                _ => 90,
            }
        })
        .clamp(1, 365);

    // Importance scoring: higher for financial patterns, guest preferences
    let importance_score = match context_type {
        "financial_pattern" => 0.9,
        "guest_preference" => 0.8,
        "property_insight" => 0.7,
        _ => 0.5,
    };

    let slug = agent_slug.unwrap_or("supervisor");

    // Upsert: update if same key+agent exists, insert otherwise
    let result = sqlx::query(
        "INSERT INTO agent_memory (organization_id, agent_slug, memory_key, memory_value, context_type, entity_id, expires_at, importance_score, memory_tier, shared)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now() + ($7::int || ' days')::interval, $8, $9, $10)
         ON CONFLICT (organization_id, agent_slug, memory_key)
         DO UPDATE SET memory_value = EXCLUDED.memory_value,
                       context_type = EXCLUDED.context_type,
                       entity_id = EXCLUDED.entity_id,
                       expires_at = EXCLUDED.expires_at,
                       importance_score = EXCLUDED.importance_score,
                       memory_tier = EXCLUDED.memory_tier,
                       shared = EXCLUDED.shared,
                       updated_at = now()
         RETURNING id",
    )
    .bind(org_id)
    .bind(slug)
    .bind(memory_key)
    .bind(memory_value)
    .bind(context_type)
    .bind(entity_id)
    .bind(expires_days as i32)
    .bind(importance_score)
    .bind(memory_tier)
    .bind(shared)
    .fetch_one(pool)
    .await
    .map_err(|e| db_error(state, &e))?;

    let memory_id = result
        .try_get::<sqlx::types::Uuid, _>("id")
        .map(|u| u.to_string())
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "memory_id": memory_id,
        "key": memory_key,
        "expires_days": expires_days,
        "memory_tier": memory_tier,
        "shared": shared,
    }))
}

// ---------------------------------------------------------------------------
// Tool: check_escalation_thresholds — check if action exceeds configured limits
// ---------------------------------------------------------------------------

async fn tool_check_escalation_thresholds(
    state: &AppState,
    org_id: &str,
    agent_slug: Option<&str>,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let threshold_type = args
        .get("threshold_type")
        .and_then(Value::as_str)
        .unwrap_or("dollar_amount");
    let value = args.get("value").and_then(Value::as_f64).unwrap_or(0.0);
    let context_desc = args
        .get("context")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Query applicable thresholds
    let rows = sqlx::query(
        "SELECT id, threshold_type, threshold_value, action, description, notify_channel, notify_target
         FROM escalation_thresholds
         WHERE organization_id = $1::uuid
           AND is_active = true
           AND threshold_type = $2
           AND ($3::text IS NULL OR agent_slug IS NULL OR agent_slug = $3)
         ORDER BY threshold_value ASC",
    )
    .bind(org_id)
    .bind(threshold_type)
    .bind(agent_slug)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut triggered: Vec<Value> = Vec::new();
    let mut max_action = "proceed";

    for row in &rows {
        let threshold_value = row.try_get::<f64, _>("threshold_value").unwrap_or(f64::MAX);
        if value >= threshold_value {
            let action = row
                .try_get::<String, _>("action")
                .unwrap_or_else(|_| "escalate".to_string());
            let description = row
                .try_get::<Option<String>, _>("description")
                .unwrap_or(None)
                .unwrap_or_default();

            if action == "block" {
                max_action = "block";
            } else if action == "escalate" && max_action != "block" {
                max_action = "escalate";
            } else if action == "require_approval" && max_action == "proceed" {
                max_action = "require_approval";
            } else if action == "notify" && max_action == "proceed" {
                max_action = "notify";
            }

            triggered.push(json!({
                "threshold_value": threshold_value,
                "action": action,
                "description": description,
            }));
        }
    }

    Ok(json!({
        "ok": true,
        "threshold_type": threshold_type,
        "checked_value": value,
        "context": context_desc,
        "result": max_action,
        "triggered_thresholds": triggered,
        "should_proceed": max_action == "proceed" || max_action == "notify",
    }))
}

// ---------------------------------------------------------------------------
// Tool: create_execution_plan — decompose complex goals into numbered steps
// ---------------------------------------------------------------------------

fn tool_create_execution_plan(args: &Map<String, Value>) -> AppResult<Value> {
    let goal = args
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if goal.is_empty() {
        return Ok(json!({ "ok": false, "error": "goal is required." }));
    }

    let steps = args
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if steps.is_empty() {
        return Ok(json!({ "ok": false, "error": "steps array is required." }));
    }

    let context = args
        .get("context")
        .and_then(Value::as_str)
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "plan": {
            "goal": goal,
            "total_steps": steps.len(),
            "steps": steps,
            "context": context,
            "status": "created",
        },
        "message": format!("Execution plan created with {} steps for: {}", steps.len(), goal),
    }))
}

// ---------------------------------------------------------------------------
// Tool: summarize_conversation — compress earlier messages into a summary
// ---------------------------------------------------------------------------

fn tool_summarize_conversation(args: &Map<String, Value>) -> AppResult<Value> {
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if summary.is_empty() {
        return Ok(json!({ "ok": false, "error": "summary is required." }));
    }

    let key_facts = args
        .get("key_facts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "summary": summary,
        "key_facts": key_facts,
        "message": "Conversation context compressed. Earlier messages can be safely pruned.",
    }))
}

fn apply_filter(
    query: &mut QueryBuilder<'_, Postgres>,
    column: &str,
    value: &Value,
) -> AppResult<()> {
    let column_name = validate_identifier(column)?.to_string();

    if let Some(spec) = value.as_object() {
        let op = spec
            .get("op")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("eq")
            .to_ascii_lowercase();
        let operand = spec.get("value").cloned().unwrap_or(Value::Null);

        match op.as_str() {
            "eq" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") = ")
                    .push_bind(render_scalar(&operand));
            }
            "neq" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") <> ")
                    .push_bind(render_scalar(&operand));
            }
            "gt" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") > ")
                    .push_bind(render_scalar(&operand));
            }
            "gte" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") >= ")
                    .push_bind(render_scalar(&operand));
            }
            "lt" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") < ")
                    .push_bind(render_scalar(&operand));
            }
            "lte" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") <= ")
                    .push_bind(render_scalar(&operand));
            }
            "ilike" => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") ILIKE ")
                    .push_bind(render_scalar(&operand));
            }
            "in" => {
                if let Some(items) = operand.as_array() {
                    let values = items.iter().map(render_scalar).collect::<Vec<_>>();
                    if !values.is_empty() {
                        query
                            .push(" AND (to_jsonb(t) ->> ")
                            .push_bind(column_name.clone())
                            .push(") = ANY(")
                            .push_bind(values)
                            .push(")");
                    }
                } else {
                    query
                        .push(" AND (to_jsonb(t) ->> ")
                        .push_bind(column_name.clone())
                        .push(") = ")
                        .push_bind(render_scalar(&operand));
                }
            }
            _ => {
                query
                    .push(" AND (to_jsonb(t) ->> ")
                    .push_bind(column_name.clone())
                    .push(") = ")
                    .push_bind(render_scalar(&operand));
            }
        }

        return Ok(());
    }

    if let Some(items) = value.as_array() {
        let values = items.iter().map(render_scalar).collect::<Vec<_>>();
        if !values.is_empty() {
            query
                .push(" AND (to_jsonb(t) ->> ")
                .push_bind(column_name.clone())
                .push(") = ANY(")
                .push_bind(values)
                .push(")");
        }
        return Ok(());
    }

    query
        .push(" AND (to_jsonb(t) ->> ")
        .push_bind(column_name)
        .push(") = ")
        .push_bind(render_scalar(value));

    Ok(())
}

fn normalize_table(value: Option<&Value>) -> AppResult<String> {
    let table = value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if table.is_empty() {
        return Err(AppError::BadRequest("table is required.".to_string()));
    }
    let _ = table_config(&table)?;
    Ok(table)
}

fn table_config(table: &str) -> AppResult<TableConfig> {
    let config = match table.trim() {
        "organizations" => TableConfig {
            org_column: "id",
            can_create: false,
            can_update: true,
            can_delete: false,
        },
        "audit_logs"
        | "agent_approvals"
        | "agent_approval_policies"
        | "anomaly_alerts"
        | "agent_memory"
        | "agent_schedules"
        | "portfolio_snapshots" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "knowledge_documents" | "knowledge_chunks" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "escrow_events" => TableConfig {
            org_column: "organization_id",
            can_create: false,
            can_update: false,
            can_delete: false,
        },
        "maintenance_requests"
        | "inspection_reports"
        | "lease_abstractions"
        | "maintenance_sla_config"
        | "vendor_roster"
        | "pricing_recommendations" => TableConfig {
            org_column: "organization_id",
            can_create: true,
            can_update: true,
            can_delete: false,
        },
        "organization_invites"
        | "properties"
        | "units"
        | "integrations"
        | "guests"
        | "reservations"
        | "calendar_blocks"
        | "tasks"
        | "expenses"
        | "owner_statements"
        | "pricing_templates"
        | "listings"
        | "application_submissions"
        | "application_events"
        | "leases"
        | "lease_charges"
        | "collection_records"
        | "message_templates"
        | "message_logs"
        | "integration_events" => TableConfig {
            org_column: "organization_id",
            can_create: true,
            can_update: true,
            can_delete: true,
        },
        _ => {
            return Err(AppError::BadRequest(format!(
                "Table '{table}' is not allowed for AI access."
            )));
        }
    };

    Ok(config)
}

fn normalize_json_object(value: Option<&Value>, field_name: &str) -> AppResult<Map<String, Value>> {
    let Some(value) = value else {
        return Ok(Map::new());
    };
    if let Some(object) = value.as_object() {
        return Ok(object.clone());
    }
    Err(AppError::BadRequest(format!(
        "{field_name} must be an object."
    )))
}

fn coerce_limit(value: Option<&Value>, default: i64) -> i64 {
    let parsed = value
        .and_then(|item| {
            item.as_i64().or_else(|| {
                item.as_u64()
                    .and_then(|number| i64::try_from(number).ok())
                    .or_else(|| {
                        item.as_f64().and_then(|number| {
                            if number.is_finite() {
                                Some(number as i64)
                            } else {
                                None
                            }
                        })
                    })
                    .or_else(|| {
                        item.as_str()
                            .and_then(|text| text.trim().parse::<i64>().ok())
                    })
            })
        })
        .unwrap_or(default);
    parsed.clamp(1, 200)
}

fn assert_mutation_allowed(
    role: &str,
    allow_mutations: bool,
    confirm_write: bool,
) -> (bool, String) {
    if !allow_mutations {
        return (
            false,
            "Mutations are disabled. Enable write mode to create/update/delete rows.".to_string(),
        );
    }
    if !confirm_write {
        return (
            false,
            "Write confirmation is required. Confirm this action before running mutations."
                .to_string(),
        );
    }

    let role_value = normalize_role(role);
    if !MUTATION_ROLES.contains(&role_value.as_str()) {
        return (
            false,
            format!("Role '{}' is read-only for AI mutations.", role_value),
        );
    }

    (true, "ok".to_string())
}

fn mutations_allowed(role: &str, allow_mutations: bool, confirm_write: bool) -> bool {
    assert_mutation_allowed(role, allow_mutations, confirm_write).0
}

fn parse_tool_arguments(raw_arguments: Option<Value>) -> AppResult<Map<String, Value>> {
    let Some(raw_arguments) = raw_arguments else {
        return Ok(Map::new());
    };

    if let Some(object) = raw_arguments.as_object() {
        return Ok(object.clone());
    }

    if let Some(raw) = raw_arguments.as_str() {
        let text = raw.trim();
        if text.is_empty() {
            return Ok(Map::new());
        }

        let parsed: Value = serde_json::from_str(text)
            .map_err(|_| AppError::BadRequest("Invalid tool arguments payload.".to_string()))?;
        if let Some(object) = parsed.as_object() {
            return Ok(object.clone());
        }
    }

    Err(AppError::BadRequest(
        "Invalid tool arguments payload.".to_string(),
    ))
}

fn preview_result(result: &Value) -> String {
    let Some(result_obj) = result.as_object() else {
        return "ok".to_string();
    };
    let data_obj = result_obj
        .get("data")
        .and_then(Value::as_object)
        .unwrap_or(result_obj);

    if !result_obj
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        if let Some(error_obj) = result_obj.get("error").and_then(Value::as_object) {
            if let Some(message) = error_obj
                .get("message")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return message.to_string();
            }
        }
        return result_obj
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Operation failed.".to_string());
    }

    if let Some(row) = data_obj.get("row").and_then(Value::as_object) {
        if let Some(id_value) = row.get("id").and_then(Value::as_str) {
            let trimmed = id_value.trim();
            if !trimmed.is_empty() {
                return format!("row={trimmed}");
            }
        }
        return "row updated".to_string();
    }

    if let Some(rows) = data_obj.get("rows").and_then(Value::as_array) {
        return format!("rows={}", rows.len());
    }

    if data_obj.get("summary").is_some() {
        return "snapshot ready".to_string();
    }

    if let Some(tables) = data_obj.get("tables").and_then(Value::as_array) {
        return format!("tables={}", tables.len());
    }

    "ok".to_string()
}

fn sanitize_mutation_payload(payload: Map<String, Value>) -> Map<String, Value> {
    let mut next_payload = payload;
    next_payload.remove("id");
    next_payload.remove("created_at");
    next_payload.remove("updated_at");
    next_payload
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

fn validate_identifier(identifier: &str) -> AppResult<&str> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Identifier cannot be empty.".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        || trimmed
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

fn normalize_role(role: &str) -> String {
    let value = role.trim().to_ascii_lowercase();
    if value.is_empty() {
        return "viewer".to_string();
    }
    value
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let mut result = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            break;
        }
        result.push(ch);
    }
    result
}

fn tool_error_detail(state: &AppState, error: &AppError) -> String {
    match error {
        AppError::BadRequest(_)
        | AppError::Forbidden(_)
        | AppError::NotFound(_)
        | AppError::Conflict(_)
        | AppError::Unauthorized(_)
        | AppError::UnprocessableEntity(_)
        | AppError::Gone(_) => error.detail_message(),
        _ => {
            if state.config.is_production() {
                "Tool execution failed.".to_string()
            } else {
                format!("Tool execution failed: {}", error.detail_message())
            }
        }
    }
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency("Database is not configured. Set DATABASE_URL.".to_string())
    })
}

fn db_error(_state: &AppState, error: &sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Database query failed");
    AppError::Dependency("External service request failed.".to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::Value;

    use super::{
        run_ai_agent_chat_streaming, AgentStreamEvent, RunAiAgentChatParams,
        AI_AGENT_DISABLED_MESSAGE,
    };
    use crate::{cache::CacheLayer, config::AppConfig, state::AppState};

    fn disabled_ai_state() -> AppState {
        let mut config = AppConfig::from_env();
        config.ai_agent_enabled = false;

        let config = Arc::new(config);
        let http_client = reqwest::Client::new();
        let llm_client =
            crate::services::llm_client::LlmClient::new(http_client.clone(), Arc::clone(&config));

        AppState {
            config,
            db_pool: None,
            http_client,
            llm_client,
            clerk_jwks_cache: None,
            org_membership_cache: CacheLayer::new(
                "org_membership",
                1000,
                std::time::Duration::from_secs(30),
            ),
            public_listings_cache: CacheLayer::new(
                "public_listings",
                500,
                std::time::Duration::from_secs(15),
            ),
            report_response_cache: CacheLayer::new(
                "reports",
                500,
                std::time::Duration::from_secs(20),
            ),
            enrichment_cache: CacheLayer::new(
                "enrichment",
                5000,
                std::time::Duration::from_secs(120),
            ),
            agent_config_cache: CacheLayer::new(
                "agent_config",
                2000,
                std::time::Duration::from_secs(60),
            ),
            fx_cache: CacheLayer::new("fx", 10, std::time::Duration::from_secs(3600)),
        }
    }

    #[tokio::test]
    async fn streaming_disabled_emits_error_then_done_and_returns_payload() {
        let state = disabled_ai_state();
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        let params = RunAiAgentChatParams {
            org_id: "11111111-1111-1111-1111-111111111111",
            role: "viewer",
            message: "health check",
            conversation: &[],
            allow_mutations: false,
            confirm_write: false,
            agent_name: "Operations Copilot",
            agent_prompt: None,
            allowed_tools: None,
            agent_slug: None,
            chat_id: None,
            requested_by_user_id: None,
            preferred_model: None,
            max_steps_override: None,
            runtime_context: None,
        };

        let payload = run_ai_agent_chat_streaming(&state, params, tx)
            .await
            .expect("disabled stream should return a fallback payload");

        match rx.recv().await {
            Some(AgentStreamEvent::Error { message }) => {
                assert_eq!(message, AI_AGENT_DISABLED_MESSAGE);
            }
            other => panic!("expected error event first, got {:?}", other),
        }

        match rx.recv().await {
            Some(AgentStreamEvent::Done {
                content,
                tool_trace,
                model_used,
                fallback_used,
                ..
            }) => {
                assert_eq!(content, AI_AGENT_DISABLED_MESSAGE);
                assert!(tool_trace.is_empty());
                assert!(model_used.is_none());
                assert!(!fallback_used);
            }
            other => panic!("expected done event second, got {:?}", other),
        }

        assert!(rx.recv().await.is_none());
        assert_eq!(
            payload.get("reply").and_then(Value::as_str),
            Some(AI_AGENT_DISABLED_MESSAGE)
        );
        assert_eq!(
            payload
                .get("tool_trace")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        assert_eq!(
            payload.get("mutations_enabled").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(payload.get("model_used"), Some(&Value::Null));
        assert_eq!(
            payload.get("fallback_used").and_then(Value::as_bool),
            Some(false)
        );
    }
}
