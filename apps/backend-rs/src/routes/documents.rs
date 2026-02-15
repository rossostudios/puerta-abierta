use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows},
    schemas::clamp_limit_in_range,
    services::audit::write_audit_log,
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const DOC_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/documents", axum::routing::get(list_documents).post(create_document))
        .route(
            "/documents/{document_id}",
            axum::routing::get(get_document).delete(delete_document),
        )
}

#[derive(Debug, serde::Deserialize)]
struct DocumentsQuery {
    org_id: String,
    entity_type: Option<String>,
    entity_id: Option<String>,
    category: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    200
}

#[derive(Debug, serde::Deserialize)]
struct DocumentPath {
    document_id: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct CreateDocumentInput {
    organization_id: String,
    entity_type: String,
    entity_id: Option<String>,
    file_name: String,
    file_url: String,
    file_size_bytes: Option<i64>,
    mime_type: Option<String>,
    #[serde(default = "default_category")]
    category: String,
}
fn default_category() -> String {
    "other".to_string()
}

async fn list_documents(
    State(state): State<AppState>,
    Query(query): Query<DocumentsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(query.org_id.clone()));
    if let Some(et) = non_empty_opt(query.entity_type.as_deref()) {
        filters.insert("entity_type".to_string(), Value::String(et));
    }
    if let Some(eid) = non_empty_opt(query.entity_id.as_deref()) {
        filters.insert("entity_id".to_string(), Value::String(eid));
    }
    if let Some(cat) = non_empty_opt(query.category.as_deref()) {
        filters.insert("category".to_string(), Value::String(cat));
    }

    let rows = list_rows(
        pool,
        "documents",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn get_document(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "documents", &path.document_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn create_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDocumentInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, DOC_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut record = Map::new();
    record.insert("organization_id".to_string(), Value::String(payload.organization_id.clone()));
    record.insert("entity_type".to_string(), Value::String(payload.entity_type));
    if let Some(eid) = payload.entity_id {
        record.insert("entity_id".to_string(), Value::String(eid));
    }
    record.insert("file_name".to_string(), Value::String(payload.file_name));
    record.insert("file_url".to_string(), Value::String(payload.file_url));
    if let Some(size) = payload.file_size_bytes {
        record.insert("file_size_bytes".to_string(), json!(size));
    }
    if let Some(mime) = payload.mime_type {
        record.insert("mime_type".to_string(), Value::String(mime));
    }
    record.insert("category".to_string(), Value::String(payload.category));
    record.insert("uploaded_by_user_id".to_string(), Value::String(user_id.clone()));

    let created = create_row(pool, "documents", &record).await?;
    let entity_id = val_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "documents",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn delete_document(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "documents", &path.document_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, DOC_EDIT_ROLES).await?;

    delete_row(pool, "documents", &path.document_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "documents",
        Some(&path.document_id),
        Some(record),
        None,
    )
    .await;

    Ok(Json(json!({ "deleted": true })))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}
