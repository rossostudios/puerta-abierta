use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Map, Value};
use tracing::{info, warn};

use crate::{
    config::AppConfig,
    repository::table_service::{get_row, list_rows, update_row},
};

/// Process all queued messages — poll `message_logs` where status = 'queued',
/// send via appropriate channel, update status.
pub async fn process_queued_messages(
    pool: &sqlx::PgPool,
    http_client: &Client,
    config: &AppConfig,
) -> (u32, u32) {
    let mut sent = 0u32;
    let mut failed = 0u32;

    let mut filters = Map::new();
    filters.insert("status".to_string(), Value::String("queued".to_string()));

    let messages = match list_rows(
        pool,
        "message_logs",
        Some(&filters),
        100,
        0,
        "created_at",
        true,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch queued messages: {e}");
            return (0, 0);
        }
    };

    for msg in messages {
        let id = val_str(&msg, "id");
        let channel = val_str(&msg, "channel");
        let recipient = val_str(&msg, "recipient");

        if id.is_empty() || recipient.is_empty() {
            continue;
        }

        // Resolve template body if template_id is present
        let body = resolve_message_body(pool, &msg).await;

        let result = match channel.as_str() {
            "whatsapp" => send_whatsapp(http_client, config, &recipient, &body, &msg).await,
            "email" => send_email(http_client, config, &recipient, &body, &msg).await,
            _ => {
                warn!("Unknown channel '{channel}' for message {id}");
                Err("unsupported channel".to_string())
            }
        };

        let mut patch = Map::new();
        match result {
            Ok(provider_response) => {
                patch.insert("status".to_string(), Value::String("sent".to_string()));
                patch.insert(
                    "sent_at".to_string(),
                    Value::String(Utc::now().to_rfc3339()),
                );
                if let Some(resp) = provider_response {
                    patch.insert("provider_response".to_string(), resp);
                }
                sent += 1;
            }
            Err(err_msg) => {
                patch.insert("status".to_string(), Value::String("failed".to_string()));
                patch.insert("error_message".to_string(), Value::String(err_msg));
                failed += 1;
            }
        }

        let _ = update_row(pool, "message_logs", &id, &patch, "id").await;
    }

    info!("Processed messages: {sent} sent, {failed} failed");
    (sent, failed)
}

/// Resolve template variables into a message body string.
async fn resolve_message_body(pool: &sqlx::PgPool, msg: &Value) -> String {
    let template_id = val_str(msg, "template_id");
    let payload = msg
        .as_object()
        .and_then(|o| o.get("payload"))
        .cloned()
        .unwrap_or(Value::Object(Map::new()));

    if template_id.is_empty() {
        // No template — use payload as-is for a simple text message
        return payload
            .as_object()
            .and_then(|o| o.get("body"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
    }

    let template = match get_row(pool, "message_templates", &template_id, "id").await {
        Ok(t) => t,
        Err(_) => return String::new(),
    };

    let mut body = val_str(&template, "body");

    // Replace {{variable}} placeholders with values from payload
    if let Some(payload_obj) = payload.as_object() {
        for (key, value) in payload_obj {
            let placeholder = format!("{{{{{key}}}}}");
            let replacement = match value {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => value.to_string(),
            };
            body = body.replace(&placeholder, &replacement);
        }
    }

    body
}

/// Send a WhatsApp message via the Cloud API.
/// Supports both plain text messages and template messages.
///
/// If the message payload contains `whatsapp_template_name`, sends a template message
/// (required by Meta for business-initiated conversations outside the 24-hour window).
/// Otherwise sends a plain text message.
async fn send_whatsapp(
    http_client: &Client,
    config: &AppConfig,
    recipient: &str,
    body: &str,
    msg: &Value,
) -> Result<Option<Value>, String> {
    let phone_id = config
        .whatsapp_phone_number_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "WHATSAPP_PHONE_NUMBER_ID not configured".to_string())?;

    let access_token = config
        .whatsapp_access_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "WHATSAPP_ACCESS_TOKEN not configured".to_string())?;

    let url = format!("https://graph.facebook.com/v21.0/{phone_id}/messages");

    // Check if this is a template message
    let msg_payload = msg.as_object().and_then(|o| o.get("payload"));
    let template_name = msg_payload
        .and_then(Value::as_object)
        .and_then(|o| o.get("whatsapp_template_name"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    let api_payload = if let Some(tpl_name) = template_name {
        // Template message (for business-initiated conversations)
        let language_code = msg_payload
            .and_then(Value::as_object)
            .and_then(|o| o.get("whatsapp_template_language"))
            .and_then(Value::as_str)
            .unwrap_or("es");

        let template_params = msg_payload
            .and_then(Value::as_object)
            .and_then(|o| o.get("whatsapp_template_params"))
            .and_then(Value::as_array);

        let mut template = json!({
            "name": tpl_name,
            "language": { "code": language_code }
        });

        // Add template parameter components if provided
        if let Some(params) = template_params {
            let components = json!([{
                "type": "body",
                "parameters": params.iter().map(|p| {
                    json!({
                        "type": "text",
                        "text": p.as_str().unwrap_or_default()
                    })
                }).collect::<Vec<_>>()
            }]);
            template
                .as_object_mut()
                .unwrap()
                .insert("components".to_string(), components);
        }

        json!({
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": template
        })
    } else {
        // Plain text message (for replies within 24-hour window)
        json!({
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "text",
            "text": {
                "body": body
            }
        })
    };

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&api_payload)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "WhatsApp API request failed");
            "WhatsApp API request failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(Some(resp_body))
    } else {
        let error_msg = resp_body
            .as_object()
            .and_then(|o| o.get("error"))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown WhatsApp API error");
        Err(format!("WhatsApp API error ({status}): {error_msg}"))
    }
}

/// Send an email via Resend API.
async fn send_email(
    http_client: &Client,
    config: &AppConfig,
    recipient: &str,
    body: &str,
    msg: &Value,
) -> Result<Option<Value>, String> {
    let api_key = config
        .resend_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "RESEND_API_KEY not configured".to_string())?;

    let from_address = &config.email_from_address;

    // Try to get subject from template or payload
    let subject = msg
        .as_object()
        .and_then(|o| o.get("payload"))
        .and_then(Value::as_object)
        .and_then(|o| o.get("subject"))
        .and_then(Value::as_str)
        .unwrap_or("Puerta Abierta — Notificación");

    let payload = json!({
        "from": from_address,
        "to": [recipient],
        "subject": subject,
        "html": format!("<div style=\"font-family: sans-serif; max-width: 600px; margin: 0 auto;\">{body}</div>"),
    });

    let response = http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Resend API request failed");
            "Resend API request failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(Some(resp_body))
    } else {
        let error_msg = resp_body
            .as_object()
            .and_then(|o| o.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown Resend API error");
        Err(format!("Resend API error ({status}): {error_msg}"))
    }
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
