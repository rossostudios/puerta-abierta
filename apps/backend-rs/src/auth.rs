#![allow(dead_code)]

use axum::http::HeaderMap;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{error::AppError, state::AppState};

/// Compatibility auth user payload used across handlers/tenancy.
/// `id` remains the canonical app user UUID in Casaora.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthenticatedUser {
    pub id: String,
    pub email: Option<String>,
    #[serde(default)]
    pub user_metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ClerkJwtClaims {
    sub: String,
    #[serde(default)]
    iss: Option<String>,
    email: Option<String>,
    #[serde(default)]
    given_name: Option<String>,
    #[serde(default)]
    family_name: Option<String>,
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let authorization = headers.get("authorization")?.to_str().ok()?;
    let (scheme, token) = authorization.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub async fn current_user_id(state: &AppState, headers: &HeaderMap) -> Option<String> {
    #[cfg(debug_assertions)]
    if state.config.auth_dev_overrides_enabled() {
        if let Some(x_user_id) = header_string(headers, "x-user-id") {
            tracing::warn!(user_id = %x_user_id, "Dev override: using x-user-id header");
            return Some(x_user_id);
        }
    }

    if let Some(token) = bearer_token(headers) {
        if let Some(user) = resolve_user(state, &token).await {
            return Some(user.id);
        }
    }

    #[cfg(debug_assertions)]
    if state.config.auth_dev_overrides_enabled() {
        if let Some(ref uid) = state.config.default_user_id {
            tracing::warn!(user_id = %uid, "Dev override: using default_user_id");
        }
        return state.config.default_user_id.clone();
    }

    None
}

pub async fn current_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<AuthenticatedUser> {
    #[cfg(debug_assertions)]
    if state.config.auth_dev_overrides_enabled() && header_string(headers, "x-user-id").is_some() {
        return None;
    }

    let token = bearer_token(headers)?;
    resolve_user(state, &token).await
}

pub async fn require_user_id(state: &AppState, headers: &HeaderMap) -> Result<String, AppError> {
    current_user_id(state, headers).await.ok_or_else(|| {
        AppError::Unauthorized("Unauthorized: missing or invalid access token.".to_string())
    })
}

pub async fn require_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedUser, AppError> {
    current_authenticated_user(state, headers)
        .await
        .ok_or_else(|| {
            AppError::Unauthorized("Unauthorized: missing or invalid access token.".to_string())
        })
}

fn header_string(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Validate Clerk JWTs via JWKS and map them to internal app users.
async fn resolve_user(state: &AppState, token: &str) -> Option<AuthenticatedUser> {
    validate_clerk_jwt_with_jwks(state, token).await
}

/// Validate a Clerk session JWT using the Clerk JWKS endpoint.
/// Returns None if Clerk JWKS is not configured or validation fails.
async fn validate_clerk_jwt_with_jwks(state: &AppState, token: &str) -> Option<AuthenticatedUser> {
    let jwks_cache = state.clerk_jwks_cache.as_ref()?;

    let header = decode_header(token).ok()?;
    let kid = header.kid.as_deref()?;
    let jwk = find_jwk_for_kid_owned(jwks_cache, kid).await?;
    let decoding_key = DecodingKey::from_jwk(&jwk).ok()?;

    let issuer = state
        .config
        .clerk_issuer_url
        .as_ref()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .or_else(|| {
            jwks_cache
                .jwks_url
                .strip_suffix("/.well-known/jwks.json")
                .map(|value| value.trim_end_matches('/').to_string())
        })?;

    let mut validation = Validation::new(Algorithm::RS256);
    if let Some(audience) = state.config.clerk_jwt_audience.as_deref() {
        validation.set_audience(&[audience.trim()]);
    } else {
        validation.validate_aud = false;
    }

    let token_data = match decode::<ClerkJwtClaims>(token, &decoding_key, &validation) {
        Ok(data) => data,
        Err(err) => {
            tracing::warn!(error = %err, "Clerk JWT validation failed");
            return None;
        }
    };

    let claims = token_data.claims;
    let token_issuer = claims
        .iss
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string());

    if !is_allowed_clerk_issuer(token_issuer.as_deref(), &issuer) {
        tracing::warn!(
            configured_issuer = %issuer,
            token_issuer = token_issuer.as_deref().unwrap_or("<missing>"),
            "Clerk JWT issuer rejected"
        );
        return None;
    }
    resolve_clerk_user(state, claims).await
}

fn is_allowed_clerk_issuer(token_issuer: Option<&str>, configured_issuer: &str) -> bool {
    let Some(token_issuer) = token_issuer else {
        return false;
    };

    let token_issuer = token_issuer.trim_end_matches('/');
    let configured_issuer = configured_issuer.trim_end_matches('/');

    if token_issuer.eq_ignore_ascii_case(configured_issuer) {
        return true;
    }

    // Accept the underlying Clerk-hosted issuer during custom-domain cutovers.
    // Clerk custom domains and `*.clerk.accounts.dev` issuers use the same signing keys.
    if let Some(host) = token_issuer.strip_prefix("https://") {
        return host.ends_with(".clerk.accounts.dev");
    }

    false
}

async fn find_jwk_for_kid_owned(
    jwks_cache: &crate::state::JwksCache,
    kid: &str,
) -> Option<jsonwebtoken::jwk::Jwk> {
    let mut jwks = jwks_cache.get_jwks().await.ok()?;
    let mut jwk = jwks
        .keys
        .iter()
        .find(|k| k.common.key_id.as_deref() == Some(kid))
        .cloned();

    if jwk.is_none() {
        jwks = jwks_cache.refresh().await.ok()?;
        jwk = jwks
            .keys
            .iter()
            .find(|k| k.common.key_id.as_deref() == Some(kid))
            .cloned();
    }
    jwk
}

fn clerk_user_metadata(claims: &ClerkJwtClaims) -> Option<Value> {
    let full_name = claims
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            let first = claims
                .given_name
                .as_deref()
                .or(claims.first_name.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let last = claims
                .family_name
                .as_deref()
                .or(claims.last_name.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            match (first, last) {
                (Some(f), Some(l)) => Some(format!("{f} {l}")),
                (Some(f), None) => Some(f),
                (None, Some(l)) => Some(l),
                (None, None) => None,
            }
        });

    let username = claims
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if full_name.is_none() && username.is_none() {
        return None;
    }

    Some(json!({
        "full_name": full_name,
        "name": full_name,
        "username": username
    }))
}

async fn resolve_clerk_user(state: &AppState, claims: ClerkJwtClaims) -> Option<AuthenticatedUser> {
    let subject = claims.sub.trim().to_string();
    if subject.is_empty() {
        return None;
    }

    let pool = state.db_pool.as_ref()?;
    let user_metadata = clerk_user_metadata(&claims);

    // Fast path: existing Clerk mapping already linked to an internal UUID.
    if let Ok(Some(row)) = sqlx::query(
        "SELECT id::text AS id, email::text AS email
         FROM app_users
         WHERE clerk_user_id = $1
         LIMIT 1",
    )
    .bind(&subject)
    .fetch_optional(pool)
    .await
    {
        let id = row.try_get::<String, _>("id").ok()?;
        let email = row.try_get::<Option<String>, _>("email").ok().flatten();
        return Some(AuthenticatedUser {
            id,
            email,
            user_metadata,
        });
    }

    let email = claims
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let Some(email) = email else {
        tracing::warn!(
            clerk_user_id = %subject,
            "Clerk token missing email and no clerk_user_id mapping exists in app_users"
        );
        return None;
    };

    let full_name = clerk_display_name(&claims, &email);
    let row = sqlx::query(
        "INSERT INTO app_users (email, full_name, clerk_user_id)
         VALUES ($1::citext, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET
           full_name = EXCLUDED.full_name,
           clerk_user_id = EXCLUDED.clerk_user_id
         RETURNING id::text AS id, email::text AS email",
    )
    .bind(&email)
    .bind(&full_name)
    .bind(&subject)
    .fetch_one(pool)
    .await
    .ok()?;

    let id = row.try_get::<String, _>("id").ok()?;
    let email = row.try_get::<Option<String>, _>("email").ok().flatten();
    Some(AuthenticatedUser {
        id,
        email,
        user_metadata,
    })
}

fn clerk_display_name(claims: &ClerkJwtClaims, email: &str) -> String {
    if let Some(value) = claims
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return value.to_string();
    }

    for candidate in [
        claims.given_name.as_deref(),
        claims.first_name.as_deref(),
        claims.username.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let candidate = candidate.trim();
        if !candidate.is_empty() {
            return candidate.to_string();
        }
    }

    email
        .split('@')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("User")
        .to_string()
}
