use reqwest::Client;
use serde_json::{json, Map, Value};

use crate::{
    config::AppConfig,
    repository::table_service::{create_row, get_row, list_rows},
};

/// Process an inbound guest message with AI auto-reply.
/// Returns the generated reply text and a confidence score (0.0–1.0).
pub async fn generate_ai_reply(
    pool: &sqlx::PgPool,
    http_client: &Client,
    config: &AppConfig,
    org_id: &str,
    sender_phone: &str,
    message_text: &str,
) -> Option<(String, f64)> {
    let api_key = config.openai_api_key.as_deref().filter(|s| !s.is_empty())?;
    let model = config.openai_model_chain().first()?.clone();

    // Gather context: active reservations for this guest's phone
    let mut guest_filters = Map::new();
    guest_filters.insert(
        "phone_e164".to_string(),
        Value::String(sender_phone.to_string()),
    );
    guest_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );

    let guests = list_rows(
        pool,
        "guests",
        Some(&guest_filters),
        1,
        0,
        "created_at",
        false,
    )
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

    // Find active reservations
    let mut res_filters = Map::new();
    res_filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    res_filters.insert("guest_id".to_string(), Value::String(guest_id.to_string()));

    let reservations = list_rows(
        pool,
        "reservations",
        Some(&res_filters),
        5,
        0,
        "check_in_date",
        false,
    )
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
        let check_in = res
            .as_object()
            .and_then(|o| o.get("check_in_date"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let check_out = res
            .as_object()
            .and_then(|o| o.get("check_out_date"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let status = res
            .as_object()
            .and_then(|o| o.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        format!("Active reservation: check-in {check_in}, check-out {check_out}, status: {status}")
    } else {
        "No active reservation found.".to_string()
    };

    // Fetch org details for context
    let org = get_row(pool, "organizations", org_id, "id").await.ok();
    let org_name = org
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|o| o.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("the property");

    let system_prompt = format!(
        "You are a helpful guest communication assistant for {org_name}, a property management company. \
        Respond to guest messages in a friendly, professional tone. \
        If you are confident in the answer, reply directly. \
        If you are unsure, say you will forward the message to the team. \
        Always respond in the same language the guest uses. \
        Keep responses concise (1-3 sentences).\n\n\
        Context:\n\
        - Guest name: {guest_name}\n\
        - {reservation_context}"
    );

    let payload = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message_text},
        ],
        "max_tokens": 300,
        "temperature": 0.3,
    });

    let response = http_client
        .post(config.openai_chat_completions_url())
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&payload)
        .send()
        .await
        .ok()?;

    let body: Value = response.json().await.ok()?;

    let reply = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)?
        .trim()
        .to_string();

    if reply.is_empty() {
        return None;
    }

    // Simple confidence heuristic: if reply contains forwarding language, low confidence
    let forward_phrases = [
        "forward",
        "team",
        "manager",
        "get back to you",
        "check with",
        "reenviar",
        "equipo",
        "gerente",
        "le responderemos",
    ];
    let is_forwarding = forward_phrases
        .iter()
        .any(|phrase| reply.to_lowercase().contains(phrase));

    let confidence = if is_forwarding { 0.3 } else { 0.85 };

    Some((reply, confidence))
}

/// Queue an AI-generated reply as an outbound message.
pub async fn queue_ai_reply(
    pool: &sqlx::PgPool,
    org_id: &str,
    recipient: &str,
    body: &str,
    confidence: f64,
) {
    let status = "queued";

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
    msg.insert("status".to_string(), Value::String(status.to_string()));
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
