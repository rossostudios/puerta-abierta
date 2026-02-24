use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::sse::{Event, Sse},
    Json,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use tokio_stream::wrappers::ReceiverStream;

use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    services::{agent_chats, audit::write_audit_log},
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

    let result = agent_chats::send_chat_message(
        &state,
        &path.chat_id,
        &query.org_id,
        &user_id,
        &role,
        &payload.message,
        allow_mutations,
        confirm_write,
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

    // Spawn the agent execution in a background task
    let state_clone = state.clone();
    let chat_id = path.chat_id.clone();
    let org_id = query.org_id.clone();
    let user_id_clone = user_id.clone();
    let role_clone = role.clone();
    let message = payload.message.clone();
    let allow_mutations = payload.allow_mutations.unwrap_or(true);
    let confirm_write = payload.confirm_write.unwrap_or(true);

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
            tx,
        )
        .await;

        if let Err(error) = result {
            tracing::error!(error = %error, "Streaming agent chat failed");
        }
    });

    // Forward agent stream events as SSE events
    let sse_tx_clone = sse_tx.clone();
    tokio::spawn(async move {
        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            let data = serde_json::to_string(&event).unwrap_or_default();
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
        "message_id": path.message_id,
        "feedback_rating": rating,
        "feedback_reason": reason,
    })))
}
