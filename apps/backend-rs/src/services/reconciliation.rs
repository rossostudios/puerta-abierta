use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Row};

use crate::{
    config::WorkflowEngineMode,
    repository::table_service::{create_row, get_row, update_row},
    services::workflows::fire_trigger,
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
    let _ = update_row(
        pool,
        "payment_instructions",
        &instruction_id,
        &pi_patch,
        "id",
    )
    .await;

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
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(0.0);

    let prior_paid = collection
        .as_object()
        .and_then(|o| o.get("amount_paid"))
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
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
    cr_patch.insert("amount_paid".to_string(), json!(total_paid).into());
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
        wf_ctx.insert(
            "collection_id".to_string(),
            Value::String(collection_id.clone()),
        );
        wf_ctx.insert(
            "payment_method".to_string(),
            Value::String(payment_method.to_string()),
        );
        wf_ctx.insert(
            "reference_code".to_string(),
            Value::String(reference_code.clone()),
        );
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
pub async fn queue_payment_receipt(pool: &PgPool, instruction: &Value, payment_amount: f64) {
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
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );
    let mut pl = Map::new();
    pl.insert("body".to_string(), Value::String(body));
    msg.insert("payload".to_string(), Value::Object(pl));
    let _ = create_row(pool, "message_logs", &msg).await;
}

/// Auto-reconcile all pending collection records by scanning for matching payments.
/// Used by the finance-agent tool.
pub async fn tool_auto_reconcile_all(
    state: &crate::state::AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> Result<Value, crate::error::AppError> {
    let pool = state.db_pool.as_ref().ok_or_else(|| {
        crate::error::AppError::Dependency("Database not configured.".to_string())
    })?;

    let period_month = args
        .get("period_month")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Find pending collections with matching paid payment instructions
    let rows = sqlx::query(
        "SELECT
            cr.id::text AS collection_id,
            cr.amount::float8 AS expected,
            cr.amount_paid::float8 AS already_paid,
            cr.status AS cr_status,
            cr.organization_id::text AS org_id,
            pi.id::text AS instruction_id,
            pi.reference_code
         FROM collection_records cr
         JOIN payment_instructions pi ON pi.collection_record_id = cr.id
         WHERE cr.organization_id = $1::uuid
           AND cr.status IN ('scheduled', 'pending', 'late')
           AND pi.status = 'paid'
           AND ($2 = '' OR to_char(cr.due_date, 'YYYY-MM') = $2)
         ORDER BY cr.due_date ASC
         LIMIT 100",
    )
    .bind(org_id)
    .bind(period_month)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Auto-reconcile query failed");
        crate::error::AppError::Dependency("Auto-reconcile query failed.".to_string())
    })?;

    let mut reconciled = 0_u32;
    let mut already_matched = 0_u32;

    for row in &rows {
        let collection_id = row
            .try_get::<String, _>("collection_id")
            .unwrap_or_default();
        let expected = row.try_get::<f64, _>("expected").unwrap_or(0.0);
        let already_paid = row.try_get::<f64, _>("already_paid").unwrap_or(0.0);

        if (already_paid - expected).abs() < 0.01 {
            // Already fully paid, just update status
            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("paid".to_string()));
            patch.insert(
                "paid_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let _ = update_row(pool, "collection_records", &collection_id, &patch, "id").await;
            already_matched += 1;
        } else if already_paid > 0.0 && already_paid < expected {
            // Partial - leave as pending but note progress
            reconciled += 1;
        } else {
            reconciled += 1;
        }
    }

    Ok(json!({
        "ok": true,
        "scanned": rows.len(),
        "reconciled": reconciled,
        "already_matched": already_matched,
        "period_month": period_month,
    }))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 6: Cognitive Financial Reconciliation — new tools
// ───────────────────────────────────────────────────────────────────────

/// Import bank transactions from CSV data (parsed as JSON array).
pub async fn tool_import_bank_transactions(
    state: &crate::state::AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> Result<Value, crate::error::AppError> {
    let pool = state.db_pool.as_ref().ok_or_else(|| {
        crate::error::AppError::Dependency("Database not configured.".to_string())
    })?;

    let transactions = args.get("transactions").and_then(Value::as_array);
    let bank_name = args
        .get("bank_name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let Some(txns) = transactions else {
        return Ok(json!({ "ok": false, "error": "transactions array is required." }));
    };

    let mut imported = 0u32;
    let mut skipped = 0u32;

    for txn in txns {
        let date = txn
            .get("date")
            .or_else(|| txn.get("transaction_date"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let description = txn
            .get("description")
            .or_else(|| txn.get("desc"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let amount = txn.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        let reference = txn
            .get("reference")
            .or_else(|| txn.get("ref"))
            .and_then(Value::as_str);
        let currency = txn.get("currency").and_then(Value::as_str).unwrap_or("PYG");
        let external_id = txn.get("external_id").and_then(Value::as_str);
        let counterparty = txn
            .get("counterparty_name")
            .or_else(|| txn.get("counterparty"))
            .and_then(Value::as_str);

        if date.is_empty() || amount.abs() < 0.001 {
            skipped += 1;
            continue;
        }

        let direction = if amount >= 0.0 { "credit" } else { "debit" };

        // Skip duplicates based on external_id
        if let Some(eid) = external_id {
            let existing: Option<(String,)> = sqlx::query_as(
                "SELECT id::text FROM bank_transactions
                 WHERE organization_id = $1::uuid AND external_id = $2
                 LIMIT 1",
            )
            .bind(org_id)
            .bind(eid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            if existing.is_some() {
                skipped += 1;
                continue;
            }
        }

        sqlx::query(
            "INSERT INTO bank_transactions
                (organization_id, external_id, bank_name, transaction_date, description,
                 amount, currency, direction, reference, counterparty_name, raw_data)
             VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::jsonb)",
        )
        .bind(org_id)
        .bind(external_id)
        .bind(bank_name)
        .bind(date)
        .bind(description)
        .bind(amount.abs())
        .bind(currency)
        .bind(direction)
        .bind(reference)
        .bind(counterparty)
        .bind(txn)
        .execute(pool)
        .await
        .ok();

        imported += 1;
    }

    Ok(json!({
        "ok": true,
        "imported": imported,
        "skipped": skipped,
        "bank_name": bank_name,
    }))
}

/// Multi-pass auto-reconciliation engine:
/// 1. Exact reference match
/// 2. Amount + date range (±3 days, exact amount)
/// 3. Fuzzy match (5% tolerance, tenant name in description)
pub async fn tool_auto_reconcile_batch(
    state: &crate::state::AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> Result<Value, crate::error::AppError> {
    let pool = state.db_pool.as_ref().ok_or_else(|| {
        crate::error::AppError::Dependency("Database not configured.".to_string())
    })?;

    let period_month = args
        .get("period_month")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Create reconciliation run
    let run = sqlx::query(
        "INSERT INTO reconciliation_runs (organization_id, run_type)
         VALUES ($1::uuid, 'auto')
         RETURNING id::text",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create reconciliation run");
        crate::error::AppError::Dependency("Failed to create run.".to_string())
    })?;

    let run_id: String = run.try_get("id").unwrap_or_default();

    // Fetch unmatched bank transactions
    let txns = sqlx::query(
        "SELECT id::text, transaction_date::text, description, amount::float8,
                reference, counterparty_name, currency
         FROM bank_transactions
         WHERE organization_id = $1::uuid
           AND match_status = 'unmatched'
           AND direction = 'credit'
         ORDER BY transaction_date DESC
         LIMIT 500",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Fetch pending collections
    let collections = sqlx::query(
        "SELECT cr.id::text AS collection_id, cr.amount::float8, cr.due_date::text,
                cr.status, pi.reference_code,
                COALESCE(t.full_name, '') AS tenant_name
         FROM collection_records cr
         LEFT JOIN payment_instructions pi ON pi.collection_record_id = cr.id
         LEFT JOIN leases l ON l.id = cr.lease_id
         LEFT JOIN app_users t ON t.id = l.tenant_id
         WHERE cr.organization_id = $1::uuid
           AND cr.status IN ('scheduled', 'pending', 'late')
           AND ($2 = '' OR to_char(cr.due_date, 'YYYY-MM') = $2)
         ORDER BY cr.due_date ASC",
    )
    .bind(org_id)
    .bind(period_month)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut matched_count = 0u32;
    let partial_count = 0u32;
    let exception_count;
    let mut total_matched_amount = 0.0f64;
    let mut matched_txn_ids = std::collections::HashSet::new();

    // Pass 1: Exact reference match
    for txn in &txns {
        let txn_id: String = txn.try_get("id").unwrap_or_default();
        let txn_ref: String = txn
            .try_get::<Option<String>, _>("reference")
            .ok()
            .flatten()
            .unwrap_or_default();
        let txn_amount: f64 = txn.try_get("amount").unwrap_or(0.0);

        if txn_ref.is_empty() || matched_txn_ids.contains(&txn_id) {
            continue;
        }

        for col in &collections {
            let col_ref: String = col
                .try_get::<Option<String>, _>("reference_code")
                .ok()
                .flatten()
                .unwrap_or_default();
            let col_id: String = col.try_get("collection_id").unwrap_or_default();

            if col_ref.is_empty() || col_ref != txn_ref {
                continue;
            }

            // Match found
            sqlx::query(
                "UPDATE bank_transactions
                 SET match_status = 'matched', match_confidence = 1.0,
                     matched_collection_id = $3::uuid, match_method = 'exact_reference',
                     reconciliation_run_id = $4::uuid, updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(&txn_id)
            .bind(org_id)
            .bind(&col_id)
            .bind(&run_id)
            .execute(pool)
            .await
            .ok();

            // Update collection
            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("paid".to_string()));
            patch.insert("amount_paid".to_string(), json!(txn_amount));
            patch.insert(
                "paid_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let _ = update_row(pool, "collection_records", &col_id, &patch, "id").await;

            matched_count += 1;
            total_matched_amount += txn_amount;
            matched_txn_ids.insert(txn_id.clone());
            break;
        }
    }

    // Pass 2: Amount + date range (±3 days, exact amount within 0.01)
    for txn in &txns {
        let txn_id: String = txn.try_get("id").unwrap_or_default();
        if matched_txn_ids.contains(&txn_id) {
            continue;
        }

        let txn_amount: f64 = txn.try_get("amount").unwrap_or(0.0);
        let txn_date: String = txn.try_get("transaction_date").unwrap_or_default();

        for col in &collections {
            let col_id: String = col.try_get("collection_id").unwrap_or_default();
            let col_amount: f64 = col.try_get("amount").unwrap_or(0.0);
            let col_date: String = col.try_get("due_date").unwrap_or_default();

            // Amount must match within 0.01
            if (txn_amount - col_amount).abs() > 0.01 {
                continue;
            }

            // Date within ±3 days
            let date_ok = if let (Ok(td), Ok(cd)) = (
                chrono::NaiveDate::parse_from_str(&txn_date, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(&col_date, "%Y-%m-%d"),
            ) {
                (td - cd).num_days().abs() <= 3
            } else {
                false
            };
            if !date_ok {
                continue;
            }

            sqlx::query(
                "UPDATE bank_transactions
                 SET match_status = 'matched', match_confidence = 0.85,
                     matched_collection_id = $3::uuid, match_method = 'amount_date',
                     reconciliation_run_id = $4::uuid, updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(&txn_id)
            .bind(org_id)
            .bind(&col_id)
            .bind(&run_id)
            .execute(pool)
            .await
            .ok();

            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("paid".to_string()));
            patch.insert("amount_paid".to_string(), json!(txn_amount));
            patch.insert(
                "paid_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let _ = update_row(pool, "collection_records", &col_id, &patch, "id").await;

            matched_count += 1;
            total_matched_amount += txn_amount;
            matched_txn_ids.insert(txn_id.clone());
            break;
        }
    }

    // Pass 3: Fuzzy match (5% tolerance + tenant name in description)
    for txn in &txns {
        let txn_id: String = txn.try_get("id").unwrap_or_default();
        if matched_txn_ids.contains(&txn_id) {
            continue;
        }

        let txn_amount: f64 = txn.try_get("amount").unwrap_or(0.0);
        let txn_desc: String = txn
            .try_get::<Option<String>, _>("description")
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_lowercase();
        let txn_counterparty: String = txn
            .try_get::<Option<String>, _>("counterparty_name")
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_lowercase();

        for col in &collections {
            let col_id: String = col.try_get("collection_id").unwrap_or_default();
            let col_amount: f64 = col.try_get("amount").unwrap_or(0.0);
            let tenant_name: String = col
                .try_get::<String, _>("tenant_name")
                .unwrap_or_default()
                .to_lowercase();

            // Amount within 5%
            let tolerance = col_amount * 0.05;
            if (txn_amount - col_amount).abs() > tolerance {
                continue;
            }

            // Tenant name must appear in description or counterparty
            if tenant_name.is_empty() {
                continue;
            }
            let name_parts: Vec<&str> = tenant_name.split_whitespace().collect();
            let name_match = name_parts.iter().any(|part| {
                part.len() >= 3 && (txn_desc.contains(part) || txn_counterparty.contains(part))
            });
            if !name_match {
                continue;
            }

            sqlx::query(
                "UPDATE bank_transactions
                 SET match_status = 'matched', match_confidence = 0.70,
                     matched_collection_id = $3::uuid, match_method = 'fuzzy_name',
                     reconciliation_run_id = $4::uuid, updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(&txn_id)
            .bind(org_id)
            .bind(&col_id)
            .bind(&run_id)
            .execute(pool)
            .await
            .ok();

            let mut patch = Map::new();
            patch.insert("status".to_string(), Value::String("paid".to_string()));
            patch.insert("amount_paid".to_string(), json!(txn_amount));
            patch.insert(
                "paid_at".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            let _ = update_row(pool, "collection_records", &col_id, &patch, "id").await;

            matched_count += 1;
            total_matched_amount += txn_amount;
            matched_txn_ids.insert(txn_id.clone());
            break;
        }
    }

    // Mark remaining unmatched as exceptions
    let unmatched_count = txns.len() as u32 - matched_count;
    exception_count = unmatched_count;

    // Update reconciliation run stats
    let total = txns.len() as i32;
    let match_rate = if total > 0 {
        matched_count as f64 / total as f64
    } else {
        0.0
    };

    sqlx::query(
        "UPDATE reconciliation_runs
         SET completed_at = now(), total_transactions = $3,
             matched_count = $4, partial_count = $5, exception_count = $6,
             total_matched_amount = $7, match_rate = $8
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(&run_id)
    .bind(org_id)
    .bind(total)
    .bind(matched_count as i32)
    .bind(partial_count as i32)
    .bind(exception_count as i32)
    .bind(total_matched_amount)
    .bind(match_rate)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "run_id": run_id,
        "total_transactions": total,
        "matched": matched_count,
        "partial": partial_count,
        "exceptions": exception_count,
        "match_rate": (match_rate * 100.0).round() / 100.0,
        "total_matched_amount": total_matched_amount,
    }))
}

/// Handle a split payment — match multiple bank transactions to one collection.
pub async fn tool_handle_split_payment(
    state: &crate::state::AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> Result<Value, crate::error::AppError> {
    let pool = state.db_pool.as_ref().ok_or_else(|| {
        crate::error::AppError::Dependency("Database not configured.".to_string())
    })?;

    let collection_id = args
        .get("collection_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let transaction_ids = args.get("transaction_ids").and_then(Value::as_array);

    if collection_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "collection_id is required." }));
    }
    let Some(txn_ids) = transaction_ids else {
        return Ok(json!({ "ok": false, "error": "transaction_ids array is required." }));
    };

    // Fetch collection expected amount
    let col = sqlx::query(
        "SELECT amount::float8, amount_paid::float8, status
         FROM collection_records
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(collection_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch collection");
        crate::error::AppError::Dependency("Failed to fetch collection.".to_string())
    })?;

    let Some(col_row) = col else {
        return Ok(json!({ "ok": false, "error": "Collection not found." }));
    };

    let expected: f64 = col_row.try_get("amount").unwrap_or(0.0);
    let already_paid: f64 = col_row.try_get("amount_paid").unwrap_or(0.0);

    let mut total_split = already_paid;
    let mut matched_txns = Vec::new();

    for txn_id_val in txn_ids {
        let txn_id = txn_id_val.as_str().unwrap_or_default();
        if txn_id.is_empty() {
            continue;
        }

        let txn = sqlx::query(
            "SELECT amount::float8 FROM bank_transactions
             WHERE id = $1::uuid AND organization_id = $2::uuid AND match_status = 'unmatched'",
        )
        .bind(txn_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        if let Some(txn_row) = txn {
            let amt: f64 = txn_row.try_get("amount").unwrap_or(0.0);
            total_split += amt;

            // Link transaction to collection
            sqlx::query(
                "UPDATE bank_transactions
                 SET match_status = 'matched', match_confidence = 0.95,
                     matched_collection_id = $3::uuid, match_method = 'split_payment',
                     updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(txn_id)
            .bind(org_id)
            .bind(collection_id)
            .execute(pool)
            .await
            .ok();

            matched_txns.push(json!({"id": txn_id, "amount": amt}));
        }
    }

    // Update collection with total
    let new_status = if (total_split - expected).abs() < 0.01 || total_split >= expected {
        "paid"
    } else {
        "pending"
    };

    let mut patch = Map::new();
    patch.insert("amount_paid".to_string(), json!(total_split));
    patch.insert("status".to_string(), Value::String(new_status.to_string()));
    if new_status == "paid" {
        patch.insert(
            "paid_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    }
    let _ = update_row(pool, "collection_records", collection_id, &patch, "id").await;

    Ok(json!({
        "ok": true,
        "collection_id": collection_id,
        "expected": expected,
        "total_paid": total_split,
        "status": new_status,
        "transactions_matched": matched_txns.len(),
        "transactions": matched_txns,
    }))
}

/// Run daily reconciliation for all active orgs.
pub async fn run_daily_reconciliation(state: &crate::state::AppState) {
    let Some(pool) = state.db_pool.as_ref() else {
        return;
    };

    let orgs: Vec<(String,)> =
        sqlx::query_as("SELECT id::text FROM organizations WHERE is_active = true")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    for (org_id,) in &orgs {
        let mut args = Map::new();
        args.insert("period_month".to_string(), Value::String(String::new()));
        let _ = tool_auto_reconcile_batch(state, org_id, &args).await;
    }

    tracing::info!(org_count = orgs.len(), "Daily reconciliation completed");
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
