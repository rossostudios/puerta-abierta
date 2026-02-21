use reqwest::Client;
use serde_json::{json, Value};

const MP_API_BASE: &str = "https://api.mercadopago.com";

/// Create a Mercado Pago Checkout Pro preference (PYG payment).
pub async fn create_mp_checkout(
    http_client: &Client,
    access_token: &str,
    amount: f64,
    currency: &str,
    reference_code: &str,
    description: &str,
    success_url: &str,
    failure_url: &str,
) -> Result<Value, String> {
    let response = http_client
        .post(format!("{MP_API_BASE}/checkout/preferences"))
        .bearer_auth(access_token)
        .json(&json!({
            "items": [{
                "title": description,
                "quantity": 1,
                "currency_id": currency.to_uppercase(),
                "unit_price": amount,
            }],
            "external_reference": reference_code,
            "back_urls": {
                "success": success_url,
                "failure": failure_url,
                "pending": failure_url,
            },
            "auto_return": "approved",
            "notification_url": format!("{success_url}/../../webhooks/mercado-pago"),
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Mercado Pago API request failed");
            "Mercado Pago API request failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(json!({
            "checkout_url": resp_body.get("init_point").and_then(Value::as_str).unwrap_or(""),
            "sandbox_url": resp_body.get("sandbox_init_point").and_then(Value::as_str).unwrap_or(""),
            "preference_id": resp_body.get("id").and_then(Value::as_str).unwrap_or(""),
        }))
    } else {
        let error_msg = resp_body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown Mercado Pago error");
        Err(format!("Mercado Pago API error ({status}): {error_msg}"))
    }
}

/// Create a QR code for in-person PYG payment (Mercado Pago Point / QR).
pub async fn create_mp_qr_payment(
    http_client: &Client,
    access_token: &str,
    amount: f64,
    reference_code: &str,
    description: &str,
) -> Result<Value, String> {
    // Use dynamic QR — creates an order that can be scanned
    let response = http_client
        .post(format!("{MP_API_BASE}/instore/orders/qr/seller/collectors/me/pos/main/qrs"))
        .bearer_auth(access_token)
        .json(&json!({
            "external_reference": reference_code,
            "title": description,
            "total_amount": amount,
            "items": [{
                "title": description,
                "unit_price": amount,
                "quantity": 1,
                "unit_measure": "unit",
                "total_amount": amount,
            }],
            "description": description,
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Mercado Pago QR API request failed");
            "Mercado Pago QR API request failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(json!({
            "qr_data": resp_body.get("qr_data").and_then(Value::as_str).unwrap_or(""),
            "in_store_order_id": resp_body.get("in_store_order_id").and_then(Value::as_str).unwrap_or(""),
        }))
    } else {
        let error_msg = resp_body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown Mercado Pago error");
        Err(format!("Mercado Pago QR error ({status}): {error_msg}"))
    }
}

/// Retrieve a payment status from Mercado Pago by payment ID.
pub async fn get_mp_payment(
    http_client: &Client,
    access_token: &str,
    payment_id: &str,
) -> Result<Value, String> {
    let response = http_client
        .get(format!("{MP_API_BASE}/v1/payments/{payment_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Mercado Pago payment lookup failed");
            "Mercado Pago payment lookup failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(json!({
            "id": resp_body.get("id"),
            "status": resp_body.get("status").and_then(Value::as_str).unwrap_or("unknown"),
            "status_detail": resp_body.get("status_detail").and_then(Value::as_str).unwrap_or(""),
            "external_reference": resp_body.get("external_reference").and_then(Value::as_str).unwrap_or(""),
            "transaction_amount": resp_body.get("transaction_amount"),
            "currency_id": resp_body.get("currency_id").and_then(Value::as_str).unwrap_or("PYG"),
            "date_approved": resp_body.get("date_approved"),
            "payer_email": resp_body.get("payer").and_then(|p| p.get("email")).and_then(Value::as_str).unwrap_or(""),
        }))
    } else {
        Err(format!("Mercado Pago payment lookup error ({status})"))
    }
}

/// Fetch the Mercado Pago access token for an organization from the integrations table.
pub async fn get_org_mp_access_token(
    pool: &sqlx::PgPool,
    org_id: &str,
) -> Result<String, String> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT mercado_pago_access_token FROM integrations
         WHERE organization_id = $1::uuid AND mercado_pago_access_token IS NOT NULL
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to query integrations: {e}"))?;

    row.and_then(|(token,)| token)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "Mercado Pago not configured for this organization.".to_string())
}
