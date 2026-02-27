use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Row};
use tokio::sync::{Mutex, RwLock};

use crate::{
    config::AppConfig, db::create_pool, db::probe_pool, error::AppResult,
    services::llm_client::LlmClient,
};

/// Cached JWKS key set fetched from an auth provider's /.well-known/jwks.json endpoint.
#[derive(Clone)]
pub struct JwksCache {
    pub jwks_url: String,
    http_client: Client,
    cached_keys: Arc<RwLock<Option<jsonwebtoken::jwk::JwkSet>>>,
}

impl JwksCache {
    pub fn new(jwks_url: String, http_client: Client) -> Self {
        Self {
            jwks_url,
            http_client,
            cached_keys: Arc::new(RwLock::new(None)),
        }
    }

    /// Return cached JWKS or fetch from the endpoint.
    pub async fn get_jwks(&self) -> Result<jsonwebtoken::jwk::JwkSet, String> {
        {
            let cached = self.cached_keys.read().await;
            if let Some(ref keys) = *cached {
                return Ok(keys.clone());
            }
        }
        self.refresh().await
    }

    /// Force-refresh the JWKS cache (e.g. on kid mismatch / key rotation).
    pub async fn refresh(&self) -> Result<jsonwebtoken::jwk::JwkSet, String> {
        let response = self
            .http_client
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch JWKS: {e}"))?;

        let jwks: jsonwebtoken::jwk::JwkSet = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JWKS: {e}"))?;

        {
            let mut cached = self.cached_keys.write().await;
            *cached = Some(jwks.clone());
        }

        Ok(jwks)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db_pool: Option<PgPool>,
    pub http_client: Client,
    pub llm_client: LlmClient,
    pub clerk_jwks_cache: Option<JwksCache>,
    pub org_membership_cache: OrgMembershipCache,
    pub public_listings_cache: PublicListingsCache,
    pub report_response_cache: ReportResponseCache,
}

impl AppState {
    pub fn build(config: AppConfig) -> AppResult<Self> {
        let db_pool = create_pool(&config)?;
        let http_client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| {
                crate::error::AppError::Internal(format!("Could not build HTTP client: {error}"))
            })?;

        let clerk_jwks_cache = config
            .clerk_jwks_url
            .as_ref()
            .map(|url| JwksCache::new(url.clone(), http_client.clone()));

        let org_membership_cache = OrgMembershipCache::new(
            config.org_membership_cache_ttl_seconds,
            config.org_membership_cache_max_entries,
        );
        let public_listings_cache = PublicListingsCache::new(
            config.public_listings_cache_ttl_seconds,
            config.public_listings_cache_max_entries,
        );
        let report_response_cache = ReportResponseCache::new(
            config.report_response_cache_ttl_seconds,
            config.report_response_cache_max_entries,
        );

        let config = Arc::new(config);
        let llm_client = LlmClient::new(http_client.clone(), Arc::clone(&config));

        Ok(Self {
            config,
            db_pool,
            http_client,
            llm_client,
            clerk_jwks_cache,
            org_membership_cache,
            public_listings_cache,
            report_response_cache,
        })
    }

    pub async fn db_startup_probe(&self) -> Result<(), crate::error::AppError> {
        let Some(pool) = self.db_pool.as_ref() else {
            return Err(crate::error::AppError::Dependency(
                "Database is not configured. Set DATABASE_URL.".to_string(),
            ));
        };

        probe_pool(pool, Duration::from_secs(3)).await
    }

    pub async fn api_readiness_report(&self) -> ApiReadinessReport {
        let Some(pool) = self.db_pool.as_ref() else {
            return ApiReadinessReport::not_ready(
                "db_not_configured",
                "Database is not configured.",
                false,
                false,
            );
        };

        if let Err(error) = probe_pool(pool, Duration::from_secs(3)).await {
            return ApiReadinessReport::from_error(&error, false, false);
        }

        let schema = match verify_required_schema(pool).await {
            Ok(report) => report,
            Err(error) => return ApiReadinessReport::from_error(&error, true, false),
        };

        if !schema.compatible {
            return ApiReadinessReport::not_ready(
                "db_schema_incompatible",
                "Database schema is incompatible with this API release.",
                true,
                false,
            )
            .with_missing_columns(schema.missing_columns);
        }

        ApiReadinessReport {
            ready: true,
            status: "ok".to_string(),
            db: true,
            schema: true,
            code: None,
            detail: None,
            retryable: false,
            missing_columns: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct OrgMembershipCache {
    ttl: Duration,
    max_entries: usize,
    entries: Arc<RwLock<HashMap<String, CachedOrgMembership>>>,
    key_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Clone)]
struct CachedOrgMembership {
    value: Option<Value>,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct PublicListingsCache {
    ttl: Duration,
    max_entries: usize,
    entries: Arc<RwLock<HashMap<String, CachedPublicListings>>>,
    key_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Clone)]
struct CachedPublicListings {
    value: Value,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct ReportResponseCache {
    ttl: Duration,
    max_entries: usize,
    entries: Arc<RwLock<HashMap<String, CachedReportResponse>>>,
    key_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Clone)]
struct CachedReportResponse {
    value: Value,
    expires_at: Instant,
}

impl OrgMembershipCache {
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            ttl: Duration::from_secs(ttl_seconds.max(1)),
            max_entries: max_entries.max(100),
            entries: Arc::new(RwLock::new(HashMap::new())),
            key_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn key(user_id: &str, org_id: &str) -> String {
        format!("{org_id}:{user_id}")
    }

    pub async fn get(&self, user_id: &str, org_id: &str) -> Option<Option<Value>> {
        let key = Self::key(user_id, org_id);
        let now = Instant::now();
        let entry = {
            let entries = self.entries.read().await;
            entries.get(&key).cloned()
        };

        match entry {
            Some(cached) if cached.expires_at > now => Some(cached.value),
            Some(_) => {
                self.entries.write().await.remove(&key);
                None
            }
            None => None,
        }
    }

    pub async fn put(&self, user_id: &str, org_id: &str, value: Option<Value>) {
        let key = Self::key(user_id, org_id);
        let mut entries = self.entries.write().await;
        if entries.len() >= self.max_entries {
            let now = Instant::now();
            entries.retain(|_, cached| cached.expires_at > now);
            if entries.len() >= self.max_entries {
                entries.clear();
            }
        }
        entries.insert(
            key,
            CachedOrgMembership {
                value,
                expires_at: Instant::now() + self.ttl,
            },
        );
    }

    pub async fn invalidate(&self, user_id: &str, org_id: &str) {
        let key = Self::key(user_id, org_id);
        self.entries.write().await.remove(&key);
    }

    pub async fn key_lock(&self, user_id: &str, org_id: &str) -> Arc<Mutex<()>> {
        let key = Self::key(user_id, org_id);
        let mut locks = self.key_locks.lock().await;
        if locks.len() >= self.max_entries {
            locks.clear();
        }
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

impl PublicListingsCache {
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            ttl: Duration::from_secs(ttl_seconds.max(1)),
            max_entries: max_entries.max(100),
            entries: Arc::new(RwLock::new(HashMap::new())),
            key_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn get(&self, key: &str) -> Option<Value> {
        let now = Instant::now();
        let entry = {
            let entries = self.entries.read().await;
            entries.get(key).cloned()
        };

        match entry {
            Some(cached) if cached.expires_at > now => Some(cached.value),
            Some(_) => {
                self.entries.write().await.remove(key);
                None
            }
            None => None,
        }
    }

    pub async fn put(&self, key: String, value: Value) {
        let mut entries = self.entries.write().await;
        if entries.len() >= self.max_entries {
            let now = Instant::now();
            entries.retain(|_, cached| cached.expires_at > now);
            if entries.len() >= self.max_entries {
                entries.clear();
            }
        }

        entries.insert(
            key,
            CachedPublicListings {
                value,
                expires_at: Instant::now() + self.ttl,
            },
        );
    }

    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }

    pub async fn key_lock(&self, key: &str) -> Arc<Mutex<()>> {
        let mut locks = self.key_locks.lock().await;
        if locks.len() >= self.max_entries {
            locks.clear();
        }
        locks
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

impl ReportResponseCache {
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            ttl: Duration::from_secs(ttl_seconds.max(1)),
            max_entries: max_entries.max(100),
            entries: Arc::new(RwLock::new(HashMap::new())),
            key_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn get(&self, key: &str) -> Option<Value> {
        let now = Instant::now();
        let entry = {
            let entries = self.entries.read().await;
            entries.get(key).cloned()
        };

        match entry {
            Some(cached) if cached.expires_at > now => Some(cached.value),
            Some(_) => {
                self.entries.write().await.remove(key);
                None
            }
            None => None,
        }
    }

    pub async fn put(&self, key: String, value: Value) {
        let mut entries = self.entries.write().await;
        if entries.len() >= self.max_entries {
            let now = Instant::now();
            entries.retain(|_, cached| cached.expires_at > now);
            if entries.len() >= self.max_entries {
                entries.clear();
            }
        }

        entries.insert(
            key,
            CachedReportResponse {
                value,
                expires_at: Instant::now() + self.ttl,
            },
        );
    }

    pub async fn key_lock(&self, key: &str) -> Arc<Mutex<()>> {
        let mut locks = self.key_locks.lock().await;
        if locks.len() >= self.max_entries {
            locks.clear();
        }
        locks
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiReadinessReport {
    pub ready: bool,
    pub status: String,
    pub db: bool,
    pub schema: bool,
    pub code: Option<String>,
    pub detail: Option<String>,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing_columns: Vec<String>,
}

impl ApiReadinessReport {
    fn not_ready(code: &str, detail: &str, db: bool, retryable: bool) -> Self {
        Self {
            ready: false,
            status: "degraded".to_string(),
            db,
            schema: false,
            code: Some(code.to_string()),
            detail: Some(detail.to_string()),
            retryable,
            missing_columns: Vec::new(),
        }
    }

    fn from_error(error: &crate::error::AppError, db: bool, schema: bool) -> Self {
        Self {
            ready: false,
            status: "degraded".to_string(),
            db,
            schema,
            code: Some(error.error_code().to_string()),
            detail: Some(error.detail_message()),
            retryable: error.retryable(),
            missing_columns: Vec::new(),
        }
    }

    fn with_missing_columns(mut self, missing_columns: Vec<String>) -> Self {
        self.missing_columns = missing_columns;
        self
    }
}

#[derive(Debug, Clone)]
struct SchemaCompatibilityReport {
    compatible: bool,
    missing_columns: Vec<String>,
}

async fn verify_required_schema(
    pool: &PgPool,
) -> Result<SchemaCompatibilityReport, crate::error::AppError> {
    let row = sqlx::query(
        "SELECT
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'agent_approvals' AND column_name = 'kind'
            ) AS has_kind,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'agent_approvals' AND column_name = 'priority'
            ) AS has_priority",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| crate::error::AppError::from_database_error(
        &error,
        "Database schema compatibility check failed.",
    ))?;

    let has_kind = row.try_get::<bool, _>("has_kind").unwrap_or(false);
    let has_priority = row.try_get::<bool, _>("has_priority").unwrap_or(false);

    let mut missing_columns = Vec::new();
    if !has_kind {
        missing_columns.push("agent_approvals.kind".to_string());
    }
    if !has_priority {
        missing_columns.push("agent_approvals.priority".to_string());
    }

    Ok(SchemaCompatibilityReport {
        compatible: missing_columns.is_empty(),
        missing_columns,
    })
}
