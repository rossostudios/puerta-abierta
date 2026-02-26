#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

echo "==> AWS access check"
echo "Profile: ${PROFILE}"
echo "Region:  ${REGION}"

"${AWS_BIN}" --version

echo "==> STS caller identity"
"${AWS_BIN}" sts get-caller-identity --profile "${PROFILE}" --output json

echo "==> ECS API access"
"${AWS_BIN}" ecs list-clusters --profile "${PROFILE}" --region "${REGION}" --max-items 5 >/dev/null
echo "ECS access OK"

echo "==> ECR API access"
"${AWS_BIN}" ecr describe-registry --profile "${PROFILE}" --region "${REGION}" >/dev/null
echo "ECR access OK"

echo "==> IAM Identity Center session cache"
if [[ -d "${HOME}/.aws/sso/cache" ]]; then
  ls "${HOME}/.aws/sso/cache" >/dev/null
  echo "SSO cache present"
else
  echo "No SSO cache directory found"
fi

echo "==> AWS access check passed"
