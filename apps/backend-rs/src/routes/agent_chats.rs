use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::sse::{Event, Sse},
    Json,
};
use chrono::Timelike;
use serde::Deserialize;
use serde_json::{Map, Value};
use tokio_stream::wrappers::ReceiverStream;

use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    services::{
        agent_chats,
        agent_runtime_v2::{inject_runtime_metadata, wrap_stream_event, RuntimeExecutionIds},
        audit::write_audit_log,
    },
    state::AppState,
    tenancy::assert_org_member,
};

#[derive(Debug, Clone, Deserialize)]
struct AgentOrgQuery {
    org_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentChatsQuery {
    org_id: String,
    #[serde(default)]
    archived: bool,
    #[serde(default = "default_limit_30")]
    limit: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentChatMessagesQuery {
    org_id: String,
    #[serde(default = "default_limit_120")]
    limit: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateAgentChatInput {
    org_id: String,
    agent_slug: String,
    title: Option<String>,
    preferred_model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SendAgentMessageInput {
    message: String,
    #[serde(default)]
    allow_mutations: Option<bool>,
    #[serde(default)]
    confirm_write: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentChatPath {
    chat_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentChatMessagePath {
    chat_id: String,
    message_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct MessageFeedbackInput {
    rating: String,
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateChatPreferencesInput {
    preferred_model: Option<String>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/agent/agents", axum::routing::get(get_agent_definitions))
        .route("/agent/models", axum::routing::get(get_agent_models))
        .route(
            "/agent/chats",
            axum::routing::get(get_agent_chats).post(create_agent_chat),
        )
        .route(
            "/agent/chats/{chat_id}",
            axum::routing::get(get_agent_chat).delete(delete_agent_chat),
        )
        .route(
            "/agent/chats/{chat_id}/preferences",
            axum::routing::patch(update_chat_preferences),
        )
        .route(
            "/agent/chats/{chat_id}/messages",
            axum::routing::get(get_agent_chat_messages).post(post_agent_chat_message),
        )
        .route(
            "/agent/chats/{chat_id}/messages/stream",
            axum::routing::post(post_agent_chat_message_stream),
        )
        .route(
            "/agent/chats/{chat_id}/archive",
            axum::routing::post(archive_agent_chat),
        )
        .route(
            "/agent/chats/{chat_id}/restore",
            axum::routing::post(restore_agent_chat),
        )
        .route(
            "/agent/chats/{chat_id}/messages/{message_id}/feedback",
            axum::routing::post(post_message_feedback),
        )
        .route("/agent/traces", axum::routing::get(get_agent_traces))
        .route(
            "/agent/evaluations/summary",
            axum::routing::get(get_evaluations_summary),
        )
        .route(
            "/agent/chats/contextual-prompts",
            axum::routing::get(get_contextual_prompts),
        )
        .route("/agent/memory", axum::routing::get(list_agent_memory))
        .route(
            "/agent/memory/{memory_id}",
            axum::routing::delete(delete_agent_memory),
        )
        .route(
            "/agent/pii-intercepts",
            axum::routing::get(list_pii_intercepts),
        )
        .route(
            "/agent/boundary-rules",
            axum::routing::get(list_boundary_rules),
        )
        .route(
            "/agent/boundary-rules/{rule_id}",
            axum::routing::put(update_boundary_rule),
        )
        .route(
            "/agent/security-audit",
            axum::routing::get(get_security_audit),
        )
}

async fn get_agent_definitions(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let data = agent_chats::list_agents(&state, &query.org_id).await?;
    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "data": data,
    })))
}

async fn get_agent_chats(
    State(state): State<AppState>,
    Query(query): Query<AgentChatsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let data =
        agent_chats::list_chats(&state, &query.org_id, &user_id, query.archived, query.limit)
            .await?;

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "archived": query.archived,
        "data": data,
    })))
}

async fn get_agent_models(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let data = agent_chats::list_models(&state);
    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "data": data,
    })))
}

async fn create_agent_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAgentChatInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.org_id).await?;

    let chat = agent_chats::create_chat(
        &state,
        &payload.org_id,
        &user_id,
        &payload.agent_slug,
        payload.title.as_deref(),
        payload.preferred_model.as_deref(),
    )
    .await?;

    let entity_id = value_str(&chat, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.org_id),
        Some(&user_id),
        "agent.chat.create",
        "ai_chat",
        entity_id.as_deref(),
        None,
        Some(serde_json::json!({
            "agent_slug": payload.agent_slug,
            "title": value_str(&chat, "title"),
            "preferred_model": value_str(&chat, "preferred_model"),
        })),
    )
    .await;

    Ok(Json(chat))
}

async fn get_agent_chat(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let chat = agent_chats::get_chat(&state, &path.chat_id, &query.org_id, &user_id).await?;
    Ok(Json(chat))
}

async fn get_agent_chat_messages(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentChatMessagesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let data = agent_chats::list_chat_messages(
        &state,
        &path.chat_id,
        &query.org_id,
        &user_id,
        query.limit,
    )
    .await?;

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "chat_id": path.chat_id,
        "data": data,
    })))
}

async fn update_chat_preferences(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<UpdateChatPreferencesInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let chat = agent_chats::update_chat_preferences(
        &state,
        &path.chat_id,
        &query.org_id,
        &user_id,
        payload.preferred_model.as_deref(),
    )
    .await?;

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "chat_id": path.chat_id,
        "chat": chat,
    })))
}

async fn post_agent_chat_message(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<SendAgentMessageInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    let role = membership
        .as_object()
        .and_then(|obj| obj.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("viewer")
        .to_string();

    let allow_mutations = payload.allow_mutations.unwrap_or(true);
    let confirm_write = payload.confirm_write.unwrap_or(true);
    let runtime_ids = RuntimeExecutionIds::generate();

    let result = agent_chats::send_chat_message(
        &state,
        &path.chat_id,
        &query.org_id,
        &user_id,
        &role,
        &payload.message,
        allow_mutations,
        confirm_write,
        Some(&runtime_ids),
    )
    .await?;

    if allow_mutations {
        write_audit_log(
            state.db_pool.as_ref(),
            Some(&query.org_id),
            Some(&user_id),
            "agent.chat.write_attempt",
            "ai_chat",
            Some(&path.chat_id),
            None,
            Some(serde_json::json!({
                "role": role,
                "confirm_write": confirm_write,
                "tool_trace_count": tool_trace_count(&result),
                "mutations_enabled": result
                    .get("mutations_enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })),
        )
        .await;
    }

    let mut response = Map::new();
    response.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    response.insert("chat_id".to_string(), Value::String(path.chat_id.clone()));
    response.insert("role".to_string(), Value::String(role));
    response.extend(result);
    inject_runtime_metadata(&mut response, &runtime_ids);

    Ok(Json(Value::Object(response)))
}

async fn post_agent_chat_message_stream(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<SendAgentMessageInput>,
) -> AppResult<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>> {
    let user_id = require_user_id(&state, &headers).await?;
    let membership = assert_org_member(&state, &user_id, &query.org_id).await?;
    let role = membership
        .as_object()
        .and_then(|obj| obj.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("viewer")
        .to_string();

    let (tx, rx) = tokio::sync::mpsc::channel(32);
    let (sse_tx, sse_rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(32);
    let runtime_ids = RuntimeExecutionIds::generate();

    // Spawn the agent execution in a background task
    let state_clone = state.clone();
    let chat_id = path.chat_id.clone();
    let org_id = query.org_id.clone();
    let user_id_clone = user_id.clone();
    let role_clone = role.clone();
    let message = payload.message.clone();
    let allow_mutations = payload.allow_mutations.unwrap_or(true);
    let confirm_write = payload.confirm_write.unwrap_or(true);
    let runtime_ids_for_run = runtime_ids.clone();

    tokio::spawn(async move {
        let result = agent_chats::send_chat_message_streaming(
            &state_clone,
            &chat_id,
            &org_id,
            &user_id_clone,
            &role_clone,
            &message,
            allow_mutations,
            confirm_write,
            Some(&runtime_ids_for_run),
            tx,
        )
        .await;

        if let Err(error) = result {
            tracing::error!(error = %error, "Streaming agent chat failed");
        }
    });

    // Forward agent stream events as SSE events
    let sse_tx_clone = sse_tx.clone();
    let runtime_ids_clone = runtime_ids.clone();
    tokio::spawn(async move {
        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            let wrapped = wrap_stream_event(event, &runtime_ids_clone);
            let data = serde_json::to_string(&wrapped).unwrap_or_default();
            let sse_event = Event::default().data(data);
            if sse_tx_clone.send(Ok(sse_event)).await.is_err() {
                break;
            }
        }
    });

    let stream = ReceiverStream::new(sse_rx);
    Ok(Sse::new(stream))
}

async fn archive_agent_chat(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let chat = agent_chats::archive_chat(&state, &path.chat_id, &query.org_id, &user_id).await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&query.org_id),
        Some(&user_id),
        "agent.chat.archive",
        "ai_chat",
        Some(&path.chat_id),
        None,
        Some(serde_json::json!({ "is_archived": true })),
    )
    .await;

    Ok(Json(serde_json::json!({
        "ok": true,
        "organization_id": query.org_id,
        "chat_id": path.chat_id,
        "is_archived": chat
            .as_object()
            .and_then(|obj| obj.get("is_archived"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })))
}

async fn restore_agent_chat(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let chat = agent_chats::restore_chat(&state, &path.chat_id, &query.org_id, &user_id).await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&query.org_id),
        Some(&user_id),
        "agent.chat.restore",
        "ai_chat",
        Some(&path.chat_id),
        None,
        Some(serde_json::json!({
            "is_archived": chat
                .as_object()
                .and_then(|obj| obj.get("is_archived"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })),
    )
    .await;

    Ok(Json(serde_json::json!({
        "ok": true,
        "organization_id": query.org_id,
        "chat_id": path.chat_id,
        "is_archived": chat
            .as_object()
            .and_then(|obj| obj.get("is_archived"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })))
}

async fn delete_agent_chat(
    State(state): State<AppState>,
    Path(path): Path<AgentChatPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let deleted = agent_chats::delete_chat(&state, &path.chat_id, &query.org_id, &user_id).await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&query.org_id),
        Some(&user_id),
        "agent.chat.delete",
        "ai_chat",
        Some(&path.chat_id),
        Some(serde_json::json!({
            "title": value_str(&deleted, "title"),
            "is_archived": deleted
                .as_object()
                .and_then(|obj| obj.get("is_archived"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })),
        None,
    )
    .await;

    Ok(Json(serde_json::json!({
        "ok": true,
        "organization_id": query.org_id,
        "chat_id": path.chat_id,
    })))
}

fn default_limit_30() -> i64 {
    30
}

fn default_limit_120() -> i64 {
    120
}

fn tool_trace_count(result: &Map<String, Value>) -> usize {
    result
        .get("tool_trace")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn value_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

// ---------------------------------------------------------------------------
// Agent Traces & Evaluation Summary routes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct AgentTracesQuery {
    org_id: String,
    #[serde(default)]
    chat_id: Option<String>,
    #[serde(default)]
    agent_slug: Option<String>,
    #[serde(default = "default_limit_30")]
    limit: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct EvalSummaryQuery {
    org_id: String,
    #[serde(default = "default_period_7d")]
    period: String,
}

fn default_period_7d() -> String {
    "7d".to_string()
}

async fn get_agent_traces(
    State(state): State<AppState>,
    Query(query): Query<AgentTracesQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| crate::error::AppError::Dependency("Database not configured.".into()))?;

    let limit = query.limit.clamp(1, 200);

    let rows = if let Some(ref chat_id) = query.chat_id {
        sqlx::query(
            "SELECT row_to_json(t) AS row FROM agent_traces t
             WHERE organization_id = $1::uuid AND chat_id = $2::uuid
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(&query.org_id)
        .bind(chat_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if let Some(ref slug) = query.agent_slug {
        sqlx::query(
            "SELECT row_to_json(t) AS row FROM agent_traces t
             WHERE organization_id = $1::uuid AND agent_slug = $2
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(&query.org_id)
        .bind(slug)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT row_to_json(t) AS row FROM agent_traces t
             WHERE organization_id = $1::uuid
             ORDER BY created_at DESC LIMIT $2",
        )
        .bind(&query.org_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load agent traces");
        crate::error::AppError::Dependency("Failed to load agent traces.".into())
    })?;

    let data: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect();

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "data": data,
        "count": data.len(),
    })))
}

async fn get_evaluations_summary(
    State(state): State<AppState>,
    Query(query): Query<EvalSummaryQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| crate::error::AppError::Dependency("Database not configured.".into()))?;

    let interval_days = match query.period.as_str() {
        "1d" => 1,
        "30d" => 30,
        _ => 7,
    };

    let rows = sqlx::query(
        "SELECT
            agent_slug,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE outcome = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE outcome = 'rejected')::int AS rejected,
            AVG(accuracy_score)::float8 AS avg_accuracy,
            AVG(helpfulness_score)::float8 AS avg_helpfulness,
            AVG(safety_score)::float8 AS avg_safety,
            SUM(COALESCE(tokens_used, 0))::bigint AS total_tokens
         FROM agent_evaluations
         WHERE organization_id = $1::uuid
           AND created_at >= now() - ($2::int || ' days')::interval
         GROUP BY agent_slug
         ORDER BY total DESC",
    )
    .bind(&query.org_id)
    .bind(interval_days)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut agents = Vec::new();
    for row in &rows {
        agents.push(serde_json::json!({
            "agent_slug": row.try_get::<String, _>("agent_slug").unwrap_or_default(),
            "total": row.try_get::<i32, _>("total").unwrap_or(0),
            "approved": row.try_get::<i32, _>("approved").unwrap_or(0),
            "rejected": row.try_get::<i32, _>("rejected").unwrap_or(0),
            "avg_accuracy": row.try_get::<Option<f64>, _>("avg_accuracy").ok().flatten(),
            "avg_helpfulness": row.try_get::<Option<f64>, _>("avg_helpfulness").ok().flatten(),
            "avg_safety": row.try_get::<Option<f64>, _>("avg_safety").ok().flatten(),
            "total_tokens": row.try_get::<i64, _>("total_tokens").unwrap_or(0),
        }));
    }

    Ok(Json(serde_json::json!({
        "organization_id": query.org_id,
        "period": query.period,
        "agents": agents,
    })))
}

// ---------------------------------------------------------------------------
// POST /agent/chats/{chat_id}/messages/{message_id}/feedback
// ---------------------------------------------------------------------------

async fn post_message_feedback(
    State(state): State<AppState>,
    Path(path): Path<AgentChatMessagePath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<MessageFeedbackInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let rating = payload.rating.trim().to_string();
    if !matches!(rating.as_str(), "positive" | "negative") {
        return Err(AppError::BadRequest(
            "rating must be 'positive' or 'negative'.".to_string(),
        ));
    }

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    let reason = payload
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    // Update the ai_chat_messages row with feedback
    let updated = sqlx::query(
        "UPDATE ai_chat_messages
         SET feedback_rating = $1,
             feedback_at = now(),
             feedback_reason = $4
         WHERE id = $2::uuid
           AND chat_id = $3::uuid
           AND role = 'assistant'
         RETURNING chat_id, feedback_rating",
    )
    .bind(&rating)
    .bind(&path.message_id)
    .bind(&path.chat_id)
    .bind(&reason)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to update message feedback");
        AppError::Dependency("Failed to save feedback.".to_string())
    })?;

    if updated.is_none() {
        return Err(AppError::NotFound(
            "Message not found or not an assistant message.".to_string(),
        ));
    }

    // Also insert an agent_evaluations record to feed the confidence scoring loop
    let outcome = if rating == "positive" {
        "approved"
    } else {
        "rejected"
    };

    // Look up agent_slug from the chat
    let agent_slug: String = sqlx::query_scalar(
        "SELECT COALESCE(agent_slug, 'unknown') FROM ai_chats WHERE id = $1::uuid",
    )
    .bind(&path.chat_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "unknown".to_string());

    let _ = sqlx::query(
        "INSERT INTO agent_evaluations (organization_id, agent_slug, outcome, created_at)
         VALUES ($1::uuid, $2, $3, now())",
    )
    .bind(&query.org_id)
    .bind(&agent_slug)
    .bind(outcome)
    .execute(pool)
    .await;

    Ok(Json(serde_json::json!({
        "ok": true,
        "registered": true,
        "memory_updated": reason.is_some(),
        "message_id": path.message_id,
        "feedback_rating": rating,
        "feedback_reason": reason,
    })))
}

// ---------------------------------------------------------------------------
// Contextual Prompts (S13.2)
// ---------------------------------------------------------------------------

async fn get_contextual_prompts(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    let mut suggestions: Vec<Value> = Vec::new();

    // Check for pending approvals
    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_approvals WHERE organization_id = $1::uuid AND status = 'pending'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if pending_count > 0 {
        suggestions.push(serde_json::json!({
            "text": format!("Review {} pending approval{}", pending_count, if pending_count > 1 { "s" } else { "" }),
            "category": "approvals"
        }));
    }

    // Check for active anomalies
    let anomaly_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM anomaly_alerts WHERE organization_id = $1::uuid AND is_dismissed = false AND detected_at >= now() - interval '24 hours'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if anomaly_count > 0 {
        suggestions.push(serde_json::json!({
            "text": format!("Investigate {} active anomal{}", anomaly_count, if anomaly_count > 1 { "ies" } else { "y" }),
            "category": "anomalies"
        }));
    }

    // Check for upcoming check-ins
    let checkin_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reservations WHERE organization_id = $1::uuid AND check_in_date = CURRENT_DATE AND status IN ('confirmed', 'pending')",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if checkin_count > 0 {
        suggestions.push(serde_json::json!({
            "text": format!("Prepare for {} check-in{} today", checkin_count, if checkin_count > 1 { "s" } else { "" }),
            "category": "operations"
        }));
    }

    // Check for overdue tasks
    let overdue_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tasks WHERE organization_id = $1::uuid AND status NOT IN ('done', 'cancelled') AND due_date < CURRENT_DATE",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if overdue_count > 0 {
        suggestions.push(serde_json::json!({
            "text": format!("Address {} overdue task{}", overdue_count, if overdue_count > 1 { "s" } else { "" }),
            "category": "tasks"
        }));
    }

    // Time-based suggestion
    let hour = chrono::Utc::now().hour();
    if hour < 12 {
        suggestions.push(serde_json::json!({
            "text": "Give me today's top priorities",
            "category": "general"
        }));
    } else {
        suggestions.push(serde_json::json!({
            "text": "Summarize today's activity so far",
            "category": "general"
        }));
    }

    Ok(Json(serde_json::json!({
        "data": suggestions
    })))
}

// ---------------------------------------------------------------------------
// Approval Policies (S14.2)
// ---------------------------------------------------------------------------

#[allow(dead_code)]
async fn get_approval_policies(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    let rows: Vec<Value> = sqlx::query(
        "SELECT row_to_json(t) AS row FROM agent_approval_policies t WHERE organization_id = $1::uuid",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| row.try_get::<Value, _>("row").ok())
    .collect();

    Ok(Json(serde_json::json!({ "data": rows })))
}

// ---------------------------------------------------------------------------
// Governance endpoints (S15.4)
// ---------------------------------------------------------------------------

async fn list_agent_memory(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    let rows: Vec<Value> = sqlx::query(
        "SELECT id, agent_slug, memory_tier, memory_key AS content, score, created_at
         FROM agent_memory WHERE organization_id = $1::uuid
         ORDER BY created_at DESC LIMIT 200",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| {
        Some(serde_json::json!({
            "id": row.try_get::<String, _>("id").ok()?,
            "agent_slug": row.try_get::<String, _>("agent_slug").unwrap_or_default(),
            "memory_tier": row.try_get::<String, _>("memory_tier").unwrap_or_else(|_| "episodic".into()),
            "content": row.try_get::<String, _>("content").unwrap_or_default(),
            "score": row.try_get::<f64, _>("score").ok(),
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }))
    })
    .collect();

    Ok(Json(serde_json::json!({ "data": rows })))
}

#[derive(Debug, Clone, Deserialize)]
struct MemoryPath {
    memory_id: String,
}

async fn delete_agent_memory(
    State(state): State<AppState>,
    Path(path): Path<MemoryPath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    sqlx::query("DELETE FROM agent_memory WHERE id = $1::uuid AND organization_id = $2::uuid")
        .bind(&path.memory_id)
        .bind(&query.org_id)
        .execute(pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to delete agent memory");
            AppError::Dependency("Failed to delete memory.".to_string())
        })?;

    Ok(Json(
        serde_json::json!({ "ok": true, "id": path.memory_id }),
    ))
}

async fn list_pii_intercepts(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    // Return from pii_intercept_log if table exists, otherwise empty
    let rows: Vec<Value> = sqlx::query(
        "SELECT id, agent_slug, pii_type, action_taken, detected_at
         FROM pii_intercept_log WHERE organization_id = $1::uuid
         ORDER BY detected_at DESC LIMIT 200",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| {
        Some(serde_json::json!({
            "id": row.try_get::<String, _>("id").ok()?,
            "agent_slug": row.try_get::<String, _>("agent_slug").unwrap_or_default(),
            "pii_type": row.try_get::<String, _>("pii_type").unwrap_or_default(),
            "action_taken": row.try_get::<String, _>("action_taken").unwrap_or_else(|_| "blocked".into()),
            "detected_at": row.try_get::<String, _>("detected_at").unwrap_or_default(),
        }))
    })
    .collect();

    Ok(Json(serde_json::json!({ "data": rows })))
}

async fn list_boundary_rules(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    let rows: Vec<Value> = sqlx::query(
        "SELECT id, category, is_blocked, custom_response
         FROM agent_boundary_rules WHERE organization_id = $1::uuid
         ORDER BY category",
    )
    .bind(&query.org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| {
        Some(serde_json::json!({
            "id": row.try_get::<String, _>("id").ok()?,
            "category": row.try_get::<String, _>("category").unwrap_or_default(),
            "is_blocked": row.try_get::<bool, _>("is_blocked").unwrap_or(false),
            "custom_response": row.try_get::<Option<String>, _>("custom_response").ok().flatten(),
        }))
    })
    .collect();

    Ok(Json(serde_json::json!({ "data": rows })))
}

#[derive(Debug, Clone, Deserialize)]
struct BoundaryRulePath {
    rule_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateBoundaryRuleInput {
    is_blocked: bool,
    custom_response: Option<String>,
}

async fn update_boundary_rule(
    State(state): State<AppState>,
    Path(path): Path<BoundaryRulePath>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
    Json(payload): Json<UpdateBoundaryRuleInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    sqlx::query(
        "UPDATE agent_boundary_rules SET is_blocked = $1, custom_response = $2, updated_at = now()
         WHERE id = $3::uuid AND organization_id = $4::uuid",
    )
    .bind(payload.is_blocked)
    .bind(&payload.custom_response)
    .bind(&path.rule_id)
    .bind(&query.org_id)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to update boundary rule");
        AppError::Dependency("Failed to update boundary rule.".to_string())
    })?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "id": path.rule_id,
        "is_blocked": payload.is_blocked,
    })))
}

async fn get_security_audit(
    State(state): State<AppState>,
    Query(query): Query<AgentOrgQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;

    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".into()))?;

    // Aggregate counts from agent_traces and related tables for last 30 days
    let total_interactions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_traces WHERE organization_id = $1::uuid AND created_at >= now() - interval '30 days'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let pii_intercepts: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pii_intercept_log WHERE organization_id = $1::uuid AND detected_at >= now() - interval '30 days'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let approval_overrides: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_approvals WHERE organization_id = $1::uuid AND status = 'rejected' AND created_at >= now() - interval '30 days'",
    )
    .bind(&query.org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "total_interactions": total_interactions,
        "pii_intercepts": pii_intercepts,
        "boundary_violations": 0,
        "approval_overrides": approval_overrides,
        "avg_response_time_ms": 0,
        "timeline": []
    })))
}
