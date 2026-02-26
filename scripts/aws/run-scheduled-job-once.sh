#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
TASKDEF_FAMILY="${TASKDEF_FAMILY:-casaora-job-runner}"
CONTAINER_NAME="${CONTAINER_NAME:-casaora-job-runner}"
LOG_GROUP_NAME="${LOG_GROUP_NAME:-/ecs/casaora-job-runner}"
API_BASE_URL="${API_BASE_URL:-https://api.casaora.co}"
WORKFLOW_PROCESS_LIMIT="${WORKFLOW_PROCESS_LIMIT:-100}"
RETENTION_DAYS="${RETENTION_DAYS:-180}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/aws/run-scheduled-job-once.sh --job <name>

Jobs:
  process-notifications
  notifications-retention
  process-workflow-jobs
USAGE
}

JOB_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --job)
      shift
      JOB_NAME="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -z "${JOB_NAME}" ]]; then
  usage
  exit 1
fi

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

build_command_script() {
  case "${JOB_NAME}" in
    process-notifications)
      printf '%s' 'set -eu; endpoint="${API_BASE_URL%/}/v1/internal/process-notifications"; echo "POST ${endpoint}"; curl -sS -f -X POST "$endpoint" -H "accept: application/json" -H "content-type: application/json" -H "x-api-key: ${INTERNAL_API_KEY}"'
      ;;
    notifications-retention)
      printf '%s' "set -eu; endpoint=\"\${API_BASE_URL%/}/v1/internal/notifications-retention\"; echo \"POST \${endpoint}\"; curl -sS -f -X POST \"\$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: \${INTERNAL_API_KEY}\" --data '{\"retention_days\":${RETENTION_DAYS}}'"
      ;;
    process-workflow-jobs)
      printf '%s' "set -eu; endpoint=\"\${API_BASE_URL%/}/v1/internal/process-workflow-jobs?limit=${WORKFLOW_PROCESS_LIMIT}\"; echo \"POST \${endpoint}\"; curl -sS -f -X POST \"\$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: \${INTERNAL_API_KEY}\""
      ;;
    *)
      echo "Unsupported job: ${JOB_NAME}" >&2
      exit 1
      ;;
  esac
}

main() {
  local cluster_arn vpc_id ecs_sg_id subnets_json subnet_a subnet_b
  local command_script overrides_json task_arn task_id

  cluster_arn="$(aws_cmd ecs describe-clusters --clusters "${CLUSTER_NAME}" --query 'clusters[0].clusterArn' --output text)"
  vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${NAME_PREFIX}-vpc" --query 'Vpcs[0].VpcId' --output text)"
  ecs_sg_id="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${NAME_PREFIX}-ecs-sg" --query 'SecurityGroups[0].GroupId' --output text)"
  subnets_json="$(aws_cmd ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
    --query 'Subnets[].{id:SubnetId,az:AvailabilityZone}' --output json | jq 'sort_by(.az) | .[:2]')"
  subnet_a="$(echo "${subnets_json}" | jq -r '.[0].id')"
  subnet_b="$(echo "${subnets_json}" | jq -r '.[1].id')"

  command_script="$(build_command_script)"
  overrides_json="$(jq -cn \
    --arg container "${CONTAINER_NAME}" \
    --arg cmd "${command_script}" \
    --arg api_base "${API_BASE_URL}" \
    '{containerOverrides:[{name:$container, command:[$cmd], environment:[{name:"API_BASE_URL", value:$api_base}]}]}')"

  echo "==> Running ECS job task once (${JOB_NAME})"
  task_arn="$(aws_cmd ecs run-task \
    --cluster "${CLUSTER_NAME}" \
    --launch-type FARGATE \
    --platform-version LATEST \
    --task-definition "${TASKDEF_FAMILY}" \
    --network-configuration "awsvpcConfiguration={subnets=[${subnet_a},${subnet_b}],securityGroups=[${ecs_sg_id}],assignPublicIp=ENABLED}" \
    --overrides "${overrides_json}" \
    --query 'tasks[0].taskArn' --output text)"

  if [[ -z "${task_arn}" || "${task_arn}" == "None" ]]; then
    echo "Task failed to start." >&2
    exit 1
  fi

  task_id="${task_arn##*/}"
  echo "Task ARN: ${task_arn}"

  aws_cmd ecs wait tasks-stopped --cluster "${CLUSTER_NAME}" --tasks "${task_arn}"

  local describe_json
  describe_json="$(aws_cmd ecs describe-tasks --cluster "${CLUSTER_NAME}" --tasks "${task_arn}" --output json)"
  echo "==> Task status"
  echo "${describe_json}" | jq '{
    lastStatus: .tasks[0].lastStatus,
    stopCode: .tasks[0].stopCode,
    stoppedReason: .tasks[0].stoppedReason,
    containers: (.tasks[0].containers | map({
      name,
      lastStatus,
      exitCode,
      reason
    }))
  }'

  local log_stream="ecs/${CONTAINER_NAME}/${task_id}"
  echo "==> CloudWatch logs (${LOG_GROUP_NAME} / ${log_stream})"
  aws_cmd logs get-log-events \
    --log-group-name "${LOG_GROUP_NAME}" \
    --log-stream-name "${log_stream}" \
    --limit 100 \
    --query 'events[].message' \
    --output text 2>/dev/null || echo "(no logs found yet)"
}

main "$@"

