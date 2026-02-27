use std::time::Duration;

use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
    PgPool,
};
use url::Url;

use crate::{config::AppConfig, error::AppError};

pub fn create_pool(config: &AppConfig) -> Result<Option<PgPool>, AppError> {
    let Some(database_url) = config.database_url.as_ref() else {
        return Ok(None);
    };

    // Parse the URL manually so we preserve the full username and still honor
    // SQLx/libpq query parameters (e.g. statement-cache-capacity).
    let url = Url::parse(database_url)
        .map_err(|e| AppError::Dependency(format!("Invalid database URL: {e}")))?;

    let mut username = url.username().to_string();
    let mut password = url.password().unwrap_or("").to_string();
    let mut host = url.host_str().unwrap_or("localhost").to_string();
    let mut port = url.port().unwrap_or(5432);
    let mut database = url.path().trim_start_matches('/').to_string();

    // Default to Require for managed Postgres / pooler connections.
    let mut ssl_mode = PgSslMode::Require;
    let mut statement_cache_capacity: Option<usize> = None;
    let mut application_name: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "sslmode" | "ssl-mode" => {
                ssl_mode = match value.as_ref() {
                    "allow" => PgSslMode::Allow,
                    "disable" => PgSslMode::Disable,
                    "prefer" => PgSslMode::Prefer,
                    "require" => PgSslMode::Require,
                    "verify-ca" => PgSslMode::VerifyCa,
                    "verify-full" => PgSslMode::VerifyFull,
                    raw => {
                        tracing::warn!(sslmode = raw, "Invalid sslmode in DB URL; using require");
                        PgSslMode::Require
                    }
                };
            }
            "statement-cache-capacity" => {
                statement_cache_capacity = Some(value.parse::<usize>().map_err(|_| {
                    AppError::Dependency(format!(
                        "Invalid statement-cache-capacity in DB URL: {value}"
                    ))
                })?);
            }
            "application_name" => {
                application_name = Some(value.into_owned());
            }
            // Support libpq-style overrides from query params.
            "host" | "hostaddr" => {
                host = value.into_owned();
            }
            "port" => {
                port = value.parse::<u16>().map_err(|_| {
                    AppError::Dependency(format!("Invalid port in DB URL query: {value}"))
                })?;
            }
            "dbname" => {
                database = value.into_owned();
            }
            "user" => {
                username = value.into_owned();
            }
            "password" => {
                password = value.into_owned();
            }
            _ => {}
        }
    }

    // PgBouncer transaction mode (pooler :6543) is incompatible with
    // prepared statement caching unless disabled.
    let auto_disabled_statement_cache = statement_cache_capacity.is_none() && port == 6543;
    if auto_disabled_statement_cache {
        statement_cache_capacity = Some(0);
    }

    tracing::info!(
        db_user = username,
        db_host = host,
        db_port = port,
        db_name = database,
        ssl_mode = ?ssl_mode,
        statement_cache_capacity = statement_cache_capacity.unwrap_or(100),
        pgbouncer_transaction_mode = auto_disabled_statement_cache,
        "Configuring database pool"
    );

    let mut connect_options = PgConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&username)
        .password(&password)
        .ssl_mode(ssl_mode);

    if !database.is_empty() {
        connect_options = connect_options.database(&database);
    }

    if let Some(capacity) = statement_cache_capacity {
        connect_options = connect_options.statement_cache_capacity(capacity);
    }

    if let Some(app_name) = application_name.as_deref() {
        connect_options = connect_options.application_name(app_name);
    }

    let pool = PgPoolOptions::new()
        .max_connections(config.db_pool_max_connections)
        .min_connections(config.db_pool_min_connections)
        .acquire_timeout(Duration::from_secs(config.db_pool_acquire_timeout_seconds))
        .idle_timeout(Duration::from_secs(config.db_pool_idle_timeout_seconds))
        .test_before_acquire(true)
        .connect_lazy_with(connect_options);

    Ok(Some(pool))
}

pub async fn probe_pool(pool: &PgPool, timeout: Duration) -> Result<(), AppError> {
    match tokio::time::timeout(timeout, sqlx::query("SELECT 1").fetch_one(pool)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => Err(AppError::from_database_error(
            &error,
            "Database connectivity check failed.",
        )),
        Err(_) => Err(AppError::from_database_error_message(
            "database connectivity check timed out",
            "Database connectivity check timed out.",
        )),
    }
}
