#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"

if [[ -z "${DB_URL}" ]]; then
  echo "DATABASE_URL or SUPABASE_DB_URL is required" >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 2
fi

echo "==> Checking required API schema compatibility"

RESULT="$(psql "${DB_URL}" -Atqc "
SELECT concat_ws(',', 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agent_approvals' AND column_name='kind'
  ) THEN NULL ELSE 'agent_approvals.kind' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agent_approvals' AND column_name='priority'
  ) THEN NULL ELSE 'agent_approvals.priority' END
);
")"

if [[ -n "${RESULT}" ]]; then
  echo "Missing required columns: ${RESULT}" >&2
  exit 1
fi

echo "Schema compatibility check passed"
