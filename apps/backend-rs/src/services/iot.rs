use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
}

/// Generate a time-limited access code for a unit/reservation.
pub async fn tool_generate_access_code(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reservation_id = args
        .get("reservation_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let lease_id = args
        .get("lease_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let guest_name = args
        .get("guest_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let guest_phone = args
        .get("guest_phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let valid_hours = args
        .get("valid_hours")
        .and_then(Value::as_i64)
        .unwrap_or(72)
        .clamp(1, 8760);
    let code_type = args
        .get("code_type")
        .and_then(Value::as_str)
        .unwrap_or("temporary");

    if unit_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "unit_id is required." }));
    }

    // Generate a 6-digit numeric code
    let code = format!("{:06}", rand_code());

    let result = sqlx::query(
        "INSERT INTO access_codes
            (organization_id, unit_id, reservation_id, lease_id, code, code_type, status,
             valid_from, valid_until, guest_name, guest_phone)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'active',
                 now(), now() + ($7::int || ' hours')::interval, $8, $9)
         RETURNING id::text, valid_from::text, valid_until::text",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(reservation_id)
    .bind(lease_id)
    .bind(&code)
    .bind(code_type)
    .bind(valid_hours as i32)
    .bind(guest_name)
    .bind(guest_phone)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to generate access code");
        AppError::Dependency("Failed to generate access code.".to_string())
    })?;

    Ok(json!({
        "ok": true,
        "code_id": result.try_get::<String, _>("id").unwrap_or_default(),
        "code": code,
        "code_type": code_type,
        "unit_id": unit_id,
        "valid_from": result.try_get::<String, _>("valid_from").unwrap_or_default(),
        "valid_until": result.try_get::<String, _>("valid_until").unwrap_or_default(),
        "guest_name": guest_name,
    }))
}

/// Mark an access code as sent via WhatsApp/SMS.
pub async fn tool_send_access_code(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let code_id = args
        .get("code_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let send_via = args
        .get("send_via")
        .and_then(Value::as_str)
        .unwrap_or("whatsapp");

    if code_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "code_id is required." }));
    }

    // Fetch code details
    let code_row = sqlx::query(
        "SELECT code, guest_name, guest_phone, unit_id::text, valid_until::text
         FROM access_codes
         WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'active'",
    )
    .bind(code_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some(row) = code_row else {
        return Ok(json!({ "ok": false, "error": "Access code not found or not active." }));
    };

    let code = row.try_get::<String, _>("code").unwrap_or_default();
    let guest_phone = row.try_get::<String, _>("guest_phone").unwrap_or_default();
    let valid_until = row
        .try_get::<Option<String>, _>("valid_until")
        .ok()
        .flatten()
        .unwrap_or_default();

    // Mark as sent
    let _ = sqlx::query(
        "UPDATE access_codes SET sent_via = $3, sent_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(code_id)
    .bind(org_id)
    .bind(send_via)
    .execute(pool)
    .await;

    // Queue message via messaging service if phone available
    if !guest_phone.is_empty() {
        let body = format!(
            "Your access code is: {}. Valid until {}.",
            code, valid_until
        );
        let mut msg = serde_json::Map::new();
        msg.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        msg.insert("channel".to_string(), Value::String(send_via.to_string()));
        msg.insert("recipient".to_string(), Value::String(guest_phone.clone()));
        msg.insert(
            "direction".to_string(),
            Value::String("outbound".to_string()),
        );
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        let mut payload = serde_json::Map::new();
        payload.insert("body".to_string(), Value::String(body));
        payload.insert(
            "template".to_string(),
            Value::String("access_code".to_string()),
        );
        msg.insert("payload".to_string(), Value::Object(payload));
        let _ = crate::repository::table_service::create_row(pool, "message_logs", &msg).await;
    }

    Ok(json!({
        "ok": true,
        "code_id": code_id,
        "sent_via": send_via,
        "sent_to": guest_phone,
        "code": code,
    }))
}

/// Revoke an access code.
pub async fn tool_revoke_access_code(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let code_id = args
        .get("code_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    if code_id.is_empty() && unit_id.is_none() {
        return Ok(json!({ "ok": false, "error": "code_id or unit_id is required." }));
    }

    let revoked = if !code_id.is_empty() {
        sqlx::query(
            "UPDATE access_codes SET status = 'revoked', revoked_at = now()
             WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'active'
             RETURNING id",
        )
        .bind(code_id)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .len()
    } else {
        // Revoke all active codes for a unit
        sqlx::query(
            "UPDATE access_codes SET status = 'revoked', revoked_at = now()
             WHERE unit_id = $1::uuid AND organization_id = $2::uuid AND status = 'active'
             RETURNING id",
        )
        .bind(unit_id.unwrap_or_default())
        .bind(org_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .len()
    };

    Ok(json!({
        "ok": true,
        "revoked_count": revoked,
    }))
}

/// Process a sensor event: store and trigger alerts if thresholds exceeded.
pub async fn tool_process_sensor_event(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let device_id = args
        .get("device_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let event_type = args
        .get("event_type")
        .and_then(Value::as_str)
        .unwrap_or("reading");
    let value = args.get("value").and_then(Value::as_f64);
    let unit_of_measure = args
        .get("unit_of_measure")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if device_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "device_id is required." }));
    }

    // Determine severity based on thresholds
    let severity = if let Some(val) = value {
        match unit_of_measure {
            "%" if val > 80.0 => "warning",  // humidity > 80%
            "°C" if val > 35.0 => "warning", // temperature > 35°C
            "°C" if val < 5.0 => "critical", // freezing
            _ if event_type == "alert" => "warning",
            _ => "info",
        }
    } else if event_type == "alert" || event_type == "offline" {
        "warning"
    } else {
        "info"
    };

    let result = sqlx::query(
        "INSERT INTO iot_events
            (organization_id, device_id, event_type, severity, value, unit_of_measure, description)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(device_id)
    .bind(event_type)
    .bind(severity)
    .bind(value)
    .bind(unit_of_measure)
    .bind(description)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to log IoT event");
        AppError::Dependency("Failed to log IoT event.".to_string())
    })?;

    // Update device last_seen_at
    let _ = sqlx::query("UPDATE iot_devices SET last_seen_at = now() WHERE id = $1::uuid")
        .bind(device_id)
        .execute(pool)
        .await;

    // If critical/warning, auto-create maintenance ticket for water leak or smoke
    let mut ticket_created = false;
    if severity != "info" && (unit_of_measure == "%" || event_type == "alert") {
        let device = sqlx::query(
            "SELECT device_type, unit_id::text, device_name
             FROM iot_devices WHERE id = $1::uuid",
        )
        .bind(device_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        if let Some(dev) = device {
            let dev_type = dev.try_get::<String, _>("device_type").unwrap_or_default();
            let dev_unit = dev.try_get::<Option<String>, _>("unit_id").ok().flatten();
            let dev_name = dev.try_get::<String, _>("device_name").unwrap_or_default();

            if dev_type == "water_leak" || dev_type == "smoke" || severity == "critical" {
                let title = format!("IoT Alert: {} - {}", dev_name, description);
                let _ = sqlx::query(
                    "INSERT INTO maintenance_requests
                        (organization_id, title, description, status, source, unit_id, ai_urgency)
                     VALUES ($1::uuid, $2, $3, 'open', 'iot_sensor', $4::uuid, 'high')",
                )
                .bind(org_id)
                .bind(&title)
                .bind(description)
                .bind(dev_unit.as_deref())
                .execute(pool)
                .await;
                ticket_created = true;
            }
        }
    }

    Ok(json!({
        "ok": true,
        "event_id": result.try_get::<String, _>("id").unwrap_or_default(),
        "severity": severity,
        "ticket_created": ticket_created,
    }))
}

/// Get device status summary.
pub async fn tool_get_device_status(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let device_type = args
        .get("device_type")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    let devices = sqlx::query(
        "SELECT d.id::text, d.device_type, d.device_name, d.status, d.battery_level,
                d.last_seen_at::text, d.unit_id::text, u.name AS unit_name,
                d.manufacturer, d.model
         FROM iot_devices d
         LEFT JOIN units u ON u.id = d.unit_id
         WHERE d.organization_id = $1::uuid AND d.is_active = true
           AND ($2::text IS NULL OR d.device_type = $2)
           AND ($3::text IS NULL OR d.unit_id::text = $3)
         ORDER BY d.status ASC, d.device_name ASC
         LIMIT 100",
    )
    .bind(org_id)
    .bind(device_type)
    .bind(unit_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let device_list: Vec<Value> = devices
        .iter()
        .map(|d| {
            json!({
                "device_id": d.try_get::<String, _>("id").unwrap_or_default(),
                "device_type": d.try_get::<String, _>("device_type").unwrap_or_default(),
                "device_name": d.try_get::<String, _>("device_name").unwrap_or_default(),
                "status": d.try_get::<String, _>("status").unwrap_or_default(),
                "battery_level": d.try_get::<Option<i32>, _>("battery_level").ok().flatten(),
                "last_seen_at": d.try_get::<Option<String>, _>("last_seen_at").ok().flatten(),
                "unit_id": d.try_get::<Option<String>, _>("unit_id").ok().flatten(),
                "unit_name": d.try_get::<Option<String>, _>("unit_name").ok().flatten(),
                "manufacturer": d.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
                "model": d.try_get::<Option<String>, _>("model").ok().flatten(),
            })
        })
        .collect();

    let online = device_list
        .iter()
        .filter(|d| d.get("status").and_then(Value::as_str) == Some("online"))
        .count();
    let offline = device_list
        .iter()
        .filter(|d| d.get("status").and_then(Value::as_str) == Some("offline"))
        .count();
    let low_battery = device_list
        .iter()
        .filter(|d| {
            d.get("battery_level")
                .and_then(Value::as_i64)
                .map(|b| b < 20)
                .unwrap_or(false)
        })
        .count();

    Ok(json!({
        "ok": true,
        "total_devices": device_list.len(),
        "online": online,
        "offline": offline,
        "low_battery": low_battery,
        "devices": device_list,
    }))
}

/// Simple pseudo-random 6-digit code generator.
fn rand_code() -> u32 {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    // Mix bits for pseudo-randomness
    let mixed = seed.wrapping_mul(1103515245).wrapping_add(12345);
    (mixed / 65536) % 900000 + 100000
}
