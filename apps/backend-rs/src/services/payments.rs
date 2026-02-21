use hmac::{Hmac, Mac};
use reqwest::Client;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::config::AppConfig;

type HmacSha256 = Hmac<Sha256>;

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

/// Verify a Stripe webhook signature using HMAC-SHA256.
///
/// Parses the `Stripe-Signature` header (format: `t=<timestamp>,v1=<signature>`),
/// constructs the signed payload `<timestamp>.<body>`, computes HMAC-SHA256
/// with the webhook secret, and uses constant-time comparison.
/// Rejects signatures older than 5 minutes to prevent replay attacks.
pub fn verify_stripe_signature(
    payload: &str,
    signature_header: &str,
    webhook_secret: &str,
) -> bool {
    const TOLERANCE_SECS: i64 = 300; // 5 minutes

    let mut timestamp: Option<&str> = None;
    let mut signature: Option<&str> = None;

    for part in signature_header.split(',') {
        let part = part.trim();
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = Some(t);
        } else if let Some(v1) = part.strip_prefix("v1=") {
            signature = Some(v1);
        }
    }

    let (Some(ts_str), Some(expected_hex)) = (timestamp, signature) else {
        return false;
    };

    let Ok(ts) = ts_str.parse::<i64>() else {
        return false;
    };

    // Reject stale signatures
    let now = chrono::Utc::now().timestamp();
    if (now - ts).abs() > TOLERANCE_SECS {
        tracing::warn!(
            "Stripe webhook signature too old: delta={}s",
            (now - ts).abs()
        );
        return false;
    }

    let signed_payload = format!("{ts_str}.{payload}");

    let Ok(mut mac) = HmacSha256::new_from_slice(webhook_secret.as_bytes()) else {
        return false;
    };
    mac.update(signed_payload.as_bytes());

    // Decode expected hex to bytes
    let Ok(expected_bytes) = hex_decode(expected_hex) else {
        return false;
    };

    mac.verify_slice(&expected_bytes).is_ok()
}

/// Decode a hex string into bytes.
fn hex_decode(hex: &str) -> Result<Vec<u8>, ()> {
    if hex.len() % 2 != 0 {
        return Err(());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| ()))
        .collect()
}
