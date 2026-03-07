#!/usr/bin/env bash
set -euo pipefail

# Unified production deploy script for all Casaora apps.
# Usage: deploy-production.sh <backend|admin|web>

APP="${1:-}"
if [[ -z "${APP}" || ! "${APP}" =~ ^(backend|admin|web)$ ]]; then
  echo "Usage: $0 <backend|admin|web>" >&2
  exit 1
fi

# ── Common defaults ──────────────────────────────────────────────

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"
ALB_NAME="${ALB_NAME:-${NAME_PREFIX}-alb}"

DOCKER_BIN="${DOCKER_BIN:-docker}"
DOCKER_BUILDX="${DOCKER_BUILDX:-false}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
DOCKER_REGISTRY_CACHE="${DOCKER_REGISTRY_CACHE:-false}"
SKIP_IMAGE_BUILD="${SKIP_IMAGE_BUILD:-false}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-true}"
WAIT_FOR_SERVICE_STABILITY="${WAIT_FOR_SERVICE_STABILITY:-true}"
ECS_STABILITY_WAIT_ATTEMPTS="${ECS_STABILITY_WAIT_ATTEMPTS:-3}"
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"
AUTO_ROLLBACK="${AUTO_ROLLBACK:-true}"
default_git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
IMAGE_TAG="${IMAGE_TAG:-${default_git_sha}-$(date +%Y%m%d%H%M%S)}"
DOCKER_CONFIG_ISOLATED="${DOCKER_CONFIG_ISOLATED:-true}"

# ── Per-app config ───────────────────────────────────────────────

build_args=()

case "${APP}" in
  backend)
    SERVICE_NAME="${ECS_SERVICE_NAME:-casaora-backend}"
    REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-casaora-backend}"
    TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.backend.json}"
    CONTAINER_NAME="${CONTAINER_NAME:-casaora-backend}"
    TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-backend-live-tg}"
    SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://api.casaora.co}"
    BACKEND_PORT="${BACKEND_PORT:-8000}"
    CLOUD_MAP_SERVICE_ARN="${CLOUD_MAP_SERVICE_ARN:-}"
    SECRET_PREFIX="${SECRET_PREFIX:-casaora/backend}"
    SECRET_DATABASE_URL_NAME="${SECRET_DATABASE_URL_NAME:-${SECRET_PREFIX}/DATABASE_URL}"
    SECRET_OPENAI_NAME="${SECRET_OPENAI_NAME:-${SECRET_PREFIX}/OPENAI_API_KEY}"
    SECRET_INTERNAL_API_KEY_NAME="${SECRET_INTERNAL_API_KEY_NAME:-${SECRET_PREFIX}/INTERNAL_API_KEY}"
    DOCKER_CONTEXT="apps/backend-rs"
    DOCKERFILE="apps/backend-rs/Dockerfile"
    ;;
  admin)
    SERVICE_NAME="${ECS_SERVICE_NAME:-casaora-admin}"
    REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-casaora-admin}"
    TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.admin.json}"
    CONTAINER_NAME="${CONTAINER_NAME:-casaora-admin}"
    TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-admin-web-tg}"
    SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://app.casaora.co}"
    SMOKE_PATH="${SMOKE_PATH:-/login}"
    NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-https://api.casaora.co/v1}"
    INTERNAL_API_BASE_URL="${INTERNAL_API_BASE_URL:-http://backend.casaora.internal:8000/v1}"
    NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://app.casaora.co}"
    CLERK_DOMAIN="${CLERK_DOMAIN:-clerk.casaora.co}"
    CLERK_JS_URL="${CLERK_JS_URL:-https://${CLERK_DOMAIN}/npm/@clerk/clerk-js@5/dist/clerk.browser.js}"
    SECRET_PREFIX="${SECRET_PREFIX:-casaora/admin}"
    SECRET_CLERK_PUBLISHABLE_NAME="${SECRET_CLERK_PUBLISHABLE_NAME:-${SECRET_PREFIX}/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
    SECRET_CLERK_SECRET_NAME="${SECRET_CLERK_SECRET_NAME:-${SECRET_PREFIX}/CLERK_SECRET_KEY}"
    DOCKER_CONTEXT="."
    DOCKERFILE="apps/admin/Dockerfile"
    build_args=(
      --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}"
      --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}"
      --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
      --build-arg "NEXT_PUBLIC_CLERK_DOMAIN=${CLERK_DOMAIN}"
      --build-arg "NEXT_PUBLIC_CLERK_JS_URL=${CLERK_JS_URL}"
    )
    ;;
  web)
    SERVICE_NAME="${ECS_SERVICE_NAME:-casaora-web}"
    REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-casaora-web}"
    TASKDEF_TEMPLATE="${TASKDEF_TEMPLATE:-infra/aws/ecs/taskdef.web.json}"
    CONTAINER_NAME="${CONTAINER_NAME:-casaora-web}"
    TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-web-tg}"
    SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://casaora.co}"
    SMOKE_PATH="${SMOKE_PATH:-/login}"
    NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-https://api.casaora.co/v1}"
    NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://casaora.co}"
    NEXT_PUBLIC_ADMIN_URL="${NEXT_PUBLIC_ADMIN_URL:-https://app.casaora.co}"
    CLERK_DOMAIN="${CLERK_DOMAIN:-clerk.casaora.co}"
    CLERK_JS_URL="${CLERK_JS_URL:-https://${CLERK_DOMAIN}/npm/@clerk/clerk-js@5/dist/clerk.browser.js}"
    SECRET_PREFIX="${SECRET_PREFIX:-casaora/web}"
    SECRET_CLERK_PUBLISHABLE_NAME="${SECRET_CLERK_PUBLISHABLE_NAME:-${SECRET_PREFIX}/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
    SECRET_CLERK_SECRET_NAME="${SECRET_CLERK_SECRET_NAME:-${SECRET_PREFIX}/CLERK_SECRET_KEY}"
    DOCKER_CONTEXT="."
    DOCKERFILE="apps/web/Dockerfile"
    build_args=(
      --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}"
      --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}"
      --build-arg "NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}"
      --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
      --build-arg "NEXT_PUBLIC_CLERK_DOMAIN=${CLERK_DOMAIN}"
      --build-arg "NEXT_PUBLIC_CLERK_JS_URL=${CLERK_JS_URL}"
    )
    ;;
esac

# ── Common functions ─────────────────────────────────────────────

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

resolve_alb_dns() {
  aws_cmd elbv2 describe-load-balancers \
    --names "${ALB_NAME}" \
    --query 'LoadBalancers[0].DNSName' \
    --output text 2>/dev/null || true
}

run_smoke_request() {
  local base_url="$1"
  local path="$2"
  local output_file="$3"
  shift 3

  : > "${output_file}"

  local http_code
  if ! http_code="$(curl -sS -o "${output_file}" -w '%{http_code}' "$@" "${base_url}${path}" 2>/dev/null)"; then
    http_code="000"
  fi

  printf '%s' "${http_code}"
}

resolve_existing_secret_ref() {
  local env_var_name="$1"
  local secret_name="$2"
  local existing_ref=""

  if [[ -n "${current_taskdef_arn:-}" ]]; then
    existing_ref="$(
      aws_cmd ecs describe-task-definition \
        --task-definition "${current_taskdef_arn}" \
        --query "taskDefinition.containerDefinitions[?name=='${CONTAINER_NAME}'] | [0].secrets[?name=='${env_var_name}'] | [0].valueFrom" \
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

rollback_to_previous() {
  if [[ "${AUTO_ROLLBACK}" != "true" || -z "${previous_taskdef_arn:-}" ]]; then
    return
  fi
  echo "==> AUTO-ROLLBACK: reverting ${SERVICE_NAME} to ${previous_taskdef_arn}" >&2
  aws_cmd ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --task-definition "${previous_taskdef_arn}" \
    --force-new-deployment >/dev/null
  echo "==> Rollback initiated. Waiting for stability..." >&2
  aws_cmd ecs wait services-stable --cluster "${CLUSTER_NAME}" --services "${SERVICE_NAME}" || true
  echo "==> Rollback complete." >&2
}

# ── Pre-flight ───────────────────────────────────────────────────

require_bin "${AWS_BIN}"
require_bin jq
require_bin "${DOCKER_BIN}"
require_bin curl

cleanup() {
  [[ -n "${tmp_taskdef:-}" && -f "${tmp_taskdef}" ]] && rm -f "${tmp_taskdef}"
  [[ -n "${tmp_smoke_body:-}" && -f "${tmp_smoke_body}" ]] && rm -f "${tmp_smoke_body}"
  [[ -n "${tmp_smoke_body2:-}" && -f "${tmp_smoke_body2}" ]] && rm -f "${tmp_smoke_body2}"
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
previous_taskdef_arn="${current_taskdef_arn}"

# ── Resolve secrets ──────────────────────────────────────────────

case "${APP}" in
  backend)
    database_url_secret_ref="$(resolve_existing_secret_ref "DATABASE_URL" "${SECRET_DATABASE_URL_NAME}")"
    openai_secret_ref="$(resolve_existing_secret_ref "OPENAI_API_KEY" "${SECRET_OPENAI_NAME}")"
    internal_api_key_secret_ref="$(resolve_existing_secret_ref "INTERNAL_API_KEY" "${SECRET_INTERNAL_API_KEY_NAME}")"
    ;;
  admin|web)
    clerk_publishable_secret_ref="$(resolve_existing_secret_ref "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" "${SECRET_CLERK_PUBLISHABLE_NAME}")"
    clerk_secret_ref="$(resolve_existing_secret_ref "CLERK_SECRET_KEY" "${SECRET_CLERK_SECRET_NAME}")"
    clerk_publishable_key="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
    if [[ -z "${clerk_publishable_key}" ]]; then
      echo "Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Set it in the GitHub Production environment secrets." >&2
      exit 1
    fi
    ;;
esac

# ── Build image ──────────────────────────────────────────────────

if [[ "${SKIP_IMAGE_BUILD}" == "true" ]]; then
  echo "==> Skipping ${APP} image build and push; reusing ${image_uri}"
else
  echo "==> Logging into ECR"
  aws_cmd ecr get-login-password | "${DOCKER_BIN}" login --username AWS --password-stdin "${account_id}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null

  if [[ "${DOCKER_BUILDX}" == "true" ]]; then
    echo "==> Building and pushing ${APP} image via buildx (${DOCKER_PLATFORM}) -> ${image_uri}"
    buildx_args=(buildx build --platform "${DOCKER_PLATFORM}")
    if [[ "${DOCKER_REGISTRY_CACHE}" == "true" ]]; then
      buildx_args+=(
        --cache-from "type=registry,ref=${build_cache_ref}"
        --cache-to "type=registry,ref=${build_cache_ref},mode=max,ignore-error=true"
      )
    else
      echo "==> Registry cache disabled for this run"
    fi
    [[ ${#build_args[@]} -gt 0 ]] && buildx_args+=("${build_args[@]}")
    buildx_args+=(
      -f "${DOCKERFILE}"
      -t "${image_uri}"
      --push
      "${DOCKER_CONTEXT}"
    )
    "${DOCKER_BIN}" "${buildx_args[@]}"
  else
    echo "==> Building ${APP} image (ARM64 for Fargate) -> ${image_uri}"
    cmd_args=(build)
    [[ ${#build_args[@]} -gt 0 ]] && cmd_args+=("${build_args[@]}")
    cmd_args+=(-f "${DOCKERFILE}" -t "${image_uri}" "${DOCKER_CONTEXT}")
    "${DOCKER_BIN}" "${cmd_args[@]}"

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

# ── Register task definition ────────────────────────────────────

echo "==> Registering task definition"
tmp_taskdef="$(mktemp)"

case "${APP}" in
  backend)
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
    ;;
  admin)
    jq \
      --arg image_uri "${image_uri}" \
      --arg api_base_url "${NEXT_PUBLIC_API_BASE_URL}" \
      --arg internal_api_base_url "${INTERNAL_API_BASE_URL}" \
      --arg site_url "${NEXT_PUBLIC_SITE_URL}" \
      --arg clerk_domain "${CLERK_DOMAIN}" \
      --arg clerk_js_url "${CLERK_JS_URL}" \
      --arg clerk_publishable_secret_ref "${clerk_publishable_secret_ref}" \
      --arg clerk_secret_ref "${clerk_secret_ref}" \
      '
        .containerDefinitions[0].image = $image_uri
        | .containerDefinitions[0].environment |= map(
            if .name == "NEXT_PUBLIC_API_BASE_URL" then .value = $api_base_url
            elif .name == "INTERNAL_API_BASE_URL" then .value = $internal_api_base_url
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
    ;;
  web)
    jq \
      --arg image_uri "${image_uri}" \
      --arg api_base_url "${NEXT_PUBLIC_API_BASE_URL}" \
      --arg site_url "${NEXT_PUBLIC_SITE_URL}" \
      --arg admin_url "${NEXT_PUBLIC_ADMIN_URL}" \
      --arg clerk_domain "${CLERK_DOMAIN}" \
      --arg clerk_js_url "${CLERK_JS_URL}" \
      --arg clerk_publishable_secret_ref "${clerk_publishable_secret_ref}" \
      --arg clerk_secret_ref "${clerk_secret_ref}" \
      '
        .containerDefinitions[0].image = $image_uri
        | .containerDefinitions[0].environment |= map(
            if .name == "NEXT_PUBLIC_API_BASE_URL" then .value = $api_base_url
            elif .name == "NEXT_PUBLIC_SITE_URL" then .value = $site_url
            elif .name == "NEXT_PUBLIC_ADMIN_URL" then .value = $admin_url
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
    ;;
esac

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

# ── Update service ───────────────────────────────────────────────

echo "==> Updating ECS service ${SERVICE_NAME}"
aws_cmd ecs update-service \
  --cluster "${CLUSTER_NAME}" \
  --service "${SERVICE_NAME}" \
  --task-definition "${taskdef_arn}" \
  --force-new-deployment >/dev/null

if [[ "${APP}" == "backend" && -n "${CLOUD_MAP_SERVICE_ARN}" ]]; then
  echo "==> Ensuring Cloud Map service registry on ${SERVICE_NAME}"
  aws_cmd ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --service-registries "registryArn=${CLOUD_MAP_SERVICE_ARN},containerName=${CONTAINER_NAME},containerPort=${BACKEND_PORT}" >/dev/null
fi

if ! wait_for_ecs_stability; then
  echo "ECS deployment did not stabilize after ${ECS_STABILITY_WAIT_ATTEMPTS} wait attempt(s)." >&2
  rollback_to_previous
  exit 2
fi

# ── Smoke tests ──────────────────────────────────────────────────

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

smoke_failed=false

case "${APP}" in
  backend)
    echo "==> Smoke tests via ${SMOKE_BASE_URL}"
    tmp_smoke_body="$(mktemp)"
    tmp_smoke_body2="$(mktemp)"
    live_status="$(run_smoke_request "${SMOKE_BASE_URL}" "/v1/live" "${tmp_smoke_body}")"
    ready_status="$(run_smoke_request "${SMOKE_BASE_URL}" "/v1/ready" "${tmp_smoke_body2}")"

    smoke_base_url_used="${SMOKE_BASE_URL}"
    smoke_path_mode="public"

    if [[ "${ready_status}" != "200" ]]; then
      alb_dns="$(resolve_alb_dns)"
      if [[ -n "${alb_dns}" && "${alb_dns}" != "None" ]]; then
        echo "==> Public smoke checks failed; retrying against ALB origin ${alb_dns}" >&2
        smoke_base_url_used="https://${alb_dns}"
        smoke_path_mode="alb_origin"
        live_status="$(run_smoke_request "${smoke_base_url_used}" "/v1/live" "${tmp_smoke_body}" -k)"
        ready_status="$(run_smoke_request "${smoke_base_url_used}" "/v1/ready" "${tmp_smoke_body2}" -k)"
      fi
    fi

    echo "/v1/live -> ${live_status}"
    echo "/v1/ready -> ${ready_status}"

    echo "==> Backend production deploy summary"
    jq -n \
      --arg cluster "${CLUSTER_NAME}" \
      --arg service "${SERVICE_NAME}" \
      --arg task_definition_arn "${taskdef_arn}" \
      --arg image_uri "${image_uri}" \
      --arg smoke_base_url "${smoke_base_url_used}" \
      --arg smoke_path_mode "${smoke_path_mode}" \
      --arg live_status "${live_status}" \
      --arg ready_status "${ready_status}" \
      --arg live_body "$(cat "${tmp_smoke_body}")" \
      --arg ready_body "$(cat "${tmp_smoke_body2}")" \
      '{
        cluster: $cluster,
        service: $service,
        task_definition_arn: $task_definition_arn,
        image_uri: $image_uri,
        smoke_base_url: $smoke_base_url,
        smoke_path_mode: $smoke_path_mode,
        smoke: {
          live: { status: ($live_status | tonumber), body: ($live_body | fromjson?) },
          ready: { status: ($ready_status | tonumber), body: ($ready_body | fromjson?) }
        }
      }'

    if [[ "${ready_status}" != "200" ]]; then
      echo "Readiness check failed; keeping service on live target group for bootstrap traffic." >&2
      smoke_failed=true
    fi
    ;;
  admin|web)
    smoke_url="${SMOKE_BASE_URL}${SMOKE_PATH}"
    echo "==> Smoke test ${smoke_url}"
    tmp_smoke_body="$(mktemp)"
    smoke_status="$(curl -sS -o "${tmp_smoke_body}" -w '%{http_code}' "${smoke_url}")"

    echo "${SMOKE_PATH} -> ${smoke_status}"

    jq -n \
      --arg cluster "${CLUSTER_NAME}" \
      --arg service "${SERVICE_NAME}" \
      --arg task_definition_arn "${taskdef_arn}" \
      --arg image_uri "${image_uri}" \
      --arg smoke_url "${smoke_url}" \
      --arg smoke_status "${smoke_status}" \
      --arg body_preview "$(head -c 500 "${tmp_smoke_body}")" \
      '{
        cluster: $cluster,
        service: $service,
        task_definition_arn: $task_definition_arn,
        image_uri: $image_uri,
        smoke: {
          url: $smoke_url,
          status: ($smoke_status | tonumber),
          body_preview: $body_preview
        }
      }'

    if [[ "${smoke_status}" -ge 500 ]]; then
      echo "${APP^} smoke test failed (${smoke_status})" >&2
      smoke_failed=true
    fi
    ;;
esac

if [[ "${smoke_failed}" == "true" ]]; then
  rollback_to_previous
  exit 3
fi
