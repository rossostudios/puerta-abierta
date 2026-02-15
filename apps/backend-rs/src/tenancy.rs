#![allow(dead_code)]

use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::{auth::SupabaseUser, error::AppError, state::AppState};

fn db_pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

pub async fn get_org_membership(
    state: &AppState,
    user_id: &str,
    org_id: &str,
) -> Result<Option<Value>, AppError> {
    let pool = db_pool(state)?;
    let row = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM organization_members t
         WHERE organization_id = $1::uuid AND user_id = $2::uuid
         LIMIT 1",
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::Dependency(format!("Supabase request failed: {error}")))?;

    Ok(row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten()))
}

pub async fn assert_org_member(
    state: &AppState,
    user_id: &str,
    org_id: &str,
) -> Result<Value, AppError> {
    get_org_membership(state, user_id, org_id)
        .await?
        .ok_or_else(|| {
            AppError::Forbidden("Forbidden: not a member of this organization.".to_string())
        })
}

pub async fn assert_org_role(
    state: &AppState,
    user_id: &str,
    org_id: &str,
    allowed_roles: &[&str],
) -> Result<Value, AppError> {
    let membership = assert_org_member(state, user_id, org_id).await?;
    let role = membership
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    if allowed_roles.contains(&role) {
        return Ok(membership);
    }

    Err(AppError::Forbidden(format!(
        "Forbidden: role '{role}' is not allowed for this action."
    )))
}

pub async fn ensure_app_user(state: &AppState, user: &SupabaseUser) -> Result<Value, AppError> {
    if user.id.trim().is_empty() {
        return Err(AppError::Unauthorized(
            "Unauthorized: missing user.".to_string(),
        ));
    }
    let Some(email) = user.email.as_ref() else {
        return Err(AppError::BadRequest(
            "Supabase user is missing an email address.".to_string(),
        ));
    };

    let full_name = resolve_full_name(user, email);
    let pool = db_pool(state)?;

    sqlx::query(
        "INSERT INTO app_users (id, email, full_name)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (id)
         DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name",
    )
    .bind(&user.id)
    .bind(email)
    .bind(&full_name)
    .execute(pool)
    .await
    .map_err(|error| AppError::Dependency(format!("Supabase request failed: {error}")))?;

    Ok(json!({
        "id": user.id,
        "email": email,
        "full_name": full_name
    }))
}

pub async fn list_user_org_ids(state: &AppState, user_id: &str) -> Result<Vec<String>, AppError> {
    let pool = db_pool(state)?;
    let rows = sqlx::query(
        "SELECT organization_id::text AS organization_id
         FROM organization_members
         WHERE user_id = $1::uuid
         LIMIT 500",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::Dependency(format!("Supabase request failed: {error}")))?;

    let mut org_ids = Vec::new();
    for row in rows {
        if let Ok(value) = row.try_get::<String, _>("organization_id") {
            if !value.is_empty() {
                org_ids.push(value);
            }
        }
    }
    Ok(org_ids)
}

pub async fn list_user_organizations(
    state: &AppState,
    user_id: &str,
) -> Result<Vec<Value>, AppError> {
    let pool = db_pool(state)?;
    let org_ids = list_user_org_ids(state, user_id).await?;
    if org_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        "SELECT row_to_json(t) AS row
         FROM organizations t
         WHERE id = ANY($1::uuid[])
         LIMIT 500",
    )
    .bind(&org_ids)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::Dependency(format!("Supabase request failed: {error}")))?;

    let mut organizations = Vec::new();
    for row in rows {
        if let Ok(Some(item)) = row.try_get::<Option<Value>, _>("row") {
            organizations.push(item);
        }
    }
    Ok(organizations)
}

pub async fn ensure_org_membership(
    state: &AppState,
    org_id: &str,
    user_id: &str,
    role: &str,
    is_primary: bool,
) -> Result<(), AppError> {
    let pool = db_pool(state)?;
    sqlx::query(
        "INSERT INTO organization_members (organization_id, user_id, role, is_primary)
         VALUES ($1::uuid, $2::uuid, $3::member_role, $4)
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, is_primary = EXCLUDED.is_primary",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(role)
    .bind(is_primary)
    .execute(pool)
    .await
    .map_err(|error| AppError::Dependency(format!("Supabase request failed: {error}")))?;
    Ok(())
}

fn resolve_full_name(user: &SupabaseUser, email: &str) -> String {
    let metadata = user
        .user_metadata
        .as_ref()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let from_metadata = ["full_name", "name", "fullName"]
        .iter()
        .find_map(|key| metadata.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if let Some(value) = from_metadata {
        return value;
    }

    email
        .split('@')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "User".to_string())
}
