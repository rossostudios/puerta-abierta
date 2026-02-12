from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Puerta Abierta API"
    environment: str = "development"
    api_prefix: str = "/v1"
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:3000"
    # In production, this must be set to the exact domain(s) of the admin app.
    # e.g. "https://admin.puerta-abierta.com"
    trusted_hosts: str = "localhost,127.0.0.1"
    docs_enabled: bool = True
    dev_auth_overrides_enabled: bool = True
    marketplace_public_enabled: bool = True
    marketplace_whatsapp_phone_e164: Optional[str] = None
    transparent_pricing_required: bool = True
    applications_pipeline_enabled: bool = True
    lease_collections_enabled: bool = True
    ai_agent_enabled: bool = True
    openai_api_key: Optional[str] = None
    openai_primary_model: str = "gpt-5.2"
    openai_fallback_models: str = "gpt-5.1-mini,gpt-4.1-mini"
    # Backward-compatible legacy setting. If set, it is appended to the fallback chain.
    openai_model: Optional[str] = None
    ai_agent_max_tool_steps: int = 6
    ai_agent_timeout_seconds: int = 45

    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None

    default_org_id: Optional[str] = None
    default_user_id: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [value.strip() for value in self.trusted_hosts.split(",") if value.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def docs_enabled_runtime(self) -> bool:
        # Always disable docs in production.
        if self.is_production:
            return False
        return self.docs_enabled

    @property
    def auth_dev_overrides_enabled(self) -> bool:
        # Never allow local auth bypasses in production.
        if self.is_production:
            return False
        return self.dev_auth_overrides_enabled

    @property
    def openai_model_chain(self) -> list[str]:
        models: list[str] = []

        primary = self.openai_primary_model.strip()
        if primary:
            models.append(primary)

        for fallback in self.openai_fallback_models.split(","):
            candidate = fallback.strip()
            if candidate and candidate not in models:
                models.append(candidate)

        legacy = (self.openai_model or "").strip()
        if legacy and legacy not in models:
            models.append(legacy)

        return models


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
