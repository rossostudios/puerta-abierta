#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.db-migration.json}"
TASK_FAMILY="${TASK_FAMILY:-casaora-db-migration}"
CONTAINER_NAME="${CONTAINER_NAME:-pg-migrator}"
NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"
SOURCE_DB_SECRET_NAME="${SOURCE_DB_SECRET_NAME:-casaora/backend/DATABASE_URL}"
TARGET_DB_SECRET_NAME="${TARGET_DB_SECRET_NAME:-casaora/rds/DATABASE_URL}"
LOG_GROUP_NAME="${LOG_GROUP_NAME:-/ecs/casaora-db-migration}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

secret_arn() {
  local secret_name="$1"
  aws_cmd secretsmanager describe-secret --secret-id "${secret_name}" --query 'ARN' --output text
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_bin "${AWS_BIN}"
require_bin jq

aws_cmd logs create-log-group --log-group-name "${LOG_GROUP_NAME}" >/dev/null 2>&1 || true
aws_cmd logs put-retention-policy --log-group-name "${LOG_GROUP_NAME}" --retention-in-days 30 >/dev/null

vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${VPC_NAME}" --query 'Vpcs[0].VpcId' --output text)"
ecs_sg_id="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ECS_SG_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
subnets_json="$(aws_cmd ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
  --query 'Subnets[].{id:SubnetId,az:AvailabilityZone}' --output json | jq 'sort_by(.az) | .[:2]')"
subnet_a="$(echo "${subnets_json}" | jq -r '.[0].id')"
subnet_b="$(echo "${subnets_json}" | jq -r '.[1].id')"

src_secret_arn="$(secret_arn "${SOURCE_DB_SECRET_NAME}")"
dst_secret_arn="$(secret_arn "${TARGET_DB_SECRET_NAME}")"

tmp_taskdef="$(mktemp)"
trap 'rm -f "${tmp_taskdef}"' EXIT

jq \
  --arg src_secret_arn "${src_secret_arn}" \
  --arg dst_secret_arn "${dst_secret_arn}" \
  '
    .containerDefinitions[0].secrets |= map(
      if .name == "SOURCE_DATABASE_URL" then .valueFrom = $src_secret_arn
      elif .name == "TARGET_DATABASE_URL" then .valueFrom = $dst_secret_arn
      else .
      end
    )
  ' "${TASKDEF_TEMPLATE}" > "${tmp_taskdef}"

taskdef_arn="$(aws_cmd ecs register-task-definition \
  --cli-input-json "file://${tmp_taskdef}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"

echo "Task definition: ${taskdef_arn}"

run_json="$(aws_cmd ecs run-task \
  --cluster "${CLUSTER_NAME}" \
  --launch-type FARGATE \
  --platform-version LATEST \
  --task-definition "${taskdef_arn}" \
  --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[${subnet_a},${subnet_b}],securityGroups=[${ecs_sg_id}],assignPublicIp=ENABLED}" \
  --query '{tasks:tasks[].{taskArn:taskArn,lastStatus:lastStatus},failures:failures}' \
  --output json)"

task_arn="$(printf '%s' "${run_json}" | jq -r '.tasks[0].taskArn // empty')"
if [[ -z "${task_arn}" ]]; then
  echo "Failed to start migration task" >&2
  printf '%s\n' "${run_json}" >&2
  exit 1
fi

task_id="${task_arn##*/}"
log_stream_name="ecs/${CONTAINER_NAME}/${task_id}"

echo "==> Waiting for migration task to stop: ${task_arn}"
aws_cmd ecs wait tasks-stopped --cluster "${CLUSTER_NAME}" --tasks "${task_arn}"

task_desc="$(aws_cmd ecs describe-tasks --cluster "${CLUSTER_NAME}" --tasks "${task_arn}" --output json)"
exit_code="$(printf '%s' "${task_desc}" | jq -r '.tasks[0].containers[0].exitCode // empty')"
stop_reason="$(printf '%s' "${task_desc}" | jq -r '.tasks[0].stoppedReason // empty')"
container_reason="$(printf '%s' "${task_desc}" | jq -r '.tasks[0].containers[0].reason // empty')"

echo "==> Migration task logs"
aws_cmd logs get-log-events \
  --log-group-name "${LOG_GROUP_NAME}" \
  --log-stream-name "${log_stream_name}" \
  --limit 200 \
  --query 'events[].message' --output text || true

jq -n \
  --arg task_arn "${task_arn}" \
  --arg task_definition_arn "${taskdef_arn}" \
  --arg log_group_name "${LOG_GROUP_NAME}" \
  --arg log_stream_name "${log_stream_name}" \
  --arg exit_code "${exit_code}" \
  --arg stop_reason "${stop_reason}" \
  --arg container_reason "${container_reason}" \
  '{
    task_arn: $task_arn,
    task_definition_arn: $task_definition_arn,
    log_group_name: $log_group_name,
    log_stream_name: $log_stream_name,
    exit_code: (if $exit_code == "" then null else ($exit_code | tonumber) end),
    stop_reason: (if $stop_reason == "" then null else $stop_reason end),
    container_reason: (if $container_reason == "" then null else $container_reason end)
  }'

if [[ -z "${exit_code}" || "${exit_code}" != "0" ]]; then
  exit 2
fi

