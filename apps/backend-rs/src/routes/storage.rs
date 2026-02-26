use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    services::storage::{
        presign_private_download, presign_public_upload, storage_enabled, validate_client_key,
        StorageNamespace,
    },
    state::AppState,
    tenancy::assert_org_member,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/storage/presign-upload",
            axum::routing::post(presign_upload),
        )
        .route(
            "/storage/presign-download",
            axum::routing::post(presign_download),
        )
        .route(
            "/storage/complete-upload",
            axum::routing::post(complete_upload),
        )
}

#[derive(Debug, Deserialize)]
struct PresignUploadRequest {
    namespace: String,
    key: String,
    #[serde(default)]
    org_id: Option<String>,
    #[serde(default)]
    content_type: Option<String>,
}

#[derive(Debug, Serialize)]
struct PresignUploadResponse {
    method: &'static str,
    upload_url: String,
    public_url: String,
    object_key: String,
    expires_in_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    required_headers: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct PresignDownloadRequest {
    object_key: String,
    #[serde(default)]
    org_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CompleteUploadRequest {
    namespace: String,
    object_key: String,
    #[serde(default)]
    public_url: Option<String>,
    #[serde(default)]
    org_id: Option<String>,
}

async fn presign_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PresignUploadRequest>,
) -> AppResult<Json<PresignUploadResponse>> {
    if !storage_enabled(&state.config) {
        return Err(AppError::ServiceUnavailable(
            "Object storage is not configured.".to_string(),
        ));
    }

    let user_id = require_user_id(&state, &headers).await?;
    if let Some(org_id) = payload
        .org_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        assert_org_member(&state, &user_id, org_id).await?;
    }

    let namespace = StorageNamespace::parse(&payload.namespace)
        .ok_or_else(|| AppError::BadRequest("Unsupported storage namespace.".to_string()))?;

    let presigned = presign_public_upload(
        &state.config,
        namespace,
        &payload.key,
        payload.content_type.as_deref(),
    )
    .await?;

    let required_headers = presigned
        .content_type
        .as_ref()
        .map(|content_type| json!({ "content-type": content_type }));

    Ok(Json(PresignUploadResponse {
        method: "PUT",
        upload_url: presigned.upload_url,
        public_url: presigned.public_url,
        object_key: presigned.object_key,
        expires_in_seconds: presigned.expires_in_seconds,
        required_headers,
    }))
}

async fn presign_download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PresignDownloadRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    if let Some(org_id) = payload
        .org_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        assert_org_member(&state, &user_id, org_id).await?;
    }

    let presigned = presign_private_download(&state.config, &payload.object_key).await?;
    Ok(Json(json!({
        "method": "GET",
        "download_url": presigned.download_url,
        "object_key": presigned.object_key,
        "expires_in_seconds": presigned.expires_in_seconds
    })))
}

async fn complete_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CompleteUploadRequest>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    let user_id = require_user_id(&state, &headers).await?;
    if let Some(org_id) = payload
        .org_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        assert_org_member(&state, &user_id, org_id).await?;
    }

    StorageNamespace::parse(&payload.namespace)
        .ok_or_else(|| AppError::BadRequest("Unsupported storage namespace.".to_string()))?;
    validate_client_key(&payload.object_key)?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "object_key": payload.object_key,
            "public_url": payload.public_url,
        })),
    ))
}
