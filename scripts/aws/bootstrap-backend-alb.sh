#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"

ALB_NAME="${ALB_NAME:-${NAME_PREFIX}-alb}"
ALB_SG_NAME="${ALB_SG_NAME:-${NAME_PREFIX}-alb-sg}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"

LIVE_TG_NAME="${LIVE_TG_NAME:-casaora-prod-backend-live-tg}"
READY_TG_NAME="${READY_TG_NAME:-casaora-prod-backend-ready-tg}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

vpc_id="$(aws_cmd ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=${VPC_NAME}" \
  --query 'Vpcs[0].VpcId' --output text)"
if [[ -z "${vpc_id}" || "${vpc_id}" == "None" ]]; then
  echo "VPC not found: ${VPC_NAME}" >&2
  exit 1
fi

alb_sg_id="$(aws_cmd ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ALB_SG_NAME}" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [[ -z "${alb_sg_id}" || "${alb_sg_id}" == "None" ]]; then
  echo "ALB security group not found: ${ALB_SG_NAME}" >&2
  exit 1
fi

public_subnets_json="$(aws_cmd ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-*" \
  --query 'Subnets[].{id:SubnetId,az:AvailabilityZone,name:Tags[?Key==`Name`]|[0].Value}' --output json \
  | jq 'sort_by(.az) | .[:2]')"

public_subnet_count="$(echo "${public_subnets_json}" | jq 'length')"
if [[ "${public_subnet_count}" -lt 2 ]]; then
  echo "Need 2 public subnets tagged ${NAME_PREFIX}-public-* in ${vpc_id}" >&2
  exit 1
fi

subnet_a="$(echo "${public_subnets_json}" | jq -r '.[0].id')"
subnet_b="$(echo "${public_subnets_json}" | jq -r '.[1].id')"

ensure_tg() {
  local tg_name="$1"
  local health_path="$2"
  local tg_arn
  tg_arn="$(aws_cmd elbv2 describe-target-groups --names "${tg_name}" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
  if [[ -z "${tg_arn}" || "${tg_arn}" == "None" ]]; then
    echo "Creating target group: ${tg_name} (${health_path})" >&2
    tg_arn="$(aws_cmd elbv2 create-target-group \
      --name "${tg_name}" \
      --protocol HTTP \
      --port "${BACKEND_PORT}" \
      --target-type ip \
      --vpc-id "${vpc_id}" \
      --health-check-protocol HTTP \
      --health-check-path "${health_path}" \
      --health-check-port traffic-port \
      --matcher HttpCode=200 \
      --query 'TargetGroups[0].TargetGroupArn' --output text)"
  else
    echo "Target group exists: ${tg_name}" >&2
  fi

  aws_cmd elbv2 modify-target-group \
    --target-group-arn "${tg_arn}" \
    --health-check-protocol HTTP \
    --health-check-path "${health_path}" \
    --health-check-port traffic-port \
    --matcher HttpCode=200 \
    --health-check-interval-seconds 15 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 2 >/dev/null

  aws_cmd elbv2 describe-target-groups --target-group-arns "${tg_arn}" \
    --query 'TargetGroups[0].{name:TargetGroupName,arn:TargetGroupArn,port:Port,healthPath:HealthCheckPath}' --output json
}

alb_arn="$(aws_cmd elbv2 describe-load-balancers --names "${ALB_NAME}" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
if [[ -z "${alb_arn}" || "${alb_arn}" == "None" ]]; then
  echo "Creating ALB: ${ALB_NAME}" >&2
  alb_arn="$(aws_cmd elbv2 create-load-balancer \
    --name "${ALB_NAME}" \
    --type application \
    --scheme internet-facing \
    --security-groups "${alb_sg_id}" \
    --subnets "${subnet_a}" "${subnet_b}" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
else
  echo "ALB exists: ${ALB_NAME}" >&2
fi

aws_cmd elbv2 wait load-balancer-available --load-balancer-arns "${alb_arn}"

alb_json="$(aws_cmd elbv2 describe-load-balancers --load-balancer-arns "${alb_arn}" \
  --query 'LoadBalancers[0].{name:LoadBalancerName,arn:LoadBalancerArn,dnsName:DNSName,zoneId:CanonicalHostedZoneId,vpcId:VpcId}' \
  --output json)"

live_tg_json="$(ensure_tg "${LIVE_TG_NAME}" "/v1/live")"
ready_tg_json="$(ensure_tg "${READY_TG_NAME}" "/v1/ready")"
live_tg_arn="$(echo "${live_tg_json}" | jq -r '.arn')"

listener_arn="$(aws_cmd elbv2 describe-listeners --load-balancer-arn "${alb_arn}" \
  --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text 2>/dev/null || true)"
if [[ -z "${listener_arn}" || "${listener_arn}" == "None" ]]; then
  echo "Creating HTTP listener (port 80) -> live target group" >&2
  listener_arn="$(aws_cmd elbv2 create-listener \
    --load-balancer-arn "${alb_arn}" \
    --protocol HTTP \
    --port 80 \
    --default-actions "Type=forward,TargetGroupArn=${live_tg_arn}" \
    --query 'Listeners[0].ListenerArn' --output text)"
else
  echo "HTTP listener exists; setting default action to live target group" >&2
  aws_cmd elbv2 modify-listener \
    --listener-arn "${listener_arn}" \
    --default-actions "Type=forward,TargetGroupArn=${live_tg_arn}" >/dev/null
fi

listener_json="$(aws_cmd elbv2 describe-listeners --listener-arns "${listener_arn}" \
  --query 'Listeners[0].{arn:ListenerArn,port:Port,protocol:Protocol}' --output json)"

echo "==> ALB bootstrap summary"
jq -n \
  --argjson alb "${alb_json}" \
  --argjson live_tg "${live_tg_json}" \
  --argjson ready_tg "${ready_tg_json}" \
  --argjson listener "${listener_json}" \
  --arg subnet_a "${subnet_a}" \
  --arg subnet_b "${subnet_b}" \
  --arg alb_sg_id "${alb_sg_id}" \
  '{
    load_balancer: $alb,
    listener_http: $listener,
    target_groups: {
      live: $live_tg,
      ready: $ready_tg
    },
    public_subnets: [$subnet_a, $subnet_b],
    alb_security_group_id: $alb_sg_id,
    backend_bootstrap_health_path: "/v1/live",
    note: "Listener forwards to live target group for bootstrap. Switch to ready target group after DB/auth secrets are configured."
  }'
