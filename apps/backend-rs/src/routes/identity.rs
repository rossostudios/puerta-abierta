use axum::{extract::State, http::HeaderMap, Json};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_authenticated_user,
    error::{AppError, AppResult},
    repository::table_service::list_rows,
    state::AppState,
    tenancy::{ensure_app_user, list_user_organizations},
};

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Value>> {
    let user = require_authenticated_user(&state, &headers).await?;
    let app_user = ensure_app_user(&state, &user).await?;
    let Some(pool) = state.db_pool.as_ref() else {
        return Err(AppError::Dependency(
            "Database is not configured. Set DATABASE_URL (legacy SUPABASE_DB_URL is also supported).".to_string(),
        ));
    };

    let mut filters = Map::new();
    filters.insert("user_id".to_string(), Value::String(user.id.clone()));

    let memberships = list_rows(
        pool,
        "organization_members",
        Some(&filters),
        200,
        0,
        "created_at",
        false,
    )
    .await?;
    let organizations = list_user_organizations(&state, &user.id).await?;

    Ok(Json(json!({
        "user": app_user,
        "memberships": memberships,
        "organizations": organizations
    })))
}
