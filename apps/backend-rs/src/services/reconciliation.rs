use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::PgPool;

use crate::{
    repository::table_service::{create_row, get_row, update_row},
    services::workflows::fire_trigger,
    config::WorkflowEngineMode,
};

/// Result of reconciling a payment against a collection record.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ReconciliationResult {
    pub outcome: ReconciliationOutcome,
    pub collection_id: String,
    pub expected: f64,
    pub paid: f64,
    pub remaining: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReconciliationOutcome {
    ExactMatch,
    PartialPayment,
    Overpayment,
    NoCollection,
}

/// Reconcile a payment received against its linked collection record.
///
/// Handles 3 cases:
/// - **Exact match**: amount_paid == expected → status = `paid`
/// - **Partial payment**: amount_paid < expected → update `amount_paid`, keep `pending`
/// - **Overpayment**: amount_paid > expected → status = `paid`, emit notification
pub async fn reconcile_payment(
    pool: &PgPool,
    instruction: &Value,
    payment_amount: f64,
    payment_method: &str,
    payment_reference: &str,
    engine_mode: WorkflowEngineMode,
) -> ReconciliationResult {
    let collection_id = val_str(instruction, "collection_record_id");
    let org_id = val_str(instruction, "organization_id");
    let instruction_id = val_str(instruction, "id");
    let reference_code = val_str(instruction, "reference_code");

    // Mark the payment instruction as paid
    let mut pi_patch = Map::new();
    pi_patch.insert("status".to_string(), Value::String("paid".to_string()));
    let _ = update_row(pool, "payment_instructions", &instruction_id, &pi_patch, "id").await;

    if collection_id.is_empty() {
        return ReconciliationResult {
            outcome: ReconciliationOutcome::NoCollection,
            collection_id: String::new(),
            expected: 0.0,
            paid: payment_amount,
            remaining: 0.0,
        };
    }

    // Fetch the collection record
    let collection = match get_row(pool, "collection_records", &collection_id, "id").await {
        Ok(c) => c,
        Err(_) => {
            return ReconciliationResult {
                outcome: ReconciliationOutcome::NoCollection,
                collection_id,
                expected: 0.0,
                paid: payment_amount,
                remaining: 0.0,
            };
        }
    };

    let expected_amount = collection
        .as_object()
        .and_then(|o| o.get("amount"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0.0);

    let prior_paid = collection
        .as_object()
        .and_then(|o| o.get("amount_paid"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0.0);

    let currency = val_str(&collection, "currency");
    let total_paid = prior_paid + payment_amount;

    // Small tolerance for floating point (0.01)
    let is_exact = (total_paid - expected_amount).abs() < 0.01;
    let is_overpayment = total_paid > expected_amount + 0.01;

    let (outcome, new_status) = if is_exact || is_overpayment {
        let outcome = if is_overpayment {
            ReconciliationOutcome::Overpayment
        } else {
            ReconciliationOutcome::ExactMatch
        };
        (outcome, "paid")
    } else {
        (ReconciliationOutcome::PartialPayment, "pending")
    };

    // Update the collection record
    let mut cr_patch = Map::new();
    cr_patch.insert("status".to_string(), Value::String(new_status.to_string()));
    cr_patch.insert(
        "amount_paid".to_string(),
        json!(total_paid).into(),
    );
    cr_patch.insert(
        "payment_method".to_string(),
        Value::String(payment_method.to_string()),
    );
    cr_patch.insert(
        "payment_reference".to_string(),
        Value::String(payment_reference.to_string()),
    );
    if new_status == "paid" {
        cr_patch.insert(
            "paid_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    }
    let _ = update_row(pool, "collection_records", &collection_id, &cr_patch, "id").await;

    // Fire workflow trigger
    if !org_id.is_empty() {
        let mut wf_ctx = Map::new();
        wf_ctx.insert("collection_id".to_string(), Value::String(collection_id.clone()));
        wf_ctx.insert("payment_method".to_string(), Value::String(payment_method.to_string()));
        wf_ctx.insert("reference_code".to_string(), Value::String(reference_code.clone()));
        wf_ctx.insert("amount".to_string(), json!(payment_amount));
        wf_ctx.insert("total_paid".to_string(), json!(total_paid));
        wf_ctx.insert("expected".to_string(), json!(expected_amount));
        wf_ctx.insert("currency".to_string(), Value::String(currency.clone()));
        wf_ctx.insert(
            "reconciliation_outcome".to_string(),
            Value::String(format!("{:?}", outcome).to_lowercase()),
        );
        fire_trigger(pool, &org_id, "payment_received", &wf_ctx, engine_mode).await;
    }

    // On overpayment, create a notification for the org
    if outcome == ReconciliationOutcome::Overpayment && !org_id.is_empty() {
        let overpayment = total_paid - expected_amount;
        let amount_display = if currency == "PYG" {
            format!("₲{}", overpayment as i64)
        } else {
            format!("${overpayment:.2}")
        };

        let mut notification = Map::new();
        notification.insert("organization_id".to_string(), Value::String(org_id.clone()));
        notification.insert("channel".to_string(), Value::String("in_app".to_string()));
        notification.insert("severity".to_string(), Value::String("warning".to_string()));
        notification.insert(
            "title".to_string(),
            Value::String(format!("Overpayment of {amount_display} received")),
        );
        notification.insert(
            "body".to_string(),
            Value::String(format!(
                "Payment ref {reference_code} received {amount_display} more than expected for collection {collection_id}. Review and issue a refund or credit if needed."
            )),
        );
        notification.insert(
            "metadata".to_string(),
            json!({
                "type": "overpayment",
                "collection_id": collection_id,
                "overpayment_amount": overpayment,
                "currency": currency,
            }),
        );
        let _ = create_row(pool, "notifications", &notification).await;
    }

    let remaining = if total_paid >= expected_amount {
        0.0
    } else {
        expected_amount - total_paid
    };

    ReconciliationResult {
        outcome,
        collection_id,
        expected: expected_amount,
        paid: total_paid,
        remaining,
    }
}

/// Queue a WhatsApp payment receipt notification.
pub async fn queue_payment_receipt(
    pool: &PgPool,
    instruction: &Value,
    payment_amount: f64,
) {
    let tenant_phone = val_str(instruction, "tenant_phone_e164");
    let org_id = val_str(instruction, "organization_id");
    let reference_code = val_str(instruction, "reference_code");
    let currency = val_str(instruction, "currency");

    if tenant_phone.is_empty() || org_id.is_empty() {
        return;
    }

    let amount_display = if currency == "PYG" {
        format!("₲{}", payment_amount as i64)
    } else {
        format!("${payment_amount:.2}")
    };

    let body = format!(
        "✅ Pago recibido\n\nTu pago de {amount_display} (ref: {reference_code}) ha sido procesado exitosamente.\n\n— Casaora"
    );

    let mut msg = Map::new();
    msg.insert("organization_id".to_string(), Value::String(org_id));
    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
    msg.insert("recipient".to_string(), Value::String(tenant_phone));
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    msg.insert("direction".to_string(), Value::String("outbound".to_string()));
    let mut pl = Map::new();
    pl.insert("body".to_string(), Value::String(body));
    msg.insert("payload".to_string(), Value::Object(pl));
    let _ = create_row(pool, "message_logs", &msg).await;
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
