#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
BASE_TASKDEF_TEMPLATE="${BASE_TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.db-migration.json}"
TASK_FAMILY="${TASK_FAMILY:-casaora-rds-sql}"
CONTAINER_NAME="${CONTAINER_NAME:-pg-migrator}"
NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"
TARGET_DB_SECRET_NAME="${TARGET_DB_SECRET_NAME:-casaora/rds/DATABASE_URL}"
LOG_GROUP_NAME="${LOG_GROUP_NAME:-/ecs/casaora-rds-sql}"
SQL_FILE="${SQL_FILE:-}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

secret_arn() {
  local secret_name="$1"
  aws_cmd secretsmanager describe-secret --secret-id "${secret_name}" --query 'ARN' --output text
}

if [[ -z "${SQL_FILE}" ]]; then
  echo "Set SQL_FILE=/absolute/or/repo-relative/path.sql" >&2
  exit 1
fi

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "SQL file not found: ${SQL_FILE}" >&2
  exit 1
fi

require_bin "${AWS_BIN}"
require_bin jq
require_bin base64

aws_cmd logs create-log-group --log-group-name "${LOG_GROUP_NAME}" >/dev/null 2>&1 || true
aws_cmd logs put-retention-policy --log-group-name "${LOG_GROUP_NAME}" --retention-in-days 30 >/dev/null

vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${VPC_NAME}" --query 'Vpcs[0].VpcId' --output text)"
ecs_sg_id="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ECS_SG_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
subnets_json="$(aws_cmd ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
  --query 'Subnets[].{id:SubnetId,az:AvailabilityZone}' --output json | jq 'sort_by(.az) | .[:2]')"
subnet_a="$(echo "${subnets_json}" | jq -r '.[0].id')"
subnet_b="$(echo "${subnets_json}" | jq -r '.[1].id')"

dst_secret_arn="$(secret_arn "${TARGET_DB_SECRET_NAME}")"
sql_b64="$(base64 < "${SQL_FILE}" | tr -d '\n')"
sql_basename="$(basename "${SQL_FILE}")"

run_command="$(cat <<'SH'
set -euo pipefail
echo "$SQL_B64" | base64 -d >/tmp/migration.sql
echo "running SQL from $SQL_BASENAME"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/migration.sql
psql "$TARGET_DATABASE_URL" -Atqc "select 'applied'" >/dev/null
echo "sql_task_status|ok"
SH
)"

tmp_taskdef="$(mktemp)"
trap 'rm -f "${tmp_taskdef}"' EXIT

jq \
  --arg family "${TASK_FAMILY}" \
  --arg log_group "${LOG_GROUP_NAME}" \
  --arg dst_secret_arn "${dst_secret_arn}" \
  --arg cmd_script "${run_command}" \
  --arg sql_b64 "${sql_b64}" \
  --arg sql_basename "${sql_basename}" \
  '
    .family = $family
    | .containerDefinitions[0].logConfiguration.options["awslogs-group"] = $log_group
    | .containerDefinitions[0].command = ["sh","-lc",$cmd_script]
    | .containerDefinitions[0].environment = [
        {"name":"SQL_B64","value":$sql_b64},
        {"name":"SQL_BASENAME","value":$sql_basename}
      ]
    | .containerDefinitions[0].secrets |= (
        map(select(.name != "SOURCE_DATABASE_URL"))
        | map(
            if .name == "TARGET_DATABASE_URL" then .valueFrom = $dst_secret_arn
            else .
            end
          )
      )
  ' "${BASE_TASKDEF_TEMPLATE}" > "${tmp_taskdef}"

taskdef_arn="$(aws_cmd ecs register-task-definition \
  --cli-input-json "file://${tmp_taskdef}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"

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
task_id="${task_arn##*/}"
log_stream_name="ecs/${CONTAINER_NAME}/${task_id}"

echo "==> Waiting for SQL task to stop: ${task_arn}"
aws_cmd ecs wait tasks-stopped --cluster "${CLUSTER_NAME}" --tasks "${task_arn}"

task_desc="$(aws_cmd ecs describe-tasks --cluster "${CLUSTER_NAME}" --tasks "${task_arn}" --output json)"
exit_code="$(printf '%s' "${task_desc}" | jq -r '.tasks[0].containers[0].exitCode // empty')"

echo "==> SQL task logs"
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
  '{task_arn:$task_arn,task_definition_arn:$task_definition_arn,log_group_name:$log_group_name,log_stream_name:$log_stream_name,exit_code:(if $exit_code=="" then null else ($exit_code|tonumber) end)}'

if [[ -z "${exit_code}" || "${exit_code}" != "0" ]]; then
  exit 2
fi
