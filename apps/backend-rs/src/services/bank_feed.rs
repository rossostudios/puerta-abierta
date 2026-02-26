use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// Import bank transactions from CSV format.
/// Each row: date, description, amount, reference
pub async fn import_csv_transactions(
    state: &AppState,
    org_id: &str,
    csv_content: &str,
) -> AppResult<Value> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))?;

    let mut imported = 0_u32;
    let mut skipped = 0_u32;
    let mut errors = Vec::new();

    for (line_num, line) in csv_content.lines().enumerate() {
        if line_num == 0 && line.to_lowercase().contains("date") {
            continue; // Skip header
        }

        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        if fields.len() < 3 {
            skipped += 1;
            continue;
        }

        let date = fields[0];
        let description = fields[1];
        let amount: f64 = match fields[2].replace(&['$', '₲', ',', ' '][..], "").parse() {
            Ok(a) => a,
            Err(_) => {
                errors.push(format!(
                    "Line {}: invalid amount '{}'",
                    line_num + 1,
                    fields[2]
                ));
                continue;
            }
        };
        let reference = fields.get(3).copied().unwrap_or_default();

        // Insert as a bank_transaction (stored as integration_event for now)
        let result = sqlx::query(
            "INSERT INTO integration_events (
                organization_id, event_type, source, payload, processed
             ) VALUES ($1::uuid, 'bank_transaction', 'csv_import', $2::jsonb, false)
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(json!({
            "date": date,
            "description": description,
            "amount": amount,
            "reference": reference,
        }))
        .fetch_optional(pool)
        .await;

        match result {
            Ok(Some(_)) => imported += 1,
            Ok(None) => skipped += 1,
            Err(e) => {
                errors.push(format!("Line {}: {}", line_num + 1, e));
            }
        }
    }

    Ok(json!({
        "ok": true,
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
    }))
}

/// Fetch transactions from Belvo (LatAm banking API).
/// Requires BELVO_SECRET_ID and BELVO_SECRET_PASSWORD environment variables.
pub async fn fetch_belvo_transactions(
    state: &AppState,
    org_id: &str,
    link_id: &str,
    date_from: &str,
    date_to: &str,
) -> AppResult<Value> {
    let secret_id = state
        .config
        .belvo_secret_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable("BELVO_SECRET_ID not configured.".to_string())
        })?;
    let secret_password = state
        .config
        .belvo_secret_password
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable("BELVO_SECRET_PASSWORD not configured.".to_string())
        })?;

    let belvo_url = state
        .config
        .belvo_api_url
        .as_deref()
        .unwrap_or("https://api.belvo.com");

    let response = state
        .http_client
        .post(&format!("{belvo_url}/api/transactions/"))
        .basic_auth(secret_id, Some(secret_password))
        .json(&json!({
            "link": link_id,
            "date_from": date_from,
            "date_to": date_to,
        }))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Belvo API request failed");
            AppError::Dependency("Belvo API request failed.".to_string())
        })?;

    let status = response.status();
    let body: Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse Belvo response");
        AppError::Dependency("Failed to parse Belvo response.".to_string())
    })?;

    if !status.is_success() {
        return Ok(json!({
            "ok": false,
            "error": format!("Belvo API error ({})", status),
            "detail": body,
        }));
    }

    // Store transactions
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))?;

    let transactions = body.as_array().cloned().unwrap_or_default();
    let mut imported = 0_u32;

    for txn in &transactions {
        sqlx::query(
            "INSERT INTO integration_events (
                organization_id, event_type, source, external_id, payload, processed
             ) VALUES ($1::uuid, 'bank_transaction', 'belvo', $2, $3::jsonb, false)
             ON CONFLICT DO NOTHING",
        )
        .bind(org_id)
        .bind(txn.get("id").and_then(Value::as_str).unwrap_or_default())
        .bind(txn)
        .execute(pool)
        .await
        .ok();
        imported += 1;
    }

    Ok(json!({
        "ok": true,
        "source": "belvo",
        "imported": imported,
        "total_fetched": transactions.len(),
    }))
}
