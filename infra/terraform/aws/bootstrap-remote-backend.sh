#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
STATE_BUCKET="${STATE_BUCKET:-}"
LOCK_TABLE="${LOCK_TABLE:-${NAME_PREFIX}-terraform-locks}"
STATE_KEY="${STATE_KEY:-casaora/prod/foundation.tfstate}"
TF_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_HCL_PATH="${BACKEND_HCL_PATH:-${TF_DIR}/backend.hcl}"
RUN_TERRAFORM_INIT="${RUN_TERRAFORM_INIT:-true}"

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

if [[ -z "${STATE_BUCKET}" ]]; then
  account_id="$(aws_cmd sts get-caller-identity --query Account --output text)"
  STATE_BUCKET="${NAME_PREFIX}-terraform-state-${account_id}"
else
  account_id="$(aws_cmd sts get-caller-identity --query Account --output text)"
fi

bucket_exists() {
  aws_cmd s3api head-bucket --bucket "${STATE_BUCKET}" >/dev/null 2>&1
}

table_exists() {
  local status
  status="$(aws_cmd dynamodb describe-table --table-name "${LOCK_TABLE}" --query 'Table.TableStatus' --output text 2>/dev/null || true)"
  [[ "${status}" == "ACTIVE" || "${status}" == "CREATING" || "${status}" == "UPDATING" ]]
}

echo "==> Terraform remote backend bootstrap"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"
echo "Account: ${account_id}"
echo "State bucket: ${STATE_BUCKET}"
echo "Lock table: ${LOCK_TABLE}"
echo "State key: ${STATE_KEY}"

if bucket_exists; then
  echo "S3 bucket exists: ${STATE_BUCKET}" >&2
else
  echo "Creating S3 bucket: ${STATE_BUCKET}" >&2
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws_cmd s3api create-bucket --bucket "${STATE_BUCKET}" >/dev/null
  else
    aws_cmd s3api create-bucket \
      --bucket "${STATE_BUCKET}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
fi

aws_cmd s3api put-bucket-versioning \
  --bucket "${STATE_BUCKET}" \
  --versioning-configuration Status=Enabled >/dev/null

aws_cmd s3api put-bucket-encryption \
  --bucket "${STATE_BUCKET}" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" }
    }]
  }' >/dev/null

aws_cmd s3api put-public-access-block \
  --bucket "${STATE_BUCKET}" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }' >/dev/null

if table_exists; then
  echo "DynamoDB lock table exists: ${LOCK_TABLE}" >&2
else
  echo "Creating DynamoDB lock table: ${LOCK_TABLE}" >&2
  aws_cmd dynamodb create-table \
    --table-name "${LOCK_TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=Project,Value=Casaora Key=Environment,Value=production \
    >/dev/null
  aws_cmd dynamodb wait table-exists --table-name "${LOCK_TABLE}"
fi

cat > "${BACKEND_HCL_PATH}" <<EOF
bucket         = "${STATE_BUCKET}"
key            = "${STATE_KEY}"
region         = "${REGION}"
profile        = "${PROFILE}"
dynamodb_table = "${LOCK_TABLE}"
encrypt        = true
EOF

echo "Wrote backend config: ${BACKEND_HCL_PATH}" >&2

if [[ "${RUN_TERRAFORM_INIT}" == "true" ]]; then
  if ! command -v terraform >/dev/null 2>&1; then
    echo "terraform not found; skipping init (backend resources are ready)." >&2
  else
    echo "==> terraform init -migrate-state"
    terraform -chdir="${TF_DIR}" init -input=false -migrate-state -backend-config="${BACKEND_HCL_PATH}"
  fi
fi

jq -n \
  --arg account_id "${account_id}" \
  --arg region "${REGION}" \
  --arg profile "${PROFILE}" \
  --arg bucket "${STATE_BUCKET}" \
  --arg lock_table "${LOCK_TABLE}" \
  --arg key "${STATE_KEY}" \
  --arg backend_hcl_path "${BACKEND_HCL_PATH}" \
  '{
    account_id: $account_id,
    region: $region,
    profile: $profile,
    backend: {
      bucket: $bucket,
      key: $key,
      dynamodb_lock_table: $lock_table,
      backend_hcl_path: $backend_hcl_path
    }
  }'
