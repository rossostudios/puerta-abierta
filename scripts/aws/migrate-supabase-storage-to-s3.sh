#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

SECRET_PREFIX="${SECRET_PREFIX:-casaora/backend}"
SUPABASE_SERVICE_ROLE_SECRET_NAME="${SUPABASE_SERVICE_ROLE_SECRET_NAME:-${SECRET_PREFIX}/SUPABASE_SERVICE_ROLE_KEY}"

SUPABASE_URL="${SUPABASE_URL:-}"
SOURCE_BUCKETS="${SOURCE_BUCKETS:-listings}"
TARGET_BUCKET="${TARGET_BUCKET:-casaora-prod-public-media-341112583495}"
REPORT_DIR="${REPORT_DIR:-}"

DRY_RUN="${DRY_RUN:-true}"
SKIP_EXISTING="${SKIP_EXISTING:-true}"
MAX_OBJECTS="${MAX_OBJECTS:-0}"
SOURCE_PREFIX="${SOURCE_PREFIX:-}"
BUCKET_PREFIX_MAP="${BUCKET_PREFIX_MAP:-}"
DOWNLOAD_ENDPOINT_MODE="${DOWNLOAD_ENDPOINT_MODE:-auto}"
VERBOSE="${VERBOSE:-false}"

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

resolve_supabase_url() {
  if [[ -n "${SUPABASE_URL}" ]]; then
    printf '%s' "${SUPABASE_URL}"
    return 0
  fi

  if [[ -f "apps/backend-rs/.env" ]]; then
    local env_url
    env_url="$(grep -E '^SUPABASE_URL=' apps/backend-rs/.env | head -1 | cut -d= -f2- || true)"
    if [[ -n "${env_url}" ]]; then
      printf '%s' "${env_url}"
      return 0
    fi
  fi

  if command -v railway >/dev/null 2>&1; then
    local railway_url
    railway_url="$(
      cd apps/backend-rs && railway variable list --service casaora --environment production --json 2>/dev/null \
        | jq -r '.SUPABASE_URL // empty'
    )"
    if [[ -n "${railway_url}" ]]; then
      printf '%s' "${railway_url}"
      return 0
    fi
  fi

  return 1
}

require_bin python3
require_bin jq
require_bin "${AWS_BIN}"

supabase_url_resolved="$(resolve_supabase_url || true)"
if [[ -z "${supabase_url_resolved}" ]]; then
  echo "Could not resolve SUPABASE_URL. Set SUPABASE_URL explicitly." >&2
  exit 1
fi

supabase_service_role_key="$(
  aws_cmd secretsmanager get-secret-value \
    --secret-id "${SUPABASE_SERVICE_ROLE_SECRET_NAME}" \
    --query 'SecretString' --output text
)"

args=(
  "scripts/aws/migrate-supabase-storage-to-s3.py"
  "--supabase-url" "${supabase_url_resolved}"
  "--supabase-service-role-key" "${supabase_service_role_key}"
  "--source-buckets" "${SOURCE_BUCKETS}"
  "--target-bucket" "${TARGET_BUCKET}"
  "--aws-profile" "${PROFILE}"
  "--aws-region" "${REGION}"
  "--download-endpoint-mode" "${DOWNLOAD_ENDPOINT_MODE}"
)

if [[ -n "${REPORT_DIR}" ]]; then
  args+=("--report-dir" "${REPORT_DIR}")
fi
if [[ -n "${SOURCE_PREFIX}" ]]; then
  args+=("--source-prefix" "${SOURCE_PREFIX}")
fi
if [[ -n "${BUCKET_PREFIX_MAP}" ]]; then
  args+=("--bucket-prefix-map" "${BUCKET_PREFIX_MAP}")
fi
if [[ "${MAX_OBJECTS}" != "0" ]]; then
  args+=("--max-objects" "${MAX_OBJECTS}")
fi
if [[ "${DRY_RUN}" == "true" ]]; then
  args+=("--dry-run")
fi
if [[ "${SKIP_EXISTING}" == "true" ]]; then
  args+=("--skip-existing")
fi
if [[ "${VERBOSE}" == "true" ]]; then
  args+=("--verbose")
fi

echo "==> Supabase Storage -> S3 migration"
echo "Supabase URL: ${supabase_url_resolved}"
echo "Source buckets: ${SOURCE_BUCKETS}"
echo "Target bucket: ${TARGET_BUCKET}"
echo "Dry run: ${DRY_RUN}"
echo "Skip existing: ${SKIP_EXISTING}"
echo "Max objects: ${MAX_OBJECTS}"

python3 "${args[@]}"

