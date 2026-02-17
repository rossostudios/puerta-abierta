use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Default fallback rate if no external API is reachable.
const FALLBACK_USD_PYG: f64 = 7500.0;

/// Cache TTL in seconds (1 hour).
const CACHE_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone)]
struct CachedRate {
    rate: f64,
    fetched_at: std::time::Instant,
}

/// Thread-safe in-memory FX cache.
static FX_CACHE: std::sync::LazyLock<Arc<RwLock<Option<CachedRate>>>> =
    std::sync::LazyLock::new(|| Arc::new(RwLock::new(None)));

/// Get USD→PYG rate for a specific date (no caching, used for expense enrichment).
pub async fn get_usd_to_pyg_rate(http_client: &reqwest::Client, value_date: &str) -> Option<f64> {
    let day = value_date.trim();
    if day.is_empty() {
        return None;
    }

    let sources = [
        format!(
            "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{day}/v1/currencies/usd/pyg.json"
        ),
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd/pyg.json"
            .to_string(),
        "https://open.er-api.com/v6/latest/USD".to_string(),
    ];

    for source in sources {
        let Some(payload) = fetch_json(http_client, &source).await else {
            continue;
        };
        if let Some(rate) = parse_rate(&payload) {
            if rate > 0.0 {
                return Some(rate);
            }
        }
    }

    None
}

/// Get the latest USD→PYG rate with in-memory caching (1-hour TTL).
/// Used for real-time display conversions. Falls back to hardcoded rate.
pub async fn get_cached_usd_pyg_rate(http_client: &reqwest::Client) -> f64 {
    // Check cache
    {
        let cache = FX_CACHE.read().await;
        if let Some(cached) = cache.as_ref() {
            if cached.fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                return cached.rate;
            }
        }
    }

    // Cache miss or stale — fetch fresh rate
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let rate = match get_usd_to_pyg_rate(http_client, &today).await {
        Some(r) if r > 0.0 => r,
        _ => {
            // Try without date
            let sources = [
                "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd/pyg.json".to_string(),
                "https://open.er-api.com/v6/latest/USD".to_string(),
            ];
            let mut found = None;
            for source in sources {
                if let Some(payload) = fetch_json(http_client, &source).await {
                    if let Some(r) = parse_rate(&payload) {
                        if r > 0.0 {
                            found = Some(r);
                            break;
                        }
                    }
                }
            }
            found.unwrap_or(FALLBACK_USD_PYG)
        }
    };

    // Update cache
    {
        let mut cache = FX_CACHE.write().await;
        *cache = Some(CachedRate {
            rate,
            fetched_at: std::time::Instant::now(),
        });
    }

    rate
}

async fn fetch_json(http_client: &reqwest::Client, url: &str) -> Option<Value> {
    let response = http_client
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "casaora/1.0")
        .send()
        .await
        .ok()?;

    let ok_response = response.error_for_status().ok()?;
    ok_response.json::<Value>().await.ok()
}

fn parse_rate(payload: &Value) -> Option<f64> {
    if let Some(rate) = payload.get("pyg").and_then(numeric_value) {
        return Some(rate);
    }

    payload
        .get("rates")
        .and_then(Value::as_object)
        .and_then(|rates| rates.get("PYG"))
        .and_then(numeric_value)
}

fn numeric_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}
