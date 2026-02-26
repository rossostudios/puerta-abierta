use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::Value;

use crate::state::AppState;

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/voice/incoming", axum::routing::post(handle_incoming_call))
        .route("/voice/status", axum::routing::post(handle_call_status))
}

#[derive(Deserialize)]
struct IncomingCallPayload {
    #[serde(rename = "From")]
    from: Option<String>,
    #[serde(rename = "To")]
    to: Option<String>,
    #[serde(rename = "CallSid")]
    call_sid: Option<String>,
    #[serde(rename = "RecordingUrl")]
    recording_url: Option<String>,
    #[serde(rename = "SpeechResult")]
    speech_result: Option<String>,
}

/// POST /voice/incoming — Twilio voice webhook for incoming calls.
/// Returns TwiML to gather speech or play a response.
async fn handle_incoming_call(
    State(state): State<AppState>,
    Json(payload): Json<IncomingCallPayload>,
) -> impl IntoResponse {
    let caller = payload.from.as_deref().unwrap_or("unknown");
    let call_sid = payload.call_sid.as_deref().unwrap_or("unknown");

    tracing::info!(caller, call_sid, "Voice: incoming call");

    // If we have speech result, process it through the voice agent
    if let Some(speech) = &payload.speech_result {
        if !speech.is_empty() {
            let response = process_voice_input(&state, caller, speech).await;
            let twiml = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice" language="es-MX">{}</Say>
    <Gather input="speech" language="es-MX" speechTimeout="3" action="/v1/voice/incoming">
        <Say voice="alice" language="es-MX">¿Hay algo más en que pueda ayudarle?</Say>
    </Gather>
</Response>"#,
                xml_escape(&response)
            );
            return (StatusCode::OK, [("Content-Type", "text/xml")], twiml);
        }
    }

    // Initial greeting with speech gather
    let twiml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" language="es-MX" speechTimeout="3" action="/v1/voice/incoming">
        <Say voice="alice" language="es-MX">Hola, bienvenido a Casaora. ¿En qué puedo ayudarle?</Say>
    </Gather>
    <Say voice="alice" language="es-MX">No recibí respuesta. Hasta luego.</Say>
</Response>"#
        .to_string();

    (StatusCode::OK, [("Content-Type", "text/xml")], twiml)
}

/// POST /voice/status — Twilio call status callback.
async fn handle_call_status(
    State(_state): State<AppState>,
    Json(payload): Json<Value>,
) -> impl IntoResponse {
    let call_sid = payload
        .get("CallSid")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let status = payload
        .get("CallStatus")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    tracing::info!(call_sid, status, "Voice: call status update");

    StatusCode::OK
}

/// Process voice input through the AI agent system.
async fn process_voice_input(state: &AppState, caller: &str, speech: &str) -> String {
    // Try to find the caller's org by phone number
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return "Lo siento, el sistema no está disponible en este momento.".to_string(),
    };

    // Look up caller by phone
    let org_id: Option<String> = sqlx::query_scalar(
        "SELECT o.id::text
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id
         JOIN app_users u ON u.id = om.user_id
         WHERE u.phone = $1
         LIMIT 1",
    )
    .bind(caller)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let org_id = match org_id {
        Some(id) => id,
        None => {
            // Check if caller is a tenant/guest
            let guest_org: Option<String> = sqlx::query_scalar(
                "SELECT organization_id::text FROM guests WHERE phone = $1 AND is_active = true LIMIT 1",
            )
            .bind(caller)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

            match guest_org {
                Some(id) => id,
                None => {
                    return "No pudimos identificar su cuenta. Por favor contacte al administrador.".to_string();
                }
            }
        }
    };

    // Route to guest-concierge agent for voice interactions
    let params = crate::services::ai_agent::RunAiAgentChatParams {
        org_id: &org_id,
        role: "tenant",
        message: speech,
        conversation: &[],
        allow_mutations: false,
        confirm_write: true,
        agent_name: "Guest Concierge",
        agent_prompt: Some(
            "You are answering a phone call. Keep responses very short (1-2 sentences) and conversational. Respond in Spanish.",
        ),
        allowed_tools: Some(&["search_knowledge".to_string(), "list_rows".to_string(), "get_row".to_string()]),
        agent_slug: Some("guest-concierge"),
        chat_id: None,
        requested_by_user_id: None,
        preferred_model: None,
    };

    match crate::services::ai_agent::run_ai_agent_chat(state, params).await {
        Ok(result) => result
            .get("reply")
            .and_then(|v| v.as_str())
            .unwrap_or("Lo siento, no pude procesar su solicitud.")
            .to_string(),
        Err(e) => {
            tracing::error!(error = %e, "Voice agent failed");
            "Lo siento, ocurrió un error. Por favor intente nuevamente.".to_string()
        }
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
