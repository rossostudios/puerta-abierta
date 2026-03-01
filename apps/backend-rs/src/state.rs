use std::{sync::Arc, time::Duration};

use reqwest::Client;
use serde::Serialize;
use sqlx::{PgPool, Row};
use tokio::sync::RwLock;

use crate::{
    cache::CacheLayer, config::AppConfig, db::create_pool, db::probe_pool, error::AppResult,
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
    pub org_membership_cache: CacheLayer,
    pub public_listings_cache: CacheLayer,
    pub report_response_cache: CacheLayer,
    pub enrichment_cache: CacheLayer,
    pub agent_config_cache: CacheLayer,
    pub fx_cache: CacheLayer,
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

        let org_membership_cache = CacheLayer::new(
            "org_membership",
            config.org_membership_cache_max_entries as u64,
            Duration::from_secs(config.org_membership_cache_ttl_seconds.max(1)),
        );
        let public_listings_cache = CacheLayer::new(
            "public_listings",
            config.public_listings_cache_max_entries as u64,
            Duration::from_secs(config.public_listings_cache_ttl_seconds.max(1)),
        );
        let report_response_cache = CacheLayer::new(
            "reports",
            config.report_response_cache_max_entries as u64,
            Duration::from_secs(config.report_response_cache_ttl_seconds.max(1)),
        );
        let enrichment_cache = CacheLayer::new(
            "enrichment",
            config.enrichment_cache_max_entries as u64,
            Duration::from_secs(config.enrichment_cache_ttl_seconds.max(1)),
        );
        let agent_config_cache = CacheLayer::new(
            "agent_config",
            config.agent_config_cache_max_entries as u64,
            Duration::from_secs(config.agent_config_cache_ttl_seconds.max(1)),
        );
        let fx_cache = CacheLayer::new(
            "fx",
            config.fx_cache_max_entries as u64,
            Duration::from_secs(config.fx_cache_ttl_seconds.max(1)),
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
            enrichment_cache,
            agent_config_cache,
            fx_cache,
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
