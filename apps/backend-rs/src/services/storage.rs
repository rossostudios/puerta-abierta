use std::time::Duration;

use aws_config::{meta::region::RegionProviderChain, BehaviorVersion};
use aws_sdk_s3::{config::Region, presigning::PresigningConfig, Client as S3Client};

use crate::{config::AppConfig, error::AppError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageNamespace {
    Documents,
    Receipts,
    Listings,
}

impl StorageNamespace {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "documents" => Some(Self::Documents),
            "receipts" => Some(Self::Receipts),
            "listings" => Some(Self::Listings),
            _ => None,
        }
    }

    pub fn as_prefix(self) -> &'static str {
        match self {
            Self::Documents => "documents",
            Self::Receipts => "receipts",
            Self::Listings => "listings",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PresignedUpload {
    pub upload_url: String,
    pub public_url: String,
    pub object_key: String,
    pub content_type: Option<String>,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone)]
pub struct PresignedDownload {
    pub download_url: String,
    pub object_key: String,
    pub expires_in_seconds: u64,
}

pub fn storage_enabled(config: &AppConfig) -> bool {
    config.storage_public_enabled()
}

pub fn validate_client_key(key: &str) -> Result<(), AppError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Storage key is required.".to_string()));
    }
    if trimmed.len() > 512 {
        return Err(AppError::BadRequest("Storage key is too long.".to_string()));
    }
    if trimmed.starts_with('/') || trimmed.ends_with('/') {
        return Err(AppError::BadRequest(
            "Storage key cannot start or end with '/'.".to_string(),
        ));
    }
    if trimmed.contains("..") || trimmed.contains("//") || trimmed.contains('\\') {
        return Err(AppError::BadRequest(
            "Storage key contains an invalid path segment.".to_string(),
        ));
    }
    if !trimmed
        .bytes()
        .all(|b| matches!(b, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/'))
    {
        return Err(AppError::BadRequest(
            "Storage key contains unsupported characters.".to_string(),
        ));
    }
    Ok(())
}

pub fn public_object_key(namespace: StorageNamespace, key: &str) -> String {
    format!("{}/{}", namespace.as_prefix(), key.trim_start_matches('/'))
}

pub fn public_object_url(config: &AppConfig, object_key: &str) -> Result<String, AppError> {
    let object_key = object_key.trim_start_matches('/');
    if let Some(base) = config
        .storage_s3_public_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(format!("{}/{}", base.trim_end_matches('/'), object_key));
    }

    let bucket = config
        .storage_s3_public_bucket
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable("Public storage bucket is not configured.".to_string())
        })?;
    let region = config
        .storage_s3_region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("us-east-1");

    let url = if region == "us-east-1" {
        format!("https://{bucket}.s3.amazonaws.com/{object_key}")
    } else {
        format!("https://{bucket}.s3.{region}.amazonaws.com/{object_key}")
    };
    Ok(url)
}

pub async fn presign_public_upload(
    config: &AppConfig,
    namespace: StorageNamespace,
    key: &str,
    content_type: Option<&str>,
) -> Result<PresignedUpload, AppError> {
    let bucket = config
        .storage_s3_public_bucket
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable("Public storage bucket is not configured.".to_string())
        })?;

    validate_client_key(key)?;
    let object_key = public_object_key(namespace, key);
    let client = s3_client_from_config(config).await?;

    let ttl = config.storage_presign_ttl_seconds.clamp(60, 3600);
    let presign_config = PresigningConfig::expires_in(Duration::from_secs(ttl))
        .map_err(|err| AppError::Internal(format!("Could not build S3 presign config: {err}")))?;

    let mut request = client.put_object().bucket(bucket).key(&object_key);
    let normalized_content_type = content_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if let Some(ref value) = normalized_content_type {
        request = request.content_type(value);
    }

    let presigned = request.presigned(presign_config).await.map_err(|err| {
        AppError::ServiceUnavailable(format!("Could not create upload URL: {err}"))
    })?;

    Ok(PresignedUpload {
        upload_url: presigned.uri().to_string(),
        public_url: public_object_url(config, &object_key)?,
        object_key,
        content_type: normalized_content_type,
        expires_in_seconds: ttl,
    })
}

pub async fn presign_private_download(
    config: &AppConfig,
    object_key: &str,
) -> Result<PresignedDownload, AppError> {
    let bucket = config
        .storage_s3_private_bucket
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::NotImplemented("Private storage is not configured.".to_string())
        })?;

    validate_client_key(object_key)?;
    let client = s3_client_from_config(config).await?;
    let ttl = config.storage_presign_ttl_seconds.clamp(60, 3600);
    let presign_config = PresigningConfig::expires_in(Duration::from_secs(ttl))
        .map_err(|err| AppError::Internal(format!("Could not build S3 presign config: {err}")))?;
    let presigned = client
        .get_object()
        .bucket(bucket)
        .key(object_key)
        .presigned(presign_config)
        .await
        .map_err(|err| {
            AppError::ServiceUnavailable(format!("Could not create download URL: {err}"))
        })?;

    Ok(PresignedDownload {
        download_url: presigned.uri().to_string(),
        object_key: object_key.to_string(),
        expires_in_seconds: ttl,
    })
}

async fn s3_client_from_config(config: &AppConfig) -> Result<S3Client, AppError> {
    let region = config
        .storage_s3_region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("us-east-1")
        .to_string();

    let region_provider = RegionProviderChain::first_try(Region::new(region))
        .or_default_provider()
        .or_else(Region::new("us-east-1"));

    let shared_config = aws_config::defaults(BehaviorVersion::latest())
        .region(region_provider)
        .load()
        .await;

    let mut builder = aws_sdk_s3::config::Builder::from(&shared_config);
    if let Some(endpoint) = config
        .storage_s3_endpoint_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.endpoint_url(endpoint.to_string());
    }
    if config.storage_s3_force_path_style {
        builder = builder.force_path_style(true);
    }

    Ok(S3Client::from_conf(builder.build()))
}
