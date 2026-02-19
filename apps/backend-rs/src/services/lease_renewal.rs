use chrono::{NaiveDate, Utc};
use serde_json::{Map, Value};
use sqlx::PgPool;
use tracing::{info, warn};

use crate::{
    config::WorkflowEngineMode,
    repository::table_service::{create_row, list_rows, update_row},
    services::workflows::fire_trigger,
};

/// Result of the daily lease renewal scan.
pub struct LeaseRenewalResult {
    pub offers_sent_60d: u32,
    pub reminders_sent_30d: u32,
    pub expired: u32,
}

/// Scan active leases for upcoming expiry and:
/// 1. Send 60-day renewal offers
/// 2. Send 30-day follow-up reminders
/// 3. Mark expired renewal offers
pub async fn run_lease_renewal_scan(
    pool: &PgPool,
    org_id: Option<&str>,
    app_public_url: &str,
    workflow_engine_mode: WorkflowEngineMode,
) -> LeaseRenewalResult {
    let mut result = LeaseRenewalResult {
        offers_sent_60d: 0,
        reminders_sent_30d: 0,
        expired: 0,
    };

    let today = Utc::now().date_naive();
    let target_60d = today + chrono::Duration::days(60);
    let target_30d = today + chrono::Duration::days(30);

    // Fetch active leases with end dates
    let mut filters = Map::new();
    filters.insert(
        "lease_status".to_string(),
        Value::String("active".to_string()),
    );
    if let Some(org) = org_id {
        filters.insert(
            "organization_id".to_string(),
            Value::String(org.to_string()),
        );
    }

    let leases = match list_rows(pool, "leases", Some(&filters), 2000, 0, "ends_on", true).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch leases for renewal scan: {e}");
            return result;
        }
    };

    for lease in &leases {
        let lease_id = val_str(lease, "id");
        let ends_on_str = val_str(lease, "ends_on");
        let org_id_str = val_str(lease, "organization_id");
        let renewal_status = val_str(lease, "renewal_status");
        let tenant_name = val_str(lease, "tenant_full_name");
        let tenant_phone = val_str(lease, "tenant_phone_e164");
        let monthly_rent = lease
            .as_object()
            .and_then(|o| o.get("monthly_rent"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let currency = val_str(lease, "currency");

        if lease_id.is_empty() || ends_on_str.is_empty() {
            continue;
        }

        let ends_on = match NaiveDate::parse_from_str(&ends_on_str, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => continue,
        };

        // 60-day offer: lease ends in ~60 days and no renewal status yet
        if ends_on == target_60d && renewal_status.is_empty() {
            let amount_display = format_amount(monthly_rent, &currency);

            // Mark lease as pending renewal
            let mut patch = Map::new();
            patch.insert(
                "renewal_status".to_string(),
                Value::String("pending".to_string()),
            );
            let _ = update_row(pool, "leases", &lease_id, &patch, "id").await;

            // Notify tenant about upcoming renewal
            if !tenant_phone.is_empty() && !org_id_str.is_empty() {
                let body = format!(
                    "📋 Renovación de contrato\n\n\
                     Hola {tenant_name}, tu contrato de alquiler vence el {ends_on_str}.\n\n\
                     Renta actual: {amount_display}/mes\n\n\
                     Tu administrador te enviará una oferta de renovación pronto.\n\
                     — Casaora"
                );
                queue_message(
                    pool,
                    &org_id_str,
                    &tenant_phone,
                    &body,
                    &lease_id,
                    "renewal_60d",
                )
                .await;
            }

            // Notify owner_admin about expiring lease
            notify_owners(
                pool,
                &org_id_str,
                &format!(
                    "📋 Contrato por vencer\n\n\
                     El contrato de {tenant_name} vence el {ends_on_str}.\n\
                     Renta actual: {amount_display}/mes\n\n\
                     Envía una oferta de renovación desde tu panel.\n\
                     {app_public_url}/module/leases"
                ),
                &lease_id,
                "renewal_owner_60d",
            )
            .await;

            // Emit workflow trigger for lease_expiring.
            if !org_id_str.is_empty() {
                let mut workflow_context = Map::new();
                workflow_context.insert("lease_id".to_string(), Value::String(lease_id.clone()));
                workflow_context.insert(
                    "tenant_full_name".to_string(),
                    Value::String(tenant_name.clone()),
                );
                workflow_context.insert(
                    "tenant_phone_e164".to_string(),
                    Value::String(tenant_phone.clone()),
                );
                workflow_context.insert("ends_on".to_string(), Value::String(ends_on_str.clone()));
                workflow_context.insert(
                    "monthly_rent".to_string(),
                    Value::Number(
                        serde_json::Number::from_f64(monthly_rent)
                            .unwrap_or_else(|| serde_json::Number::from(0)),
                    ),
                );
                workflow_context.insert("currency".to_string(), Value::String(currency.clone()));
                fire_trigger(
                    pool,
                    &org_id_str,
                    "lease_expiring",
                    &workflow_context,
                    workflow_engine_mode,
                )
                .await;
            }

            result.offers_sent_60d += 1;
        }

        // 30-day reminder: lease ends in ~30 days and renewal is still pending (no decision)
        if ends_on == target_30d && (renewal_status == "pending" || renewal_status == "offered") {
            if !tenant_phone.is_empty() && !org_id_str.is_empty() {
                let body = format!(
                    "⏰ Recordatorio de renovación\n\n\
                     Hola {tenant_name}, tu contrato vence en 30 días ({ends_on_str}).\n\n\
                     Por favor contacta a tu administrador sobre la renovación.\n\
                     — Casaora"
                );
                queue_message(
                    pool,
                    &org_id_str,
                    &tenant_phone,
                    &body,
                    &lease_id,
                    "renewal_30d",
                )
                .await;
            }

            result.reminders_sent_30d += 1;
        }

        // Mark expired offers (lease ended and renewal still pending/offered)
        if ends_on < today && (renewal_status == "pending" || renewal_status == "offered") {
            let mut patch = Map::new();
            patch.insert(
                "renewal_status".to_string(),
                Value::String("expired".to_string()),
            );
            let _ = update_row(pool, "leases", &lease_id, &patch, "id").await;
            result.expired += 1;
        }
    }

    info!(
        "Lease renewal scan: {} 60d offers, {} 30d reminders, {} expired",
        result.offers_sent_60d, result.reminders_sent_30d, result.expired
    );

    result
}

/// Send a renewal offer to a tenant with optional rent adjustment.
pub async fn send_renewal_offer(
    pool: &PgPool,
    lease_id: &str,
    offered_rent: Option<f64>,
    notes: Option<&str>,
    _app_public_url: &str,
) -> Result<Value, String> {
    let lease = crate::repository::table_service::get_row(pool, "leases", lease_id, "id")
        .await
        .map_err(|e| format!("Lease not found: {e}"))?;

    let status = val_str(&lease, "lease_status");
    if status != "active" {
        return Err("Lease must be active to send a renewal offer.".to_string());
    }

    let current_rent = lease
        .as_object()
        .and_then(|o| o.get("monthly_rent"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let new_rent = offered_rent.unwrap_or(current_rent);
    let currency = val_str(&lease, "currency");
    let tenant_name = val_str(&lease, "tenant_full_name");
    let tenant_phone = val_str(&lease, "tenant_phone_e164");
    let org_id = val_str(&lease, "organization_id");
    let ends_on = val_str(&lease, "ends_on");

    let mut patch = Map::new();
    patch.insert(
        "renewal_status".to_string(),
        Value::String("offered".to_string()),
    );
    patch.insert(
        "renewal_offered_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    patch.insert(
        "renewal_offered_rent".to_string(),
        Value::Number(
            serde_json::Number::from_f64(new_rent).unwrap_or_else(|| serde_json::Number::from(0)),
        ),
    );
    if let Some(n) = notes {
        patch.insert("renewal_notes".to_string(), Value::String(n.to_string()));
    }

    let updated = update_row(pool, "leases", lease_id, &patch, "id")
        .await
        .map_err(|e| format!("Failed to update lease: {e}"))?;

    // Notify tenant via WhatsApp
    if !tenant_phone.is_empty() && !org_id.is_empty() {
        let current_display = format_amount(current_rent, &currency);
        let new_display = format_amount(new_rent, &currency);
        let rent_change = if (new_rent - current_rent).abs() < 0.01 {
            "Misma renta".to_string()
        } else if new_rent > current_rent {
            format!("Nueva renta: {new_display} (antes: {current_display})")
        } else {
            format!("Nueva renta: {new_display} (antes: {current_display})")
        };

        let body = format!(
            "📝 Oferta de renovación\n\n\
             Hola {tenant_name},\n\n\
             Tu administrador te ofrece renovar tu contrato (vence: {ends_on}).\n\
             {rent_change}\n\n\
             Acepta o responde a este mensaje para más información.\n\
             — Casaora"
        );
        queue_message(
            pool,
            &org_id,
            &tenant_phone,
            &body,
            lease_id,
            "renewal_offer",
        )
        .await;
    }

    Ok(updated)
}

async fn queue_message(
    pool: &PgPool,
    org_id: &str,
    phone: &str,
    body: &str,
    lease_id: &str,
    reminder_type: &str,
) {
    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
    msg.insert("recipient".to_string(), Value::String(phone.to_string()));
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert(
        "scheduled_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );

    let mut payload = Map::new();
    payload.insert("body".to_string(), Value::String(body.to_string()));
    payload.insert("lease_id".to_string(), Value::String(lease_id.to_string()));
    payload.insert(
        "reminder_type".to_string(),
        Value::String(reminder_type.to_string()),
    );
    msg.insert("payload".to_string(), Value::Object(payload));

    let _ = create_row(pool, "message_logs", &msg).await;
}

async fn notify_owners(
    pool: &PgPool,
    org_id: &str,
    body: &str,
    lease_id: &str,
    reminder_type: &str,
) {
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert("role".to_string(), Value::String("owner_admin".to_string()));

    let members = match list_rows(
        pool,
        "organization_members",
        Some(&filters),
        5,
        0,
        "created_at",
        true,
    )
    .await
    {
        Ok(m) => m,
        Err(_) => return,
    };

    for member in &members {
        let user_id = val_str(member, "user_id");
        if user_id.is_empty() {
            continue;
        }
        if let Ok(user) =
            crate::repository::table_service::get_row(pool, "app_users", &user_id, "id").await
        {
            let phone = val_str(&user, "phone_e164");
            if !phone.is_empty() {
                queue_message(pool, org_id, &phone, body, lease_id, reminder_type).await;
            }
        }
    }
}

fn format_amount(amount: f64, currency: &str) -> String {
    if currency == "PYG" {
        let int_amount = amount as i64;
        let formatted = format_with_dots(int_amount);
        format!("₲{formatted}")
    } else {
        format!("${amount:.2}")
    }
}

fn format_with_dots(n: i64) -> String {
    let s = n.abs().to_string();
    let mut result = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push('.');
        }
        result.push(c);
    }
    result.chars().rev().collect()
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
