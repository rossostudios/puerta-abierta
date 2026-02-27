#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-}"
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
DOCKER_BUILDX="${DOCKER_BUILDX:-false}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
DOCKER_REGISTRY_CACHE="${DOCKER_REGISTRY_CACHE:-false}"
SKIP_IMAGE_BUILD="${SKIP_IMAGE_BUILD:-false}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-true}"
WAIT_FOR_SERVICE_STABILITY="${WAIT_FOR_SERVICE_STABILITY:-true}"
ECS_STABILITY_WAIT_ATTEMPTS="${ECS_STABILITY_WAIT_ATTEMPTS:-3}"
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"
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

resolve_existing_secret_ref() {
  local env_var_name="$1"
  local secret_name="$2"
  local existing_ref=""

  if [[ -n "${current_taskdef_arn:-}" ]]; then
    existing_ref="$(
      aws_cmd ecs describe-task-definition \
        --task-definition "${current_taskdef_arn}" \
        --query "taskDefinition.containerDefinitions[?name=='${CONTAINER_NAME}'].secrets[?name=='${env_var_name}'].valueFrom | [0][0]" \
        --output text 2>/dev/null || true
    )"
    if [[ "${existing_ref}" == "None" ]]; then
      existing_ref=""
    fi
  fi

  if [[ -n "${existing_ref}" ]]; then
    printf '%s' "${existing_ref}"
    return
  fi

  printf '%s' "${secret_name}"
}

check_ecr_access() {
  if aws_cmd ecr describe-repositories --repository-names "${REPOSITORY_NAME}" >/dev/null 2>&1; then
    return
  fi

  cat >&2 <<MSG
Unable to access ECR repository ${REPOSITORY_NAME} in ${REGION}.
Failing early before image build.

Required IAM actions include:
- ecr:DescribeRepositories
- ecr:GetAuthorizationToken
- ecr:BatchCheckLayerAvailability
- ecr:InitiateLayerUpload
- ecr:UploadLayerPart
- ecr:CompleteLayerUpload
- ecr:PutImage
MSG
  exit 1
}

print_ecs_diagnostics() {
  echo "==> ECS diagnostics for ${SERVICE_NAME}"

  aws_cmd ecs describe-services \
    --cluster "${CLUSTER_NAME}" \
    --services "${SERVICE_NAME}" \
    --query 'services[0].events[:10].[createdAt,message]' \
    --output table || true

  mapfile -t stopped_tasks < <(
    aws_cmd ecs list-tasks \
      --cluster "${CLUSTER_NAME}" \
      --service-name "${SERVICE_NAME}" \
      --desired-status STOPPED \
      --max-items 5 \
      --query 'taskArns' \
      --output text 2>/dev/null | tr '\t' '\n' | sed '/^None$/d;/^$/d'
  )

  if [[ ${#stopped_tasks[@]} -gt 0 ]]; then
    aws_cmd ecs describe-tasks \
      --cluster "${CLUSTER_NAME}" \
      --tasks "${stopped_tasks[@]}" \
      --query 'tasks[].{task:taskArn,lastStatus:lastStatus,stoppedReason:stoppedReason,stoppedAt:stoppedAt}' \
      --output table || true
  fi
}

wait_for_ecs_stability() {
  if [[ "${WAIT_FOR_SERVICE_STABILITY}" != "true" ]]; then
    echo "==> WAIT_FOR_SERVICE_STABILITY=false; skipping stability wait"
    return 0
  fi

  local attempt
  local max_attempts="${ECS_STABILITY_WAIT_ATTEMPTS}"

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    echo "==> Waiting for ECS service stability (attempt ${attempt}/${max_attempts})"
    if aws_cmd ecs wait services-stable --cluster "${CLUSTER_NAME}" --services "${SERVICE_NAME}"; then
      return 0
    fi

    echo "ECS service did not stabilize on attempt ${attempt}." >&2
    print_ecs_diagnostics
  done

  return 1
}

require_bin "${AWS_BIN}"
require_bin jq
require_bin "${DOCKER_BIN}"
require_bin curl

cleanup() {
  [[ -n "${tmp_taskdef:-}" && -f "${tmp_taskdef}" ]] && rm -f "${tmp_taskdef}"
  [[ -n "${tmp_live_body:-}" && -f "${tmp_live_body}" ]] && rm -f "${tmp_live_body}"
  [[ -n "${tmp_ready_body:-}" && -f "${tmp_ready_body}" ]] && rm -f "${tmp_ready_body}"
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
repo_uri="${account_id}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY_NAME}"
image_uri="${repo_uri}:${IMAGE_TAG}"
cache_platform="${DOCKER_PLATFORM//\//-}"
build_cache_ref="${BUILD_CACHE_REF:-${repo_uri}:buildcache-${cache_platform}}"

check_ecr_access

current_taskdef_arn="$(aws_cmd ecs describe-services --cluster "${CLUSTER_NAME}" --services "${SERVICE_NAME}" --query 'services[0].taskDefinition' --output text 2>/dev/null || true)"
if [[ "${current_taskdef_arn}" == "None" ]]; then
  current_taskdef_arn=""
fi

database_url_secret_ref="$(resolve_existing_secret_ref "DATABASE_URL" "${SECRET_DATABASE_URL_NAME}")"
openai_secret_ref="$(resolve_existing_secret_ref "OPENAI_API_KEY" "${SECRET_OPENAI_NAME}")"
internal_api_key_secret_ref="$(resolve_existing_secret_ref "INTERNAL_API_KEY" "${SECRET_INTERNAL_API_KEY_NAME}")"

if [[ "${SKIP_IMAGE_BUILD}" == "true" ]]; then
  echo "==> Skipping backend image build and push; reusing ${image_uri}"
else
  echo "==> Logging into ECR"
  aws_cmd ecr get-login-password | "${DOCKER_BIN}" login --username AWS --password-stdin "${account_id}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null

  if [[ "${DOCKER_BUILDX}" == "true" ]]; then
    echo "==> Building and pushing backend image via buildx (${DOCKER_PLATFORM}) -> ${image_uri}"
    buildx_args=(buildx build --platform "${DOCKER_PLATFORM}")
    if [[ "${DOCKER_REGISTRY_CACHE}" == "true" ]]; then
      buildx_args+=(
        --cache-from "type=registry,ref=${build_cache_ref}"
        --cache-to "type=registry,ref=${build_cache_ref},mode=max"
      )
    else
      echo "==> Registry cache disabled for this run"
    fi
    buildx_args+=(
      -f apps/backend-rs/Dockerfile
      -t "${image_uri}"
      --push
      apps/backend-rs
    )
    "${DOCKER_BIN}" "${buildx_args[@]}"
  else
    echo "==> Building backend image (ARM64 for Fargate) -> ${image_uri}"
    "${DOCKER_BIN}" build \
      -f apps/backend-rs/Dockerfile \
      -t "${image_uri}" \
      apps/backend-rs

    echo "==> Pushing image"
    "${DOCKER_BIN}" push "${image_uri}"
  fi
fi

if [[ "${DEPLOY_SERVICE}" != "true" ]]; then
  echo "==> DEPLOY_SERVICE=false; skipping ECS service update and smoke checks"
  jq -n \
    --arg image_uri "${image_uri}" \
    --arg repository "${REPOSITORY_NAME}" \
    '{
      deploy_service: false,
      image_uri: $image_uri,
      repository: $repository
    }'
  exit 0
fi

echo "==> Registering task definition"
tmp_taskdef="$(mktemp)"
jq \
  --arg image_uri "${image_uri}" \
  --arg db_secret_ref "${database_url_secret_ref}" \
  --arg openai_secret_ref "${openai_secret_ref}" \
  --arg internal_api_key_secret_ref "${internal_api_key_secret_ref}" \
  '
    .containerDefinitions[0].image = $image_uri
    | .containerDefinitions[0].secrets |= map(
        if .name == "DATABASE_URL" then .valueFrom = $db_secret_ref
        elif .name == "OPENAI_API_KEY" then .valueFrom = $openai_secret_ref
        elif .name == "INTERNAL_API_KEY" then .valueFrom = $internal_api_key_secret_ref
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
  echo "ECS service ${SERVICE_NAME} not found. This deploy script supports update-only production deploys." >&2
  exit 1
fi

echo "==> Updating ECS service ${SERVICE_NAME}"
aws_cmd ecs update-service \
  --cluster "${CLUSTER_NAME}" \
  --service "${SERVICE_NAME}" \
  --task-definition "${taskdef_arn}" \
  --force-new-deployment >/dev/null

if ! wait_for_ecs_stability; then
  echo "ECS deployment did not stabilize after ${ECS_STABILITY_WAIT_ATTEMPTS} wait attempt(s)." >&2
  exit 2
fi

if [[ "${RUN_SMOKE_TESTS}" != "true" ]]; then
  echo "==> RUN_SMOKE_TESTS=false; skipping smoke checks"
  jq -n \
    --arg cluster "${CLUSTER_NAME}" \
    --arg service "${SERVICE_NAME}" \
    --arg task_definition_arn "${taskdef_arn}" \
    --arg image_uri "${image_uri}" \
    '{
      cluster: $cluster,
      service: $service,
      task_definition_arn: $task_definition_arn,
      image_uri: $image_uri,
      smoke: { skipped: true }
    }'
  exit 0
fi

echo "==> Smoke tests via ${SMOKE_BASE_URL}"
tmp_live_body="$(mktemp)"
tmp_ready_body="$(mktemp)"
live_status="$(curl -sS -o "${tmp_live_body}" -w '%{http_code}' "${SMOKE_BASE_URL}/v1/live")"
ready_status="$(curl -sS -o "${tmp_ready_body}" -w '%{http_code}' "${SMOKE_BASE_URL}/v1/ready")"

echo "/v1/live -> ${live_status}"
echo "/v1/ready -> ${ready_status}"

echo "==> Backend production deploy summary"
jq -n \
  --arg cluster "${CLUSTER_NAME}" \
  --arg service "${SERVICE_NAME}" \
  --arg task_definition_arn "${taskdef_arn}" \
  --arg image_uri "${image_uri}" \
  --arg smoke_base_url "${SMOKE_BASE_URL}" \
  --arg live_status "${live_status}" \
  --arg ready_status "${ready_status}" \
  --arg live_body "$(cat "${tmp_live_body}")" \
  --arg ready_body "$(cat "${tmp_ready_body}")" \
  '{
    cluster: $cluster,
    service: $service,
    task_definition_arn: $task_definition_arn,
    image_uri: $image_uri,
    smoke_base_url: $smoke_base_url,
    smoke: {
      live: { status: ($live_status | tonumber), body: ($live_body | fromjson?) },
      ready: { status: ($ready_status | tonumber), body: ($ready_body | fromjson?) }
    }
  }'

if [[ "${ready_status}" != "200" ]]; then
  echo "Readiness check failed; keeping service on live target group for bootstrap traffic." >&2
  exit 3
fi
