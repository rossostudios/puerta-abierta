#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load local MCP env first (preferred), then fall back to repo root .env.local if present.
for env_file in "${ROOT_DIR}/.env.mcp.local" "${ROOT_DIR}/.env.local"; do
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
done

if [[ -z "${CLERK_SECRET_KEY:-}" ]]; then
  cat >&2 <<'EOF'
CLERK_SECRET_KEY is not set.

Create /Users/christopher/Desktop/casaora/.env.mcp.local with:
  CLERK_SECRET_KEY=sk_test_... (or sk_live_...)

Then restart Codex so the Clerk MCP server can start.
EOF
  exit 1
fi

exec npx -y @clerk/clerk-mcp@latest
