use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Map, Value};

use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows},
    schemas::clamp_limit_in_range,
    services::{audit::write_audit_log, embeddings},
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const DOC_EDIT_ROLES: &[&str] = &["owner_admin", "operator", "accountant"];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/documents",
            axum::routing::get(list_documents).post(create_document),
        )
        .route(
            "/documents/{document_id}",
            axum::routing::get(get_document).delete(delete_document),
        )
        .route(
            "/documents/{document_id}/process",
            axum::routing::post(process_document),
        )
        .route(
            "/knowledge-documents",
            axum::routing::get(list_knowledge_documents).post(create_knowledge_document),
        )
        .route(
            "/knowledge-documents/{document_id}",
            axum::routing::get(get_knowledge_document).delete(delete_knowledge_document),
        )
        .route(
            "/knowledge-documents/{document_id}/chunks",
            axum::routing::get(list_knowledge_chunks),
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
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
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
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    record.insert(
        "entity_type".to_string(),
        Value::String(payload.entity_type),
    );
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
    record.insert(
        "uploaded_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

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

// ---------------------------------------------------------------------------
// Document processing (RAG pipeline)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct ProcessDocumentInput {
    organization_id: String,
    content: String,
    title: Option<String>,
}

/// Split a document's text content into chunks, embed each via OpenAI, and store in knowledge_chunks.
async fn process_document(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    headers: HeaderMap,
    Json(payload): Json<ProcessDocumentInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, DOC_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    // Verify document exists and belongs to the org
    let doc = get_row(pool, "documents", &path.document_id, "id").await?;
    let doc_org = val_str(&doc, "organization_id");
    if doc_org != payload.organization_id {
        return Err(AppError::Forbidden(
            "Document does not belong to this organization".to_string(),
        ));
    }

    let title = payload
        .title
        .as_deref()
        .or_else(|| {
            doc.as_object()
                .and_then(|o| o.get("file_name"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default();

    // Ensure a knowledge_document record exists for this document
    let kd_id = ensure_knowledge_document(
        pool,
        &payload.organization_id,
        &path.document_id,
        title,
        &user_id,
    )
    .await?;

    let count = embeddings::process_and_embed_document(
        pool,
        &state.http_client,
        &state.config,
        &payload.organization_id,
        &kd_id,
        &payload.content,
        title,
    )
    .await
    .map_err(|e| AppError::ServiceUnavailable(e))?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "process_document",
        "knowledge_documents",
        Some(&kd_id),
        None,
        Some(json!({ "chunks_created": count })),
    )
    .await;

    Ok(Json(json!({
        "ok": true,
        "knowledge_document_id": kd_id,
        "chunks_created": count,
    })))
}

async fn ensure_knowledge_document(
    pool: &sqlx::PgPool,
    org_id: &str,
    source_document_id: &str,
    title: &str,
    user_id: &str,
) -> AppResult<String> {
    // Check if a knowledge_document already exists for this source
    let existing = sqlx::query(
        "SELECT id::text AS id FROM knowledge_documents
         WHERE organization_id = $1::uuid
           AND metadata ->> 'source_document_id' = $2
         LIMIT 1",
    )
    .bind(org_id)
    .bind(source_document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Dependency(e.to_string()))?;

    if let Some(row) = existing {
        let id: String = row.try_get("id").unwrap_or_default();
        // Update title if changed
        sqlx::query(
            "UPDATE knowledge_documents SET title = $1, updated_at = now() WHERE id = $2::uuid",
        )
        .bind(title)
        .bind(&id)
        .execute(pool)
        .await
        .ok();
        return Ok(id);
    }

    // Create new knowledge_document
    let row = sqlx::query(
        "INSERT INTO knowledge_documents (organization_id, title, metadata, created_by_user_id)
         VALUES ($1::uuid, $2, $3::jsonb, $4::uuid)
         RETURNING id::text AS id",
    )
    .bind(org_id)
    .bind(title)
    .bind(json!({ "source_document_id": source_document_id }))
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Dependency(e.to_string()))?;

    Ok(row.try_get::<String, _>("id").unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Knowledge documents CRUD
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct KnowledgeDocsQuery {
    org_id: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Debug, serde::Deserialize)]
struct CreateKnowledgeDocInput {
    organization_id: String,
    title: String,
    source_url: Option<String>,
    content: Option<String>,
}

async fn list_knowledge_documents(
    State(state): State<AppState>,
    Query(query): Query<KnowledgeDocsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );

    let rows = list_rows(
        pool,
        "knowledge_documents",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 500),
        0,
        "created_at",
        false,
    )
    .await?;

    // Attach chunk counts
    let mut enriched = Vec::with_capacity(rows.len());
    for row in rows {
        let doc_id = val_str(&row, "id");
        let chunk_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM knowledge_chunks WHERE document_id = $1::uuid",
        )
        .bind(&doc_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        let has_embeddings: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM knowledge_chunks WHERE document_id = $1::uuid AND embedding IS NOT NULL)",
        )
        .bind(&doc_id)
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        let mut doc = row
            .as_object()
            .cloned()
            .unwrap_or_default();
        doc.insert("chunk_count".to_string(), json!(chunk_count));
        doc.insert("has_embeddings".to_string(), json!(has_embeddings));
        enriched.push(Value::Object(doc));
    }

    Ok(Json(json!({ "data": enriched })))
}

async fn get_knowledge_document(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "knowledge_documents", &path.document_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    Ok(Json(record))
}

async fn create_knowledge_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateKnowledgeDocInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, DOC_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut record = Map::new();
    record.insert(
        "organization_id".to_string(),
        Value::String(payload.organization_id.clone()),
    );
    record.insert("title".to_string(), Value::String(payload.title.clone()));
    if let Some(url) = payload.source_url {
        record.insert("source_url".to_string(), Value::String(url));
    }
    record.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    let created = create_row(pool, "knowledge_documents", &record).await?;
    let kd_id = val_str(&created, "id");

    // If content is provided, process and embed immediately
    if let Some(content) = payload.content.as_deref().filter(|c| !c.trim().is_empty()) {
        let _ = embeddings::process_and_embed_document(
            pool,
            &state.http_client,
            &state.config,
            &payload.organization_id,
            &kd_id,
            content,
            &payload.title,
        )
        .await;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "knowledge_documents",
        Some(&kd_id),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn delete_knowledge_document(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "knowledge_documents", &path.document_id, "id").await?;
    let org_id = val_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, DOC_EDIT_ROLES).await?;

    // Chunks cascade-delete via FK
    delete_row(pool, "knowledge_documents", &path.document_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "delete",
        "knowledge_documents",
        Some(&path.document_id),
        Some(record),
        None,
    )
    .await;

    Ok(Json(json!({ "deleted": true })))
}

#[derive(Debug, serde::Deserialize)]
struct ChunksQuery {
    org_id: String,
    #[serde(default = "default_chunk_limit")]
    limit: i64,
}
fn default_chunk_limit() -> i64 {
    100
}

async fn list_knowledge_chunks(
    State(state): State<AppState>,
    Path(path): Path<DocumentPath>,
    Query(query): Query<ChunksQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let limit = clamp_limit_in_range(query.limit, 1, 500);
    let rows = sqlx::query(
        "SELECT
            id::text AS id,
            document_id::text AS document_id,
            chunk_index,
            content,
            metadata,
            embedding IS NOT NULL AS has_embedding,
            created_at,
            updated_at
         FROM knowledge_chunks
         WHERE organization_id = $1::uuid AND document_id = $2::uuid
         ORDER BY chunk_index ASC
         LIMIT $3",
    )
    .bind(&query.org_id)
    .bind(&path.document_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Dependency(e.to_string()))?;

    let mut chunks = Vec::with_capacity(rows.len());
    for row in rows {
        chunks.push(json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
            "chunk_index": row.try_get::<i32, _>("chunk_index").unwrap_or(0),
            "content": row.try_get::<String, _>("content").unwrap_or_default(),
            "metadata": row.try_get::<Option<Value>, _>("metadata").ok().flatten().unwrap_or(json!({})),
            "has_embedding": row.try_get::<bool, _>("has_embedding").unwrap_or(false),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));
    }

    Ok(Json(json!({ "data": chunks })))
}
