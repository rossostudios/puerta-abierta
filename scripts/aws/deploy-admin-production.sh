#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
SERVICE_NAME="${ECS_SERVICE_NAME:-casaora-admin}"
REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-casaora-admin}"
TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.admin.json}"
CONTAINER_NAME="${CONTAINER_NAME:-casaora-admin}"
TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-admin-web-tg}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"
ALB_NAME="${ALB_NAME:-${NAME_PREFIX}-alb}"

SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://app.casaora.co}"
SMOKE_PATH="${SMOKE_PATH:-/login}"

NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-https://api.casaora.co/v1}"
NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://app.casaora.co}"
CLERK_DOMAIN="${CLERK_DOMAIN:-clerk.casaora.co}"
CLERK_JS_URL="${CLERK_JS_URL:-https://${CLERK_DOMAIN}/npm/@clerk/clerk-js@5/dist/clerk.browser.js}"

SECRET_PREFIX="${SECRET_PREFIX:-casaora/admin}"
SECRET_CLERK_PUBLISHABLE_NAME="${SECRET_CLERK_PUBLISHABLE_NAME:-${SECRET_PREFIX}/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
SECRET_CLERK_SECRET_NAME="${SECRET_CLERK_SECRET_NAME:-${SECRET_PREFIX}/CLERK_SECRET_KEY}"

DOCKER_BIN="${DOCKER_BIN:-docker}"
DOCKER_BUILDX="${DOCKER_BUILDX:-false}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
default_git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
IMAGE_TAG="${IMAGE_TAG:-${default_git_sha}-$(date +%Y%m%d%H%M%S)}"
DOCKER_CONFIG_ISOLATED="${DOCKER_CONFIG_ISOLATED:-true}"

aws_cmd() {
  local -a args=("${AWS_BIN}" --region "${REGION}")
  if [[ -n "${PROFILE}" ]]; then
    args+=(--profile "${PROFILE}")
  fi
  "${args[@]}" "$@"
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_bin "${AWS_BIN}"
require_bin jq
require_bin "${DOCKER_BIN}"
require_bin curl

cleanup() {
  [[ -n "${tmp_taskdef:-}" && -f "${tmp_taskdef}" ]] && rm -f "${tmp_taskdef}"
  [[ -n "${tmp_smoke_body:-}" && -f "${tmp_smoke_body}" ]] && rm -f "${tmp_smoke_body}"
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

clerk_publishable_key="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
if [[ -z "${clerk_publishable_key}" ]]; then
  echo "Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Set it in the GitHub Production environment secrets." >&2
  exit 1
fi

echo "==> Logging into ECR"
aws_cmd ecr get-login-password | "${DOCKER_BIN}" login --username AWS --password-stdin "${account_id}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null

if [[ "${DOCKER_BUILDX}" == "true" ]]; then
  echo "==> Building and pushing admin image via buildx (${DOCKER_PLATFORM}) -> ${image_uri}"
  "${DOCKER_BIN}" buildx build \
    --platform "${DOCKER_PLATFORM}" \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}" \
    --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${clerk_publishable_key}" \
    --build-arg "NEXT_PUBLIC_CLERK_DOMAIN=${CLERK_DOMAIN}" \
    --build-arg "NEXT_PUBLIC_CLERK_JS_URL=${CLERK_JS_URL}" \
    -f apps/admin/Dockerfile \
    -t "${image_uri}" \
    --push \
    .
else
  echo "==> Building admin image (ARM64 for Fargate) -> ${image_uri}"
  "${DOCKER_BIN}" build \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}" \
    --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${clerk_publishable_key}" \
    --build-arg "NEXT_PUBLIC_CLERK_DOMAIN=${CLERK_DOMAIN}" \
    --build-arg "NEXT_PUBLIC_CLERK_JS_URL=${CLERK_JS_URL}" \
    -f apps/admin/Dockerfile \
    -t "${image_uri}" \
    .

  echo "==> Pushing image"
  "${DOCKER_BIN}" push "${image_uri}"
fi

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
  --arg api_base_url "${NEXT_PUBLIC_API_BASE_URL}" \
  --arg site_url "${NEXT_PUBLIC_SITE_URL}" \
  --arg clerk_domain "${CLERK_DOMAIN}" \
  --arg clerk_js_url "${CLERK_JS_URL}" \
  --arg clerk_publishable_secret_ref "${SECRET_CLERK_PUBLISHABLE_NAME}" \
  --arg clerk_secret_ref "${SECRET_CLERK_SECRET_NAME}" \
  '
    .containerDefinitions[0].image = $image_uri
    | .containerDefinitions[0].environment |= map(
        if .name == "NEXT_PUBLIC_API_BASE_URL" then .value = $api_base_url
        elif .name == "NEXT_PUBLIC_SITE_URL" then .value = $site_url
        elif .name == "NEXT_PUBLIC_CLERK_DOMAIN" then .value = $clerk_domain
        elif .name == "NEXT_PUBLIC_CLERK_JS_URL" then .value = $clerk_js_url
        else .
        end
      )
    | .containerDefinitions[0].secrets |= map(
        if .name == "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" then .valueFrom = $clerk_publishable_secret_ref
        elif .name == "CLERK_SECRET_KEY" then .valueFrom = $clerk_secret_ref
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
    --health-check-grace-period-seconds 90 \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=50" \
    --network-configuration "awsvpcConfiguration={subnets=[${subnet_a},${subnet_b}],securityGroups=[${ecs_sg_id}],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=${target_group_arn},containerName=${CONTAINER_NAME},containerPort=3000" \
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

echo "==> Smoke test ${SMOKE_BASE_URL}${SMOKE_PATH}"
tmp_smoke_body="$(mktemp)"
smoke_status="$(curl -sS -o "${tmp_smoke_body}" -w '%{http_code}' "${SMOKE_BASE_URL}${SMOKE_PATH}")"

echo "${SMOKE_PATH} -> ${smoke_status}"

jq -n \
  --arg cluster "${CLUSTER_NAME}" \
  --arg service "${SERVICE_NAME}" \
  --arg task_definition_arn "${taskdef_arn}" \
  --arg image_uri "${image_uri}" \
  --arg alb_dns_name "${alb_dns_name}" \
  --arg smoke_base_url "${SMOKE_BASE_URL}" \
  --arg smoke_path "${SMOKE_PATH}" \
  --arg smoke_status "${smoke_status}" \
  --arg body_preview "$(head -c 500 "${tmp_smoke_body}")" \
  '{
    cluster: $cluster,
    service: $service,
    task_definition_arn: $task_definition_arn,
    image_uri: $image_uri,
    alb_dns_name: $alb_dns_name,
    smoke: {
      url: ($smoke_base_url + $smoke_path),
      status: ($smoke_status | tonumber),
      body_preview: $body_preview
    }
  }'

if [[ "${smoke_status}" -ge 500 ]]; then
  echo "Admin smoke test failed (${smoke_status})" >&2
  exit 2
fi
