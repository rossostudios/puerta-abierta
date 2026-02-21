use std::sync::Mutex;

use serde_json::{json, Map, Value};

use crate::{
    repository::table_service::{create_row, get_row, list_rows},
    services::ai_agent::{run_ai_agent_chat, AgentConversationMessage, RunAiAgentChatParams},
    state::AppState,
};

/// Cached approval rate: (multiplier, timestamp_secs)
static APPROVAL_RATE_CACHE: Mutex<Option<(f64, u64)>> = Mutex::new(None);
const CACHE_TTL_SECS: u64 = 3600; // 1 hour

const GUEST_CONCIERGE_SLUG: &str = "guest-concierge";
const LOW_CONFIDENCE_THRESHOLD: f64 = 0.8;

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

    let reservation_context;
    let mut unit_context = String::new();
    let mut property_context = String::new();
    let mut listing_context = String::new();

    if let Some(res) = active_reservation {
        let check_in = val_str(res, "check_in_date");
        let check_out = val_str(res, "check_out_date");
        let status = val_str(res, "status");
        let unit_id = val_str(res, "unit_id");
        let property_id = val_str(res, "property_id");
        reservation_context = format!(
            "Active reservation: check-in {check_in}, check-out {check_out}, status: {status}"
        );

        // Enrich with unit details (amenities, WiFi, beds)
        if !unit_id.is_empty() {
            if let Ok(unit) = get_row(pool, "units", &unit_id, "id").await {
                let bedrooms = unit.as_object().and_then(|o| o.get("bedrooms")).and_then(|v| v.as_i64()).unwrap_or(0);
                let bathrooms = unit.as_object().and_then(|o| o.get("bathrooms")).and_then(|v| v.as_i64()).unwrap_or(0);
                let max_guests = unit.as_object().and_then(|o| o.get("max_guests")).and_then(|v| v.as_i64()).unwrap_or(0);
                let wifi_name = val_str(&unit, "wifi_network_name");
                let wifi_pass = val_str(&unit, "wifi_password");
                let amenities = val_str(&unit, "amenities");
                let unit_name = val_str(&unit, "name");

                let mut parts = vec![format!("Unit: {unit_name}")];
                if bedrooms > 0 { parts.push(format!("{bedrooms} bedroom(s)")); }
                if bathrooms > 0 { parts.push(format!("{bathrooms} bathroom(s)")); }
                if max_guests > 0 { parts.push(format!("max {max_guests} guests")); }
                if !wifi_name.is_empty() {
                    parts.push(format!("WiFi: {wifi_name}"));
                    if !wifi_pass.is_empty() {
                        parts.push(format!("WiFi password: {wifi_pass}"));
                    }
                }
                if !amenities.is_empty() { parts.push(format!("Amenities: {amenities}")); }
                unit_context = parts.join(", ");
            }
        }

        // Enrich with property details (address, access instructions)
        let prop_id = if !property_id.is_empty() { &property_id } else { &unit_id };
        if !prop_id.is_empty() {
            if let Ok(property) = get_row(pool, "properties", prop_id, "id").await {
                let address = val_str(&property, "address");
                let access_instructions = val_str(&property, "access_instructions");
                let property_name = val_str(&property, "name");

                let mut parts = vec![format!("Property: {property_name}")];
                if !address.is_empty() { parts.push(format!("Address: {address}")); }
                if !access_instructions.is_empty() {
                    parts.push(format!("Access instructions: {access_instructions}"));
                }
                property_context = parts.join(", ");
            }
        }

        // Enrich with listing details (house rules, check-in/out times)
        if !unit_id.is_empty() {
            let mut listing_filters = Map::new();
            listing_filters.insert("unit_id".to_string(), Value::String(unit_id.clone()));
            listing_filters.insert("organization_id".to_string(), Value::String(org_id.to_string()));
            if let Ok(listings) = list_rows(pool, "listings", Some(&listing_filters), 1, 0, "created_at", false).await {
                if let Some(listing) = listings.first() {
                    let house_rules = val_str(listing, "house_rules");
                    let checkin_time = val_str(listing, "check_in_time");
                    let checkout_time = val_str(listing, "check_out_time");

                    let mut parts = Vec::new();
                    if !checkin_time.is_empty() { parts.push(format!("Check-in time: {checkin_time}")); }
                    if !checkout_time.is_empty() { parts.push(format!("Check-out time: {checkout_time}")); }
                    if !house_rules.is_empty() { parts.push(format!("House rules: {house_rules}")); }
                    if !parts.is_empty() {
                        listing_context = parts.join(", ");
                    }
                }
            }
        }
    } else {
        reservation_context = "No active reservation found.".to_string();
    }

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

    // Build contextual prompt with guest/reservation/unit/property info
    let mut context_lines = vec![
        format!("- Property/Company: {org_name}"),
        format!("- Guest name: {guest_name}"),
        format!("- Guest phone: {sender_phone}"),
        format!("- Guest ID: {guest_id}"),
        format!("- {reservation_context}"),
    ];
    if !unit_context.is_empty() {
        context_lines.push(format!("- {unit_context}"));
    }
    if !property_context.is_empty() {
        context_lines.push(format!("- {property_context}"));
    }
    if !listing_context.is_empty() {
        context_lines.push(format!("- {listing_context}"));
    }

    let contextual_prompt = format!(
        "{}\n\nCurrent context:\n{}",
        agent_prompt,
        context_lines.join("\n")
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

    // Compute confidence based on reply content, tool usage, and historical approval rate
    let confidence = compute_confidence(pool, &reply, &result).await;

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

/// Compute confidence score based on reply content, tool trace, and response quality.
///
/// Returns a composite score in [0.0, 1.0] weighted across multiple factors:
/// - Base score starts at 0.5
/// - Forwarding/uncertain language: heavy penalty (-0.3)
/// - Successful tool calls: +0.05 each (up to +0.15)
/// - Knowledge base match: +0.2
/// - Response length (substantive replies): +0.1
/// - Historical approval rate: multiplier of 0.5 + 0.5 * approval_rate
async fn compute_confidence(pool: &sqlx::PgPool, reply: &str, result: &Map<String, Value>) -> f64 {
    let lower = reply.to_lowercase();

    let forward_phrases = [
        "forward",
        "get back to you",
        "check with",
        "not sure",
        "don't know",
        "i'll ask",
        "let me find out",
        "reenviar",
        "le responderemos",
        "no estoy seguro",
        "no sé",
        "voy a consultar",
        "déjame averiguar",
    ];
    let is_forwarding = forward_phrases
        .iter()
        .any(|phrase| lower.contains(phrase));

    let tool_trace = result
        .get("tool_trace")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let successful_tool_calls = tool_trace
        .iter()
        .filter(|trace| {
            trace
                .as_object()
                .and_then(|o| o.get("ok"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();

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

    // Base score
    let mut score: f64 = 0.5;

    // Forwarding penalty
    if is_forwarding {
        score -= 0.3;
    }

    // Tool call success bonus (up to +0.15)
    score += (successful_tool_calls as f64 * 0.05).min(0.15);

    // Knowledge base bonus
    if knowledge_used {
        score += 0.2;
    }

    // Response length bonus — substantive replies (>100 chars) get a boost
    if reply.len() > 100 {
        score += 0.1;
    }

    // Historical approval rate factor: query recent approved/rejected outcomes
    // over the last 30 days for the guest-concierge agent.
    // approval_rate = approved / (approved + rejected); if no data, defaults to 1.0.
    // Multiplier: 0.5 + 0.5 * approval_rate
    let approval_multiplier = get_approval_rate_multiplier(pool).await;
    score *= approval_multiplier;

    score.clamp(0.0, 1.0)
}

/// Query the 30-day approval rate for the guest-concierge agent.
/// Returns a multiplier in [0.5, 1.0]: at 100% approval → 1.0, at 50% → 0.75, at 0% → 0.5.
async fn get_approval_rate_multiplier(pool: &sqlx::PgPool) -> f64 {
    // Check cache first (1-hour TTL)
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if let Ok(guard) = APPROVAL_RATE_CACHE.lock() {
        if let Some((cached_rate, cached_at)) = *guard {
            if now_secs.saturating_sub(cached_at) < CACHE_TTL_SECS {
                return cached_rate;
            }
        }
    }

    // Query both agent_approvals and agent_evaluations for a combined rate
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT
            COALESCE(SUM(approved_count), 0),
            COALESCE(SUM(total_count), 0)
         FROM (
            SELECT
                SUM(CASE WHEN status IN ('approved', 'executed') THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN status IN ('approved', 'executed', 'rejected', 'execution_failed') THEN 1 ELSE 0 END) AS total_count
            FROM agent_approvals
            WHERE agent_slug = $1
              AND created_at > now() - interval '30 days'
            UNION ALL
            SELECT
                SUM(CASE WHEN outcome = 'approved' THEN 1 ELSE 0 END) AS approved_count,
                COUNT(*) AS total_count
            FROM agent_evaluations
            WHERE agent_slug = $1
              AND created_at > now() - interval '30 days'
         ) combined",
    )
    .bind(GUEST_CONCIERGE_SLUG)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (approved, total) = row.unwrap_or((0, 0));
    let multiplier = if total == 0 {
        1.0 // No data — don't penalize
    } else {
        let approval_rate = approved as f64 / total as f64;
        0.5 + 0.5 * approval_rate
    };

    // Update cache
    if let Ok(mut guard) = APPROVAL_RATE_CACHE.lock() {
        *guard = Some((multiplier, now_secs));
    }

    multiplier
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("unknown")
        .to_string()
}
