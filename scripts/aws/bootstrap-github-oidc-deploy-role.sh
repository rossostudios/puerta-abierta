#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-rossostudios/casaora}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
ROLE_NAME="${GITHUB_OIDC_ROLE_NAME:-CasaoraGitHubActionsDeployRole}"
INLINE_POLICY_NAME="${GITHUB_OIDC_INLINE_POLICY_NAME:-CasaoraGitHubActionsEcsDeploy}"

BACKEND_ECR_REPOSITORY="${BACKEND_ECR_REPOSITORY:-casaora-backend}"
ADMIN_ECR_REPOSITORY="${ADMIN_ECR_REPOSITORY:-casaora-admin}"
ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-casaora-prod}"

# GitHub Actions OIDC provider thumbprint commonly used in AWS examples.
# If AWS/GitHub rotates this, rerun with GITHUB_OIDC_THUMBPRINT overridden.
GITHUB_OIDC_THUMBPRINT="${GITHUB_OIDC_THUMBPRINT:-6938fd4d98bab03faadb97b34396831e3780aea1}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

cleanup() {
  [[ -n "${TRUST_FILE:-}" && -f "${TRUST_FILE}" ]] && rm -f "${TRUST_FILE}"
  [[ -n "${POLICY_FILE:-}" && -f "${POLICY_FILE}" ]] && rm -f "${POLICY_FILE}"
}
trap cleanup EXIT

echo "==> Bootstrapping GitHub OIDC deploy role"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"
echo "Repo: ${GITHUB_REPOSITORY}"
echo "Branch: ${GITHUB_BRANCH}"
echo "Role: ${ROLE_NAME}"

ACCOUNT_ID="$(aws_cmd sts get-caller-identity --query Account --output text)"
echo "Account: ${ACCOUNT_ID}"

BACKEND_REPO_ARN="arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${BACKEND_ECR_REPOSITORY}"
ADMIN_REPO_ARN="arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${ADMIN_ECR_REPOSITORY}"

echo "==> Ensuring GitHub OIDC provider exists"
OIDC_PROVIDER_ARN="$(
  aws_cmd iam list-open-id-connect-providers --output json \
    | jq -r '.OpenIDConnectProviderList[].Arn'
)"

GITHUB_PROVIDER_ARN=""
if [[ -n "${OIDC_PROVIDER_ARN}" ]]; then
  while IFS= read -r arn; do
    [[ -z "${arn}" ]] && continue
    url="$(aws_cmd iam get-open-id-connect-provider --open-id-connect-provider-arn "${arn}" --query Url --output text 2>/dev/null || true)"
    if [[ "${url}" == "token.actions.githubusercontent.com" ]]; then
      GITHUB_PROVIDER_ARN="${arn}"
      break
    fi
  done <<< "${OIDC_PROVIDER_ARN}"
fi

if [[ -z "${GITHUB_PROVIDER_ARN}" ]]; then
  echo "Creating IAM OIDC provider for GitHub Actions"
  GITHUB_PROVIDER_ARN="$(
    aws_cmd iam create-open-id-connect-provider \
      --url "https://token.actions.githubusercontent.com" \
      --client-id-list "sts.amazonaws.com" \
      --thumbprint-list "${GITHUB_OIDC_THUMBPRINT}" \
      --query 'OpenIDConnectProviderArn' \
      --output text
  )"
else
  echo "OIDC provider exists: ${GITHUB_PROVIDER_ARN}"
fi

TRUST_FILE="$(mktemp)"
cat > "${TRUST_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${GITHUB_PROVIDER_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPOSITORY}:ref:refs/heads/${GITHUB_BRANCH}"
        }
      }
    }
  ]
}
EOF

echo "==> Ensuring IAM role exists"
if aws_cmd iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "Role exists, updating trust policy: ${ROLE_NAME}"
  aws_cmd iam update-assume-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-document "file://${TRUST_FILE}"
else
  echo "Creating role: ${ROLE_NAME}"
  aws_cmd iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "file://${TRUST_FILE}" \
    --description "GitHub Actions OIDC deploy role for Casaora ECS/ECR deploys" \
    --tags Key=Project,Value=Casaora Key=Environment,Value=production \
    >/dev/null
fi

POLICY_FILE="$(mktemp)"
cat > "${POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuth",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Sid": "EcrPushPull",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:ListImages",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": [
        "${BACKEND_REPO_ARN}",
        "${ADMIN_REPO_ARN}"
      ]
    },
    {
      "Sid": "EcsDeploy",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
        "ecs:RegisterTaskDefinition",
        "ecs:TagResource",
        "ecs:UpdateService"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassRolesToEcsTasks",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": "arn:aws:iam::${ACCOUNT_ID}:role/*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    },
    {
      "Sid": "CloudWatchLogsDescribe",
      "Effect": "Allow",
      "Action": ["logs:DescribeLogGroups"],
      "Resource": "*"
    }
  ]
}
EOF

echo "==> Attaching/updating inline policy: ${INLINE_POLICY_NAME}"
aws_cmd iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "${INLINE_POLICY_NAME}" \
  --policy-document "file://${POLICY_FILE}"

ROLE_ARN="$(aws_cmd iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)"

echo "==> GitHub OIDC deploy role ready"
jq -n \
  --arg account_id "${ACCOUNT_ID}" \
  --arg role_name "${ROLE_NAME}" \
  --arg role_arn "${ROLE_ARN}" \
  --arg provider_arn "${GITHUB_PROVIDER_ARN}" \
  --arg repo "${GITHUB_REPOSITORY}" \
  --arg branch "${GITHUB_BRANCH}" \
  '{
    account_id: $account_id,
    github_oidc_provider_arn: $provider_arn,
    role: {
      name: $role_name,
      arn: $role_arn
    },
    trust: {
      repository: $repo,
      branch: $branch
    },
    github_actions_secret_to_set: {
      name: "AWS_GITHUB_OIDC_ROLE_ARN",
      value: $role_arn
    }
  }'
