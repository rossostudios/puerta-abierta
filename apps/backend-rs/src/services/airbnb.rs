use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

const AIRBNB_API_BASE: &str = "https://api.airbnb.com/v3";
const AIRBNB_AUTH_URL: &str = "https://www.airbnb.com/oauth2/auth";
const AIRBNB_TOKEN_URL: &str = "https://api.airbnb.com/v2/oauth2/authorizations";

/// Airbnb OAuth2 configuration from env vars.
pub struct AirbnbConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl AirbnbConfig {
    pub fn from_env() -> Option<Self> {
        let client_id = std::env::var("AIRBNB_CLIENT_ID").ok()?;
        let client_secret = std::env::var("AIRBNB_CLIENT_SECRET").ok()?;
        let redirect_uri = std::env::var("AIRBNB_REDIRECT_URI").ok()?;
        Some(Self {
            client_id,
            client_secret,
            redirect_uri,
        })
    }

    pub fn auth_url(&self, state: &str) -> String {
        fn encode(s: &str) -> String {
            let mut out = String::with_capacity(s.len() * 3);
            for b in s.bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        out.push(b as char);
                    }
                    _ => {
                        out.push_str(&format!("%{b:02X}"));
                    }
                }
            }
            out
        }
        format!(
            "{AIRBNB_AUTH_URL}?client_id={}&redirect_uri={}&scope=listings_r,reservations_rw,messages_r&response_type=code&state={}",
            encode(&self.client_id),
            encode(&self.redirect_uri),
            encode(state),
        )
    }
}

#[derive(Debug, Deserialize)]
pub struct AirbnbTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

/// Exchange an OAuth authorization code for tokens.
pub async fn exchange_code(
    http: &Client,
    config: &AirbnbConfig,
    code: &str,
) -> Result<AirbnbTokenResponse, String> {
    let res = http
        .post(AIRBNB_TOKEN_URL)
        .json(&json!({
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": config.redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Airbnb token exchange failed: {text}"));
    }

    res.json::<AirbnbTokenResponse>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

/// Refresh an expired access token.
pub async fn refresh_token(
    http: &Client,
    config: &AirbnbConfig,
    refresh_tok: &str,
) -> Result<AirbnbTokenResponse, String> {
    let res = http
        .post(AIRBNB_TOKEN_URL)
        .json(&json!({
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "refresh_token": refresh_tok,
            "grant_type": "refresh_token",
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Airbnb token refresh failed: {text}"));
    }

    res.json::<AirbnbTokenResponse>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

#[derive(Debug, Deserialize)]
struct AirbnbReservation {
    confirmation_code: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    status: Option<String>,
    guest: Option<AirbnbGuest>,
    listing_id: Option<i64>,
    nights: Option<i64>,
    expected_payout_amount_accurate: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct AirbnbGuest {
    first_name: Option<String>,
    last_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AirbnbReservationsResponse {
    reservations: Option<Vec<AirbnbReservation>>,
}

/// Fetch reservations from Airbnb API for a listing.
pub async fn fetch_reservations(
    http: &Client,
    access_token: &str,
    listing_id: &str,
) -> Result<Vec<Value>, String> {
    let url = format!(
        "{AIRBNB_API_BASE}/reservations?listing_id={listing_id}&status=accept,pending&_limit=50"
    );

    let res = http
        .get(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Airbnb API error: {text}"));
    }

    let body = res
        .json::<AirbnbReservationsResponse>()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let reservations = body.reservations.unwrap_or_default();
    Ok(reservations
        .into_iter()
        .map(|r| {
            let guest_name = r
                .guest
                .as_ref()
                .map(|g| {
                    format!(
                        "{} {}",
                        g.first_name.as_deref().unwrap_or(""),
                        g.last_name.as_deref().unwrap_or("")
                    )
                    .trim()
                    .to_string()
                })
                .unwrap_or_default();

            json!({
                "confirmation_code": r.confirmation_code,
                "check_in": r.start_date,
                "check_out": r.end_date,
                "status": r.status,
                "guest_name": guest_name,
                "listing_id": r.listing_id,
                "nights": r.nights,
                "payout_amount": r.expected_payout_amount_accurate,
            })
        })
        .collect())
}

/// Push availability (calendar blocks) to Airbnb.
pub async fn push_availability(
    http: &Client,
    access_token: &str,
    listing_id: &str,
    dates: &[(String, bool)], // (date YYYY-MM-DD, available)
) -> Result<(), String> {
    let days: Vec<Value> = dates
        .iter()
        .map(|(date, available)| {
            json!({
                "date": date,
                "available": available,
            })
        })
        .collect();

    let url = format!("{AIRBNB_API_BASE}/calendars/{listing_id}");

    let res = http
        .put(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "days": days }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Airbnb calendar push failed: {text}"));
    }

    Ok(())
}

/// Push pricing updates to Airbnb.
pub async fn push_pricing(
    http: &Client,
    access_token: &str,
    listing_id: &str,
    dates: &[(String, f64)], // (date, nightly_price)
) -> Result<(), String> {
    let days: Vec<Value> = dates
        .iter()
        .map(|(date, price)| {
            json!({
                "date": date,
                "price": price,
            })
        })
        .collect();

    let url = format!("{AIRBNB_API_BASE}/calendars/{listing_id}");

    let res = http
        .put(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "days": days }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Airbnb pricing push failed: {text}"));
    }

    Ok(())
}

/// Sync a single integration: pull Airbnb reservations → upsert locally.
pub async fn sync_airbnb_integration(
    pool: &PgPool,
    http: &Client,
    integration_id: &str,
    access_token: &str,
    listing_id: &str,
    org_id: &str,
    unit_id: &str,
) -> Result<Value, String> {
    let reservations = fetch_reservations(http, access_token, listing_id).await?;

    let mut created = 0i64;
    let mut updated = 0i64;
    let mut skipped = 0i64;

    for res in &reservations {
        let ext_id = res
            .get("confirmation_code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if ext_id.is_empty() {
            skipped += 1;
            continue;
        }

        let check_in = res.get("check_in").and_then(Value::as_str).unwrap_or("");
        let check_out = res.get("check_out").and_then(Value::as_str).unwrap_or("");
        let guest_name = res
            .get("guest_name")
            .and_then(Value::as_str)
            .unwrap_or("Airbnb Guest");
        let payout = res
            .get("payout_amount")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let airbnb_status = res
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending");

        let local_status = match airbnb_status {
            "accept" | "accepted" => "confirmed",
            "pending" => "pending",
            "denied" | "cancelled" | "cancelled_by_host" | "cancelled_by_guest" => "cancelled",
            _ => "pending",
        };

        // Check if reservation exists
        let existing = sqlx::query_scalar::<_, String>(
            "SELECT id::text FROM reservations
             WHERE organization_id = $1::uuid
               AND external_reservation_id = $2
             LIMIT 1",
        )
        .bind(org_id)
        .bind(ext_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error: {e}"))?;

        if let Some(existing_id) = existing {
            // Update
            sqlx::query(
                "UPDATE reservations SET
                   check_in_date = $2::date, check_out_date = $3::date,
                   status = $4, total_amount = $5, updated_at = now()
                 WHERE id = $1::uuid",
            )
            .bind(&existing_id)
            .bind(check_in)
            .bind(check_out)
            .bind(local_status)
            .bind(payout)
            .execute(pool)
            .await
            .map_err(|e| format!("DB error: {e}"))?;

            updated += 1;
        } else {
            // Create
            sqlx::query(
                "INSERT INTO reservations (organization_id, unit_id, integration_id,
                   external_reservation_id, source, check_in_date, check_out_date,
                   status, guest_name, total_amount, currency)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'ical', $5::date, $6::date,
                   $7, $8, $9, 'USD')",
            )
            .bind(org_id)
            .bind(unit_id)
            .bind(integration_id)
            .bind(ext_id)
            .bind(check_in)
            .bind(check_out)
            .bind(local_status)
            .bind(guest_name)
            .bind(payout)
            .execute(pool)
            .await
            .map_err(|e| format!("DB error: {e}"))?;

            created += 1;
        }
    }

    // Update sync timestamp
    sqlx::query(
        "UPDATE integrations SET last_ical_sync_at = now(), ical_sync_error = NULL
         WHERE id = $1::uuid",
    )
    .bind(integration_id)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total_fetched": reservations.len(),
    }))
}

/// Get the stored Airbnb access token for an integration.
pub async fn get_integration_airbnb_token(
    pool: &PgPool,
    integration_id: &str,
) -> Result<(String, String), String> {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT
           (metadata->>'airbnb_access_token')::text,
           (metadata->>'airbnb_listing_id')::text
         FROM integrations WHERE id = $1::uuid",
    )
    .bind(integration_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    match row {
        Some((Some(token), Some(listing_id))) if !token.is_empty() && !listing_id.is_empty() => {
            Ok((token, listing_id))
        }
        _ => Err("No Airbnb access token configured for this integration.".to_string()),
    }
}
