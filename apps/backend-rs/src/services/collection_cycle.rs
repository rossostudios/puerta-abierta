use chrono::{NaiveDate, Utc};
use serde_json::{Map, Value};
use sqlx::PgPool;
use tracing::{info, warn};

use crate::repository::table_service::{create_row, list_rows, update_row};

/// Result of a daily collection cycle run.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CollectionCycleResult {
    pub activated: u32,
    pub reminders_queued: u32,
    pub marked_late: u32,
    pub escalated: u32,
    pub errors: u32,
}

/// Run the daily collection cycle for all organizations (or a specific one).
///
/// This is the core automation engine:
///   D-3:  Transition scheduled → pending, send first WhatsApp reminder
///   D-1:  Send second reminder
///   D-day: Send final reminder ("payment due today")
///   D+3:  Mark as late, send late notice
///   D+7:  Escalate — send urgent notice to tenant + alert to owner
pub async fn run_daily_collection_cycle(
    pool: &PgPool,
    org_id: Option<&str>,
    app_public_url: &str,
) -> CollectionCycleResult {
    let today = Utc::now().date_naive();
    let mut result = CollectionCycleResult {
        activated: 0,
        reminders_queued: 0,
        marked_late: 0,
        escalated: 0,
        errors: 0,
    };

    // Phase 1: Activate scheduled collections approaching due date (D-3)
    let d_minus_3 = today + chrono::Duration::days(3);
    activate_upcoming_collections(pool, org_id, &d_minus_3, &mut result).await;

    // Phase 2: Send reminders for pending collections
    send_reminders(pool, org_id, &today, app_public_url, &mut result).await;

    // Phase 3: Mark overdue collections as late (D+3)
    let d_plus_3 = today - chrono::Duration::days(3);
    mark_late_collections(pool, org_id, &d_plus_3, app_public_url, &mut result).await;

    // Phase 4: Escalate severely late collections (D+7)
    let d_plus_7 = today - chrono::Duration::days(7);
    escalate_late_collections(pool, org_id, &d_plus_7, app_public_url, &mut result).await;

    info!(
        activated = result.activated,
        reminders = result.reminders_queued,
        late = result.marked_late,
        escalated = result.escalated,
        errors = result.errors,
        "Collection cycle completed"
    );

    result
}

/// Transition scheduled → pending for collections due within 3 days.
/// Queue a D-3 reminder via WhatsApp.
async fn activate_upcoming_collections(
    pool: &PgPool,
    org_id: Option<&str>,
    cutoff_date: &NaiveDate,
    result: &mut CollectionCycleResult,
) {
    let mut filters = Map::new();
    filters.insert(
        "status".to_string(),
        Value::String("scheduled".to_string()),
    );
    if let Some(oid) = org_id {
        filters.insert(
            "organization_id".to_string(),
            Value::String(oid.to_string()),
        );
    }

    let collections = match list_rows(pool, "collection_records", Some(&filters), 500, 0, "due_date", true).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch scheduled collections: {e}");
            result.errors += 1;
            return;
        }
    };

    let cutoff_iso = cutoff_date.to_string();

    for collection in collections {
        let due_date = val_str(&collection, "due_date");
        if due_date.is_empty() || due_date > cutoff_iso {
            continue;
        }

        let collection_id = val_str(&collection, "id");
        if collection_id.is_empty() {
            continue;
        }

        // Transition to pending
        let mut patch = Map::new();
        patch.insert("status".to_string(), Value::String("pending".to_string()));
        if let Err(e) = update_row(pool, "collection_records", &collection_id, &patch, "id").await {
            warn!("Failed to activate collection {collection_id}: {e}");
            result.errors += 1;
            continue;
        }

        result.activated += 1;
    }
}

/// Send WhatsApp reminders for pending collections based on days until due.
async fn send_reminders(
    pool: &PgPool,
    org_id: Option<&str>,
    today: &NaiveDate,
    app_public_url: &str,
    result: &mut CollectionCycleResult,
) {
    let mut filters = Map::new();
    filters.insert("status".to_string(), Value::String("pending".to_string()));
    if let Some(oid) = org_id {
        filters.insert(
            "organization_id".to_string(),
            Value::String(oid.to_string()),
        );
    }

    let collections = match list_rows(pool, "collection_records", Some(&filters), 500, 0, "due_date", true).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch pending collections: {e}");
            result.errors += 1;
            return;
        }
    };

    let today_iso = today.to_string();

    for collection in collections {
        let due_date_str = val_str(&collection, "due_date");
        if due_date_str.is_empty() {
            continue;
        }

        let due_date = match NaiveDate::parse_from_str(&due_date_str, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => continue,
        };

        let days_until_due = (due_date - *today).num_days();
        let collection_id = val_str(&collection, "id");
        let lease_id = val_str(&collection, "lease_id");
        let org_id_val = val_str(&collection, "organization_id");

        // Determine which reminder to send (only send once per milestone)
        let reminder_type = match days_until_due {
            3 => "d_minus_3",
            1 => "d_minus_1",
            0 => "d_day",
            _ => continue,
        };

        // Check if we already sent this reminder today
        if already_sent_today(pool, &collection_id, reminder_type, &today_iso).await {
            continue;
        }

        // Fetch lease to get tenant info
        if lease_id.is_empty() {
            continue;
        }
        let lease = match crate::repository::table_service::get_row(pool, "leases", &lease_id, "id").await {
            Ok(l) => l,
            Err(_) => continue,
        };

        let tenant_phone = val_str(&lease, "tenant_phone_e164");
        let tenant_name = val_str(&lease, "tenant_full_name");
        let amount = collection
            .as_object()
            .and_then(|o| o.get("amount"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let currency = val_str(&collection, "currency");

        if tenant_phone.is_empty() {
            continue;
        }

        let amount_display = format_amount(amount, &currency);

        let body = match reminder_type {
            "d_minus_3" => format!(
                "Hola {tenant_name} 👋\n\n\
                 Te recordamos que tu pago de alquiler de {amount_display} vence el {due_date_str}.\n\n\
                 Puedes ver los detalles y realizar tu pago en:\n\
                 {app_public_url}/tenant/payments\n\n\
                 Gracias por tu puntualidad.\n\
                 — Casaora"
            ),
            "d_minus_1" => format!(
                "Hola {tenant_name},\n\n\
                 Tu pago de {amount_display} vence mañana ({due_date_str}).\n\n\
                 Si ya realizaste el pago, por favor envía tu comprobante.\n\
                 {app_public_url}/tenant/payments\n\n\
                 — Casaora"
            ),
            "d_day" => format!(
                "⚠️ {tenant_name}, hoy vence tu pago de alquiler de {amount_display}.\n\n\
                 Por favor realiza tu pago hoy para evitar recargos.\n\
                 {app_public_url}/tenant/payments\n\n\
                 — Casaora"
            ),
            _ => continue,
        };

        // Queue WhatsApp message
        let mut msg = Map::new();
        msg.insert(
            "organization_id".to_string(),
            Value::String(org_id_val.clone()),
        );
        msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
        msg.insert(
            "recipient".to_string(),
            Value::String(tenant_phone.clone()),
        );
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        msg.insert(
            "scheduled_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );

        let mut payload = Map::new();
        payload.insert("body".to_string(), Value::String(body));
        payload.insert(
            "reminder_type".to_string(),
            Value::String(reminder_type.to_string()),
        );
        payload.insert(
            "collection_id".to_string(),
            Value::String(collection_id.clone()),
        );
        msg.insert("payload".to_string(), Value::Object(payload));

        if let Err(e) = create_row(pool, "message_logs", &msg).await {
            warn!("Failed to queue reminder for collection {collection_id}: {e}");
            result.errors += 1;
        } else {
            result.reminders_queued += 1;
        }
    }
}

/// Mark collections as late if they are pending and overdue by 3+ days.
async fn mark_late_collections(
    pool: &PgPool,
    org_id: Option<&str>,
    cutoff_date: &NaiveDate,
    app_public_url: &str,
    result: &mut CollectionCycleResult,
) {
    let mut filters = Map::new();
    filters.insert("status".to_string(), Value::String("pending".to_string()));
    if let Some(oid) = org_id {
        filters.insert(
            "organization_id".to_string(),
            Value::String(oid.to_string()),
        );
    }

    let collections = match list_rows(pool, "collection_records", Some(&filters), 500, 0, "due_date", true).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch overdue collections: {e}");
            result.errors += 1;
            return;
        }
    };

    let cutoff_iso = cutoff_date.to_string();

    for collection in collections {
        let due_date = val_str(&collection, "due_date");
        if due_date.is_empty() || due_date > cutoff_iso {
            continue;
        }

        let collection_id = val_str(&collection, "id");
        let lease_id = val_str(&collection, "lease_id");
        let org_id_val = val_str(&collection, "organization_id");

        if collection_id.is_empty() {
            continue;
        }

        // Mark as late
        let mut patch = Map::new();
        patch.insert("status".to_string(), Value::String("late".to_string()));
        if let Err(e) = update_row(pool, "collection_records", &collection_id, &patch, "id").await {
            warn!("Failed to mark collection {collection_id} late: {e}");
            result.errors += 1;
            continue;
        }

        // Refresh lease status to delinquent
        if !lease_id.is_empty() {
            let _ = refresh_lease_delinquent(pool, &lease_id).await;
        }

        // Send late payment notice to tenant
        let lease = match crate::repository::table_service::get_row(pool, "leases", &lease_id, "id").await {
            Ok(l) => l,
            Err(_) => {
                result.marked_late += 1;
                continue;
            }
        };

        let tenant_phone = val_str(&lease, "tenant_phone_e164");
        let tenant_name = val_str(&lease, "tenant_full_name");
        let amount = collection
            .as_object()
            .and_then(|o| o.get("amount"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let currency = val_str(&collection, "currency");
        let amount_display = format_amount(amount, &currency);

        if !tenant_phone.is_empty() {
            let body = format!(
                "🔴 {tenant_name}, tu pago de {amount_display} (vencimiento: {due_date}) está atrasado.\n\n\
                 Por favor regulariza tu situación lo antes posible.\n\
                 {app_public_url}/tenant/payments\n\n\
                 Si ya realizaste el pago, envía tu comprobante.\n\
                 — Casaora"
            );

            let mut msg = Map::new();
            msg.insert(
                "organization_id".to_string(),
                Value::String(org_id_val),
            );
            msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
            msg.insert("recipient".to_string(), Value::String(tenant_phone));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let mut payload = Map::new();
            payload.insert("body".to_string(), Value::String(body));
            payload.insert(
                "reminder_type".to_string(),
                Value::String("d_plus_3_late".to_string()),
            );
            payload.insert(
                "collection_id".to_string(),
                Value::String(collection_id.clone()),
            );
            msg.insert("payload".to_string(), Value::Object(payload));
            let _ = create_row(pool, "message_logs", &msg).await;
        }

        result.marked_late += 1;
    }
}

/// Escalate collections that are late and overdue by 7+ days.
/// Sends urgent notice to tenant + alerts the property manager.
async fn escalate_late_collections(
    pool: &PgPool,
    org_id: Option<&str>,
    cutoff_date: &NaiveDate,
    app_public_url: &str,
    result: &mut CollectionCycleResult,
) {
    let mut filters = Map::new();
    filters.insert("status".to_string(), Value::String("late".to_string()));
    if let Some(oid) = org_id {
        filters.insert(
            "organization_id".to_string(),
            Value::String(oid.to_string()),
        );
    }

    let collections = match list_rows(pool, "collection_records", Some(&filters), 500, 0, "due_date", true).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!("Failed to fetch late collections for escalation: {e}");
            result.errors += 1;
            return;
        }
    };

    let cutoff_iso = cutoff_date.to_string();
    let today_iso = Utc::now().date_naive().to_string();

    for collection in collections {
        let due_date = val_str(&collection, "due_date");
        if due_date.is_empty() || due_date > cutoff_iso {
            continue;
        }

        let collection_id = val_str(&collection, "id");
        let lease_id = val_str(&collection, "lease_id");
        let org_id_val = val_str(&collection, "organization_id");

        if collection_id.is_empty() {
            continue;
        }

        // Check if already escalated today
        if already_sent_today(pool, &collection_id, "d_plus_7_escalation", &today_iso).await {
            continue;
        }

        let lease = match crate::repository::table_service::get_row(pool, "leases", &lease_id, "id").await {
            Ok(l) => l,
            Err(_) => continue,
        };

        let tenant_phone = val_str(&lease, "tenant_phone_e164");
        let tenant_name = val_str(&lease, "tenant_full_name");
        let amount = collection
            .as_object()
            .and_then(|o| o.get("amount"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let currency = val_str(&collection, "currency");
        let amount_display = format_amount(amount, &currency);

        // Send escalation to tenant
        if !tenant_phone.is_empty() {
            let body = format!(
                "🚨 URGENTE — {tenant_name}\n\n\
                 Tu pago de {amount_display} (vencimiento: {due_date}) lleva más de 7 días de atraso.\n\n\
                 Debes regularizar tu situación de forma inmediata para evitar acciones adicionales.\n\
                 {app_public_url}/tenant/payments\n\n\
                 Contacta a tu administrador si necesitas coordinar un plan de pago.\n\
                 — Casaora"
            );

            let mut msg = Map::new();
            msg.insert(
                "organization_id".to_string(),
                Value::String(org_id_val.clone()),
            );
            msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
            msg.insert("recipient".to_string(), Value::String(tenant_phone));
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            msg.insert(
                "scheduled_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let mut payload = Map::new();
            payload.insert("body".to_string(), Value::String(body));
            payload.insert(
                "reminder_type".to_string(),
                Value::String("d_plus_7_escalation".to_string()),
            );
            payload.insert(
                "collection_id".to_string(),
                Value::String(collection_id.clone()),
            );
            msg.insert("payload".to_string(), Value::Object(payload));
            let _ = create_row(pool, "message_logs", &msg).await;
        }

        // Alert the property manager / owner
        let owner_members = match list_rows(
            pool,
            "organization_members",
            Some(&{
                let mut f = Map::new();
                f.insert(
                    "organization_id".to_string(),
                    Value::String(org_id_val.clone()),
                );
                f.insert("role".to_string(), Value::String("owner_admin".to_string()));
                f
            }),
            5,
            0,
            "created_at",
            true,
        )
        .await
        {
            Ok(m) => m,
            Err(_) => Vec::new(),
        };

        for member in &owner_members {
            let user_id = val_str(member, "user_id");
            if user_id.is_empty() {
                continue;
            }

            // Fetch user's phone
            if let Ok(user) = crate::repository::table_service::get_row(pool, "app_users", &user_id, "id").await {
                let owner_phone = val_str(&user, "phone_e164");
                if !owner_phone.is_empty() {
                    let body = format!(
                        "⚠️ Alerta de cobro — El inquilino {tenant_name} tiene un pago de {amount_display} con más de 7 días de atraso (vencimiento: {due_date}).\n\n\
                         Revisa el estado en tu panel de administración.\n\
                         — Casaora"
                    );

                    let mut msg = Map::new();
                    msg.insert(
                        "organization_id".to_string(),
                        Value::String(org_id_val.clone()),
                    );
                    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
                    msg.insert("recipient".to_string(), Value::String(owner_phone));
                    msg.insert("status".to_string(), Value::String("queued".to_string()));
                    msg.insert(
                        "scheduled_at".to_string(),
                        Value::String(Utc::now().to_rfc3339()),
                    );
                    let mut payload = Map::new();
                    payload.insert("body".to_string(), Value::String(body));
                    payload.insert(
                        "reminder_type".to_string(),
                        Value::String("owner_escalation_alert".to_string()),
                    );
                    payload.insert(
                        "collection_id".to_string(),
                        Value::String(collection_id.clone()),
                    );
                    msg.insert("payload".to_string(), Value::Object(payload));
                    let _ = create_row(pool, "message_logs", &msg).await;
                }
            }
        }

        result.escalated += 1;
    }
}

/// Check if a reminder of this type was already sent today for this collection.
async fn already_sent_today(pool: &PgPool, collection_id: &str, reminder_type: &str, today_iso: &str) -> bool {
    let mut filters = Map::new();
    filters.insert("channel".to_string(), Value::String("whatsapp".to_string()));

    let messages = match list_rows(pool, "message_logs", Some(&filters), 200, 0, "created_at", false).await {
        Ok(rows) => rows,
        Err(_) => return false,
    };

    messages.iter().any(|msg| {
        let payload = msg.as_object().and_then(|o| o.get("payload"));
        let msg_collection_id = payload
            .and_then(Value::as_object)
            .and_then(|o| o.get("collection_id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let msg_reminder_type = payload
            .and_then(Value::as_object)
            .and_then(|o| o.get("reminder_type"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let created_at = val_str(msg, "created_at");

        msg_collection_id == collection_id
            && msg_reminder_type == reminder_type
            && created_at.starts_with(today_iso)
    })
}

/// Refresh lease status based on overdue collections.
async fn refresh_lease_delinquent(pool: &PgPool, lease_id: &str) -> Result<(), crate::error::AppError> {
    let lease = crate::repository::table_service::get_row(pool, "leases", lease_id, "id").await?;
    let status = val_str(&lease, "lease_status");
    if status != "active" && status != "delinquent" {
        return Ok(());
    }

    if status != "delinquent" {
        let mut patch = Map::new();
        patch.insert(
            "lease_status".to_string(),
            Value::String("delinquent".to_string()),
        );
        update_row(pool, "leases", lease_id, &patch, "id").await?;
    }

    Ok(())
}

fn format_amount(amount: f64, currency: &str) -> String {
    match currency {
        "PYG" => format!("₲{}", format_number_with_dots(amount as i64)),
        "USD" => format!("${:.2}", amount),
        _ => format!("{:.2} {}", amount, currency),
    }
}

fn format_number_with_dots(n: i64) -> String {
    let s = n.to_string();
    let mut result = String::new();
    for (i, ch) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push('.');
        }
        result.push(ch);
    }
    result.chars().rev().collect()
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
