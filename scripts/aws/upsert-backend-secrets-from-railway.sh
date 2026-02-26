#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

WORKSPACE_PATH="${WORKSPACE_PATH:-apps/backend-rs}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-casaora}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
SECRET_PREFIX="${SECRET_PREFIX:-casaora/backend}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_bin railway
require_bin jq
require_bin "${AWS_BIN}"

tmp_vars="$(mktemp)"
trap 'rm -f "$tmp_vars"' EXIT

echo "==> Reading Railway variables (${RAILWAY_SERVICE}/${RAILWAY_ENVIRONMENT})"
(
  cd "${WORKSPACE_PATH}"
  railway variable list \
    --service "${RAILWAY_SERVICE}" \
    --environment "${RAILWAY_ENVIRONMENT}" \
    --json > "${tmp_vars}"
)

jq -e 'type == "object"' "${tmp_vars}" >/dev/null

get_var() {
  local key="$1"
  jq -r --arg key "$key" '.[$key] // empty' "${tmp_vars}"
}

upsert_secret() {
  local secret_name="$1"
  local secret_value="$2"
  local required="${3:-true}"
  local arn

  if [[ -z "${secret_value}" ]]; then
    if [[ "${required}" == "true" ]]; then
      echo "required source value missing for secret: ${secret_name}" >&2
      exit 1
    fi
    echo "skip (missing optional source): ${secret_name}"
    return 0
  fi

  arn="$(aws_cmd secretsmanager describe-secret \
    --secret-id "${secret_name}" \
    --query 'ARN' --output text 2>/dev/null || true)"

  if [[ -z "${arn}" || "${arn}" == "None" ]]; then
    arn="$(aws_cmd secretsmanager create-secret \
      --name "${secret_name}" \
      --secret-string "${secret_value}" \
      --tags Key=Project,Value=Casaora Key=Component,Value=backend \
      --query 'ARN' --output text)"
    echo "created: ${secret_name}"
  else
    aws_cmd secretsmanager put-secret-value \
      --secret-id "${secret_name}" \
      --secret-string "${secret_value}" >/dev/null
    echo "updated: ${secret_name}"
  fi

  echo "${secret_name}=${arn}" >> "${tmp_summary}"
}

tmp_summary="$(mktemp)"
trap 'rm -f "$tmp_vars" "$tmp_summary"' EXIT

db_url="$(get_var SUPABASE_DB_URL)"
openai_api_key="$(get_var OPENAI_API_KEY)"
supabase_service_role_key="$(get_var SUPABASE_SERVICE_ROLE_KEY)"
internal_api_key="$(get_var INTERNAL_API_KEY)"

upsert_secret "${SECRET_PREFIX}/DATABASE_URL" "${db_url}" true
upsert_secret "${SECRET_PREFIX}/OPENAI_API_KEY" "${openai_api_key}" true
upsert_secret "${SECRET_PREFIX}/SUPABASE_SERVICE_ROLE_KEY" "${supabase_service_role_key}" true
upsert_secret "${SECRET_PREFIX}/INTERNAL_API_KEY" "${internal_api_key}" true

echo "==> Secrets summary (names + ARNs only)"
jq -Rn '
  [inputs | select(length > 0) | split("=") | {name: .[0], arn: .[1]}]
' < "${tmp_summary}"

