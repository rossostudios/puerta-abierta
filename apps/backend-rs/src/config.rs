#![allow(dead_code)]

use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowEngineMode {
    Legacy,
    Queue,
}

impl WorkflowEngineMode {
    fn from_env(value: Option<String>) -> Self {
        match value
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "queue" => Self::Queue,
            _ => Self::Legacy,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::Queue => "queue",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub app_name: String,
    pub environment: String,
    pub api_prefix: String,
    pub host: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
    pub trusted_hosts: Vec<String>,
    pub docs_enabled: bool,
    pub dev_auth_overrides_enabled: bool,
    pub rate_limit_enabled: bool,
    pub rate_limit_per_second: u64,
    pub rate_limit_burst_size: u32,
    pub marketplace_public_enabled: bool,
    pub marketplace_whatsapp_phone_e164: Option<String>,
    pub transparent_pricing_required: bool,
    pub applications_pipeline_enabled: bool,
    pub lease_collections_enabled: bool,
    pub notification_rules_enforced: bool,
    pub ai_agent_enabled: bool,
    pub openai_api_key: Option<String>,
    pub openai_api_base_url: String,
    pub openai_primary_model: String,
    pub openai_fallback_models: Vec<String>,
    pub openai_model: Option<String>,
    pub ai_agent_use_responses_api: bool,
    pub ai_agent_max_tool_steps: u32,
    pub ai_agent_timeout_seconds: u64,
    pub ai_agent_rollout_mode: String,
    pub ai_agent_rollout_canary_percentage: u32,
    pub ai_agent_shadow_mode_enabled: bool,
    pub ai_agent_shadow_mode_percentage: u32,
    pub ai_agent_rollout_gate_enabled: bool,
    pub ai_agent_rollout_gate_window_minutes: i32,
    pub ai_agent_rollout_gate_min_samples: i64,
    pub ai_agent_rollout_gate_max_error_rate: f64,
    pub ai_agent_rollout_gate_max_mismatch_rate: f64,
    pub ai_agent_legacy_chat_shim_enabled: bool,
    pub ai_agent_legacy_chat_cutoff_at: Option<String>,
    pub ai_agent_legacy_chat_window_days: i32,
    pub ai_agent_legacy_chat_max_calls: i64,
    pub clerk_jwks_url: Option<String>,
    pub clerk_issuer_url: Option<String>,
    pub clerk_jwt_audience: Option<String>,
    pub storage_s3_region: Option<String>,
    pub storage_s3_public_bucket: Option<String>,
    pub storage_s3_private_bucket: Option<String>,
    pub storage_s3_public_base_url: Option<String>,
    pub storage_s3_endpoint_url: Option<String>,
    pub storage_s3_force_path_style: bool,
    pub storage_presign_ttl_seconds: u64,
    pub database_url: Option<String>,
    pub db_fail_fast_on_startup: bool,
    pub db_pool_max_connections: u32,
    pub db_pool_min_connections: u32,
    pub db_pool_acquire_timeout_seconds: u64,
    pub db_pool_idle_timeout_seconds: u64,
    pub org_membership_cache_ttl_seconds: u64,
    pub org_membership_cache_max_entries: usize,
    pub public_listings_cache_ttl_seconds: u64,
    pub public_listings_cache_max_entries: usize,
    pub report_response_cache_ttl_seconds: u64,
    pub report_response_cache_max_entries: usize,
    pub default_org_id: Option<String>,
    pub default_user_id: Option<String>,
    pub internal_api_key: Option<String>,
    pub whatsapp_phone_number_id: Option<String>,
    pub whatsapp_access_token: Option<String>,
    pub whatsapp_verify_token: Option<String>,
    pub resend_api_key: Option<String>,
    pub email_from_address: String,
    pub stripe_secret_key: Option<String>,
    pub stripe_webhook_secret: Option<String>,
    pub stripe_trial_days: i32,
    pub twilio_account_sid: Option<String>,
    pub twilio_auth_token: Option<String>,
    pub twilio_phone_number: Option<String>,
    pub elevenlabs_api_key: Option<String>,
    pub elevenlabs_voice_id: Option<String>,
    pub belvo_secret_id: Option<String>,
    pub belvo_secret_password: Option<String>,
    pub belvo_api_url: Option<String>,
    pub informconf_api_key: Option<String>,
    pub informconf_api_url: Option<String>,
    pub app_public_url: String,
    pub workflow_engine_mode: WorkflowEngineMode,
    pub scheduler_enabled: bool,
    pub ical_sync_interval_minutes: u64,
    pub workflow_poll_interval_seconds: u64,
    pub message_poll_interval_seconds: u64,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let environment = env_or("ENVIRONMENT", "development");
        let db_fail_fast_default = environment.trim().eq_ignore_ascii_case("production");
        let ai_agent_use_responses_api = env_parse_bool_or("AI_AGENT_USE_RESPONSES_API", true);
        let rollout_mode_default = if ai_agent_use_responses_api {
            "canary"
        } else {
            "legacy"
        };

        Self {
            app_name: env_or("APP_NAME", "Casaora API"),
            environment,
            api_prefix: normalize_prefix(&env_or("API_PREFIX", "/v1")),
            host: env_or("HOST", "0.0.0.0"),
            port: env_parse_or("PORT", 8000),
            cors_origins: parse_csv(&env_or("CORS_ORIGINS", "http://localhost:3000")),
            trusted_hosts: parse_csv(&env_or("TRUSTED_HOSTS", "localhost,127.0.0.1")),
            docs_enabled: env_parse_bool_or("DOCS_ENABLED", true),
            dev_auth_overrides_enabled: env_parse_bool_or("DEV_AUTH_OVERRIDES_ENABLED", false),
            rate_limit_enabled: env_parse_bool_or("RATE_LIMIT_ENABLED", true),
            rate_limit_per_second: env_parse_or("RATE_LIMIT_PER_SECOND", 10),
            rate_limit_burst_size: env_parse_or("RATE_LIMIT_BURST_SIZE", 100),
            marketplace_public_enabled: env_parse_bool_or("MARKETPLACE_PUBLIC_ENABLED", true),
            marketplace_whatsapp_phone_e164: env_opt("MARKETPLACE_WHATSAPP_PHONE_E164"),
            transparent_pricing_required: env_parse_bool_or("TRANSPARENT_PRICING_REQUIRED", true),
            applications_pipeline_enabled: env_parse_bool_or("APPLICATIONS_PIPELINE_ENABLED", true),
            lease_collections_enabled: env_parse_bool_or("LEASE_COLLECTIONS_ENABLED", true),
            notification_rules_enforced: env_parse_bool_or("NOTIFICATION_RULES_ENFORCED", false),
            ai_agent_enabled: env_parse_bool_or("AI_AGENT_ENABLED", true),
            openai_api_key: env_opt("OPENAI_API_KEY"),
            openai_api_base_url: env_or("OPENAI_API_BASE_URL", "https://api.openai.com/v1"),
            openai_primary_model: env_or("OPENAI_PRIMARY_MODEL", "gpt-5.2"),
            openai_fallback_models: parse_csv(&env_or("OPENAI_FALLBACK_MODELS", "")),
            openai_model: env_opt("OPENAI_MODEL"),
            ai_agent_use_responses_api,
            ai_agent_max_tool_steps: env_parse_or("AI_AGENT_MAX_TOOL_STEPS", 6),
            ai_agent_timeout_seconds: env_parse_or("AI_AGENT_TIMEOUT_SECONDS", 45),
            ai_agent_rollout_mode: env_or("AI_AGENT_ROLLOUT_MODE", rollout_mode_default),
            ai_agent_rollout_canary_percentage: env_parse_or(
                "AI_AGENT_ROLLOUT_CANARY_PERCENTAGE",
                100,
            ),
            ai_agent_shadow_mode_enabled: env_parse_bool_or("AI_AGENT_SHADOW_MODE_ENABLED", true),
            ai_agent_shadow_mode_percentage: env_parse_or("AI_AGENT_SHADOW_MODE_PERCENTAGE", 25),
            ai_agent_rollout_gate_enabled: env_parse_bool_or("AI_AGENT_ROLLOUT_GATE_ENABLED", true),
            ai_agent_rollout_gate_window_minutes: env_parse_or(
                "AI_AGENT_ROLLOUT_GATE_WINDOW_MINUTES",
                60,
            ),
            ai_agent_rollout_gate_min_samples: env_parse_or(
                "AI_AGENT_ROLLOUT_GATE_MIN_SAMPLES",
                20,
            ),
            ai_agent_rollout_gate_max_error_rate: env_parse_or(
                "AI_AGENT_ROLLOUT_GATE_MAX_ERROR_RATE",
                0.15,
            ),
            ai_agent_rollout_gate_max_mismatch_rate: env_parse_or(
                "AI_AGENT_ROLLOUT_GATE_MAX_MISMATCH_RATE",
                0.25,
            ),
            ai_agent_legacy_chat_shim_enabled: env_parse_bool_or(
                "AI_AGENT_LEGACY_CHAT_SHIM_ENABLED",
                true,
            ),
            ai_agent_legacy_chat_cutoff_at: env_opt("AI_AGENT_LEGACY_CHAT_CUTOFF_AT"),
            ai_agent_legacy_chat_window_days: env_parse_or("AI_AGENT_LEGACY_CHAT_WINDOW_DAYS", 7),
            ai_agent_legacy_chat_max_calls: env_parse_or("AI_AGENT_LEGACY_CHAT_MAX_CALLS", 0),
            clerk_jwks_url: env_opt("CLERK_JWKS_URL"),
            clerk_issuer_url: env_opt("CLERK_ISSUER_URL").or_else(|| {
                env_opt("NEXT_PUBLIC_CLERK_FRONTEND_API_URL")
                    .or_else(|| env_opt("CLERK_FRONTEND_API_URL"))
            }),
            clerk_jwt_audience: env_opt("CLERK_JWT_AUDIENCE"),
            storage_s3_region: env_opt("STORAGE_S3_REGION").or_else(|| env_opt("AWS_REGION")),
            storage_s3_public_bucket: env_opt("STORAGE_S3_PUBLIC_BUCKET"),
            storage_s3_private_bucket: env_opt("STORAGE_S3_PRIVATE_BUCKET"),
            storage_s3_public_base_url: env_opt("STORAGE_S3_PUBLIC_BASE_URL"),
            storage_s3_endpoint_url: env_opt("STORAGE_S3_ENDPOINT_URL"),
            storage_s3_force_path_style: env_parse_bool_or("STORAGE_S3_FORCE_PATH_STYLE", false),
            storage_presign_ttl_seconds: env_parse_or("STORAGE_PRESIGN_TTL_SECONDS", 900),
            database_url: env_opt("DATABASE_URL").or_else(|| env_opt("SUPABASE_DB_URL")),
            db_fail_fast_on_startup: env_parse_bool_or(
                "DB_FAIL_FAST_ON_STARTUP",
                db_fail_fast_default,
            ),
            db_pool_max_connections: env_parse_or("DB_POOL_MAX_CONNECTIONS", 5),
            db_pool_min_connections: env_parse_or("DB_POOL_MIN_CONNECTIONS", 1),
            db_pool_acquire_timeout_seconds: env_parse_or("DB_POOL_ACQUIRE_TIMEOUT_SECONDS", 5),
            db_pool_idle_timeout_seconds: env_parse_or("DB_POOL_IDLE_TIMEOUT_SECONDS", 600),
            org_membership_cache_ttl_seconds: env_parse_or("ORG_MEMBERSHIP_CACHE_TTL_SECONDS", 30),
            org_membership_cache_max_entries: env_parse_or(
                "ORG_MEMBERSHIP_CACHE_MAX_ENTRIES",
                10000,
            ),
            public_listings_cache_ttl_seconds: env_parse_or(
                "PUBLIC_LISTINGS_CACHE_TTL_SECONDS",
                15,
            ),
            public_listings_cache_max_entries: env_parse_or(
                "PUBLIC_LISTINGS_CACHE_MAX_ENTRIES",
                500,
            ),
            report_response_cache_ttl_seconds: env_parse_or(
                "REPORT_RESPONSE_CACHE_TTL_SECONDS",
                20,
            ),
            report_response_cache_max_entries: env_parse_or(
                "REPORT_RESPONSE_CACHE_MAX_ENTRIES",
                2000,
            ),
            default_org_id: env_opt("DEFAULT_ORG_ID"),
            default_user_id: env_opt("DEFAULT_USER_ID"),
            internal_api_key: env_opt("INTERNAL_API_KEY"),
            whatsapp_phone_number_id: env_opt("WHATSAPP_PHONE_NUMBER_ID"),
            whatsapp_access_token: env_opt("WHATSAPP_ACCESS_TOKEN"),
            whatsapp_verify_token: env_opt("WHATSAPP_VERIFY_TOKEN"),
            resend_api_key: env_opt("RESEND_API_KEY"),
            email_from_address: env_or("EMAIL_FROM_ADDRESS", "noreply@casaora.co"),
            stripe_secret_key: env_opt("STRIPE_SECRET_KEY"),
            stripe_webhook_secret: env_opt("STRIPE_WEBHOOK_SECRET"),
            stripe_trial_days: env_parse_or("STRIPE_TRIAL_DAYS", 14),
            twilio_account_sid: env_opt("TWILIO_ACCOUNT_SID"),
            twilio_auth_token: env_opt("TWILIO_AUTH_TOKEN"),
            twilio_phone_number: env_opt("TWILIO_PHONE_NUMBER"),
            elevenlabs_api_key: env_opt("ELEVENLABS_API_KEY"),
            elevenlabs_voice_id: env_opt("ELEVENLABS_VOICE_ID"),
            belvo_secret_id: env_opt("BELVO_SECRET_ID"),
            belvo_secret_password: env_opt("BELVO_SECRET_PASSWORD"),
            belvo_api_url: env_opt("BELVO_API_URL"),
            informconf_api_key: env_opt("INFORMCONF_API_KEY"),
            informconf_api_url: env_opt("INFORMCONF_API_URL"),
            app_public_url: env_or("APP_PUBLIC_URL", "http://localhost:3000"),
            workflow_engine_mode: WorkflowEngineMode::from_env(env_opt("WORKFLOW_ENGINE_MODE")),
            scheduler_enabled: env_parse_bool_or("SCHEDULER_ENABLED", false),
            ical_sync_interval_minutes: env_parse_or("ICAL_SYNC_INTERVAL_MINUTES", 30),
            workflow_poll_interval_seconds: env_parse_or("WORKFLOW_POLL_INTERVAL_SECONDS", 300),
            message_poll_interval_seconds: env_parse_or("MESSAGE_POLL_INTERVAL_SECONDS", 30),
        }
    }

    pub fn is_production(&self) -> bool {
        self.environment.trim().eq_ignore_ascii_case("production")
    }

    pub fn docs_enabled_runtime(&self) -> bool {
        if self.is_production() {
            return false;
        }
        self.docs_enabled
    }

    pub fn auth_dev_overrides_enabled(&self) -> bool {
        if self.is_production() {
            return false;
        }
        self.dev_auth_overrides_enabled
    }

    pub fn openai_model_chain(&self) -> Vec<String> {
        let mut models = Vec::new();

        let primary = self.openai_primary_model.trim();
        if !primary.is_empty() {
            models.push(primary.to_string());
        }

        for model in &self.openai_fallback_models {
            let candidate = model.trim();
            if candidate.is_empty() {
                continue;
            }
            if !models.iter().any(|existing| existing == candidate) {
                models.push(candidate.to_string());
            }
        }

        if let Some(legacy) = &self.openai_model {
            let candidate = legacy.trim();
            if !candidate.is_empty() && !models.iter().any(|existing| existing == candidate) {
                models.push(candidate.to_string());
            }
        }

        models
    }

    pub fn openai_chat_completions_url(&self) -> String {
        let base = self.openai_api_base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return "https://api.openai.com/v1/chat/completions".to_string();
        }

        if base.ends_with("/chat/completions") {
            return base.to_string();
        }

        format!("{base}/chat/completions")
    }

    pub fn openai_responses_url(&self) -> String {
        let base = self.openai_api_base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return "https://api.openai.com/v1/responses".to_string();
        }

        if base.ends_with("/responses") {
            return base.to_string();
        }

        format!("{base}/responses")
    }

    pub fn rate_limit_enabled_runtime(&self) -> bool {
        if self.is_production() {
            return true;
        }
        self.rate_limit_enabled
    }

    pub fn workflow_queue_enabled(&self) -> bool {
        self.workflow_engine_mode == WorkflowEngineMode::Queue
    }

    pub fn db_fail_fast_on_startup_runtime(&self) -> bool {
        self.db_fail_fast_on_startup
    }

    pub fn storage_public_enabled(&self) -> bool {
        self.storage_s3_public_bucket
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
    }
}

fn env_opt(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env_opt(key).unwrap_or_else(|| default.to_string())
}

fn env_parse_or<T>(key: &str, default: T) -> T
where
    T: std::str::FromStr + Copy,
{
    env_opt(key)
        .and_then(|raw| raw.parse::<T>().ok())
        .unwrap_or(default)
}

fn env_parse_bool_or(key: &str, default: bool) -> bool {
    match env_opt(key).as_deref().map(str::to_ascii_lowercase) {
        Some(value) if value == "1" || value == "true" || value == "yes" || value == "on" => true,
        Some(value) if value == "0" || value == "false" || value == "no" || value == "off" => false,
        Some(_) => default,
        None => default,
    }
}

fn parse_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_prefix(raw: &str) -> String {
    let mut prefix = raw.trim().to_string();
    if prefix.is_empty() {
        return "/v1".to_string();
    }
    if !prefix.starts_with('/') {
        prefix.insert(0, '/');
    }
    while prefix.ends_with('/') && prefix.len() > 1 {
        prefix.pop();
    }
    prefix
}

#[cfg(test)]
mod tests {
    use super::normalize_prefix;

    #[test]
    fn normalizes_prefix() {
        assert_eq!(normalize_prefix("v1"), "/v1");
        assert_eq!(normalize_prefix("/v1/"), "/v1");
        assert_eq!(normalize_prefix(""), "/v1");
    }
}
