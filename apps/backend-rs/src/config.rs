#![allow(dead_code)]

use std::env;

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
    pub marketplace_public_enabled: bool,
    pub marketplace_whatsapp_phone_e164: Option<String>,
    pub transparent_pricing_required: bool,
    pub applications_pipeline_enabled: bool,
    pub lease_collections_enabled: bool,
    pub ai_agent_enabled: bool,
    pub openai_api_key: Option<String>,
    pub openai_primary_model: String,
    pub openai_fallback_models: Vec<String>,
    pub openai_model: Option<String>,
    pub ai_agent_max_tool_steps: u32,
    pub ai_agent_timeout_seconds: u64,
    pub supabase_url: Option<String>,
    pub supabase_service_role_key: Option<String>,
    pub supabase_jwt_secret: Option<String>,
    pub supabase_db_url: Option<String>,
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
    pub app_public_url: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            app_name: env_or("APP_NAME", "Puerta Abierta API"),
            environment: env_or("ENVIRONMENT", "development"),
            api_prefix: normalize_prefix(&env_or("API_PREFIX", "/v1")),
            host: env_or("HOST", "0.0.0.0"),
            port: env_parse_or("PORT", 8000),
            cors_origins: parse_csv(&env_or("CORS_ORIGINS", "http://localhost:3000")),
            trusted_hosts: parse_csv(&env_or("TRUSTED_HOSTS", "localhost,127.0.0.1")),
            docs_enabled: env_parse_bool_or("DOCS_ENABLED", true),
            dev_auth_overrides_enabled: env_parse_bool_or("DEV_AUTH_OVERRIDES_ENABLED", false),
            marketplace_public_enabled: env_parse_bool_or("MARKETPLACE_PUBLIC_ENABLED", true),
            marketplace_whatsapp_phone_e164: env_opt("MARKETPLACE_WHATSAPP_PHONE_E164"),
            transparent_pricing_required: env_parse_bool_or("TRANSPARENT_PRICING_REQUIRED", true),
            applications_pipeline_enabled: env_parse_bool_or("APPLICATIONS_PIPELINE_ENABLED", true),
            lease_collections_enabled: env_parse_bool_or("LEASE_COLLECTIONS_ENABLED", true),
            ai_agent_enabled: env_parse_bool_or("AI_AGENT_ENABLED", true),
            openai_api_key: env_opt("OPENAI_API_KEY"),
            openai_primary_model: env_or("OPENAI_PRIMARY_MODEL", "gpt-5.2"),
            openai_fallback_models: parse_csv(&env_or(
                "OPENAI_FALLBACK_MODELS",
                "gpt-5.1-mini,gpt-4.1-mini",
            )),
            openai_model: env_opt("OPENAI_MODEL"),
            ai_agent_max_tool_steps: env_parse_or("AI_AGENT_MAX_TOOL_STEPS", 6),
            ai_agent_timeout_seconds: env_parse_or("AI_AGENT_TIMEOUT_SECONDS", 45),
            supabase_url: env_opt("SUPABASE_URL"),
            supabase_service_role_key: env_opt("SUPABASE_SERVICE_ROLE_KEY"),
            supabase_jwt_secret: env_opt("SUPABASE_JWT_SECRET"),
            supabase_db_url: env_opt("SUPABASE_DB_URL").or_else(|| env_opt("DATABASE_URL")),
            default_org_id: env_opt("DEFAULT_ORG_ID"),
            default_user_id: env_opt("DEFAULT_USER_ID"),
            internal_api_key: env_opt("INTERNAL_API_KEY"),
            whatsapp_phone_number_id: env_opt("WHATSAPP_PHONE_NUMBER_ID"),
            whatsapp_access_token: env_opt("WHATSAPP_ACCESS_TOKEN"),
            whatsapp_verify_token: env_opt("WHATSAPP_VERIFY_TOKEN"),
            resend_api_key: env_opt("RESEND_API_KEY"),
            email_from_address: env_or("EMAIL_FROM_ADDRESS", "noreply@puertaabierta.com"),
            stripe_secret_key: env_opt("STRIPE_SECRET_KEY"),
            stripe_webhook_secret: env_opt("STRIPE_WEBHOOK_SECRET"),
            stripe_trial_days: env_parse_or("STRIPE_TRIAL_DAYS", 14),
            app_public_url: env_or("APP_PUBLIC_URL", "http://localhost:3000"),
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
