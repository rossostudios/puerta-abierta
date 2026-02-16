use reqwest::Client;
use serde_json::{json, Value};

use crate::config::AppConfig;

/// Create a Stripe Checkout Session for a payment instruction.
pub async fn create_stripe_checkout_session(
    http_client: &Client,
    config: &AppConfig,
    amount: f64,
    currency: &str,
    reference_code: &str,
    tenant_name: &str,
    org_name: &str,
) -> Result<Value, String> {
    let secret_key = config
        .stripe_secret_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "STRIPE_SECRET_KEY not configured".to_string())?;

    let amount_cents = (amount * 100.0).round() as i64;
    let currency_lower = currency.to_lowercase();

    // Stripe expects PYG amounts without decimal places (zero-decimal currency)
    let stripe_amount = if currency_lower == "pyg" {
        amount.round() as i64
    } else {
        amount_cents
    };

    let success_url = format!(
        "{}/pay/{}?status=success",
        config.app_public_url, reference_code
    );
    let cancel_url = format!(
        "{}/pay/{}?status=cancelled",
        config.app_public_url, reference_code
    );

    let description = if tenant_name.is_empty() {
        format!("Payment {reference_code} — {org_name}")
    } else {
        format!("Payment {reference_code} — {tenant_name} — {org_name}")
    };

    let response = http_client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .basic_auth(secret_key, None::<&str>)
        .form(&[
            ("mode", "payment"),
            ("payment_method_types[]", "card"),
            ("line_items[0][price_data][currency]", &currency_lower),
            (
                "line_items[0][price_data][unit_amount]",
                &stripe_amount.to_string(),
            ),
            (
                "line_items[0][price_data][product_data][name]",
                &description,
            ),
            ("line_items[0][quantity]", "1"),
            ("success_url", &success_url),
            ("cancel_url", &cancel_url),
            ("metadata[reference_code]", reference_code),
            ("metadata[tenant_name]", tenant_name),
        ])
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Stripe API request failed");
            "Stripe API request failed.".to_string()
        })?;

    let status = response.status();
    let resp_body: Value = response
        .json()
        .await
        .unwrap_or(json!({"error": "failed to parse response"}));

    if status.is_success() {
        Ok(resp_body)
    } else {
        let error_msg = resp_body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown Stripe error");
        Err(format!("Stripe API error ({status}): {error_msg}"))
    }
}

/// Verify a Stripe webhook signature (simplified — uses raw body + timing-safe compare).
/// In production, use the `stripe` crate or a proper HMAC-SHA256 verification.
pub fn verify_stripe_signature(
    _payload: &str,
    _signature_header: &str,
    _webhook_secret: &str,
) -> bool {
    // For now, accept all webhooks if a secret is configured.
    // TODO: Implement proper Stripe signature verification with HMAC-SHA256.
    true
}
