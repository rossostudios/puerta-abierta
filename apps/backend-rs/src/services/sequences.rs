use chrono::Utc;
use serde_json::{Map, Value};
use tracing::{info, warn};

use crate::repository::table_service::{create_row, list_rows, update_row};

/// Process all active sequence enrollments where next_send_at <= now.
/// Called by cron via /internal/process-messages or a dedicated endpoint.
pub async fn process_sequences(pool: &sqlx::PgPool) -> (u32, u32) {
    let mut sent = 0u32;
    let mut errors = 0u32;

    // Fetch enrollments where next_send_at <= now and status = active
    let enrollments = match sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT row_to_json(t) FROM sequence_enrollments t WHERE status = 'active' AND next_send_at <= now() ORDER BY next_send_at LIMIT 100"
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch sequence enrollments: {e}");
            return (0, 0);
        }
    };

    for enrollment in enrollments {
        let Some(obj) = enrollment.as_object() else {
            continue;
        };

        let enrollment_id = val_str(obj.get("id"));
        let sequence_id = val_str(obj.get("sequence_id"));
        let org_id = val_str(obj.get("organization_id"));
        let current_step = obj
            .get("current_step")
            .and_then(Value::as_i64)
            .unwrap_or(1) as i32;
        let recipient = val_str(obj.get("recipient"));
        let context: Map<String, Value> = obj
            .get("context")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        if enrollment_id.is_empty() || sequence_id.is_empty() || recipient.is_empty() {
            continue;
        }

        // Find the current step
        let mut step_filters = Map::new();
        step_filters.insert("sequence_id".to_string(), Value::String(sequence_id.clone()));
        step_filters.insert(
            "step_order".to_string(),
            Value::Number(serde_json::Number::from(current_step)),
        );

        let step = match list_rows(pool, "sequence_steps", Some(&step_filters), 1, 0, "step_order", true).await {
            Ok(steps) => steps.into_iter().next(),
            Err(_) => None,
        };

        let Some(step) = step else {
            // No step found — complete the enrollment
            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("completed".to_string()));
            let _ = update_row(pool, "sequence_enrollments", &enrollment_id, &patch, "id").await;
            continue;
        };

        let step_obj = step.as_object().cloned().unwrap_or_default();
        let channel = val_str(step_obj.get("channel"));
        let body_template = val_str(step_obj.get("body_template"));
        let subject = val_str(step_obj.get("subject"));

        // Resolve template variables
        let body = resolve_template(&body_template, &context);

        // Create message log
        let mut msg = Map::new();
        msg.insert("organization_id".to_string(), Value::String(org_id));
        msg.insert(
            "channel".to_string(),
            Value::String(if channel.is_empty() { "whatsapp".to_string() } else { channel }),
        );
        msg.insert("recipient".to_string(), Value::String(recipient));
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        msg.insert("direction".to_string(), Value::String("outbound".to_string()));

        let mut payload = Map::new();
        payload.insert("body".to_string(), Value::String(body));
        if !subject.is_empty() {
            payload.insert("subject".to_string(), Value::String(subject));
        }
        msg.insert("payload".to_string(), Value::Object(payload));

        if let Some(template_id) = step_obj.get("template_id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            msg.insert("template_id".to_string(), Value::String(template_id.to_string()));
        }

        match create_row(pool, "message_logs", &msg).await {
            Ok(_) => sent += 1,
            Err(e) => {
                warn!("Failed to create sequence message: {e}");
                errors += 1;
                continue;
            }
        }

        // Advance to next step or complete
        let next_step = current_step + 1;

        // Check if next step exists
        let mut next_filters = Map::new();
        next_filters.insert("sequence_id".to_string(), Value::String(sequence_id));
        next_filters.insert(
            "step_order".to_string(),
            Value::Number(serde_json::Number::from(next_step)),
        );

        let has_next = list_rows(pool, "sequence_steps", Some(&next_filters), 1, 0, "step_order", true)
            .await
            .map(|rows| !rows.is_empty())
            .unwrap_or(false);

        let mut enrollment_patch = Map::new();
        if has_next {
            // Get the next step's delay_hours
            let next_delay = list_rows(pool, "sequence_steps", Some(&next_filters), 1, 0, "step_order", true)
                .await
                .ok()
                .and_then(|rows| rows.into_iter().next())
                .and_then(|s| s.as_object().and_then(|o| o.get("delay_hours")).and_then(Value::as_i64))
                .unwrap_or(0);

            let next_send = Utc::now() + chrono::Duration::hours(next_delay);
            enrollment_patch.insert(
                "current_step".to_string(),
                Value::Number(serde_json::Number::from(next_step)),
            );
            enrollment_patch.insert(
                "next_send_at".to_string(),
                Value::String(next_send.to_rfc3339()),
            );
        } else {
            enrollment_patch.insert("status".to_string(), Value::String("completed".to_string()));
        }

        let _ = update_row(pool, "sequence_enrollments", &enrollment_id, &enrollment_patch, "id").await;
    }

    info!("Processed sequences: {sent} sent, {errors} errors");
    (sent, errors)
}

/// Enroll an entity in a communication sequence.
pub async fn enroll_in_sequences(
    pool: &sqlx::PgPool,
    org_id: &str,
    trigger_type: &str,
    entity_type: &str,
    entity_id: &str,
    recipient: &str,
    context: &Map<String, Value>,
) {
    if recipient.is_empty() {
        return;
    }

    // Find active sequences matching this trigger
    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id.to_string()));
    filters.insert("trigger_type".to_string(), Value::String(trigger_type.to_string()));
    filters.insert("is_active".to_string(), Value::Bool(true));

    let sequences = match list_rows(pool, "communication_sequences", Some(&filters), 20, 0, "created_at", true).await {
        Ok(rows) => rows,
        Err(_) => return,
    };

    for seq in sequences {
        let sequence_id = seq
            .as_object()
            .and_then(|o| o.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if sequence_id.is_empty() {
            continue;
        }

        // Get the first step's delay
        let mut step_filters = Map::new();
        step_filters.insert("sequence_id".to_string(), Value::String(sequence_id.to_string()));
        step_filters.insert("step_order".to_string(), Value::Number(serde_json::Number::from(1)));

        let first_delay = list_rows(pool, "sequence_steps", Some(&step_filters), 1, 0, "step_order", true)
            .await
            .ok()
            .and_then(|rows| rows.into_iter().next())
            .and_then(|s| s.as_object().and_then(|o| o.get("delay_hours")).and_then(Value::as_i64))
            .unwrap_or(0);

        let next_send = Utc::now() + chrono::Duration::hours(first_delay);

        let mut enrollment = Map::new();
        enrollment.insert("sequence_id".to_string(), Value::String(sequence_id.to_string()));
        enrollment.insert("organization_id".to_string(), Value::String(org_id.to_string()));
        enrollment.insert("entity_type".to_string(), Value::String(entity_type.to_string()));
        enrollment.insert("entity_id".to_string(), Value::String(entity_id.to_string()));
        enrollment.insert("current_step".to_string(), Value::Number(serde_json::Number::from(1)));
        enrollment.insert("next_send_at".to_string(), Value::String(next_send.to_rfc3339()));
        enrollment.insert("recipient".to_string(), Value::String(recipient.to_string()));
        enrollment.insert("context".to_string(), Value::Object(context.clone()));

        let _ = create_row(pool, "sequence_enrollments", &enrollment).await;
    }
}

fn resolve_template(template: &str, context: &Map<String, Value>) -> String {
    let mut result = template.to_string();
    for (key, value) in context {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => continue,
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}

fn val_str(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
