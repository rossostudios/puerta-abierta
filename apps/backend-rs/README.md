# Casaora Rust Backend

Primary API backend built with Axum + SQLx, serving all `/v1` endpoints for the Casaora platform.

## Run locally

```bash
cd /Users/christopher/Desktop/puerta-abierta/apps/backend-rs
cp .env.example .env
cargo run
```

The server listens on port `8000` by default. Override with the `PORT` environment variable.
