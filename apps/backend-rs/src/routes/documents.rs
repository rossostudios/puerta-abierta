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
        .route(
            "/knowledge-documents/seed",
            axum::routing::post(seed_knowledge_documents),
        )
        .route(
            "/knowledge-documents/upload",
            axum::routing::post(upload_knowledge_document),
        )
        .route(
            "/knowledge-documents/search-test",
            axum::routing::post(search_test_knowledge),
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
            "Database is not configured. Set DATABASE_URL (legacy SUPABASE_DB_URL is also supported).".to_string(),
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

        let mut doc = row.as_object().cloned().unwrap_or_default();
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

// ---------------------------------------------------------------------------
// Knowledge base seeding
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct SeedInput {
    organization_id: String,
}

const SEED_DOCS: &[(&str, &str)] = &[
    (
        "Check-in / Check-out Procedures",
        r#"## Check-in / Check-out Procedures

### Standard Check-in
- **Check-in time:** 3:00 PM (15:00)
- **Early check-in:** Available upon request, subject to availability. Extra fee of 50,000 PYG may apply.
- **Key handoff:** Digital lockbox code sent via WhatsApp 2 hours before check-in. For smart lock properties, a temporary access code is generated automatically.
- **Welcome packet:** Located inside the property — includes WiFi password, emergency contacts, house rules, and local recommendations.

### Standard Check-out
- **Check-out time:** 11:00 AM (11:00)
- **Late check-out:** Available until 2:00 PM for 100,000 PYG. Must be requested 24 hours in advance.
- **Check-out checklist:** Take out trash, wash dishes, strip bed linens, close all windows, lock all doors, return keys to lockbox.

### Cleaning Protocol
- Professional cleaning scheduled within 2 hours of check-out.
- Inspection photos taken before and after cleaning.
- Minimum 4-hour turnover window between guests.
- Deep cleaning performed monthly or every 4 turnovers.
"#,
    ),
    (
        "House Rules & FAQ",
        r#"## House Rules & Frequently Asked Questions

### WiFi
- **Network name:** Displayed on the welcome card in the living room.
- **Password:** Included in the welcome packet and sent via WhatsApp at check-in.
- **Speed:** Minimum 50 Mbps. Report issues to property manager immediately.

### Parking
- Designated parking spot included (where available). Do not park in neighboring spaces.
- Street parking is available in most neighborhoods. Lock your vehicle.

### Quiet Hours
- **10:00 PM – 8:00 AM** — No loud music, parties, or excessive noise.
- Violations may result in a warning or early termination of stay.

### Pets
- Not allowed unless explicitly listed as pet-friendly. Pet fee: 150,000 PYG per stay.

### Smoking
- Strictly prohibited inside all properties. Smoking is only allowed in designated outdoor areas.
- A cleaning fee of 500,000 PYG will be charged for violations.

### Garbage
- Separate recyclables from general waste. Collection days vary by neighborhood.
- Take trash to the designated bin area before check-out.

### Pool / Amenities
- Pool hours: 8:00 AM – 9:00 PM. No diving. Children must be supervised.
- BBQ grills available — clean after use. Charcoal provided.
- Gym access included where available. Use equipment at own risk.
"#,
    ),
    (
        "Paraguay Short-Term Rental Regulations",
        r#"## Paraguay Short-Term Rental Regulations

### Legal Framework
- **Ley 6524/2020 (Ley de Turismo):** Regulates tourist accommodations including short-term rentals.
- All short-term rental operators must register with SENATUR (Secretaría Nacional de Turismo).
- Properties must meet minimum safety and hygiene standards.

### Tax Obligations
- **IVA (Value Added Tax):** 10% applies to rental income from tourist accommodations.
- **SET Registration:** Operators must register with the Subsecretaría de Estado de Tributación.
- **Income tax:** Rental income is subject to IRACIS (corporate) or IRP (personal) depending on structure.
- Monthly IVA declarations are required via the Marangatú system.

### Guest ID Requirements
- All guests must present valid identification at check-in.
- Foreign guests: passport required. Paraguayan guests: cédula de identidad.
- Guest registry must be maintained and available for inspection.
- Guest data must be reported to SENATUR within 24 hours of check-in.

### Safety Requirements
- Fire extinguisher (minimum 1 per floor).
- Smoke detectors in every bedroom and hallway.
- Emergency exit signage.
- First aid kit.
- Emergency contact information posted visibly.
"#,
    ),
    (
        "Emergency Contacts & Procedures",
        r#"## Emergency Contacts & Procedures

### Emergency Numbers (Paraguay)
- **General Emergency (Police/Fire/Ambulance):** 911
- **Police (Policía Nacional):** 911 or (021) 441-111
- **Fire Department (Bomberos):** 132
- **Ambulance (SEME):** 141
- **Hospital de Clínicas:** (021) 420-980
- **Hospital Italiano:** (021) 615-666

### Property Emergency Escalation
1. **Immediate danger (fire, flood, break-in):** Call 911 first, then property manager.
2. **Urgent maintenance (water leak, power outage, AC failure):** Contact property manager via WhatsApp. Response within 30 minutes.
3. **Non-urgent issues (minor repairs, replacements):** Submit via the guest portal or WhatsApp. Response within 4 hours during business hours.

### Property Manager Contact
- Available 24/7 for emergencies.
- Business hours: 8:00 AM – 8:00 PM, Monday – Saturday.
- WhatsApp is the preferred communication channel.

### Natural Disasters
- Paraguay experiences occasional storms and flooding during rainy season (October – March).
- In case of severe weather: stay indoors, away from windows. Follow local authorities' instructions.
- Emergency supplies (flashlight, water) available in the utility closet.
"#,
    ),
    (
        "OTA Channel Guidelines",
        r#"## OTA Channel Guidelines

### Airbnb
- **Commission:** 3% host fee (host-only pricing model).
- **Cancellation policy:** Moderate — full refund if cancelled 5+ days before check-in.
- **Review response SLA:** Respond to all reviews within 48 hours. Professional, courteous tone.
- **Listing sync:** Calendar synced every 15 minutes via iCal. Price changes pushed immediately via API.
- **Superhost requirements:** 4.8+ rating, <1% cancellation rate, 90%+ response rate, 10+ stays/year.

### Booking.com
- **Commission:** 15% per booking.
- **Cancellation policy:** Free cancellation up to 48 hours before check-in (default).
- **Guest communication:** All pre-booking messages go through Booking.com extranet. Post-booking, direct WhatsApp is allowed.
- **Listing sync:** Channel manager integration with real-time availability updates.
- **Genius program:** Properties with 8.0+ rating and low cancellation qualify for visibility boost.

### General OTA Rules
- **Rate parity:** Maintain consistent pricing across all channels (±5% allowed for commission offset).
- **Minimum stay:** 2 nights (weekends), 1 night (weekdays) — adjust seasonally.
- **Listing photos:** Minimum 20 professional photos per listing. Update annually.
- **Description accuracy:** All amenities, rules, and restrictions must be accurately listed. Misrepresentation leads to penalties.
- **Response time:** Reply to all inquiries within 1 hour during business hours, 4 hours outside.
"#,
    ),
];

async fn seed_knowledge_documents(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SeedInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(&state, &user_id, &payload.organization_id, DOC_EDIT_ROLES).await?;
    let pool = db_pool(&state)?;

    let mut seeded = 0u32;
    let mut skipped = 0u32;

    for (title, content) in SEED_DOCS {
        // Idempotent: check if a document with this title already exists for this org
        let existing: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM knowledge_documents WHERE organization_id = $1::uuid AND title = $2)",
        )
        .bind(&payload.organization_id)
        .bind(title)
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        if existing {
            skipped += 1;
            continue;
        }

        // Create knowledge document
        let row = sqlx::query(
            "INSERT INTO knowledge_documents (organization_id, title, source_url, created_by_user_id)
             VALUES ($1::uuid, $2, 'seed', $3::uuid)
             RETURNING id::text AS id",
        )
        .bind(&payload.organization_id)
        .bind(title)
        .bind(&user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Dependency(e.to_string()))?;

        let kd_id: String = row.try_get("id").unwrap_or_default();

        // Process and embed the content
        let _ = embeddings::process_and_embed_document(
            pool,
            &state.http_client,
            &state.config,
            &payload.organization_id,
            &kd_id,
            content,
            title,
        )
        .await;

        seeded += 1;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "seed_knowledge",
        "knowledge_documents",
        None,
        None,
        Some(json!({ "seeded": seeded, "skipped": skipped })),
    )
    .await;

    Ok(Json(json!({
        "ok": true,
        "seeded": seeded,
        "skipped": skipped,
        "total_available": SEED_DOCS.len(),
    })))
}

// ---------------------------------------------------------------------------
// S19: File upload for knowledge documents (PDF, DOCX, TXT, MD)
// ---------------------------------------------------------------------------

use axum::extract::Multipart;

async fn upload_knowledge_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let mut org_id: Option<String> = None;
    let mut title: Option<String> = None;
    let mut file_content: Option<String> = None;
    let mut file_name: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "organization_id" | "org_id" => {
                org_id = field.text().await.ok().filter(|s| !s.trim().is_empty());
            }
            "title" => {
                title = field.text().await.ok().filter(|s| !s.trim().is_empty());
            }
            "file" => {
                file_name = field.file_name().map(ToOwned::to_owned);
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read file: {e}")))?;
                let fname = file_name.as_deref().unwrap_or("file.txt").to_lowercase();
                // Extract text based on file type
                if fname.ends_with(".txt") || fname.ends_with(".md") {
                    file_content = Some(String::from_utf8_lossy(&bytes).to_string());
                } else if fname.ends_with(".pdf") {
                    // Simple PDF text extraction — look for text between stream markers
                    file_content = Some(extract_pdf_text(&bytes));
                } else if fname.ends_with(".docx") {
                    file_content = Some(extract_docx_text(&bytes));
                } else {
                    // Fallback: try as UTF-8 text
                    file_content = Some(String::from_utf8_lossy(&bytes).to_string());
                }
            }
            _ => {}
        }
    }

    let org_id =
        org_id.ok_or_else(|| AppError::BadRequest("organization_id is required".to_string()))?;
    assert_org_role(&state, &user_id, &org_id, DOC_EDIT_ROLES).await?;

    let content = file_content.filter(|c| !c.trim().is_empty()).ok_or_else(|| {
        AppError::BadRequest("No content could be extracted from the file. Supported formats: PDF, DOCX, TXT, MD.".to_string())
    })?;

    let doc_title = title
        .or(file_name.clone())
        .unwrap_or_else(|| "Uploaded Document".to_string());

    // Create knowledge document
    let row = sqlx::query(
        "INSERT INTO knowledge_documents (organization_id, title, source_url, created_by_user_id)
         VALUES ($1::uuid, $2, 'upload', $3::uuid)
         RETURNING id::text AS id",
    )
    .bind(&org_id)
    .bind(&doc_title)
    .bind(&user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Dependency(e.to_string()))?;

    let kd_id: String = row.try_get("id").unwrap_or_default();

    let chunk_count = embeddings::process_and_embed_document(
        pool,
        &state.http_client,
        &state.config,
        &org_id,
        &kd_id,
        &content,
        &doc_title,
    )
    .await
    .map_err(|e| AppError::ServiceUnavailable(e))?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "upload_knowledge",
        "knowledge_documents",
        Some(&kd_id),
        None,
        Some(json!({
            "file_name": file_name,
            "chunks_created": chunk_count,
        })),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "knowledge_document_id": kd_id,
            "title": doc_title,
            "chunks_created": chunk_count,
        })),
    ))
}

/// Basic PDF text extraction — extracts raw text content from PDF streams.
fn extract_pdf_text(bytes: &[u8]) -> String {
    // Simple extraction: look for text between BT...ET markers or parenthesized strings
    let raw = String::from_utf8_lossy(bytes);
    let mut text = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        // Extract text from Tj operators: (text) Tj
        if trimmed.ends_with("Tj") || trimmed.ends_with("TJ") {
            if let Some(start) = trimmed.find('(') {
                if let Some(end) = trimmed.rfind(')') {
                    if start < end {
                        text.push_str(&trimmed[start + 1..end]);
                        text.push(' ');
                    }
                }
            }
        }
    }

    if text.trim().is_empty() {
        // Fallback: extract all parenthesized strings
        let bytes_str = &raw;
        let mut in_paren = false;
        let mut buf = String::new();
        for ch in bytes_str.chars() {
            if ch == '(' {
                in_paren = true;
                continue;
            }
            if ch == ')' {
                in_paren = false;
                if !buf.trim().is_empty() {
                    text.push_str(buf.trim());
                    text.push(' ');
                }
                buf.clear();
                continue;
            }
            if in_paren {
                buf.push(ch);
            }
        }
    }

    text.trim().to_string()
}

/// Basic DOCX text extraction — parse the XML content.
fn extract_docx_text(bytes: &[u8]) -> String {
    // DOCX is a ZIP file; extract word/document.xml and strip XML tags
    use std::io::{Cursor, Read};

    let cursor = Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return String::from_utf8_lossy(bytes).to_string(),
    };

    let mut xml_content = String::new();
    if let Ok(mut file) = archive.by_name("word/document.xml") {
        file.read_to_string(&mut xml_content).ok();
    }

    if xml_content.is_empty() {
        return String::new();
    }

    // Strip XML tags, keeping text content
    let mut text = String::new();
    let mut in_tag = false;
    for ch in xml_content.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                // Add space after closing paragraph/line tags
                if text.ends_with(|c: char| c.is_alphanumeric()) {
                    text.push(' ');
                }
            }
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }

    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// S19: RAG search test endpoint
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct SearchTestInput {
    org_id: String,
    query: String,
    #[serde(default = "default_search_limit")]
    limit: i64,
}
fn default_search_limit() -> i64 {
    10
}

async fn search_test_knowledge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SearchTestInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &payload.org_id).await?;
    let pool = db_pool(&state)?;

    // Embed the query
    let embedding = embeddings::embed_text(&state.http_client, &state.config, &payload.query)
        .await
        .map_err(|e| AppError::ServiceUnavailable(e))?;

    let embedding_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let limit = payload.limit.min(50).max(1);

    // Hybrid search: vector similarity + FTS with RRF fusion
    let rows = sqlx::query(
        "WITH vector_results AS (
            SELECT kc.id, kc.content, kc.document_id,
                   1.0 - (kc.embedding <=> $3::vector) AS vector_score,
                   ROW_NUMBER() OVER (ORDER BY kc.embedding <=> $3::vector) AS vector_rank
            FROM knowledge_chunks kc
            WHERE kc.organization_id = $1::uuid AND kc.embedding IS NOT NULL
            ORDER BY kc.embedding <=> $3::vector
            LIMIT $4
        ),
        fts_results AS (
            SELECT kc.id, kc.content, kc.document_id,
                   ts_rank(kc.fts_vector, plainto_tsquery('english', $2)) AS fts_score,
                   ROW_NUMBER() OVER (ORDER BY ts_rank(kc.fts_vector, plainto_tsquery('english', $2)) DESC) AS fts_rank
            FROM knowledge_chunks kc
            WHERE kc.organization_id = $1::uuid AND kc.fts_vector @@ plainto_tsquery('english', $2)
            ORDER BY fts_score DESC
            LIMIT $4
        ),
        combined AS (
            SELECT
                COALESCE(v.id, f.id) AS id,
                COALESCE(v.content, f.content) AS content,
                COALESCE(v.document_id, f.document_id) AS document_id,
                COALESCE(v.vector_score, 0) AS vector_score,
                COALESCE(f.fts_score, 0) AS fts_score,
                (1.0 / (60.0 + COALESCE(v.vector_rank, 999))) + (1.0 / (60.0 + COALESCE(f.fts_rank, 999))) AS rrf_score
            FROM vector_results v
            FULL OUTER JOIN fts_results f ON v.id = f.id
        )
        SELECT c.id::text, c.content, c.document_id::text, c.vector_score::float8, c.fts_score::float8, c.rrf_score::float8,
               kd.title AS doc_title
        FROM combined c
        LEFT JOIN knowledge_documents kd ON kd.id = c.document_id
        ORDER BY c.rrf_score DESC
        LIMIT $4",
    )
    .bind(&payload.org_id)
    .bind(&payload.query)
    .bind(&embedding_str)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Dependency(format!("Search failed: {e}")))?;

    let results: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "chunk_id": row.try_get::<String, _>("id").unwrap_or_default(),
                "content": row.try_get::<String, _>("content").unwrap_or_default(),
                "document_id": row.try_get::<String, _>("document_id").unwrap_or_default(),
                "doc_title": row.try_get::<Option<String>, _>("doc_title").ok().flatten().unwrap_or_default(),
                "vector_score": row.try_get::<f64, _>("vector_score").unwrap_or(0.0),
                "fts_score": row.try_get::<f64, _>("fts_score").unwrap_or(0.0),
                "rrf_score": row.try_get::<f64, _>("rrf_score").unwrap_or(0.0),
            })
        })
        .collect();

    Ok(Json(json!({
        "ok": true,
        "query": payload.query,
        "results": results,
        "total": results.len(),
    })))
}
