#![allow(dead_code)]

use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Gone: {0}")]
    Gone(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Unprocessable entity: {0}")]
    UnprocessableEntity(String),
    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),
    #[error("Dependency failure: {0}")]
    Dependency(String),
    #[error("{detail}")]
    Classified {
        detail: String,
        code: &'static str,
        status: StatusCode,
        retryable: bool,
    },
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Not implemented: {0}")]
    NotImplemented(String),
}

impl AppError {
    pub fn from_database_error(error: &sqlx::Error, fallback_detail: &str) -> Self {
        Self::from_database_error_message(&error.to_string(), fallback_detail)
    }

    pub fn from_database_error_message(message: &str, fallback_detail: &str) -> Self {
        if let Some(classified) = classify_database_error(message) {
            return Self::Classified {
                detail: classified.detail.to_string(),
                code: classified.code,
                status: classified.status,
                retryable: classified.retryable,
            };
        }

        if message
            .to_ascii_lowercase()
            .contains("invalid input syntax for type uuid")
        {
            return Self::BadRequest("Invalid UUID parameter.".to_string());
        }

        Self::Dependency(fallback_detail.to_string())
    }

    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Gone(_) => StatusCode::GONE,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::UnprocessableEntity(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::ServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Dependency(message) => classify_database_error(message)
                .map(|classified| classified.status)
                .unwrap_or(StatusCode::BAD_GATEWAY),
            Self::Classified { status, .. } => *status,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
        }
    }

    pub fn detail_message(&self) -> String {
        match self {
            Self::Unauthorized(message)
            | Self::Forbidden(message)
            | Self::NotFound(message)
            | Self::Conflict(message)
            | Self::Gone(message)
            | Self::BadRequest(message)
            | Self::UnprocessableEntity(message)
            | Self::ServiceUnavailable(message)
            | Self::Internal(message)
            | Self::NotImplemented(message) => message.clone(),
            Self::Dependency(message) => classify_database_error(message)
                .map(|classified| classified.detail.to_string())
                .unwrap_or_else(|| message.clone()),
            Self::Classified { detail, .. } => detail.clone(),
        }
    }

    pub fn error_code(&self) -> &'static str {
        match self {
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden(_) => "forbidden",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Gone(_) => "gone",
            Self::BadRequest(_) => "bad_request",
            Self::UnprocessableEntity(_) => "unprocessable_entity",
            Self::ServiceUnavailable(_) => "service_unavailable",
            Self::Dependency(message) => classify_database_error(message)
                .map(|classified| classified.code)
                .unwrap_or("dependency_failure"),
            Self::Classified { code, .. } => code,
            Self::Internal(_) => "internal_error",
            Self::NotImplemented(_) => "not_implemented",
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            Self::ServiceUnavailable(_) => true,
            Self::Dependency(message) => classify_database_error(message)
                .map(|classified| classified.retryable)
                .unwrap_or(false),
            Self::Classified { retryable, .. } => *retryable,
            _ => false,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let retryable = self.retryable();
        let request_id = crate::middleware::request_id::current_request_id();
        let body = Json(json!({
            "detail": self.detail_message(),
            "code": self.error_code(),
            "retryable": retryable,
            "request_id": request_id,
        }));

        let mut response = (status, body).into_response();
        if retryable {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("3"));
        }
        if let Some(request_id) = crate::middleware::request_id::current_request_id() {
            if let Ok(value) = HeaderValue::from_str(&request_id) {
                response.headers_mut().insert("x-request-id", value);
            }
        }
        response
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Copy)]
struct ClassifiedDbError {
    code: &'static str,
    status: StatusCode,
    retryable: bool,
    detail: &'static str,
}

fn classify_database_error(message: &str) -> Option<ClassifiedDbError> {
    let normalized = message.to_ascii_lowercase();

    if (normalized.contains("circuit breaker open") && normalized.contains("authentication"))
        || normalized.contains("too many authentication errors")
        || normalized.contains("password authentication failed")
    {
        return Some(ClassifiedDbError {
            code: "db_auth_failure",
            status: StatusCode::SERVICE_UNAVAILABLE,
            retryable: true,
            detail: "Database authentication failed or was temporarily blocked.",
        });
    }

    if (normalized.contains("column \"") && normalized.contains("does not exist"))
        || (normalized.contains("relation \"") && normalized.contains("does not exist"))
    {
        return Some(ClassifiedDbError {
            code: "db_schema_incompatible",
            status: StatusCode::SERVICE_UNAVAILABLE,
            retryable: false,
            detail: "Database schema is incompatible with this API release.",
        });
    }

    if normalized.contains("uuid = text")
        || (normalized.contains("operator does not exist:")
            && normalized.contains("uuid")
            && normalized.contains("text"))
    {
        return Some(ClassifiedDbError {
            code: "db_query_error",
            status: StatusCode::INTERNAL_SERVER_ERROR,
            retryable: false,
            detail: "Database query type mismatch detected.",
        });
    }

    if normalized.contains("timed out")
        || normalized.contains("timeout")
        || normalized.contains("connection refused")
        || normalized.contains("could not translate host name")
        || normalized.contains("failed to lookup address information")
        || normalized.contains("connection reset")
        || normalized.contains("connection closed")
        || normalized.contains("i/o error")
        || normalized.contains("pool timed out")
    {
        return Some(ClassifiedDbError {
            code: "db_unavailable",
            status: StatusCode::SERVICE_UNAVAILABLE,
            retryable: true,
            detail: "Database is temporarily unavailable.",
        });
    }

    None
}
