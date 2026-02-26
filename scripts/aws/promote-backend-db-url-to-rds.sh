#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
SOURCE_SECRET_NAME="${SOURCE_SECRET_NAME:-casaora/rds/DATABASE_URL}"
TARGET_SECRET_NAME="${TARGET_SECRET_NAME:-casaora/backend/DATABASE_URL}"

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

source_value="$(aws_cmd secretsmanager get-secret-value --secret-id "${SOURCE_SECRET_NAME}" --query 'SecretString' --output text)"
if [[ -z "${source_value}" || "${source_value}" == "None" ]]; then
  echo "source secret is empty: ${SOURCE_SECRET_NAME}" >&2
  exit 1
fi

target_arn="$(aws_cmd secretsmanager describe-secret --secret-id "${TARGET_SECRET_NAME}" --query 'ARN' --output text)"
aws_cmd secretsmanager put-secret-value --secret-id "${TARGET_SECRET_NAME}" --secret-string "${source_value}" >/dev/null

jq -n \
  --arg source_secret "${SOURCE_SECRET_NAME}" \
  --arg target_secret "${TARGET_SECRET_NAME}" \
  --arg target_arn "${target_arn}" \
  '{updated: true, source_secret: $source_secret, target_secret: $target_secret, target_arn: $target_arn}'

