#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-full}"

echo "==> Puerta Abierta quality gate (${MODE})"

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

echo "==> Backend checks"
(
  cd "${ROOT_DIR}/apps/backend"
  if [[ ! -x "./.venv/bin/python" ]]; then
    echo "Missing backend virtualenv at apps/backend/.venv"
    exit 1
  fi
  ./.venv/bin/python -m ruff check app tests
  ./.venv/bin/python -m unittest discover -s tests -p "test_*.py"
)

echo "==> Quality gate passed"
