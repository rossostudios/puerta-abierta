# syntax=docker/dockerfile:1.7

FROM rust:1.91-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependency compilation: copy manifests first with a dummy main.rs
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release --locked && \
    rm -rf src \
           target/release/.fingerprint/casaora-backend-rs* \
           target/release/deps/casaora_backend_rs* \
           target/release/casaora-backend-rs

# Now copy real source and rebuild (only app code recompiles)
COPY src ./src
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

ENV HOST=0.0.0.0 \
    PORT=8000 \
    RUST_LOG=info

WORKDIR /srv

COPY --from=builder /app/target/release/casaora-backend-rs /usr/local/bin/casaora-backend-rs

EXPOSE 8000

CMD ["casaora-backend-rs"]
