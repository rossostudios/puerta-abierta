#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

DB_INSTANCE_ID="${DB_INSTANCE_ID:-casaora-prod-postgres}"
DB_NAME="${DB_NAME:-casaora}"
DB_MASTER_USERNAME="${DB_MASTER_USERNAME:-casaoraapp}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t4g.micro}"
ENGINE="${ENGINE:-postgres}"
ENGINE_VERSION="${ENGINE_VERSION:-}"
ALLOCATED_STORAGE_GB="${ALLOCATED_STORAGE_GB:-20}"
MAX_ALLOCATED_STORAGE_GB="${MAX_ALLOCATED_STORAGE_GB:-100}"
STORAGE_TYPE="${STORAGE_TYPE:-gp3}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
SECRET_NAME_MASTER_PASSWORD="${SECRET_NAME_MASTER_PASSWORD:-casaora/rds/master_password}"
SECRET_NAME_DATABASE_URL="${SECRET_NAME_DATABASE_URL:-casaora/rds/DATABASE_URL}"
DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME:-casaora-prod-db-subnet-group}"
RDS_SECURITY_GROUP_ID="${RDS_SECURITY_GROUP_ID:-sg-0a09a86680d6e629a}"
MULTI_AZ="${MULTI_AZ:-true}"

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
require_bin openssl

describe_instance() {
  aws_cmd rds describe-db-instances \
    --db-instance-identifier "${DB_INSTANCE_ID}" \
    --query 'DBInstances[0]' --output json 2>/dev/null || true
}

ensure_secret_string() {
  local secret_name="$1"
  local secret_value="$2"
  local arn
  arn="$(aws_cmd secretsmanager describe-secret --secret-id "${secret_name}" --query 'ARN' --output text 2>/dev/null || true)"
  if [[ -z "${arn}" || "${arn}" == "None" ]]; then
    arn="$(aws_cmd secretsmanager create-secret \
      --name "${secret_name}" \
      --secret-string "${secret_value}" \
      --tags Key=Project,Value=Casaora Key=Component,Value=rds \
      --query 'ARN' --output text)"
    echo "created secret: ${secret_name}" >&2
  else
    aws_cmd secretsmanager put-secret-value --secret-id "${secret_name}" --secret-string "${secret_value}" >/dev/null
    echo "updated secret: ${secret_name}" >&2
  fi
  printf '%s' "${arn}"
}

existing_json="$(describe_instance)"
if [[ -z "${existing_json}" ]]; then
  master_password="$(openssl rand -hex 16)"
  if [[ -z "${master_password}" ]]; then
    echo "failed to generate master password" >&2
    exit 1
  fi
  master_password_secret_arn="$(ensure_secret_string "${SECRET_NAME_MASTER_PASSWORD}" "${master_password}")"
  echo "==> Creating RDS instance ${DB_INSTANCE_ID} (${DB_INSTANCE_CLASS}, multi_az=${MULTI_AZ})"
  create_args=(
    rds create-db-instance
    --db-instance-identifier "${DB_INSTANCE_ID}"
    --engine "${ENGINE}"
    --db-instance-class "${DB_INSTANCE_CLASS}"
    --allocated-storage "${ALLOCATED_STORAGE_GB}"
    --max-allocated-storage "${MAX_ALLOCATED_STORAGE_GB}"
    --storage-type "${STORAGE_TYPE}"
    --storage-encrypted
    --db-name "${DB_NAME}"
    --master-username "${DB_MASTER_USERNAME}"
    --master-user-password "${master_password}"
    --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}"
    --vpc-security-group-ids "${RDS_SECURITY_GROUP_ID}"
    --backup-retention-period "${BACKUP_RETENTION_DAYS}"
    --copy-tags-to-snapshot
    --no-publicly-accessible
    --no-deletion-protection
    --no-enable-performance-insights
    --auto-minor-version-upgrade
    --tags Key=Name,Value="${DB_INSTANCE_ID}" Key=Project,Value=Casaora Key=Environment,Value=production
  )
  if [[ -n "${ENGINE_VERSION}" ]]; then
    create_args+=(--engine-version "${ENGINE_VERSION}")
  fi
  if [[ "${MULTI_AZ}" == "true" ]]; then
    create_args+=(--multi-az)
  fi
  aws_cmd "${create_args[@]}" >/dev/null
else
  master_password_secret_arn="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_NAME_MASTER_PASSWORD}" --query 'ARN' --output text)"
  master_password="$(aws_cmd secretsmanager get-secret-value --secret-id "${SECRET_NAME_MASTER_PASSWORD}" --query 'SecretString' --output text)"
  echo "RDS instance already exists: ${DB_INSTANCE_ID}" >&2
fi

echo "==> Waiting for RDS instance availability"
aws_cmd rds wait db-instance-available --db-instance-identifier "${DB_INSTANCE_ID}"

db_json="$(describe_instance)"
endpoint="$(printf '%s' "${db_json}" | jq -r '.Endpoint.Address')"
port="$(printf '%s' "${db_json}" | jq -r '.Endpoint.Port')"
engine_version="$(printf '%s' "${db_json}" | jq -r '.EngineVersion')"
status="$(printf '%s' "${db_json}" | jq -r '.DBInstanceStatus')"
multi_az_actual="$(printf '%s' "${db_json}" | jq -r '.MultiAZ')"

db_url="postgresql://${DB_MASTER_USERNAME}:${master_password}@${endpoint}:${port}/${DB_NAME}?sslmode=require"
db_url_secret_arn="$(ensure_secret_string "${SECRET_NAME_DATABASE_URL}" "${db_url}")"

jq -n \
  --arg db_instance_id "${DB_INSTANCE_ID}" \
  --arg status "${status}" \
  --arg endpoint "${endpoint}" \
  --arg port "${port}" \
  --arg engine "${ENGINE}" \
  --arg engine_version "${engine_version}" \
  --arg db_name "${DB_NAME}" \
  --arg db_master_username "${DB_MASTER_USERNAME}" \
  --argjson multi_az "${multi_az_actual}" \
  --arg master_password_secret_arn "${master_password_secret_arn}" \
  --arg db_url_secret_arn "${db_url_secret_arn}" \
  '{
    db_instance_id: $db_instance_id,
    status: $status,
    engine: $engine,
    engine_version: $engine_version,
    endpoint: $endpoint,
    port: ($port | tonumber),
    db_name: $db_name,
    db_master_username: $db_master_username,
    multi_az: $multi_az,
    secrets: {
      master_password: $master_password_secret_arn,
      database_url: $db_url_secret_arn
    }
  }'
