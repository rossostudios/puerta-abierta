use axum::{
    extract::State,
    http::{
        header::{
            HeaderName, HeaderValue, STRICT_TRANSPORT_SECURITY, X_CONTENT_TYPE_OPTIONS,
            X_FRAME_OPTIONS,
        },
        Request, StatusCode,
    },
    middleware::Next,
    response::Response,
    Json,
};
use serde_json::json;

use crate::state::AppState;

const REFERRER_POLICY: HeaderName = HeaderName::from_static("referrer-policy");
const PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");
const CONTENT_SECURITY_POLICY: HeaderName = HeaderName::from_static("content-security-policy");

pub async fn enforce_trusted_hosts(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let health_path = format!("{}/health", state.config.api_prefix);
    let live_path = format!("{}/live", state.config.api_prefix);
    let ready_path = format!("{}/ready", state.config.api_prefix);
    let path = request.uri().path().to_string();

    if path != health_path
        && path != live_path
        && path != ready_path
        && !state.config.trusted_hosts.is_empty()
        && !host_allowed(
            request
                .headers()
                .get("host")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default(),
            &state.config.trusted_hosts,
        )
    {
        let body = Json(json!({
            "status": "error",
            "code": 400,
            "message": "Invalid host header"
        }));
        return (StatusCode::BAD_REQUEST, body).into_response();
    }

    let mut response = next.run(request).await;

    insert_header_if_missing(
        response.headers_mut(),
        X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    insert_header_if_missing(
        response.headers_mut(),
        X_FRAME_OPTIONS,
        HeaderValue::from_static("DENY"),
    );
    insert_header_if_missing(
        response.headers_mut(),
        REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    insert_header_if_missing(
        response.headers_mut(),
        PERMISSIONS_POLICY,
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    insert_header_if_missing(
        response.headers_mut(),
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );

    if state.config.is_production() {
        insert_header_if_missing(
            response.headers_mut(),
            STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }

    response
}

fn insert_header_if_missing(
    headers: &mut axum::http::HeaderMap,
    key: HeaderName,
    value: HeaderValue,
) {
    if !headers.contains_key(&key) {
        headers.insert(key, value);
    }
}

pub fn host_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    let normalized_host = host
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    if normalized_host.is_empty() {
        return false;
    }

    for pattern in allowed_hosts {
        let candidate = pattern.trim().to_ascii_lowercase();
        if candidate.is_empty() {
            continue;
        }
        if candidate == "*" {
            return true;
        }
        if let Some(suffix) = candidate.strip_prefix("*.") {
            if normalized_host == suffix || normalized_host.ends_with(&format!(".{suffix}")) {
                return true;
            }
            continue;
        }
        if normalized_host == candidate {
            return true;
        }
    }

    false
}

use axum::response::IntoResponse;

#[cfg(test)]
mod tests {
    use super::host_allowed;

    #[test]
    fn accepts_exact_and_wildcard_hosts() {
        let allowed = vec!["localhost".to_string(), "admin.example.com".to_string()];
        assert!(host_allowed("localhost:3000", &allowed));
        assert!(!host_allowed("evil.example.com", &allowed));
    }
}
