#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
DOMAIN_NAME="${DOMAIN_NAME:-api.casaora.co}"
SUBJECT_ALTERNATIVE_NAMES="${SUBJECT_ALTERNATIVE_NAMES:-}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

find_existing_cert() {
  aws_cmd acm list-certificates --certificate-statuses PENDING_VALIDATION ISSUED INACTIVE EXPIRED FAILED \
    --query "CertificateSummaryList[?DomainName=='${DOMAIN_NAME}'] | [0].CertificateArn" --output text 2>/dev/null || true
}

cert_arn="$(find_existing_cert)"
if [[ -z "${cert_arn}" || "${cert_arn}" == "None" ]]; then
  echo "Requesting ACM certificate for ${DOMAIN_NAME}" >&2
  request_args=(
    acm request-certificate
    --domain-name "${DOMAIN_NAME}"
    --validation-method DNS
    --key-algorithm RSA_2048
    --idempotency-token "$(echo "${DOMAIN_NAME}" | tr -cd 'a-z0-9' | head -c 32)"
    --options CertificateTransparencyLoggingPreference=ENABLED
  )
  if [[ -n "${SUBJECT_ALTERNATIVE_NAMES}" ]]; then
    IFS=',' read -r -a sans <<< "${SUBJECT_ALTERNATIVE_NAMES}"
    for san in "${sans[@]}"; do
      trimmed="$(echo "${san}" | awk '{$1=$1;print}')"
      [[ -n "${trimmed}" ]] && request_args+=(--subject-alternative-names "${trimmed}")
    done
  fi
  cert_arn="$(aws_cmd "${request_args[@]}" --query 'CertificateArn' --output text)"
else
  echo "ACM certificate already exists for ${DOMAIN_NAME}: ${cert_arn}" >&2
fi

records_json="[]"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  cert_json="$(aws_cmd acm describe-certificate --certificate-arn "${cert_arn}" --query 'Certificate' --output json)"
  rr_count="$(echo "${cert_json}" | jq '[.DomainValidationOptions[]? | select(.ResourceRecord != null)] | length')"
  if [[ "${rr_count}" -gt 0 ]]; then
    records_json="$(echo "${cert_json}" | jq '[.DomainValidationOptions[]? | select(.ResourceRecord != null) | .ResourceRecord]')"
    break
  fi
  sleep 2
done

status="$(aws_cmd acm describe-certificate --certificate-arn "${cert_arn}" --query 'Certificate.Status' --output text)"

echo "==> ACM certificate summary"
jq -n \
  --arg domain "${DOMAIN_NAME}" \
  --arg sans "${SUBJECT_ALTERNATIVE_NAMES}" \
  --arg cert_arn "${cert_arn}" \
  --arg status "${status}" \
  --argjson dns_records "${records_json}" \
  '{
    domain: $domain,
    subject_alternative_names: ($sans | if length == 0 then [] else split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0)) end),
    certificate_arn: $cert_arn,
    status: $status,
    dns_validation_records: $dns_records,
    cloudflare_action_required: (if $status == "ISSUED" then false else true end)
  }'
