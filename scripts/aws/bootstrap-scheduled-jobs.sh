#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.scheduler-job-runner.json}"
TASKDEF_FAMILY="${TASKDEF_FAMILY:-casaora-job-runner}"
CONTAINER_NAME="${CONTAINER_NAME:-casaora-job-runner}"
API_BASE_URL="${API_BASE_URL:-https://api.casaora.co}"

LOG_GROUP_NAME="${LOG_GROUP_NAME:-/ecs/casaora-job-runner}"
EVENTS_INVOKE_ROLE_NAME="${EVENTS_INVOKE_ROLE_NAME:-casaora-eventbridge-ecs-run-task-role}"
EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-casaora-backend-task-execution-role}"
TASK_ROLE_NAME="${TASK_ROLE_NAME:-casaora-backend-task-role}"
INTERNAL_API_KEY_SECRET_NAME="${INTERNAL_API_KEY_SECRET_NAME:-casaora/backend/INTERNAL_API_KEY}"

WORKFLOW_PROCESS_LIMIT="${WORKFLOW_PROCESS_LIMIT:-100}"
RETENTION_DAYS="${RETENTION_DAYS:-180}"

PROCESS_NOTIFICATIONS_RULE_NAME="${PROCESS_NOTIFICATIONS_RULE_NAME:-casaora-process-notifications-5m}"
PROCESS_NOTIFICATIONS_SCHEDULE="${PROCESS_NOTIFICATIONS_SCHEDULE:-rate(5 minutes)}"
NOTIFICATIONS_RETENTION_RULE_NAME="${NOTIFICATIONS_RETENTION_RULE_NAME:-casaora-notifications-retention-daily}"
NOTIFICATIONS_RETENTION_SCHEDULE="${NOTIFICATIONS_RETENTION_SCHEDULE:-cron(15 3 * * ? *)}"
PROCESS_WORKFLOW_RULE_NAME="${PROCESS_WORKFLOW_RULE_NAME:-casaora-process-workflow-jobs-1m}"
PROCESS_WORKFLOW_SCHEDULE="${PROCESS_WORKFLOW_SCHEDULE:-rate(1 minute)}"

ENABLE_RULES="${ENABLE_RULES:-true}"

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

cleanup() {
  [[ -n "${tmp_taskdef:-}" && -f "${tmp_taskdef}" ]] && rm -f "${tmp_taskdef}"
  [[ -n "${tmp_trust:-}" && -f "${tmp_trust}" ]] && rm -f "${tmp_trust}"
  [[ -n "${tmp_policy:-}" && -f "${tmp_policy}" ]] && rm -f "${tmp_policy}"
  [[ -n "${tmp_targets:-}" && -f "${tmp_targets}" ]] && rm -f "${tmp_targets}"
}
trap cleanup EXIT

ensure_log_group() {
  local existing
  existing="$(aws_cmd logs describe-log-groups \
    --log-group-name-prefix "${LOG_GROUP_NAME}" \
    --query "logGroups[?logGroupName=='${LOG_GROUP_NAME}'].logGroupName | [0]" \
    --output text 2>/dev/null || true)"

  if [[ -z "${existing}" || "${existing}" == "None" ]]; then
    echo "==> Creating CloudWatch log group ${LOG_GROUP_NAME}"
    aws_cmd logs create-log-group --log-group-name "${LOG_GROUP_NAME}"
  else
    echo "==> Log group exists: ${LOG_GROUP_NAME}"
  fi

  aws_cmd logs put-retention-policy \
    --log-group-name "${LOG_GROUP_NAME}" \
    --retention-in-days 30 >/dev/null
}

ensure_events_invoke_role() {
  local account_id="$1"
  local cluster_arn="$2"
  local taskdef_family="$3"
  local execution_role_arn="$4"
  local task_role_arn="$5"

  local role_arn
  role_arn="$(aws_cmd iam get-role --role-name "${EVENTS_INVOKE_ROLE_NAME}" --query 'Role.Arn' --output text 2>/dev/null || true)"

  if [[ -z "${role_arn}" || "${role_arn}" == "None" ]]; then
    echo "==> Creating EventBridge invoke role ${EVENTS_INVOKE_ROLE_NAME}" >&2
    tmp_trust="$(mktemp)"
    cat > "${tmp_trust}" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "events.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
    role_arn="$(aws_cmd iam create-role \
      --role-name "${EVENTS_INVOKE_ROLE_NAME}" \
      --assume-role-policy-document "file://${tmp_trust}" \
      --tags Key=Project,Value=Casaora Key=Environment,Value=production \
      --query 'Role.Arn' --output text)"
  else
    echo "==> EventBridge invoke role exists: ${EVENTS_INVOKE_ROLE_NAME}" >&2
  fi

  tmp_policy="$(mktemp)"
  jq -n \
    --arg region "${REGION}" \
    --arg account_id "${account_id}" \
    --arg family "${taskdef_family}" \
    --arg cluster_arn "${cluster_arn}" \
    --arg execution_role_arn "${execution_role_arn}" \
    --arg task_role_arn "${task_role_arn}" \
    '{
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RunSchedulerTasks",
          Effect: "Allow",
          Action: ["ecs:RunTask"],
          Resource: ("arn:aws:ecs:" + $region + ":" + $account_id + ":task-definition/" + $family + ":*"),
          Condition: {
            ArnEquals: {
              "ecs:cluster": $cluster_arn
            }
          }
        },
        {
          Sid: "PassTaskRoles",
          Effect: "Allow",
          Action: ["iam:PassRole"],
          Resource: [$execution_role_arn, $task_role_arn]
        }
      ]
    }' > "${tmp_policy}"

  aws_cmd iam put-role-policy \
    --role-name "${EVENTS_INVOKE_ROLE_NAME}" \
    --policy-name "CasaoraEventBridgeRunEcsTask" \
    --policy-document "file://${tmp_policy}" >/dev/null

  printf '%s' "${role_arn}"
}

register_task_definition() {
  local execution_role_arn="$1"
  local task_role_arn="$2"
  local internal_api_secret_arn="$3"

  echo "==> Registering scheduler job-runner task definition" >&2
  tmp_taskdef="$(mktemp)"
  jq \
    --arg execution_role_arn "${execution_role_arn}" \
    --arg task_role_arn "${task_role_arn}" \
    --arg internal_secret_arn "${internal_api_secret_arn}" \
    --arg api_base_url "${API_BASE_URL}" \
    --arg region "${REGION}" \
    '
      .executionRoleArn = $execution_role_arn
      | .taskRoleArn = $task_role_arn
      | .containerDefinitions[0].environment |= map(
          if .name == "API_BASE_URL" then .value = $api_base_url else . end
        )
      | .containerDefinitions[0].secrets |= map(
          if .name == "INTERNAL_API_KEY" then .valueFrom = $internal_secret_arn else . end
        )
      | .containerDefinitions[0].logConfiguration.options["awslogs-region"] = $region
    ' "${TASKDEF_TEMPLATE}" > "${tmp_taskdef}"

  aws_cmd ecs register-task-definition \
    --cli-input-json "file://${tmp_taskdef}" \
    --query 'taskDefinition.taskDefinitionArn' --output text
}

put_rule() {
  local rule_name="$1"
  local schedule_expr="$2"
  echo "==> Ensuring EventBridge rule ${rule_name} (${schedule_expr})"
  aws_cmd events put-rule \
    --name "${rule_name}" \
    --schedule-expression "${schedule_expr}" \
    --state "$(if [[ "${ENABLE_RULES}" == "true" ]]; then echo ENABLED; else echo DISABLED; fi)" \
    --description "Casaora scheduled job via ECS RunTask" >/dev/null
}

put_ecs_target() {
  local rule_name="$1"
  local target_id="$2"
  local command_script="$3"
  local cluster_arn="$4"
  local events_role_arn="$5"
  local taskdef_arn="$6"
  local subnet_a="$7"
  local subnet_b="$8"
  local ecs_sg_id="$9"

  local input_json
  input_json="$(jq -cn \
    --arg container "${CONTAINER_NAME}" \
    --arg cmd "${command_script}" \
    '{containerOverrides:[{name:$container,command:[$cmd]}]}')"

  tmp_targets="$(mktemp)"
  jq -n \
    --arg target_id "${target_id}" \
    --arg cluster_arn "${cluster_arn}" \
    --arg role_arn "${events_role_arn}" \
    --arg taskdef_arn "${taskdef_arn}" \
    --arg subnet_a "${subnet_a}" \
    --arg subnet_b "${subnet_b}" \
    --arg ecs_sg_id "${ecs_sg_id}" \
    --arg input_json "${input_json}" \
    '[
      {
        Id: $target_id,
        Arn: $cluster_arn,
        RoleArn: $role_arn,
        EcsParameters: {
          TaskDefinitionArn: $taskdef_arn,
          TaskCount: 1,
          LaunchType: "FARGATE",
          PlatformVersion: "LATEST",
          EnableECSManagedTags: true,
          NetworkConfiguration: {
            awsvpcConfiguration: {
              Subnets: [$subnet_a, $subnet_b],
              SecurityGroups: [$ecs_sg_id],
              AssignPublicIp: "ENABLED"
            }
          }
        },
        Input: $input_json
      }
    ]' > "${tmp_targets}"

  aws_cmd events put-targets \
    --rule "${rule_name}" \
    --targets "file://${tmp_targets}" >/dev/null

  rm -f "${tmp_targets}"
  tmp_targets=""
}

main() {
  local account_id cluster_arn vpc_id ecs_sg_id subnets_json subnet_a subnet_b
  local execution_role_arn task_role_arn internal_api_secret_arn events_role_arn taskdef_arn

  account_id="$(aws_cmd sts get-caller-identity --query Account --output text)"
  cluster_arn="$(aws_cmd ecs describe-clusters --clusters "${CLUSTER_NAME}" --query 'clusters[0].clusterArn' --output text)"
  vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${NAME_PREFIX}-vpc" --query 'Vpcs[0].VpcId' --output text)"
  ecs_sg_id="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${NAME_PREFIX}-ecs-sg" --query 'SecurityGroups[0].GroupId' --output text)"
  subnets_json="$(aws_cmd ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
    --query 'Subnets[].{id:SubnetId,az:AvailabilityZone}' --output json | jq 'sort_by(.az) | .[:2]')"
  subnet_a="$(echo "${subnets_json}" | jq -r '.[0].id')"
  subnet_b="$(echo "${subnets_json}" | jq -r '.[1].id')"

  execution_role_arn="$(aws_cmd iam get-role --role-name "${EXECUTION_ROLE_NAME}" --query 'Role.Arn' --output text)"
  task_role_arn="$(aws_cmd iam get-role --role-name "${TASK_ROLE_NAME}" --query 'Role.Arn' --output text)"
  internal_api_secret_arn="$(aws_cmd secretsmanager describe-secret --secret-id "${INTERNAL_API_KEY_SECRET_NAME}" --query 'ARN' --output text)"

  ensure_log_group
  taskdef_arn="$(register_task_definition "${execution_role_arn}" "${task_role_arn}" "${internal_api_secret_arn}")"
  events_role_arn="$(ensure_events_invoke_role "${account_id}" "${cluster_arn}" "${TASKDEF_FAMILY}" "${execution_role_arn}" "${task_role_arn}")"

  put_rule "${PROCESS_NOTIFICATIONS_RULE_NAME}" "${PROCESS_NOTIFICATIONS_SCHEDULE}"
  put_rule "${NOTIFICATIONS_RETENTION_RULE_NAME}" "${NOTIFICATIONS_RETENTION_SCHEDULE}"
  put_rule "${PROCESS_WORKFLOW_RULE_NAME}" "${PROCESS_WORKFLOW_SCHEDULE}"

  local process_notifications_cmd
  process_notifications_cmd='set -eu; endpoint="${API_BASE_URL%/}/v1/internal/process-notifications"; echo "POST ${endpoint}"; curl -sS -f -X POST "$endpoint" -H "accept: application/json" -H "content-type: application/json" -H "x-api-key: ${INTERNAL_API_KEY}"'

  local notifications_retention_cmd
  notifications_retention_cmd="set -eu; endpoint=\"\${API_BASE_URL%/}/v1/internal/notifications-retention\"; echo \"POST \${endpoint}\"; curl -sS -f -X POST \"\$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: \${INTERNAL_API_KEY}\" --data '{\"retention_days\":${RETENTION_DAYS}}'"

  local process_workflow_cmd
  process_workflow_cmd="set -eu; endpoint=\"\${API_BASE_URL%/}/v1/internal/process-workflow-jobs?limit=${WORKFLOW_PROCESS_LIMIT}\"; echo \"POST \${endpoint}\"; curl -sS -f -X POST \"\$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: \${INTERNAL_API_KEY}\""

  put_ecs_target "${PROCESS_NOTIFICATIONS_RULE_NAME}" "process-notifications" "${process_notifications_cmd}" "${cluster_arn}" "${events_role_arn}" "${taskdef_arn}" "${subnet_a}" "${subnet_b}" "${ecs_sg_id}"
  put_ecs_target "${NOTIFICATIONS_RETENTION_RULE_NAME}" "notifications-retention" "${notifications_retention_cmd}" "${cluster_arn}" "${events_role_arn}" "${taskdef_arn}" "${subnet_a}" "${subnet_b}" "${ecs_sg_id}"
  put_ecs_target "${PROCESS_WORKFLOW_RULE_NAME}" "process-workflow-jobs" "${process_workflow_cmd}" "${cluster_arn}" "${events_role_arn}" "${taskdef_arn}" "${subnet_a}" "${subnet_b}" "${ecs_sg_id}"

  echo "==> Scheduled jobs bootstrap complete"
  jq -n \
    --arg cluster "${CLUSTER_NAME}" \
    --arg cluster_arn "${cluster_arn}" \
    --arg taskdef_arn "${taskdef_arn}" \
    --arg log_group "${LOG_GROUP_NAME}" \
    --arg events_role_arn "${events_role_arn}" \
    --arg process_notifications_rule "${PROCESS_NOTIFICATIONS_RULE_NAME}" \
    --arg notifications_retention_rule "${NOTIFICATIONS_RETENTION_RULE_NAME}" \
    --arg process_workflow_rule "${PROCESS_WORKFLOW_RULE_NAME}" \
    --arg process_notifications_schedule "${PROCESS_NOTIFICATIONS_SCHEDULE}" \
    --arg notifications_retention_schedule "${NOTIFICATIONS_RETENTION_SCHEDULE}" \
    --arg process_workflow_schedule "${PROCESS_WORKFLOW_SCHEDULE}" \
    '{
      cluster: $cluster,
      cluster_arn: $cluster_arn,
      task_definition_arn: $taskdef_arn,
      log_group: $log_group,
      eventbridge_invoke_role_arn: $events_role_arn,
      rules: [
        { name: $process_notifications_rule, schedule: $process_notifications_schedule },
        { name: $notifications_retention_rule, schedule: $notifications_retention_schedule },
        { name: $process_workflow_rule, schedule: $process_workflow_schedule }
      ]
    }'

  return 0
}

main "$@"
