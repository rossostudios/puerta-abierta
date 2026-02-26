use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// Run a background check via Informconf (Paraguay credit bureau).
/// Requires INFORMCONF_API_KEY and INFORMCONF_API_URL environment variables.
pub async fn check_informconf(
    state: &AppState,
    org_id: &str,
    document_number: &str,
    full_name: &str,
) -> AppResult<Value> {
    let api_key = state
        .config
        .informconf_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable(
                "INFORMCONF_API_KEY not configured. Set it in environment variables.".to_string(),
            )
        })?;

    let api_url = state
        .config
        .informconf_api_url
        .as_deref()
        .unwrap_or("https://api.informconf.com.py");

    if document_number.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "document_number is required for background check.",
        }));
    }

    let response = state
        .http_client
        .post(&format!("{api_url}/v1/consulta"))
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "documento": document_number,
            "nombre": full_name,
        }))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Informconf API request failed");
            AppError::Dependency("Informconf API request failed.".to_string())
        })?;

    let status = response.status();
    let body: Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse Informconf response");
        AppError::Dependency("Failed to parse Informconf response.".to_string())
    })?;

    if !status.is_success() {
        return Ok(json!({
            "ok": false,
            "error": format!("Informconf API error ({})", status),
            "detail": body,
        }));
    }

    // Store result as an integration event
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))?;

    sqlx::query(
        "INSERT INTO integration_events (
            organization_id, event_type, source, payload, processed
         ) VALUES ($1::uuid, 'background_check', 'informconf', $2::jsonb, true)",
    )
    .bind(org_id)
    .bind(&body)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "source": "informconf",
        "document_number": document_number,
        "result": body,
    }))
}
