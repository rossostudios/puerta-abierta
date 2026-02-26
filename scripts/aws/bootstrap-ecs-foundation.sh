#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"
BACKEND_REPO="${BACKEND_ECR_REPOSITORY:-casaora-backend}"
ADMIN_REPO="${ADMIN_ECR_REPOSITORY:-casaora-admin}"
WEB_REPO="${WEB_ECR_REPOSITORY:-casaora-web}"
BACKEND_LOG_GROUP="${BACKEND_LOG_GROUP:-/ecs/casaora-backend}"
ADMIN_LOG_GROUP="${ADMIN_LOG_GROUP:-/ecs/casaora-admin}"
WEB_LOG_GROUP="${WEB_LOG_GROUP:-/ecs/casaora-web}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"

PROJECT_TAG_KEY="${PROJECT_TAG_KEY:-Project}"
PROJECT_TAG_VALUE="${PROJECT_TAG_VALUE:-Casaora}"
ENV_TAG_KEY="${ENV_TAG_KEY:-Environment}"
ENV_TAG_VALUE="${ENV_TAG_VALUE:-production}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

ecr_repo_exists() {
  local repo="$1"
  aws_cmd ecr describe-repositories --repository-names "${repo}" >/dev/null 2>&1
}

ensure_ecr_repo() {
  local repo="$1"
  if ecr_repo_exists "${repo}"; then
    echo "ECR repo exists: ${repo}" >&2
  else
    echo "Creating ECR repo: ${repo}" >&2
    aws_cmd ecr create-repository \
      --repository-name "${repo}" \
      --image-tag-mutability IMMUTABLE \
      --image-scanning-configuration scanOnPush=true \
      --tags "Key=${PROJECT_TAG_KEY},Value=${PROJECT_TAG_VALUE}" "Key=${ENV_TAG_KEY},Value=${ENV_TAG_VALUE}" \
      >/dev/null
  fi

  # Keep the latest 100 images by default to avoid unbounded growth.
  aws_cmd ecr put-lifecycle-policy \
    --repository-name "${repo}" \
    --lifecycle-policy-text '{
      "rules": [
        {
          "rulePriority": 1,
          "description": "Expire images beyond 100",
          "selection": {
            "tagStatus": "any",
            "countType": "imageCountMoreThan",
            "countNumber": 100
          },
          "action": { "type": "expire" }
        }
      ]
    }' >/dev/null

  aws_cmd ecr describe-repositories --repository-names "${repo}" \
    --query 'repositories[0].{name:repositoryName,uri:repositoryUri,arn:repositoryArn}' \
    --output json
}

ensure_ecs_cluster() {
  local cluster="$1"
  local status
  status="$(aws_cmd ecs describe-clusters --clusters "${cluster}" --query 'clusters[0].status' --output text 2>/dev/null || true)"

  if [[ "${status}" == "ACTIVE" || "${status}" == "PROVISIONING" ]]; then
    echo "ECS cluster exists: ${cluster} (${status})" >&2
  else
    echo "Creating ECS cluster: ${cluster}" >&2
    aws_cmd ecs create-cluster \
      --cluster-name "${cluster}" \
      --settings name=containerInsights,value=enabled \
      --tags key="${PROJECT_TAG_KEY}",value="${PROJECT_TAG_VALUE}" key="${ENV_TAG_KEY}",value="${ENV_TAG_VALUE}" \
      >/dev/null
  fi

  aws_cmd ecs describe-clusters --clusters "${cluster}" --include SETTINGS TAGS \
    --query 'clusters[0].{name:clusterName,arn:clusterArn,status:status,settings:settings}' \
    --output json
}

log_group_exists() {
  local group="$1"
  local found
  found="$(aws_cmd logs describe-log-groups \
    --log-group-name-prefix "${group}" \
    --query "logGroups[?logGroupName=='${group}'].logGroupName | [0]" \
    --output text 2>/dev/null || true)"
  [[ "${found}" == "${group}" ]]
}

ensure_log_group() {
  local group="$1"
  if log_group_exists "${group}"; then
    echo "CloudWatch log group exists: ${group}" >&2
  else
    echo "Creating CloudWatch log group: ${group}" >&2
    aws_cmd logs create-log-group --log-group-name "${group}" \
      --tags "${PROJECT_TAG_KEY}=${PROJECT_TAG_VALUE},${ENV_TAG_KEY}=${ENV_TAG_VALUE}"
  fi

  aws_cmd logs put-retention-policy \
    --log-group-name "${group}" \
    --retention-in-days "${LOG_RETENTION_DAYS}"

  aws_cmd logs describe-log-groups \
    --log-group-name-prefix "${group}" \
    --query "logGroups[?logGroupName=='${group}'] | [0].{name:logGroupName,retentionInDays:retentionInDays,arn:arn}" \
    --output json
}

echo "==> Bootstrapping AWS ECS foundation"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"
echo "Cluster: ${CLUSTER_NAME}"
echo "ECR repos: ${BACKEND_REPO}, ${ADMIN_REPO}, ${WEB_REPO}"
echo "Log groups: ${BACKEND_LOG_GROUP}, ${ADMIN_LOG_GROUP}, ${WEB_LOG_GROUP}"

echo "==> Verifying AWS access"
aws_cmd sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json

echo "==> ECS cluster"
cluster_json="$(ensure_ecs_cluster "${CLUSTER_NAME}")"
echo "${cluster_json}"

echo "==> ECR repositories"
backend_repo_json="$(ensure_ecr_repo "${BACKEND_REPO}")"
echo "${backend_repo_json}"
admin_repo_json="$(ensure_ecr_repo "${ADMIN_REPO}")"
echo "${admin_repo_json}"
web_repo_json="$(ensure_ecr_repo "${WEB_REPO}")"
echo "${web_repo_json}"

echo "==> CloudWatch log groups"
backend_log_json="$(ensure_log_group "${BACKEND_LOG_GROUP}")"
echo "${backend_log_json}"
admin_log_json="$(ensure_log_group "${ADMIN_LOG_GROUP}")"
echo "${admin_log_json}"
web_log_json="$(ensure_log_group "${WEB_LOG_GROUP}")"
echo "${web_log_json}"

echo "==> Bootstrap summary"
jq -n \
  --arg region "${REGION}" \
  --arg cluster_name "${CLUSTER_NAME}" \
  --argjson cluster "${cluster_json}" \
  --argjson backend_repo "${backend_repo_json}" \
  --argjson admin_repo "${admin_repo_json}" \
  --argjson web_repo "${web_repo_json}" \
  --argjson backend_log "${backend_log_json}" \
  --argjson admin_log "${admin_log_json}" \
  --argjson web_log "${web_log_json}" \
  '{
    region: $region,
    cluster: $cluster,
    ecr: {
      backend: $backend_repo,
      admin: $admin_repo,
      web: $web_repo
    },
    logs: {
      backend: $backend_log,
      admin: $admin_log,
      web: $web_log
    }
  }'
