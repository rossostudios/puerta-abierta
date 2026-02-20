use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

use super::ai_agent::{
    run_ai_agent_chat, run_ai_agent_chat_streaming, AgentConversationMessage, AgentStreamEvent,
    RunAiAgentChatParams,
};

const MAX_CHAT_LIMIT: i64 = 100;
const MAX_MESSAGE_LIMIT: i64 = 300;
const CONTEXT_WINDOW: i64 = 20;

pub async fn list_agents(state: &AppState, org_id: &str) -> AppResult<Vec<Value>> {
    if org_id.trim().is_empty() {
        return Err(AppError::BadRequest("org_id is required.".to_string()));
    }

    let pool = db_pool(state)?;
    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row FROM (
            SELECT id, slug, name, description, icon_key, is_active
            FROM ai_agents
            WHERE is_active = TRUE
            ORDER BY name ASC
        ) t",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

pub fn list_models(state: &AppState) -> Vec<Value> {
    let model_chain = state.config.openai_model_chain();
    let primary = model_chain.first().cloned().unwrap_or_default();

    model_chain
        .into_iter()
        .map(|model| {
            json!({
                "model": model,
                "is_primary": model == primary,
            })
        })
        .collect()
}

pub async fn list_chats(
    state: &AppState,
    org_id: &str,
    user_id: &str,
    archived: bool,
    limit: i64,
) -> AppResult<Vec<Value>> {
    let bounded_limit = coerce_limit(limit, 30, 1, MAX_CHAT_LIMIT);
    let pool = db_pool(state)?;

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM ai_chats t
         WHERE organization_id = $1::uuid
           AND created_by_user_id = $2::uuid
           AND is_archived = $3
         ORDER BY last_message_at DESC
         LIMIT $4",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(archived)
    .bind(bounded_limit)
    .fetch_all(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let chats = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    if chats.is_empty() {
        return Ok(Vec::new());
    }

    let agent_ids = chats
        .iter()
        .filter_map(|chat| value_str(chat, "agent_id"))
        .collect::<Vec<_>>();

    let mut agent_map = std::collections::HashMap::<String, Value>::new();
    if !agent_ids.is_empty() {
        let agent_rows = sqlx::query(
            "SELECT row_to_json(t) AS row
             FROM (
                SELECT id, slug, name, description, icon_key, is_active
                FROM ai_agents
                WHERE id = ANY($1::uuid[])
             ) t",
        )
        .bind(&agent_ids)
        .fetch_all(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;

        for row in agent_rows {
            if let Some(item) = row.try_get::<Option<Value>, _>("row").ok().flatten() {
                if let Some(id) = value_str(&item, "id") {
                    agent_map.insert(id, item);
                }
            }
        }
    }

    let mut summaries = Vec::new();
    for chat in chats {
        let Some(agent_id) = value_str(&chat, "agent_id") else {
            continue;
        };
        let Some(agent) = agent_map.get(&agent_id) else {
            continue;
        };

        let preview = latest_preview_for_chat(
            state,
            value_str(&chat, "id").as_deref().unwrap_or_default(),
            org_id,
            user_id,
        )
        .await?;
        summaries.push(serialize_chat_summary(&chat, agent, preview));
    }

    Ok(summaries)
}

pub async fn create_chat(
    state: &AppState,
    org_id: &str,
    user_id: &str,
    agent_slug: &str,
    title: Option<&str>,
    preferred_model: Option<&str>,
) -> AppResult<Value> {
    let agent = get_agent_by_slug(state, agent_slug).await?;
    let fallback_title = value_str(&agent, "name").unwrap_or_else(|| "New chat".to_string());
    let chat_title = clean_title(title, &fallback_title);
    let preferred_model = validate_preferred_model(state, preferred_model)?;

    let pool = db_pool(state)?;
    let row = sqlx::query(
        "INSERT INTO ai_chats (
            organization_id,
            created_by_user_id,
            agent_id,
            title,
            preferred_model,
            is_archived
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, FALSE)
         RETURNING row_to_json(ai_chats.*) AS row",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(value_str(&agent, "id").unwrap_or_default())
    .bind(chat_title)
    .bind(preferred_model)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let chat = row
        .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::Internal("Could not create chat.".to_string()))?;

    Ok(serialize_chat_summary(&chat, &agent, None))
}

pub async fn update_chat_preferences(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
    preferred_model: Option<&str>,
) -> AppResult<Value> {
    let _chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let preferred_model = validate_preferred_model(state, preferred_model)?;
    let pool = db_pool(state)?;

    sqlx::query(
        "UPDATE ai_chats
         SET preferred_model = $1,
             updated_at = now()
         WHERE id = $2::uuid
           AND organization_id = $3::uuid
           AND created_by_user_id = $4::uuid",
    )
    .bind(preferred_model)
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    get_chat(state, chat_id, org_id, user_id).await
}

pub async fn get_chat(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Value> {
    let chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let agent_id = value_str(&chat, "agent_id").unwrap_or_default();
    let agent = get_agent_by_id(state, &agent_id).await?;
    let preview = latest_preview_for_chat(state, chat_id, org_id, user_id).await?;
    Ok(serialize_chat_summary(&chat, &agent, preview))
}

pub async fn list_chat_messages(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
    limit: i64,
) -> AppResult<Vec<Value>> {
    let _chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let bounded_limit = coerce_limit(limit, 80, 1, MAX_MESSAGE_LIMIT);

    let pool = db_pool(state)?;
    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM ai_chat_messages t
         WHERE chat_id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid
         ORDER BY created_at DESC
         LIMIT $4",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .bind(bounded_limit)
    .fetch_all(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let mut messages = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .map(|row| serialize_chat_message(&row))
        .collect::<Vec<_>>();

    messages.reverse();
    Ok(messages)
}

#[allow(clippy::too_many_arguments)]
pub async fn send_chat_message(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
    role: &str,
    message: &str,
    allow_mutations: bool,
    confirm_write: bool,
) -> AppResult<Map<String, Value>> {
    let chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let agent_id = value_str(&chat, "agent_id").unwrap_or_default();
    let agent = get_agent_by_id(state, &agent_id).await?;
    let preferred_model = value_str(&chat, "preferred_model");

    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return Err(AppError::BadRequest("message is required.".to_string()));
    }

    let conversation = collect_context_messages(state, chat_id, org_id, user_id).await?;
    let pool = db_pool(state)?;

    let user_row = sqlx::query(
        "INSERT INTO ai_chat_messages (chat_id, organization_id, role, content, created_by_user_id)
         VALUES ($1::uuid, $2::uuid, 'user', $3, $4::uuid)
         RETURNING row_to_json(ai_chat_messages.*) AS row",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(trimmed_message)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?
    .and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
    .ok_or_else(|| AppError::Internal("Could not persist user message.".to_string()))?;

    let agent_name = value_str(&agent, "name").unwrap_or_else(|| "Operations Copilot".to_string());
    let agent_prompt = value_str(&agent, "system_prompt");
    let agent_slug = value_str(&agent, "slug");
    let allowed_tools = agent_allowed_tools(&agent);

    let agent_result = run_ai_agent_chat(
        state,
        RunAiAgentChatParams {
            org_id,
            role,
            message: trimmed_message,
            conversation: &conversation,
            allow_mutations,
            confirm_write,
            agent_name: &agent_name,
            agent_prompt: agent_prompt.as_deref(),
            allowed_tools: allowed_tools.as_deref(),
            agent_slug: agent_slug.as_deref(),
            chat_id: Some(chat_id),
            requested_by_user_id: Some(user_id),
            preferred_model: preferred_model.as_deref(),
        },
    )
    .await?;

    let reply = agent_result
        .get("reply")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "No response generated.".to_string());

    let fallback_used = agent_result
        .get("fallback_used")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tool_trace = agent_result
        .get("tool_trace")
        .and_then(Value::as_array)
        .cloned();
    let model_used = agent_result
        .get("model_used")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let assistant_row = sqlx::query(
        "INSERT INTO ai_chat_messages (
            chat_id,
            organization_id,
            role,
            content,
            created_by_user_id,
            fallback_used,
            tool_trace,
            model_used
         ) VALUES ($1::uuid, $2::uuid, 'assistant', $3, $4::uuid, $5, $6, $7)
         RETURNING row_to_json(ai_chat_messages.*) AS row",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(&reply)
    .bind(user_id)
    .bind(fallback_used)
    .bind(tool_trace.clone().map(Value::Array))
    .bind(model_used.clone())
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?
    .and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
    .ok_or_else(|| AppError::Internal("Could not persist assistant message.".to_string()))?;

    let current_title = value_str(&chat, "title").unwrap_or_default();
    let agent_title = value_str(&agent, "name").unwrap_or_default();
    let generated_title =
        if current_title.trim().is_empty() || current_title.trim() == agent_title.trim() {
            let fallback = if current_title.trim().is_empty() {
                "New chat"
            } else {
                current_title.trim()
            };
            clean_title(Some(trimmed_message), fallback)
        } else {
            current_title.clone()
        };

    let assistant_created_at = value_str(&assistant_row, "created_at").unwrap_or_default();
    if !assistant_created_at.is_empty() {
        sqlx::query(
            "UPDATE ai_chats
             SET last_message_at = $1::timestamptz,
                 title = $2
             WHERE id = $3::uuid",
        )
        .bind(&assistant_created_at)
        .bind(&generated_title)
        .bind(chat_id)
        .execute(pool)
        .await
        .map_err(|error| supabase_error(state, &error))?;
    }

    let summary = get_chat(state, chat_id, org_id, user_id).await?;

    let mut payload = Map::new();
    payload.insert("chat".to_string(), summary);
    payload.insert(
        "user_message".to_string(),
        serialize_chat_message(&user_row),
    );
    payload.insert(
        "assistant_message".to_string(),
        serialize_chat_message(&assistant_row),
    );
    payload.insert("reply".to_string(), Value::String(reply));
    payload.insert(
        "tool_trace".to_string(),
        Value::Array(tool_trace.unwrap_or_default()),
    );
    payload.insert(
        "mutations_enabled".to_string(),
        Value::Bool(
            agent_result
                .get("mutations_enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ),
    );
    payload.insert(
        "model_used".to_string(),
        agent_result
            .get("model_used")
            .cloned()
            .unwrap_or(Value::Null),
    );
    payload.insert("fallback_used".to_string(), Value::Bool(fallback_used));

    Ok(payload)
}

/// Streaming variant: runs the agent with SSE events, saves messages to DB after completion.
#[allow(clippy::too_many_arguments)]
pub async fn send_chat_message_streaming(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
    role: &str,
    message: &str,
    allow_mutations: bool,
    confirm_write: bool,
    stream_tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
) -> AppResult<()> {
    let chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let agent_id = value_str(&chat, "agent_id").unwrap_or_default();
    let agent = get_agent_by_id(state, &agent_id).await?;
    let preferred_model = value_str(&chat, "preferred_model");

    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return Err(AppError::BadRequest("message is required.".to_string()));
    }

    let conversation = collect_context_messages(state, chat_id, org_id, user_id).await?;
    let pool = db_pool(state)?;

    // Save user message
    sqlx::query(
        "INSERT INTO ai_chat_messages (chat_id, organization_id, role, content, created_by_user_id)
         VALUES ($1::uuid, $2::uuid, 'user', $3, $4::uuid)",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(trimmed_message)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to save user message");
        AppError::Internal("Could not persist user message.".to_string())
    })?;

    let agent_name = value_str(&agent, "name").unwrap_or_else(|| "Operations Copilot".to_string());
    let agent_prompt = value_str(&agent, "system_prompt");
    let agent_slug = value_str(&agent, "slug");
    let allowed_tools = agent_allowed_tools(&agent);

    let agent_result = run_ai_agent_chat_streaming(
        state,
        RunAiAgentChatParams {
            org_id,
            role,
            message: trimmed_message,
            conversation: &conversation,
            allow_mutations,
            confirm_write,
            agent_name: &agent_name,
            agent_prompt: agent_prompt.as_deref(),
            allowed_tools: allowed_tools.as_deref(),
            agent_slug: agent_slug.as_deref(),
            chat_id: Some(chat_id),
            requested_by_user_id: Some(user_id),
            preferred_model: preferred_model.as_deref(),
        },
        stream_tx,
    )
    .await?;

    // Save assistant message
    let reply = agent_result
        .get("reply")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "No response generated.".to_string());

    let fallback_used = agent_result
        .get("fallback_used")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tool_trace = agent_result
        .get("tool_trace")
        .and_then(Value::as_array)
        .cloned();
    let model_used = agent_result
        .get("model_used")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let assistant_row = sqlx::query(
        "INSERT INTO ai_chat_messages (
            chat_id, organization_id, role, content, created_by_user_id,
            fallback_used, tool_trace, model_used
         ) VALUES ($1::uuid, $2::uuid, 'assistant', $3, $4::uuid, $5, $6, $7)
         RETURNING created_at",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(&reply)
    .bind(user_id)
    .bind(fallback_used)
    .bind(tool_trace.map(Value::Array))
    .bind(model_used)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Failed to save assistant message");
        AppError::Internal("Could not persist assistant message.".to_string())
    })?;

    // Update chat timestamp
    if let Some(row) = assistant_row {
        if let Ok(Some(ts)) = row.try_get::<Option<String>, _>("created_at") {
            let _ = sqlx::query(
                "UPDATE ai_chats SET last_message_at = $1::timestamptz WHERE id = $2::uuid",
            )
            .bind(&ts)
            .bind(chat_id)
            .execute(pool)
            .await;
        }
    }

    Ok(())
}

/// Get agent performance statistics for the last 30 days.
pub async fn get_agent_performance_stats(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    // Total conversations
    let total_conversations: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT chat_id)::bigint
         FROM ai_chat_messages
         WHERE organization_id = $1::uuid
           AND created_at > (now() - interval '30 days')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Total messages
    let total_messages: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM ai_chat_messages
         WHERE organization_id = $1::uuid
           AND created_at > (now() - interval '30 days')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Avg tool calls per assistant message
    let avg_tool_calls: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(jsonb_array_length(tool_trace)), 0)::float8
         FROM ai_chat_messages
         WHERE organization_id = $1::uuid
           AND role = 'assistant'
           AND tool_trace IS NOT NULL
           AND created_at > (now() - interval '30 days')",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    // Model usage breakdown
    let model_rows = sqlx::query(
        "SELECT model_used, COUNT(*)::bigint AS count
         FROM ai_chat_messages
         WHERE organization_id = $1::uuid
           AND role = 'assistant'
           AND model_used IS NOT NULL
           AND created_at > (now() - interval '30 days')
         GROUP BY model_used
         ORDER BY count DESC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let model_usage: Vec<Value> = model_rows
        .iter()
        .filter_map(|row| {
            let model: String = row.try_get("model_used").ok()?;
            let count: i64 = row.try_get("count").ok()?;
            Some(json!({ "model": model, "count": count }))
        })
        .collect();

    // Per-agent message counts
    let agent_rows = sqlx::query(
        "SELECT a.name AS agent_name, COUNT(m.id)::bigint AS message_count
         FROM ai_chat_messages m
         JOIN ai_chats c ON m.chat_id = c.id
         JOIN ai_agents a ON c.agent_id = a.id
         WHERE m.organization_id = $1::uuid
           AND m.created_at > (now() - interval '30 days')
         GROUP BY a.name
         ORDER BY message_count DESC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let per_agent: Vec<Value> = agent_rows
        .iter()
        .filter_map(|row| {
            let name: String = row.try_get("agent_name").ok()?;
            let count: i64 = row.try_get("message_count").ok()?;
            Some(json!({ "agent_name": name, "message_count": count }))
        })
        .collect();

    Ok(json!({
        "organization_id": org_id,
        "period_days": 30,
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "avg_tool_calls_per_response": (avg_tool_calls * 100.0).round() / 100.0,
        "model_usage": model_usage,
        "per_agent": per_agent,
    }))
}

pub async fn archive_chat(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Value> {
    let _chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let pool = db_pool(state)?;

    let row = sqlx::query(
        "UPDATE ai_chats
         SET is_archived = TRUE
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid
         RETURNING row_to_json(ai_chats.*) AS row",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?
    .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
    .ok_or_else(|| AppError::NotFound("Chat not found.".to_string()))?;

    Ok(row)
}

pub async fn restore_chat(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Value> {
    let _chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let pool = db_pool(state)?;

    let row = sqlx::query(
        "UPDATE ai_chats
         SET is_archived = FALSE
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid
         RETURNING row_to_json(ai_chats.*) AS row",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?
    .and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
    .ok_or_else(|| AppError::NotFound("Chat not found.".to_string()))?;

    Ok(row)
}

pub async fn delete_chat(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Value> {
    let chat = ensure_chat_owner(state, chat_id, org_id, user_id).await?;
    let pool = db_pool(state)?;

    sqlx::query(
        "DELETE FROM ai_chats
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    Ok(chat)
}

async fn get_agent_by_slug(state: &AppState, slug: &str) -> AppResult<Value> {
    let value = slug.trim();
    if value.is_empty() {
        return Err(AppError::BadRequest("agent_slug is required.".to_string()));
    }

    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM ai_agents t
         WHERE slug = $1
           AND is_active = TRUE
         LIMIT 1",
    )
    .bind(value)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound(format!("AI agent '{value}' was not found.")))
}

async fn get_agent_by_id(state: &AppState, agent_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM ai_agents t
         WHERE id = $1::uuid
           AND is_active = TRUE
         LIMIT 1",
    )
    .bind(agent_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("AI agent was not found.".to_string()))
}

async fn ensure_chat_owner(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Value> {
    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM ai_chats t
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid
         LIMIT 1",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Chat not found.".to_string()))
}

async fn latest_preview_for_chat(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Option<String>> {
    let pool = db_pool(state)?;

    let row = sqlx::query(
        "SELECT content
         FROM ai_chat_messages
         WHERE chat_id = $1::uuid
           AND organization_id = $2::uuid
           AND created_by_user_id = $3::uuid
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .bind(chat_id)
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| supabase_error(state, &error))?;

    let content = row
        .and_then(|item| item.try_get::<Option<String>, _>("content").ok().flatten())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok(content.map(|value| trim_preview(&value, 120)))
}

async fn collect_context_messages(
    state: &AppState,
    chat_id: &str,
    org_id: &str,
    user_id: &str,
) -> AppResult<Vec<AgentConversationMessage>> {
    let messages = list_chat_messages(state, chat_id, org_id, user_id, CONTEXT_WINDOW).await?;
    let mut context = Vec::new();

    for message in messages {
        let role = value_str(&message, "role")
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();
        let content = value_str(&message, "content")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();

        if matches!(role.as_str(), "user" | "assistant") && !content.is_empty() {
            context.push(AgentConversationMessage { role, content });
        }
    }

    let trim_at = context.len().saturating_sub(CONTEXT_WINDOW as usize);
    Ok(context.split_off(trim_at))
}

fn agent_allowed_tools(agent_row: &Value) -> Option<Vec<String>> {
    let raw = agent_row
        .as_object()
        .and_then(|obj| obj.get("allowed_tools"))
        .and_then(Value::as_array)?;

    let mut tools = Vec::new();
    for item in raw {
        let tool = item.as_str().map(str::trim).unwrap_or_default();
        if !tool.is_empty() && !tools.iter().any(|existing| existing == tool) {
            tools.push(tool.to_string());
        }
    }

    if tools.is_empty() {
        return None;
    }
    Some(tools)
}

fn serialize_chat_summary(
    chat: &Value,
    agent: &Value,
    latest_message_preview: Option<String>,
) -> Value {
    json!({
        "id": chat.as_object().and_then(|obj| obj.get("id")).cloned().unwrap_or(Value::Null),
        "org_id": chat.as_object().and_then(|obj| obj.get("organization_id")).cloned().unwrap_or(Value::Null),
        "agent_id": agent.as_object().and_then(|obj| obj.get("id")).cloned().unwrap_or(Value::Null),
        "agent_slug": agent.as_object().and_then(|obj| obj.get("slug")).cloned().unwrap_or(Value::Null),
        "agent_name": agent.as_object().and_then(|obj| obj.get("name")).cloned().unwrap_or(Value::Null),
        "agent_icon_key": agent.as_object().and_then(|obj| obj.get("icon_key")).cloned().unwrap_or(Value::Null),
        "title": chat.as_object().and_then(|obj| obj.get("title")).cloned().unwrap_or(Value::Null),
        "preferred_model": chat.as_object().and_then(|obj| obj.get("preferred_model")).cloned().unwrap_or(Value::Null),
        "is_archived": chat.as_object().and_then(|obj| obj.get("is_archived")).and_then(Value::as_bool).unwrap_or(false),
        "last_message_at": chat
            .as_object()
            .and_then(|obj| obj.get("last_message_at"))
            .cloned()
            .unwrap_or_else(|| chat.as_object().and_then(|obj| obj.get("created_at")).cloned().unwrap_or(Value::Null)),
        "created_at": chat.as_object().and_then(|obj| obj.get("created_at")).cloned().unwrap_or(Value::Null),
        "updated_at": chat.as_object().and_then(|obj| obj.get("updated_at")).cloned().unwrap_or(Value::Null),
        "latest_message_preview": latest_message_preview.map(Value::String).unwrap_or(Value::Null),
    })
}

fn serialize_chat_message(row: &Value) -> Value {
    json!({
        "id": row.as_object().and_then(|obj| obj.get("id")).cloned().unwrap_or(Value::Null),
        "chat_id": row.as_object().and_then(|obj| obj.get("chat_id")).cloned().unwrap_or(Value::Null),
        "org_id": row.as_object().and_then(|obj| obj.get("organization_id")).cloned().unwrap_or(Value::Null),
        "role": row.as_object().and_then(|obj| obj.get("role")).cloned().unwrap_or(Value::Null),
        "content": row.as_object().and_then(|obj| obj.get("content")).cloned().unwrap_or(Value::Null),
        "tool_trace": row.as_object().and_then(|obj| obj.get("tool_trace")).cloned().unwrap_or(Value::Null),
        "model_used": row.as_object().and_then(|obj| obj.get("model_used")).cloned().unwrap_or(Value::Null),
        "fallback_used": row.as_object().and_then(|obj| obj.get("fallback_used")).and_then(Value::as_bool).unwrap_or(false),
        "created_at": row.as_object().and_then(|obj| obj.get("created_at")).cloned().unwrap_or(Value::Null),
    })
}

fn trim_preview(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let char_count = normalized.chars().count();
    if char_count <= max_chars {
        return normalized;
    }

    let mut trimmed = normalized
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>();
    while trimmed.ends_with(char::is_whitespace) {
        trimmed.pop();
    }
    format!("{trimmed}...")
}

fn clean_title(value: Option<&str>, fallback: &str) -> String {
    let candidate = value.map(str::trim).unwrap_or_default();
    if candidate.is_empty() {
        return fallback.to_string();
    }

    if candidate.chars().count() > 180 {
        let mut next = candidate.chars().take(180).collect::<String>();
        while next.ends_with(char::is_whitespace) {
            next.pop();
        }
        return next;
    }

    candidate.to_string()
}

fn validate_preferred_model(
    state: &AppState,
    preferred_model: Option<&str>,
) -> AppResult<Option<String>> {
    let candidate = preferred_model.map(str::trim).unwrap_or_default();
    if candidate.is_empty() {
        return Ok(None);
    }

    let configured = state.config.openai_model_chain();
    if configured.iter().any(|model| model == candidate) {
        return Ok(Some(candidate.to_string()));
    }

    Err(AppError::BadRequest(format!(
        "preferred_model '{candidate}' is not configured for this environment."
    )))
}

fn coerce_limit(value: i64, default: i64, minimum: i64, maximum: i64) -> i64 {
    let parsed = if value <= 0 { default } else { value };
    parsed.clamp(minimum, maximum)
}

fn value_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn supabase_error(_state: &AppState, error: &sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Database query failed");
    AppError::Dependency("External service request failed.".to_string())
}
