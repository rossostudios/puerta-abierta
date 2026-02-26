use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// Orchestrate a voice agent interaction using TTS (ElevenLabs) + STT (Whisper) + agent loop.
/// This is called from the Twilio webhook route when an incoming call is received.
pub async fn handle_voice_interaction(
    state: &AppState,
    org_id: &str,
    caller_phone: &str,
    audio_url: Option<&str>,
) -> AppResult<Value> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))?;

    // 1. Look up caller in guest/tenant records
    let caller_info: Option<(String, String)> = sqlx::query_as(
        "SELECT id::text, full_name FROM guests
         WHERE organization_id = $1::uuid AND phone = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(caller_phone)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (guest_id, caller_name) = caller_info.unwrap_or_default();

    // 2. If audio provided, transcribe with Whisper
    let transcript = if let Some(url) = audio_url {
        transcribe_audio(state, url).await.unwrap_or_default()
    } else {
        String::new()
    };

    // 3. Route to appropriate agent based on transcript content
    let agent_slug = classify_voice_intent(&transcript);

    // 4. Log the voice interaction
    let mut msg = serde_json::Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String("voice".to_string()));
    msg.insert(
        "recipient".to_string(),
        Value::String(caller_phone.to_string()),
    );
    msg.insert(
        "direction".to_string(),
        Value::String("inbound".to_string()),
    );
    msg.insert("status".to_string(), Value::String("received".to_string()));
    let mut payload = serde_json::Map::new();
    payload.insert("body".to_string(), Value::String(transcript.clone()));
    payload.insert("guest_id".to_string(), Value::String(guest_id.clone()));
    payload.insert(
        "caller_name".to_string(),
        Value::String(caller_name.clone()),
    );
    payload.insert(
        "routed_to_agent".to_string(),
        Value::String(agent_slug.to_string()),
    );
    msg.insert("payload".to_string(), Value::Object(payload));
    let _ = crate::repository::table_service::create_row(pool, "message_logs", &msg).await;

    Ok(json!({
        "ok": true,
        "caller_phone": caller_phone,
        "caller_name": caller_name,
        "guest_id": guest_id,
        "transcript": transcript,
        "routed_to_agent": agent_slug,
    }))
}

/// Transcribe audio using OpenAI Whisper API.
async fn transcribe_audio(state: &AppState, audio_url: &str) -> Result<String, String> {
    let api_key = state
        .config
        .openai_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "OPENAI_API_KEY not configured".to_string())?;

    // Download audio
    let audio_bytes = state
        .http_client
        .get(audio_url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to download audio: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read audio bytes: {e}"))?;

    let base_url = state.config.openai_api_base_url.trim_end_matches('/');
    let whisper_url = format!("{base_url}/v1/audio/transcriptions");

    let part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Multipart error: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .text("language", "es")
        .part("file", part);

    let response = state
        .http_client
        .post(&whisper_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Whisper API request failed: {e}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Whisper response: {e}"))?;

    Ok(body
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

/// Classify voice intent to route to appropriate agent.
fn classify_voice_intent(transcript: &str) -> &'static str {
    let lower = transcript.to_lowercase();
    if lower.contains("maintenance")
        || lower.contains("repair")
        || lower.contains("broken")
        || lower.contains("mantenimiento")
        || lower.contains("roto")
    {
        "maintenance-triage"
    } else if lower.contains("payment")
        || lower.contains("rent")
        || lower.contains("pago")
        || lower.contains("alquiler")
    {
        "finance-agent"
    } else if lower.contains("lease") || lower.contains("contract") || lower.contains("contrato") {
        "leasing-agent"
    } else if lower.contains("guest") || lower.contains("check-in") || lower.contains("huésped") {
        "guest-concierge"
    } else {
        "supervisor"
    }
}

/// Generate TTS audio response using ElevenLabs.
pub async fn generate_voice_response(state: &AppState, text: &str) -> Result<Vec<u8>, String> {
    let api_key = state
        .config
        .elevenlabs_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "ELEVENLABS_API_KEY not configured".to_string())?;

    let voice_id = state
        .config
        .elevenlabs_voice_id
        .as_deref()
        .unwrap_or("21m00Tcm4TlvDq8ikWAM"); // Default voice

    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}");

    let response = state
        .http_client
        .post(&url)
        .header("xi-api-key", api_key)
        .json(&json!({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
            }
        }))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("ElevenLabs API failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("ElevenLabs API returned {}", response.status()));
    }

    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read TTS audio: {e}"))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 7: Voice Agent — tools callable via ai_agent dispatch
// ───────────────────────────────────────────────────────────────────────

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
}

/// Look up a caller in the guest/tenant database by phone number.
pub async fn tool_voice_lookup_caller(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let phone = args
        .get("phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if phone.is_empty() {
        return Ok(json!({ "ok": false, "error": "phone is required." }));
    }

    // Check guests
    let guest = sqlx::query(
        "SELECT id::text, full_name, email, phone, preferred_language
         FROM guests
         WHERE organization_id = $1::uuid AND phone = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(phone)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(g) = guest {
        return Ok(json!({
            "ok": true,
            "found": true,
            "type": "guest",
            "id": g.try_get::<String, _>("id").unwrap_or_default(),
            "name": g.try_get::<String, _>("full_name").unwrap_or_default(),
            "email": g.try_get::<Option<String>, _>("email").ok().flatten(),
            "phone": phone,
            "language": g.try_get::<Option<String>, _>("preferred_language").ok().flatten(),
        }));
    }

    // Check tenants (app_users with active leases)
    let tenant = sqlx::query(
        "SELECT u.id::text, u.full_name, u.email, u.phone,
                l.id::text AS lease_id, un.name AS unit_name
         FROM app_users u
         JOIN leases l ON l.tenant_id = u.id
         JOIN units un ON un.id = l.unit_id
         WHERE l.organization_id = $1::uuid AND u.phone = $2
           AND l.status IN ('active', 'pending')
         LIMIT 1",
    )
    .bind(org_id)
    .bind(phone)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(t) = tenant {
        return Ok(json!({
            "ok": true,
            "found": true,
            "type": "tenant",
            "id": t.try_get::<String, _>("id").unwrap_or_default(),
            "name": t.try_get::<String, _>("full_name").unwrap_or_default(),
            "email": t.try_get::<Option<String>, _>("email").ok().flatten(),
            "phone": phone,
            "lease_id": t.try_get::<Option<String>, _>("lease_id").ok().flatten(),
            "unit_name": t.try_get::<Option<String>, _>("unit_name").ok().flatten(),
        }));
    }

    Ok(json!({
        "ok": true,
        "found": false,
        "phone": phone,
    }))
}

/// Create a maintenance request from a voice interaction.
pub async fn tool_voice_create_maintenance_request(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Voice maintenance request");
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let caller_phone = args
        .get("caller_phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let urgency = args
        .get("urgency")
        .and_then(Value::as_str)
        .unwrap_or("medium");

    if description.is_empty() {
        return Ok(json!({ "ok": false, "error": "description is required." }));
    }

    let result = sqlx::query(
        "INSERT INTO maintenance_requests
            (organization_id, title, description, status, source, submitted_by_phone, unit_id, ai_urgency)
         VALUES ($1::uuid, $2, $3, 'open', 'voice', $4, $5::uuid, $6)
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(title)
    .bind(description)
    .bind(caller_phone)
    .bind(unit_id)
    .bind(urgency)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create voice maintenance request");
        AppError::Dependency("Failed to create maintenance request.".to_string())
    })?;

    let request_id: String = result.try_get("id").unwrap_or_default();

    Ok(json!({
        "ok": true,
        "request_id": request_id,
        "title": title,
        "urgency": urgency,
        "source": "voice",
    }))
}

/// Check reservation status for a caller.
pub async fn tool_voice_check_reservation(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let phone = args
        .get("phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let guest_name = args
        .get("guest_name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if phone.is_empty() && guest_name.is_empty() {
        return Ok(json!({ "ok": false, "error": "phone or guest_name is required." }));
    }

    let reservations = sqlx::query(
        "SELECT r.id::text, r.status, r.check_in::text, r.check_out::text,
                r.total_price::float8, r.currency,
                un.name AS unit_name, p.name AS property_name
         FROM reservations r
         JOIN units un ON un.id = r.unit_id
         JOIN properties p ON p.id = un.property_id
         LEFT JOIN guests g ON g.id = r.guest_id
         WHERE r.organization_id = $1::uuid
           AND r.status IN ('confirmed', 'checked_in', 'pending')
           AND (
               ($2 != '' AND g.phone = $2)
               OR ($3 != '' AND g.full_name ILIKE '%' || $3 || '%')
           )
         ORDER BY r.check_in ASC
         LIMIT 5",
    )
    .bind(org_id)
    .bind(phone)
    .bind(guest_name)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let results: Vec<Value> = reservations
        .iter()
        .map(|r| {
            json!({
                "reservation_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "check_in": r.try_get::<Option<String>, _>("check_in").ok().flatten(),
                "check_out": r.try_get::<Option<String>, _>("check_out").ok().flatten(),
                "total_price": r.try_get::<f64, _>("total_price").unwrap_or(0.0),
                "currency": r.try_get::<String, _>("currency").unwrap_or_default(),
                "unit_name": r.try_get::<String, _>("unit_name").unwrap_or_default(),
                "property_name": r.try_get::<String, _>("property_name").unwrap_or_default(),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "found": !results.is_empty(),
        "count": results.len(),
        "reservations": results,
    }))
}

/// Log a completed voice interaction to the database.
pub async fn tool_log_voice_interaction(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let caller_phone = args
        .get("caller_phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let duration = args
        .get("duration_seconds")
        .and_then(Value::as_i64)
        .unwrap_or(0) as i32;
    let language = args.get("language").and_then(Value::as_str).unwrap_or("es");
    let actions = args
        .get("actions_taken")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let direction = args
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or("inbound");

    let result = sqlx::query(
        "INSERT INTO voice_interactions
            (organization_id, caller_phone, direction, status, duration_seconds,
             language, summary, actions_taken)
         VALUES ($1::uuid, $2, $3, 'completed', $4, $5, $6, $7::jsonb)
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(caller_phone)
    .bind(direction)
    .bind(duration)
    .bind(language)
    .bind(summary)
    .bind(&actions)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to log voice interaction");
        AppError::Dependency("Failed to log voice interaction.".to_string())
    })?;

    let interaction_id: String = result.try_get("id").unwrap_or_default();

    Ok(json!({
        "ok": true,
        "interaction_id": interaction_id,
    }))
}
