#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

BACKEND_EXEC_ROLE_NAME="${BACKEND_EXEC_ROLE_NAME:-casaora-backend-task-execution-role}"
BACKEND_TASK_ROLE_NAME="${BACKEND_TASK_ROLE_NAME:-casaora-backend-task-role}"
ADMIN_EXEC_ROLE_NAME="${ADMIN_EXEC_ROLE_NAME:-casaora-admin-task-execution-role}"
ADMIN_TASK_ROLE_NAME="${ADMIN_TASK_ROLE_NAME:-casaora-admin-task-role}"
WEB_EXEC_ROLE_NAME="${WEB_EXEC_ROLE_NAME:-casaora-web-task-execution-role}"
WEB_TASK_ROLE_NAME="${WEB_TASK_ROLE_NAME:-casaora-web-task-role}"

SECRETS_PREFIX="${SECRETS_PREFIX:-casaora/}"
SSM_PREFIX="${SSM_PREFIX:-/casaora/}"
STORAGE_PUBLIC_BUCKET_NAME="${STORAGE_PUBLIC_BUCKET_NAME:-casaora-prod-public-media-341112583495}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

cleanup() {
  [[ -n "${TRUST_FILE:-}" && -f "${TRUST_FILE}" ]] && rm -f "${TRUST_FILE}"
  [[ -n "${EXEC_POLICY_FILE:-}" && -f "${EXEC_POLICY_FILE}" ]] && rm -f "${EXEC_POLICY_FILE}"
  [[ -n "${BACKEND_S3_POLICY_FILE:-}" && -f "${BACKEND_S3_POLICY_FILE}" ]] && rm -f "${BACKEND_S3_POLICY_FILE}"
}
trap cleanup EXIT

ACCOUNT_ID="$(aws_cmd sts get-caller-identity --query Account --output text)"

TRUST_FILE="$(mktemp)"
cat > "${TRUST_FILE}" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

BACKEND_S3_POLICY_FILE="$(mktemp)"
cat > "${BACKEND_S3_POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicMediaUploads",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::${STORAGE_PUBLIC_BUCKET_NAME}/*"
    },
    {
      "Sid": "AllowPublicMediaList",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::${STORAGE_PUBLIC_BUCKET_NAME}"
    }
  ]
}
EOF

EXEC_POLICY_FILE="$(mktemp)"
cat > "${EXEC_POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSecretsManagerForCasaora",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SECRETS_PREFIX}*"
    },
    {
      "Sid": "ReadSsmParametersForCasaora",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}*"
    },
    {
      "Sid": "DecryptForSecretsAndParameters",
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "*"
    }
  ]
}
EOF

ensure_role() {
  local role_name="$1"
  local attach_managed_exec="${2:-false}"

  if aws_cmd iam get-role --role-name "${role_name}" >/dev/null 2>&1; then
    echo "Role exists, updating trust policy: ${role_name}" >&2
    aws_cmd iam update-assume-role-policy \
      --role-name "${role_name}" \
      --policy-document "file://${TRUST_FILE}"
  else
    echo "Creating role: ${role_name}" >&2
    aws_cmd iam create-role \
      --role-name "${role_name}" \
      --assume-role-policy-document "file://${TRUST_FILE}" \
      --description "ECS task role for Casaora" \
      --tags Key=Project,Value=Casaora Key=Environment,Value=production \
      >/dev/null
  fi

  if [[ "${attach_managed_exec}" == "true" ]]; then
    aws_cmd iam attach-role-policy \
      --role-name "${role_name}" \
      --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" \
      >/dev/null 2>&1 || true
    aws_cmd iam put-role-policy \
      --role-name "${role_name}" \
      --policy-name "CasaoraEcsExecutionSecretsAccess" \
      --policy-document "file://${EXEC_POLICY_FILE}" \
      >/dev/null
  fi

  aws_cmd iam get-role --role-name "${role_name}" \
    --query 'Role.{name:RoleName,arn:Arn}' \
    --output json
}

echo "==> Bootstrapping ECS IAM roles"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"
echo "Account: ${ACCOUNT_ID}"

echo "==> Backend execution role"
backend_exec_json="$(ensure_role "${BACKEND_EXEC_ROLE_NAME}" true)"
echo "${backend_exec_json}"

echo "==> Backend task role"
backend_task_json="$(ensure_role "${BACKEND_TASK_ROLE_NAME}" false)"
echo "${backend_task_json}"
aws_cmd iam put-role-policy \
  --role-name "${BACKEND_TASK_ROLE_NAME}" \
  --policy-name "CasaoraBackendS3PublicMediaAccess" \
  --policy-document "file://${BACKEND_S3_POLICY_FILE}" \
  >/dev/null

echo "==> Admin execution role"
admin_exec_json="$(ensure_role "${ADMIN_EXEC_ROLE_NAME}" true)"
echo "${admin_exec_json}"

echo "==> Admin task role"
admin_task_json="$(ensure_role "${ADMIN_TASK_ROLE_NAME}" false)"
echo "${admin_task_json}"

echo "==> Web execution role"
web_exec_json="$(ensure_role "${WEB_EXEC_ROLE_NAME}" true)"
echo "${web_exec_json}"

echo "==> Web task role"
web_task_json="$(ensure_role "${WEB_TASK_ROLE_NAME}" false)"
echo "${web_task_json}"

echo "==> ECS IAM role summary"
jq -n \
  --arg account_id "${ACCOUNT_ID}" \
  --argjson backend_exec "${backend_exec_json}" \
  --argjson backend_task "${backend_task_json}" \
  --argjson admin_exec "${admin_exec_json}" \
  --argjson admin_task "${admin_task_json}" \
  --argjson web_exec "${web_exec_json}" \
  --argjson web_task "${web_task_json}" \
  '{
    account_id: $account_id,
    backend: {
      execution_role: $backend_exec,
      task_role: $backend_task
    },
    admin: {
      execution_role: $admin_exec,
      task_role: $admin_task
    },
    web: {
      execution_role: $web_exec,
      task_role: $web_task
    }
  }'
