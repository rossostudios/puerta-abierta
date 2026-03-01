use std::sync::Arc;
use std::time::Duration;

use moka::future::Cache;
use serde_json::Value;

/// A named cache layer backed by `moka::future::Cache`.
///
/// Provides configurable TTL, max capacity, thundering-herd protection via
/// `get_or_try_init`, and prefix-based invalidation.
#[derive(Clone)]
pub struct CacheLayer {
    name: &'static str,
    inner: Cache<String, Arc<Value>>,
}

impl CacheLayer {
    /// Create a new cache with the given name, max capacity, and TTL.
    pub fn new(name: &'static str, max_capacity: u64, ttl: Duration) -> Self {
        let inner = Cache::builder()
            .max_capacity(max_capacity)
            .time_to_live(ttl)
            .build();
        Self { name, inner }
    }

    /// Get a cached value by key.
    pub async fn get(&self, key: &str) -> Option<Value> {
        let hit = self.inner.get(key).await;
        tracing::debug!(
            cache.name = self.name,
            cache.key = key,
            cache.hit = hit.is_some(),
            "cache get"
        );
        hit.map(|arc| (*arc).clone())
    }

    /// Insert a value into the cache.
    pub async fn insert(&self, key: String, value: Value) {
        tracing::debug!(
            cache.name = self.name,
            cache.key = %key,
            "cache insert"
        );
        self.inner.insert(key, Arc::new(value)).await;
    }

    /// Get a cached value, or initialize it using the provided async closure.
    ///
    /// Uses moka's `try_get_with` for thundering-herd protection — only one
    /// caller will execute the init future for a given key at a time.
    pub async fn get_or_try_init<F, Fut>(
        &self,
        key: &str,
        init: F,
    ) -> Result<Value, crate::error::AppError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, crate::error::AppError>>,
    {
        let cache_name = self.name;
        let result = self
            .inner
            .try_get_with(key.to_string(), async {
                let value = init().await.map_err(Arc::new)?;
                Ok(Arc::new(value)) as Result<Arc<Value>, Arc<crate::error::AppError>>
            })
            .await;

        match result {
            Ok(arc) => {
                tracing::debug!(
                    cache.name = cache_name,
                    cache.key = key,
                    "cache get_or_try_init resolved"
                );
                Ok((*arc).clone())
            }
            Err(e) => {
                // Unwrap the Arc<Arc<AppError>> from moka's try_get_with.
                // If another caller holds a reference, fall back to Dependency
                // with the original error message (rare — only on concurrent failures).
                let inner = Arc::try_unwrap(e).unwrap_or_else(|arc| (*arc).clone());
                match Arc::try_unwrap(inner) {
                    Ok(original) => Err(original),
                    Err(arc) => Err(crate::error::AppError::Dependency(arc.to_string())),
                }
            }
        }
    }

    /// Invalidate a single key.
    pub async fn invalidate(&self, key: &str) {
        tracing::debug!(cache.name = self.name, cache.key = key, "cache invalidate");
        self.inner.invalidate(key).await;
    }

    /// Invalidate all keys that start with the given prefix.
    pub async fn invalidate_prefix(&self, prefix: &str) {
        tracing::debug!(
            cache.name = self.name,
            cache.prefix = prefix,
            "cache invalidate_prefix"
        );
        let owned_prefix = prefix.to_string();
        self.inner
            .invalidate_entries_if(move |key, _| key.starts_with(&owned_prefix))
            .ok();
    }

    /// Clear all entries.
    pub async fn clear(&self) {
        tracing::debug!(cache.name = self.name, "cache clear");
        self.inner.invalidate_all();
    }

    /// Return the current number of entries in the cache.
    pub fn entry_count(&self) -> u64 {
        self.inner.entry_count()
    }
}

/// Build an org-scoped cache key: `"{org_id}:{discriminator}"`.
pub fn org_key(org_id: &str, discriminator: &str) -> String {
    format!("{org_id}:{discriminator}")
}
