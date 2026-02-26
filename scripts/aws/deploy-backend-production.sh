#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
SERVICE_NAME="${ECS_SERVICE_NAME:-casaora-backend}"
REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-casaora-backend}"
TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.backend.json}"
CONTAINER_NAME="${CONTAINER_NAME:-casaora-backend}"
TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-backend-live-tg}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"
ALB_NAME="${ALB_NAME:-${NAME_PREFIX}-alb}"

SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://api.casaora.co}"

SECRET_PREFIX="${SECRET_PREFIX:-casaora/backend}"
SECRET_DATABASE_URL_NAME="${SECRET_DATABASE_URL_NAME:-${SECRET_PREFIX}/DATABASE_URL}"
SECRET_OPENAI_NAME="${SECRET_OPENAI_NAME:-${SECRET_PREFIX}/OPENAI_API_KEY}"
SECRET_INTERNAL_API_KEY_NAME="${SECRET_INTERNAL_API_KEY_NAME:-${SECRET_PREFIX}/INTERNAL_API_KEY}"

DOCKER_BIN="${DOCKER_BIN:-docker}"
default_git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
IMAGE_TAG="${IMAGE_TAG:-${default_git_sha}-$(date +%Y%m%d%H%M%S)}"
DOCKER_CONFIG_ISOLATED="${DOCKER_CONFIG_ISOLATED:-true}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

secret_arn() {
  local secret_name="$1"
  aws_cmd secretsmanager describe-secret \
    --secret-id "${secret_name}" \
    --query 'ARN' --output text
}

if ! command -v "${DOCKER_BIN}" >/dev/null 2>&1; then
  echo "docker is required for production deploy" >&2
  exit 1
fi

cleanup() {
  [[ -n "${tmp_taskdef:-}" && -f "${tmp_taskdef}" ]] && rm -f "${tmp_taskdef}"
  if [[ "${DOCKER_CONFIG_ISOLATED}" == "true" && -n "${temp_docker_config:-}" && -d "${temp_docker_config}" ]]; then
    rm -rf "${temp_docker_config}"
  fi
}
trap cleanup EXIT

if [[ "${DOCKER_CONFIG_ISOLATED}" == "true" && -z "${DOCKER_CONFIG:-}" ]]; then
  temp_docker_config="$(mktemp -d)"
  export DOCKER_CONFIG="${temp_docker_config}"
fi

if [[ -z "${DOCKER_HOST:-}" && -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi

account_id="$(aws_cmd sts get-caller-identity --query Account --output text)"
repo_uri="$(aws_cmd ecr describe-repositories --repository-names "${REPOSITORY_NAME}" --query 'repositories[0].repositoryUri' --output text)"
image_uri="${repo_uri}:${IMAGE_TAG}"

database_url_secret_arn="$(secret_arn "${SECRET_DATABASE_URL_NAME}")"
openai_secret_arn="$(secret_arn "${SECRET_OPENAI_NAME}")"
internal_api_key_secret_arn="$(secret_arn "${SECRET_INTERNAL_API_KEY_NAME}")"

echo "==> Logging into ECR"
aws_cmd ecr get-login-password | "${DOCKER_BIN}" login --username AWS --password-stdin "${account_id}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null

echo "==> Building backend image (ARM64 for Fargate) -> ${image_uri}"
"${DOCKER_BIN}" build \
  -f apps/backend-rs/Dockerfile \
  -t "${image_uri}" \
  apps/backend-rs

echo "==> Pushing image"
"${DOCKER_BIN}" push "${image_uri}"

echo "==> Resolving network and load balancer resources"
vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${VPC_NAME}" --query 'Vpcs[0].VpcId' --output text)"
ecs_sg_id="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ECS_SG_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
subnets_json="$(aws_cmd ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
  --query 'Subnets[].{id:SubnetId,az:AvailabilityZone}' --output json | jq 'sort_by(.az) | .[:2]')"
subnet_a="$(echo "${subnets_json}" | jq -r '.[0].id')"
subnet_b="$(echo "${subnets_json}" | jq -r '.[1].id')"

target_group_arn="$(aws_cmd elbv2 describe-target-groups --names "${TARGET_GROUP_NAME}" --query 'TargetGroups[0].TargetGroupArn' --output text)"
alb_dns_name="$(aws_cmd elbv2 describe-load-balancers --names "${ALB_NAME}" --query 'LoadBalancers[0].DNSName' --output text)"

echo "==> Registering task definition"
tmp_taskdef="$(mktemp)"
jq \
  --arg image_uri "${image_uri}" \
  --arg db_secret_arn "${database_url_secret_arn}" \
  --arg openai_secret_arn "${openai_secret_arn}" \
  --arg internal_api_key_secret_arn "${internal_api_key_secret_arn}" \
  '
    .containerDefinitions[0].image = $image_uri
    | .containerDefinitions[0].secrets |= map(
        if .name == "DATABASE_URL" then .valueFrom = $db_secret_arn
        elif .name == "OPENAI_API_KEY" then .valueFrom = $openai_secret_arn
        elif .name == "INTERNAL_API_KEY" then .valueFrom = $internal_api_key_secret_arn
        else .
        end
      )
  ' "${TASKDEF_TEMPLATE}" > "${tmp_taskdef}"

taskdef_arn="$(aws_cmd ecs register-task-definition \
  --cli-input-json "file://${tmp_taskdef}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"

echo "Task definition: ${taskdef_arn}"

service_arn="$(aws_cmd ecs describe-services --cluster "${CLUSTER_NAME}" --services "${SERVICE_NAME}" \
  --query 'services[0].serviceArn' --output text 2>/dev/null || true)"

if [[ -z "${service_arn}" || "${service_arn}" == "None" ]]; then
  echo "==> Creating ECS service ${SERVICE_NAME}"
  aws_cmd ecs create-service \
    --cluster "${CLUSTER_NAME}" \
    --service-name "${SERVICE_NAME}" \
    --task-definition "${taskdef_arn}" \
    --desired-count 1 \
    --launch-type FARGATE \
    --platform-version LATEST \
    --health-check-grace-period-seconds 60 \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=50" \
    --network-configuration "awsvpcConfiguration={subnets=[${subnet_a},${subnet_b}],securityGroups=[${ecs_sg_id}],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=${target_group_arn},containerName=${CONTAINER_NAME},containerPort=8000" \
    --enable-execute-command \
    >/dev/null
else
  echo "==> Updating ECS service ${SERVICE_NAME}"
  aws_cmd ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --task-definition "${taskdef_arn}" \
    --force-new-deployment >/dev/null
fi

echo "==> Waiting for ECS service stability"
aws_cmd ecs wait services-stable --cluster "${CLUSTER_NAME}" --services "${SERVICE_NAME}"

echo "==> Smoke tests via ${SMOKE_BASE_URL}"
live_status="$(curl -sS -o /tmp/casaora_prod_live.json -w '%{http_code}' "${SMOKE_BASE_URL}/v1/live")"
ready_status="$(curl -sS -o /tmp/casaora_prod_ready.json -w '%{http_code}' "${SMOKE_BASE_URL}/v1/ready")"

echo "/v1/live -> ${live_status}"
echo "/v1/ready -> ${ready_status}"

echo "==> Backend production deploy summary"
jq -n \
  --arg cluster "${CLUSTER_NAME}" \
  --arg service "${SERVICE_NAME}" \
  --arg task_definition_arn "${taskdef_arn}" \
  --arg image_uri "${image_uri}" \
  --arg alb_dns_name "${alb_dns_name}" \
  --arg smoke_base_url "${SMOKE_BASE_URL}" \
  --arg live_status "${live_status}" \
  --arg ready_status "${ready_status}" \
  --arg live_body "$(cat /tmp/casaora_prod_live.json)" \
  --arg ready_body "$(cat /tmp/casaora_prod_ready.json)" \
  '{
    cluster: $cluster,
    service: $service,
    task_definition_arn: $task_definition_arn,
    image_uri: $image_uri,
    alb_dns_name: $alb_dns_name,
    smoke_base_url: $smoke_base_url,
    smoke: {
      live: { status: ($live_status | tonumber), body: ($live_body | fromjson?) },
      ready: { status: ($ready_status | tonumber), body: ($ready_body | fromjson?) }
    }
  }'

if [[ "${ready_status}" != "200" ]]; then
  echo "Readiness check failed; keeping service on live target group for bootstrap traffic." >&2
  exit 2
fi
