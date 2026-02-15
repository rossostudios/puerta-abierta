use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use tower_http::cors::{Any, CorsLayer};

use crate::config::AppConfig;

pub fn build_cors_layer(config: &AppConfig) -> CorsLayer {
    let mut headers = vec![ACCEPT, AUTHORIZATION, CONTENT_TYPE];
    // Tenant portal uses x-tenant-token for magic-link auth
    headers.push(axum::http::header::HeaderName::from_static("x-tenant-token"));
    if config.auth_dev_overrides_enabled() {
        headers.push(axum::http::header::HeaderName::from_static("x-user-id"));
    }

    let mut layer = CorsLayer::new()
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers(headers);

    if config
        .cors_origins
        .iter()
        .any(|origin| origin.trim() == "*")
    {
        layer = layer.allow_origin(Any).allow_credentials(false);
    } else {
        let origins = config
            .cors_origins
            .iter()
            .filter_map(|origin| origin.parse().ok())
            .collect::<Vec<_>>();
        layer = layer.allow_origin(origins).allow_credentials(true);
    }

    layer
}
