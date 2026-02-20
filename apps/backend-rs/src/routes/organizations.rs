use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    auth::require_supabase_user,
    error::{AppError, AppResult},
    repository::table_service::{
        create_row, create_row_tx, delete_row, get_row, list_rows, update_row,
    },
    schemas::{
        clamp_limit, remove_nulls, serialize_to_map, validate_input, AcceptOrganizationInviteInput,
        CreateOrganizationInput, CreateOrganizationInviteInput, CreateOrganizationMemberInput,
        ListOrganizationsQuery, OrgInvitePath, OrgMemberPath, OrgPath, UpdateOrganizationInput,
        UpdateOrganizationMemberInput,
    },
    services::{
        audit::write_audit_log,
        plan_limits::{check_plan_limit, PlanResource},
    },
    state::AppState,
    tenancy::{
        assert_org_member, assert_org_role, ensure_app_user, ensure_org_membership,
        get_org_membership, list_user_org_ids, list_user_organizations,
    },
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/organizations",
            axum::routing::get(list_organizations).post(create_organization),
        )
        .route(
            "/organizations/{org_id}",
            axum::routing::get(get_organization)
                .patch(update_organization)
                .delete(delete_organization),
        )
        .route(
            "/organizations/{org_id}/invites",
            axum::routing::get(list_invites).post(create_invite),
        )
        .route(
            "/organizations/{org_id}/invites/{invite_id}",
            axum::routing::delete(revoke_invite),
        )
        .route(
            "/organization-invites/accept",
            axum::routing::post(accept_invite),
        )
        .route(
            "/organizations/{org_id}/members",
            axum::routing::get(list_members).post(add_member),
        )
        .route(
            "/organizations/{org_id}/members/{member_user_id}",
            axum::routing::patch(update_member).delete(delete_member),
        )
}

async fn list_organizations(
    State(state): State<AppState>,
    Query(query): Query<ListOrganizationsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;

    if let Some(org_id) = query.org_id.as_deref() {
        assert_org_member(&state, &user.id, org_id).await?;
        let row = get_db_row(&state, "organizations", org_id).await?;
        return Ok(Json(json!({ "data": [row] })));
    }

    let organizations = list_user_organizations(&state, &user.id).await?;
    let limit = clamp_limit(query.limit) as usize;
    Ok(Json(
        json!({ "data": organizations.into_iter().take(limit).collect::<Vec<_>>() }),
    ))
}

async fn create_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateOrganizationInput>,
) -> AppResult<impl IntoResponse> {
    validate_input(&payload)?;
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    let pool = db_pool(&state)?;

    let mut record = remove_nulls(serialize_to_map(&payload));
    record.insert("owner_user_id".to_string(), Value::String(user.id.clone()));

    // Use a single transaction so the org and membership are created atomically.
    // If either fails, both roll back — no orphaned orgs without memberships.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::Dependency(format!("txn begin: {e}")))?;

    let org = create_row_tx(&mut tx, "organizations", &record).await?;
    let org_id = value_str(&org, "id");

    sqlx::query(
        "INSERT INTO organization_members (organization_id, user_id, role, is_primary)
         VALUES ($1::uuid, $2::uuid, $3::member_role, $4)
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, is_primary = EXCLUDED.is_primary",
    )
    .bind(&org_id)
    .bind(&user.id)
    .bind("owner_admin")
    .bind(true)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Dependency(format!("membership insert: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::Dependency(format!("txn commit: {e}")))?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user.id),
        "create",
        "organizations",
        Some(&org_id),
        None,
        Some(org.clone()),
    )
    .await;
    Ok((axum::http::StatusCode::CREATED, Json(org)))
}

async fn get_organization(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_member(&state, &user.id, &path.org_id).await?;
    let row = get_db_row(&state, "organizations", &path.org_id).await?;
    Ok(Json(row))
}

async fn update_organization(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateOrganizationInput>,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let org = get_row(pool, "organizations", &path.org_id, "id").await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    let updated = update_row(pool, "organizations", &path.org_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "update",
        "organizations",
        Some(&path.org_id),
        Some(org),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn delete_organization(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    let pool = db_pool(&state)?;

    let org = get_row(pool, "organizations", &path.org_id, "id").await?;
    let owner_user_id = value_str(&org, "owner_user_id");
    if owner_user_id != user.id {
        return Err(AppError::Forbidden(
            "Forbidden: only the organization owner can delete it.".to_string(),
        ));
    }

    let deleted = delete_row(pool, "organizations", &path.org_id, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "delete",
        "organizations",
        Some(&path.org_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}

async fn list_invites(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;

    let pool = db_pool(&state)?;
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(path.org_id.clone()),
    );
    let invites = list_rows(
        pool,
        "organization_invites",
        Some(&filters),
        200,
        0,
        "created_at",
        false,
    )
    .await?;
    Ok(Json(json!({ "data": invites })))
}

async fn create_invite(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
    Json(payload): Json<CreateOrganizationInviteInput>,
) -> AppResult<impl IntoResponse> {
    validate_input(&payload)?;
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let days = payload.expires_in_days;
    if !(1..=180).contains(&days) {
        return Err(AppError::BadRequest(
            "expires_in_days must be between 1 and 180.".to_string(),
        ));
    }

    let email = payload.email.trim().to_string();
    let pending = sqlx::query(
        "SELECT id FROM organization_invites
         WHERE organization_id = $1
           AND lower(email::text) = lower($2)
           AND status = 'pending'
         LIMIT 1",
    )
    .bind(&path.org_id)
    .bind(&email)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;
    if pending.is_some() {
        return Err(AppError::Conflict(
            "An invite is already pending for this email.".to_string(),
        ));
    }

    let expires_at = (Utc::now() + Duration::days(days as i64)).to_rfc3339();
    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(path.org_id.clone()),
    );
    record.insert("email".to_string(), Value::String(email));
    record.insert("role".to_string(), Value::String(payload.role));
    record.insert("expires_at".to_string(), Value::String(expires_at));
    record.insert(
        "created_by_user_id".to_string(),
        Value::String(user.id.clone()),
    );
    record.insert("status".to_string(), Value::String("pending".to_string()));

    let created = create_row(pool, "organization_invites", &record).await?;
    let entity_id = value_str(&created, "id");
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "create",
        "organization_invites",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn revoke_invite(
    State(state): State<AppState>,
    Path(path): Path<OrgInvitePath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let existing = get_row(pool, "organization_invites", &path.invite_id, "id").await?;
    if value_str(&existing, "organization_id") != path.org_id {
        return Err(AppError::NotFound(
            "organization_invites record not found.".to_string(),
        ));
    }
    if value_str(&existing, "status") != "pending" {
        return Ok(Json(existing));
    }

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("revoked".to_string()));
    patch.insert(
        "revoked_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    patch.insert(
        "revoked_by_user_id".to_string(),
        Value::String(user.id.clone()),
    );
    let updated = update_row(pool, "organization_invites", &path.invite_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "delete",
        "organization_invites",
        Some(&path.invite_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;
    Ok(Json(updated))
}

async fn accept_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AcceptOrganizationInviteInput>,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    let pool = db_pool(&state)?;

    let token = payload.token.trim();
    if token.is_empty() {
        return Err(AppError::BadRequest("token is required.".to_string()));
    }

    let invite_row = sqlx::query(
        "SELECT row_to_json(t) AS row FROM organization_invites t WHERE token = $1 LIMIT 1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "Database query failed");
        AppError::Dependency("External service request failed.".to_string())
    })?;
    let Some(invite) =
        invite_row.and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
    else {
        return Err(AppError::NotFound("Invite not found.".to_string()));
    };

    let status = value_str(&invite, "status");
    if status != "pending" {
        return Err(AppError::Conflict(
            "Invite is no longer pending.".to_string(),
        ));
    }

    let invite_email = value_str_opt(&invite, "email")
        .unwrap_or_default()
        .to_lowercase();
    let user_email = user.email.clone().unwrap_or_default().trim().to_lowercase();
    if !invite_email.is_empty() && !user_email.is_empty() && invite_email != user_email {
        return Err(AppError::Forbidden(
            "Forbidden: this invite was issued to a different email.".to_string(),
        ));
    }

    if let Some(expires_at_raw) = value_str_opt(&invite, "expires_at") {
        if let Ok(expires_at) = DateTime::parse_from_rfc3339(&expires_at_raw) {
            if expires_at.with_timezone(&Utc) < Utc::now() {
                let mut expired_patch = Map::new();
                expired_patch.insert("status".to_string(), Value::String("expired".to_string()));
                let invite_id = value_str(&invite, "id");
                let _ = update_row(
                    pool,
                    "organization_invites",
                    &invite_id,
                    &expired_patch,
                    "id",
                )
                .await;
                return Err(AppError::Gone("Invite has expired.".to_string()));
            }
        }
    }

    let org_id = value_str_opt(&invite, "organization_id")
        .ok_or_else(|| AppError::Internal("Invite is missing organization_id.".to_string()))?;
    let role = value_str_opt(&invite, "role").unwrap_or_else(|| "operator".to_string());

    let is_primary = list_user_org_ids(&state, &user.id).await?.is_empty();
    ensure_org_membership(&state, &org_id, &user.id, &role, is_primary).await?;
    let membership = get_org_membership(&state, &user.id, &org_id).await?;

    let invite_id = value_str(&invite, "id");
    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String("accepted".to_string()));
    patch.insert(
        "accepted_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    patch.insert(
        "accepted_by_user_id".to_string(),
        Value::String(user.id.clone()),
    );
    let updated_invite = update_row(pool, "organization_invites", &invite_id, &patch, "id").await?;
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user.id),
        "accept",
        "organization_invites",
        Some(&invite_id),
        Some(invite.clone()),
        Some(updated_invite.clone()),
    )
    .await;

    Ok(Json(json!({
        "organization_id": org_id,
        "membership": membership,
        "invite": updated_invite
    })))
}

async fn list_members(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_member(&state, &user.id, &path.org_id).await?;
    let pool = db_pool(&state)?;

    let rows = sqlx::query("SELECT list_org_members_with_users($1::uuid) AS row")
        .bind(&path.org_id)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    let data = rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect::<Vec<_>>();

    Ok(Json(json!({ "data": data })))
}

async fn add_member(
    State(state): State<AppState>,
    Path(path): Path<OrgPath>,
    headers: HeaderMap,
    Json(payload): Json<CreateOrganizationMemberInput>,
) -> AppResult<impl IntoResponse> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    check_plan_limit(pool, &path.org_id, PlanResource::User).await?;

    let _target_user = get_row(pool, "app_users", &payload.user_id, "id").await?;
    ensure_org_membership(
        &state,
        &path.org_id,
        &payload.user_id,
        &payload.role,
        payload.is_primary,
    )
    .await?;
    let created = get_org_membership(&state, &payload.user_id, &path.org_id).await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "create",
        "organization_members",
        Some(&payload.user_id),
        None,
        created.clone(),
    )
    .await;

    let fallback = json!({
        "organization_id": path.org_id,
        "user_id": payload.user_id,
        "role": payload.role,
        "is_primary": payload.is_primary
    });

    Ok((
        axum::http::StatusCode::CREATED,
        Json(created.unwrap_or(fallback)),
    ))
}

async fn update_member(
    State(state): State<AppState>,
    Path(path): Path<OrgMemberPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateOrganizationMemberInput>,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let org = get_row(pool, "organizations", &path.org_id, "id").await?;
    if value_str(&org, "owner_user_id") == path.member_user_id {
        return Err(AppError::Forbidden(
            "Forbidden: cannot update the organization owner membership.".to_string(),
        ));
    }

    let existing = get_org_membership(&state, &path.member_user_id, &path.org_id)
        .await?
        .ok_or_else(|| AppError::NotFound("organization_members record not found.".to_string()))?;

    let patch = remove_nulls(serialize_to_map(&payload));
    if patch.is_empty() {
        return Ok(Json(existing));
    }

    let mut builder = QueryBuilder::<Postgres>::new("UPDATE organization_members t SET ");
    {
        let mut keys = patch.keys().cloned().collect::<Vec<_>>();
        keys.sort_unstable();
        let mut separated = builder.separated(", ");
        for key in &keys {
            separated.push(key.as_str());
            separated.push_unseparated(" = r.");
            separated.push_unseparated(key.as_str());
        }
    }
    builder
        .push(" FROM jsonb_populate_record(NULL::organization_members, ")
        .push_bind(Value::Object(patch))
        .push(") r WHERE (to_jsonb(t) ->> 'organization_id') = ")
        .push_bind(path.org_id.as_str())
        .push(" AND (to_jsonb(t) ->> 'user_id') = ")
        .push_bind(path.member_user_id.as_str())
        .push(" RETURNING row_to_json(t) AS row");
    let updated_row = builder
        .build()
        .fetch_optional(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    let updated = updated_row
        .and_then(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .unwrap_or_else(|| existing.clone());

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "update",
        "organization_members",
        Some(&path.member_user_id),
        Some(existing),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn delete_member(
    State(state): State<AppState>,
    Path(path): Path<OrgMemberPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user = require_supabase_user(&state, &headers).await?;
    let _app_user = ensure_app_user(&state, &user).await?;
    assert_org_role(&state, &user.id, &path.org_id, &["owner_admin"]).await?;
    let pool = db_pool(&state)?;

    let org = get_row(pool, "organizations", &path.org_id, "id").await?;
    if value_str(&org, "owner_user_id") == path.member_user_id {
        return Err(AppError::Forbidden(
            "Forbidden: cannot remove the organization owner.".to_string(),
        ));
    }

    let existing = get_org_membership(&state, &path.member_user_id, &path.org_id)
        .await?
        .ok_or_else(|| AppError::NotFound("organization_members record not found.".to_string()))?;

    if value_str(&existing, "role") == "owner_admin" {
        let mut filters = Map::new();
        filters.insert(
            "organization_id".to_string(),
            Value::String(path.org_id.clone()),
        );
        filters.insert("role".to_string(), Value::String("owner_admin".to_string()));
        let owners = list_rows(
            pool,
            "organization_members",
            Some(&filters),
            50,
            0,
            "created_at",
            false,
        )
        .await?;
        if owners.len() <= 1 {
            return Err(AppError::Conflict(
                "Cannot remove the last owner_admin from the organization.".to_string(),
            ));
        }
    }

    sqlx::query("DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2")
        .bind(&path.org_id)
        .bind(&path.member_user_id)
        .execute(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&path.org_id),
        Some(&user.id),
        "delete",
        "organization_members",
        Some(&path.member_user_id),
        Some(existing.clone()),
        None,
    )
    .await;

    Ok(Json(existing))
}

async fn get_db_row(state: &AppState, table: &str, row_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;
    get_row(pool, table, row_id, "id").await
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn value_str(row: &Value, key: &str) -> String {
    value_str_opt(row, key).unwrap_or_default()
}

fn value_str_opt(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
