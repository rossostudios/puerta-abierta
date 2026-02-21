use serde_json::{json, Map, Value};

use crate::{
    repository::table_service::{create_row, get_row, list_rows},
    services::ai_agent::{run_ai_agent_chat, AgentConversationMessage, RunAiAgentChatParams},
    state::AppState,
};

const GUEST_CONCIERGE_SLUG: &str = "guest-concierge";
const LOW_CONFIDENCE_THRESHOLD: f64 = 0.7;

/// Process an inbound guest message with the AI guest concierge agent.
/// Uses the full agent loop with tool calling (knowledge base, reservation lookup, etc.).
/// Returns the generated reply text and a confidence score (0.0-1.0).
pub async fn generate_ai_reply(
    state: &AppState,
    org_id: &str,
    sender_phone: &str,
    message_text: &str,
) -> Option<(String, f64)> {
    let pool = state.db_pool.as_ref()?;

    // Look up guest by phone
    let mut guest_filters = Map::new();
    guest_filters.insert(
        "phone_e164".to_string(),
        Value::String(sender_phone.to_string()),
    );
    guest_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );

    let guests = list_rows(pool, "guests", Some(&guest_filters), 1, 0, "created_at", false)
        .await
        .ok()?;

    let guest = guests.first()?;
    let guest_name = guest
        .as_object()
        .and_then(|o| o.get("full_name"))
        .and_then(Value::as_str)
        .unwrap_or("Guest");
    let guest_id = guest
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Find active reservations for context
    let mut res_filters = Map::new();
    res_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    res_filters.insert("guest_id".to_string(), Value::String(guest_id.to_string()));

    let reservations = list_rows(pool, "reservations", Some(&res_filters), 5, 0, "check_in_date", false)
        .await
        .unwrap_or_default();

    let active_reservation = reservations.iter().find(|r| {
        let status = r
            .as_object()
            .and_then(|o| o.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("");
        matches!(status, "confirmed" | "checked_in" | "pending")
    });

    let reservation_context = if let Some(res) = active_reservation {
        let check_in = val_str(res, "check_in_date");
        let check_out = val_str(res, "check_out_date");
        let status = val_str(res, "status");
        let unit_id = val_str(res, "unit_id");
        format!(
            "Active reservation: check-in {check_in}, check-out {check_out}, status: {status}, unit_id: {unit_id}"
        )
    } else {
        "No active reservation found.".to_string()
    };

    // Fetch org name
    let org = get_row(pool, "organizations", org_id, "id").await.ok();
    let org_name = org
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|o| o.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("the property");

    // Fetch the guest-concierge agent configuration
    let agent = sqlx::query_as::<_, AgentRow>(
        "SELECT slug, name, system_prompt, allowed_tools FROM ai_agents WHERE slug = $1 AND is_active = true",
    )
    .bind(GUEST_CONCIERGE_SLUG)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (agent_prompt, allowed_tools_json) = if let Some(ref agent) = agent {
        (
            agent.system_prompt.clone(),
            agent.allowed_tools.clone(),
        )
    } else {
        (default_concierge_prompt(), None)
    };

    // Build contextual prompt with guest/reservation info
    let contextual_prompt = format!(
        "{}\n\nCurrent context:\n- Property/Company: {org_name}\n- Guest name: {guest_name}\n- Guest phone: {sender_phone}\n- Guest ID: {guest_id}\n- {reservation_context}",
        agent_prompt
    );

    // Collect last 10 messages from message_logs for conversation history
    let conversation = load_conversation_history(pool, org_id, sender_phone, 10).await;

    // Parse allowed_tools from agent config
    let allowed_tools: Vec<String> = allowed_tools_json
        .as_ref()
        .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
        .unwrap_or_else(|| {
            vec![
                "search_knowledge".to_string(),
                "list_rows".to_string(),
                "get_row".to_string(),
                "send_message".to_string(),
            ]
        });
    let allowed_tools_refs: Vec<String> = allowed_tools.clone();

    // Run the full agent loop
    let result = run_ai_agent_chat(
        state,
        RunAiAgentChatParams {
            org_id,
            role: "operator",
            message: message_text,
            conversation: &conversation,
            allow_mutations: false,
            confirm_write: false,
            agent_name: "Guest Concierge",
            agent_prompt: Some(&contextual_prompt),
            allowed_tools: Some(&allowed_tools_refs),
            agent_slug: Some(GUEST_CONCIERGE_SLUG),
            chat_id: None,
            requested_by_user_id: None,
            preferred_model: None,
        },
    )
    .await;

    let result = match result {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Guest concierge agent failed: {e}");
            return None;
        }
    };

    let reply = result
        .get("reply")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    // Compute confidence based on reply content and tool usage
    let confidence = compute_confidence(&reply, &result);

    Some((reply, confidence))
}

/// Queue an AI-generated reply as an outbound message.
/// Low-confidence replies are routed to the approval queue instead of direct sending.
pub async fn queue_ai_reply(
    pool: &sqlx::PgPool,
    org_id: &str,
    recipient: &str,
    body: &str,
    confidence: f64,
) {
    if confidence < LOW_CONFIDENCE_THRESHOLD {
        // Route to approval queue instead of sending directly
        let mut approval = Map::new();
        approval.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        approval.insert(
            "agent_slug".to_string(),
            Value::String(GUEST_CONCIERGE_SLUG.to_string()),
        );
        approval.insert(
            "tool_name".to_string(),
            Value::String("send_message".to_string()),
        );
        approval.insert(
            "tool_args".to_string(),
            json!({
                "channel": "whatsapp",
                "recipient": recipient,
                "body": body,
            }),
        );
        approval.insert(
            "status".to_string(),
            Value::String("pending".to_string()),
        );

        let _ = create_row(pool, "agent_approvals", &approval).await;
        return;
    }

    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
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
    payload.insert("ai_confidence".to_string(), json!(confidence));
    msg.insert("payload".to_string(), Value::Object(payload));

    let _ = create_row(pool, "message_logs", &msg).await;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct AgentRow {
    #[allow(dead_code)]
    slug: String,
    #[allow(dead_code)]
    name: String,
    system_prompt: String,
    allowed_tools: Option<String>,
}

fn default_concierge_prompt() -> String {
    "You are a friendly, professional guest concierge for a property management company. \
     Respond to guest messages helpfully. Search the knowledge base for property-specific answers. \
     If unsure, say you will forward the message to the team. \
     Reply in the same language the guest uses. Keep responses concise (1-3 sentences)."
        .to_string()
}

/// Load recent conversation history from message_logs for a phone number.
async fn load_conversation_history(
    pool: &sqlx::PgPool,
    org_id: &str,
    phone: &str,
    limit: i64,
) -> Vec<AgentConversationMessage> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT direction, payload
         FROM message_logs
         WHERE organization_id = $1::uuid
           AND (recipient = $2 OR (payload ->> 'sender_phone') = $2)
           AND channel = 'whatsapp'
         ORDER BY created_at DESC
         LIMIT $3",
    )
    .bind(org_id)
    .bind(phone)
    .bind(limit)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut messages: Vec<AgentConversationMessage> = rows
        .iter()
        .filter_map(|row| {
            let direction: String = row.try_get("direction").ok()?;
            let payload: Value = row.try_get("payload").ok()?;
            let body = payload
                .as_object()
                .and_then(|p| p.get("body"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if body.is_empty() {
                return None;
            }

            let role = if direction == "inbound" {
                "user"
            } else {
                "assistant"
            };
            Some(AgentConversationMessage {
                role: role.to_string(),
                content: body.to_string(),
            })
        })
        .collect();

    // Reverse to chronological order (query was DESC)
    messages.reverse();
    messages
}

/// Compute confidence score based on reply content and tool trace.
fn compute_confidence(reply: &str, result: &Map<String, Value>) -> f64 {
    let lower = reply.to_lowercase();

    // Low confidence if the reply contains forwarding/uncertain language
    let forward_phrases = [
        "forward",
        "team",
        "manager",
        "get back to you",
        "check with",
        "not sure",
        "don't know",
        "reenviar",
        "equipo",
        "gerente",
        "le responderemos",
        "no estoy seguro",
        "no sé",
    ];
    let is_forwarding = forward_phrases
        .iter()
        .any(|phrase| lower.contains(phrase));

    if is_forwarding {
        return 0.3;
    }

    // Higher confidence if knowledge base was used successfully
    let tool_trace = result
        .get("tool_trace")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let knowledge_used = tool_trace.iter().any(|trace| {
        let name = trace
            .as_object()
            .and_then(|o| o.get("tool"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let ok = trace
            .as_object()
            .and_then(|o| o.get("ok"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        name == "search_knowledge" && ok
    });

    if knowledge_used {
        0.92
    } else {
        0.75
    }
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("unknown")
        .to_string()
}
