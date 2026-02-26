#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-full}"

echo "==> Casaora quality gate (${MODE})"

if [[ "${MODE}" != "backend" ]]; then
  echo "==> Admin checks"
  (
    cd "${ROOT_DIR}/apps/admin"
    npm run brand:check
    npm run deadcode:check
    npm run lint
    npm run typecheck
    if [[ "${MODE}" == "full" ]]; then
      npm run build
    fi
  )
fi

if [[ "${MODE}" != "backend" && -d "${ROOT_DIR}/apps/web" ]]; then
  echo "==> Web site checks"
  (
    cd "${ROOT_DIR}/apps/web"
    npm run lint
    npm run typecheck
    if [[ "${MODE}" == "full" ]]; then
      npm run build
    fi
  )
fi

if [[ -d "${ROOT_DIR}/apps/backend-rs" ]]; then
  echo "==> Rust backend checks"
  (
    cd "${ROOT_DIR}/apps/backend-rs"
    cargo fmt --all --check
    cargo clippy --all-targets --all-features -- -D warnings
    cargo test --all-targets --all-features
  )
fi

echo "==> Quality gate passed"
