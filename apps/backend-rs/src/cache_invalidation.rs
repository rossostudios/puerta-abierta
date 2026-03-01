use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::state::AppState;

const CHANNEL: &str = "cache_invalidate";

/// An invalidation event broadcast via Postgres LISTEN/NOTIFY.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvalidationEvent {
    /// Which cache to invalidate: "org_membership", "public_listings", "reports",
    /// "enrichment", "agent_config", "fx".
    pub cache: String,
    /// Optional key to invalidate. If empty, the entire cache is cleared.
    pub key: String,
    /// Optional prefix-based invalidation. If non-empty, all keys starting
    /// with this prefix are evicted.
    pub prefix: String,
}

/// Publish an invalidation event to all connected instances via `pg_notify`.
pub async fn notify(pool: &PgPool, event: &InvalidationEvent) {
    let payload = match serde_json::to_string(event) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "failed to serialize invalidation event");
            return;
        }
    };

    if let Err(e) = sqlx::query("SELECT pg_notify($1, $2)")
        .bind(CHANNEL)
        .bind(&payload)
        .execute(pool)
        .await
    {
        tracing::warn!(error = %e, "failed to send cache invalidation notification");
    }
}

/// Spawn a background task that listens for invalidation events and applies
/// them to the local caches.
pub async fn spawn_listener(state: AppState) {
    let Some(pool) = state.db_pool.as_ref() else {
        tracing::warn!("cache invalidation listener skipped — no DB pool");
        return;
    };

    let mut listener = match sqlx::postgres::PgListener::connect_with(pool).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, "failed to create PgListener for cache invalidation");
            return;
        }
    };

    if let Err(e) = listener.listen(CHANNEL).await {
        tracing::error!(error = %e, "failed to LISTEN on {}", CHANNEL);
        return;
    }

    tracing::info!(
        "cache invalidation listener started on channel '{}'",
        CHANNEL
    );

    let mut backoff = std::time::Duration::from_secs(1);
    let max_backoff = std::time::Duration::from_secs(30);

    loop {
        match listener.recv().await {
            Ok(notification) => {
                backoff = std::time::Duration::from_secs(1); // reset on success
                let payload = notification.payload();
                match serde_json::from_str::<InvalidationEvent>(payload) {
                    Ok(event) => apply_invalidation(&state, &event).await,
                    Err(e) => {
                        tracing::warn!(error = %e, payload = payload, "invalid invalidation event");
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, backoff_secs = backoff.as_secs(), "cache invalidation listener error, reconnecting...");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(max_backoff);

                // Re-create listener on persistent errors
                match sqlx::postgres::PgListener::connect_with(pool).await {
                    Ok(mut new_listener) => {
                        if let Err(e) = new_listener.listen(CHANNEL).await {
                            tracing::error!(error = %e, "failed to re-LISTEN on {}", CHANNEL);
                            continue;
                        }
                        listener = new_listener;
                        tracing::info!("cache invalidation listener reconnected");
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "failed to reconnect PgListener");
                    }
                }
            }
        }
    }
}

async fn apply_invalidation(state: &AppState, event: &InvalidationEvent) {
    let cache = match event.cache.as_str() {
        "org_membership" => &state.org_membership_cache,
        "public_listings" => &state.public_listings_cache,
        "reports" => &state.report_response_cache,
        "enrichment" => &state.enrichment_cache,
        "agent_config" => &state.agent_config_cache,
        "fx" => &state.fx_cache,
        other => {
            tracing::debug!(cache = other, "unknown cache in invalidation event");
            return;
        }
    };

    if !event.prefix.is_empty() {
        cache.invalidate_prefix(&event.prefix).await;
    } else if !event.key.is_empty() {
        cache.invalidate(&event.key).await;
    } else {
        cache.clear().await;
    }

    tracing::debug!(
        cache = event.cache.as_str(),
        key = event.key.as_str(),
        prefix = event.prefix.as_str(),
        "applied cache invalidation from NOTIFY"
    );
}
