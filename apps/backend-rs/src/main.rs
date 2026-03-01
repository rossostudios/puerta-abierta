//! Casaora backend — Axum-based API server.
#![recursion_limit = "512"]

mod auth;
mod cache;
mod cache_invalidation;
mod config;
mod db;
mod error;
mod middleware;
mod repository;
mod routes;
mod schemas;
mod services;
mod state;
mod tenancy;

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::{middleware::from_fn_with_state, Router};
use config::AppConfig;
use middleware::cors::build_cors_layer;
use middleware::request_id::inject_request_id;
use middleware::security::enforce_trusted_hosts;
use state::AppState;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    init_tracing();

    let config = AppConfig::from_env();
    let state = AppState::build(config)?;

    if state.config.db_fail_fast_on_startup_runtime() && state.db_pool.is_some() {
        if let Err(error) = state.db_startup_probe().await {
            tracing::error!(
                code = error.error_code(),
                retryable = error.retryable(),
                detail = %error.detail_message(),
                "Startup DB probe failed; refusing to serve traffic"
            );
            return Err(Box::new(std::io::Error::other(format!(
                "startup db probe failed: {}",
                error.detail_message()
            ))) as Box<dyn std::error::Error>);
        }
    }

    if state.config.auth_dev_overrides_enabled() {
        tracing::warn!("DEV AUTH OVERRIDES ARE ENABLED — do not use in production");
    }

    if state.clerk_jwks_cache.is_none() {
        tracing::warn!(
            "No Clerk JWKS auth provider configured (CLERK_JWKS_URL); token auth will reject bearer tokens"
        );
    }

    let mut app = Router::new()
        .nest(&state.config.api_prefix, routes::v1_router())
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2 MB
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(axum::middleware::from_fn(inject_request_id))
        .layer(TraceLayer::new_for_http())
        .layer(build_cors_layer(&state.config))
        .layer(from_fn_with_state(state.clone(), enforce_trusted_hosts))
        .with_state(state.clone());

    if state.config.rate_limit_enabled_runtime() {
        let governor_config = GovernorConfigBuilder::default()
            .key_extractor(middleware::rate_limit::CloudflareIpKeyExtractor)
            .per_second(state.config.rate_limit_per_second)
            .burst_size(state.config.rate_limit_burst_size)
            .finish()
            .expect("valid governor config");
        app = app.layer(GovernorLayer::new(governor_config));
    } else {
        tracing::warn!("Rate limiting middleware disabled");
    }

    let socket_addr: SocketAddr = format!("{}:{}", state.config.host, state.config.port).parse()?;
    let listener = tokio::net::TcpListener::bind(socket_addr).await?;

    if state.config.scheduler_enabled {
        let sched_state = state.clone();
        tokio::spawn(services::scheduler::run_background_scheduler(sched_state));
        tracing::info!("Background scheduler enabled");
    }

    if state.db_pool.is_some() {
        let invalidation_state = state.clone();
        tokio::spawn(cache_invalidation::spawn_listener(invalidation_state));
    }

    tracing::info!(
        app_name = %state.config.app_name,
        environment = %state.config.environment,
        api_prefix = %state.config.api_prefix,
        docs_enabled_runtime = state.config.docs_enabled_runtime(),
        "Rust backend listening"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to register SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {},
            _ = sigterm.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        ctrl_c.await.ok();
    }
    tracing::info!("Shutdown signal received, finishing in-flight requests");
}

fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .compact()
        .init();
}
