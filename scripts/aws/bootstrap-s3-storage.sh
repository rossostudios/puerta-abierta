#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

PUBLIC_BUCKET_NAME="${PUBLIC_BUCKET_NAME:-casaora-prod-public-media-341112583495}"
PRIVATE_BUCKET_NAME="${PRIVATE_BUCKET_NAME:-casaora-prod-private-documents-341112583495}"
CREATE_PRIVATE_BUCKET="${CREATE_PRIVATE_BUCKET:-false}"

PROJECT_TAG="${PROJECT_TAG:-Casaora}"
ENVIRONMENT_TAG="${ENVIRONMENT_TAG:-production}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

cleanup() {
  [[ -n "${PUBLIC_CORS_FILE:-}" && -f "${PUBLIC_CORS_FILE}" ]] && rm -f "${PUBLIC_CORS_FILE}"
  [[ -n "${PUBLIC_POLICY_FILE:-}" && -f "${PUBLIC_POLICY_FILE}" ]] && rm -f "${PUBLIC_POLICY_FILE}"
}
trap cleanup EXIT

ensure_bucket() {
  local bucket="$1"
  if aws_cmd s3api head-bucket --bucket "${bucket}" >/dev/null 2>&1; then
    echo "Bucket exists: ${bucket}" >&2
    return 0
  fi

  echo "Creating bucket: ${bucket}" >&2
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws_cmd s3api create-bucket --bucket "${bucket}" >/dev/null
  else
    aws_cmd s3api create-bucket \
      --bucket "${bucket}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
}

tag_bucket() {
  local bucket="$1"
  aws_cmd s3api put-bucket-tagging \
    --bucket "${bucket}" \
    --tagging "TagSet=[{Key=Project,Value=${PROJECT_TAG}},{Key=Environment,Value=${ENVIRONMENT_TAG}}]" \
    >/dev/null
}

enable_bucket_defaults() {
  local bucket="$1"
  aws_cmd s3api put-bucket-versioning \
    --bucket "${bucket}" \
    --versioning-configuration Status=Enabled >/dev/null
}

PUBLIC_CORS_FILE="$(mktemp)"
cat > "${PUBLIC_CORS_FILE}" <<'EOF'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedOrigins": [
        "https://app.casaora.co",
        "https://casaora.co",
        "https://www.casaora.co",
        "http://localhost:3000",
        "http://localhost:3001"
      ],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

PUBLIC_POLICY_FILE="$(mktemp)"
cat > "${PUBLIC_POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadObjects",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::${PUBLIC_BUCKET_NAME}/*"
    }
  ]
}
EOF

echo "==> Bootstrapping S3 storage buckets"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"

ensure_bucket "${PUBLIC_BUCKET_NAME}"
tag_bucket "${PUBLIC_BUCKET_NAME}"
enable_bucket_defaults "${PUBLIC_BUCKET_NAME}"

echo "Configuring public bucket ownership + public access policy"
aws_cmd s3api put-public-access-block \
  --bucket "${PUBLIC_BUCKET_NAME}" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": false,
    "RestrictPublicBuckets": false
  }' >/dev/null
aws_cmd s3api put-bucket-ownership-controls \
  --bucket "${PUBLIC_BUCKET_NAME}" \
  --ownership-controls '{
    "Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]
  }' >/dev/null
aws_cmd s3api put-bucket-cors \
  --bucket "${PUBLIC_BUCKET_NAME}" \
  --cors-configuration "file://${PUBLIC_CORS_FILE}" >/dev/null
aws_cmd s3api put-bucket-policy \
  --bucket "${PUBLIC_BUCKET_NAME}" \
  --policy "file://${PUBLIC_POLICY_FILE}" >/dev/null

if [[ "${CREATE_PRIVATE_BUCKET}" == "true" ]]; then
  ensure_bucket "${PRIVATE_BUCKET_NAME}"
  tag_bucket "${PRIVATE_BUCKET_NAME}"
  enable_bucket_defaults "${PRIVATE_BUCKET_NAME}"
  aws_cmd s3api put-public-access-block \
    --bucket "${PRIVATE_BUCKET_NAME}" \
    --public-access-block-configuration '{
      "BlockPublicAcls": true,
      "IgnorePublicAcls": true,
      "BlockPublicPolicy": true,
      "RestrictPublicBuckets": true
    }' >/dev/null
  aws_cmd s3api put-bucket-ownership-controls \
    --bucket "${PRIVATE_BUCKET_NAME}" \
    --ownership-controls '{
      "Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]
    }' >/dev/null
fi

jq -n \
  --arg region "${REGION}" \
  --arg public_bucket "${PUBLIC_BUCKET_NAME}" \
  --arg public_base_url "$(if [[ "${REGION}" == "us-east-1" ]]; then printf 'https://%s.s3.amazonaws.com' "${PUBLIC_BUCKET_NAME}"; else printf 'https://%s.s3.%s.amazonaws.com' "${PUBLIC_BUCKET_NAME}" "${REGION}"; fi)" \
  --arg private_bucket "$(if [[ "${CREATE_PRIVATE_BUCKET}" == "true" ]]; then printf '%s' "${PRIVATE_BUCKET_NAME}"; else printf ''; fi)" \
  '{
    region: $region,
    public_bucket: $public_bucket,
    public_base_url: $public_base_url,
    private_bucket: (if $private_bucket == "" then null else $private_bucket end)
  }'

