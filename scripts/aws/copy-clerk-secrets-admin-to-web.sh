#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

SOURCE_PREFIX="${SOURCE_PREFIX:-casaora/admin}"
TARGET_PREFIX="${TARGET_PREFIX:-casaora/web}"

SRC_PUBLISHABLE="${SRC_PUBLISHABLE:-${SOURCE_PREFIX}/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
SRC_SECRET="${SRC_SECRET:-${SOURCE_PREFIX}/CLERK_SECRET_KEY}"
DST_PUBLISHABLE="${DST_PUBLISHABLE:-${TARGET_PREFIX}/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
DST_SECRET="${DST_SECRET:-${TARGET_PREFIX}/CLERK_SECRET_KEY}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_bin "${AWS_BIN}"
require_bin jq

upsert_secret() {
  local name="$1"
  local value="$2"
  if aws_cmd secretsmanager describe-secret --secret-id "${name}" >/dev/null 2>&1; then
    aws_cmd secretsmanager put-secret-value --secret-id "${name}" --secret-string "${value}" >/dev/null
  else
    aws_cmd secretsmanager create-secret \
      --name "${name}" \
      --secret-string "${value}" \
      --tags Key=Project,Value=Casaora Key=Environment,Value=production \
      >/dev/null
  fi
  aws_cmd secretsmanager describe-secret --secret-id "${name}" \
    --query '{name:Name,arn:ARN}' --output json
}

publishable_value="$(aws_cmd secretsmanager get-secret-value --secret-id "${SRC_PUBLISHABLE}" --query 'SecretString' --output text)"
secret_value="$(aws_cmd secretsmanager get-secret-value --secret-id "${SRC_SECRET}" --query 'SecretString' --output text)"

dst_publishable_json="$(upsert_secret "${DST_PUBLISHABLE}" "${publishable_value}")"
dst_secret_json="$(upsert_secret "${DST_SECRET}" "${secret_value}")"

jq -n \
  --arg source_prefix "${SOURCE_PREFIX}" \
  --arg target_prefix "${TARGET_PREFIX}" \
  --argjson publishable "${dst_publishable_json}" \
  --argjson secret "${dst_secret_json}" \
  '{
    copied_from: $source_prefix,
    copied_to: $target_prefix,
    secrets: {
      next_public_clerk_publishable_key: $publishable,
      clerk_secret_key: $secret
    }
  }'
