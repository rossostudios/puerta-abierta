#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
VPC_NAME="${VPC_NAME:-${NAME_PREFIX}-vpc}"
ALB_NAME="${ALB_NAME:-${NAME_PREFIX}-alb}"
ALB_SG_NAME="${ALB_SG_NAME:-${NAME_PREFIX}-alb-sg}"
ECS_SG_NAME="${ECS_SG_NAME:-${NAME_PREFIX}-ecs-sg}"

TARGET_GROUP_NAME="${TARGET_GROUP_NAME:-casaora-prod-web-tg}"
CONTAINER_PORT="${CONTAINER_PORT:-3001}"
HEALTH_PATH="${HEALTH_PATH:-/}"
HEALTH_MATCHER="${HEALTH_MATCHER:-200-399}"
WEB_HOSTNAMES="${WEB_HOSTNAMES:-casaora.co,www.casaora.co}"
RULE_PRIORITY="${RULE_PRIORITY:-110}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_bin "${AWS_BIN}"
require_bin jq

vpc_id="$(aws_cmd ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=${VPC_NAME}" \
  --query 'Vpcs[0].VpcId' --output text)"
if [[ -z "${vpc_id}" || "${vpc_id}" == "None" ]]; then
  echo "VPC not found: ${VPC_NAME}" >&2
  exit 1
fi

alb_arn="$(aws_cmd elbv2 describe-load-balancers --names "${ALB_NAME}" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
if [[ -z "${alb_arn}" || "${alb_arn}" == "None" ]]; then
  echo "ALB not found: ${ALB_NAME}" >&2
  exit 1
fi

alb_sg_id="$(aws_cmd ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ALB_SG_NAME}" \
  --query 'SecurityGroups[0].GroupId' --output text)"
ecs_sg_id="$(aws_cmd ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${ECS_SG_NAME}" \
  --query 'SecurityGroups[0].GroupId' --output text)"

if [[ -z "${alb_sg_id}" || "${alb_sg_id}" == "None" || -z "${ecs_sg_id}" || "${ecs_sg_id}" == "None" ]]; then
  echo "Required security groups not found (ALB=${ALB_SG_NAME}, ECS=${ECS_SG_NAME})" >&2
  exit 1
fi

echo "==> Ensuring ECS service SG allows ALB ingress on ${CONTAINER_PORT}"
aws_cmd ec2 authorize-security-group-ingress \
  --group-id "${ecs_sg_id}" \
  --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":${CONTAINER_PORT},\"ToPort\":${CONTAINER_PORT},\"UserIdGroupPairs\":[{\"GroupId\":\"${alb_sg_id}\",\"Description\":\"ALB to web ECS\"}]}]" \
  >/dev/null 2>&1 || true

tg_arn="$(aws_cmd elbv2 describe-target-groups --names "${TARGET_GROUP_NAME}" \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [[ -z "${tg_arn}" || "${tg_arn}" == "None" ]]; then
  echo "==> Creating target group ${TARGET_GROUP_NAME}"
  tg_arn="$(aws_cmd elbv2 create-target-group \
    --name "${TARGET_GROUP_NAME}" \
    --protocol HTTP \
    --port "${CONTAINER_PORT}" \
    --target-type ip \
    --vpc-id "${vpc_id}" \
    --health-check-protocol HTTP \
    --health-check-port traffic-port \
    --health-check-path "${HEALTH_PATH}" \
    --matcher "HttpCode=${HEALTH_MATCHER}" \
    --query 'TargetGroups[0].TargetGroupArn' --output text)"
fi

aws_cmd elbv2 modify-target-group \
  --target-group-arn "${tg_arn}" \
  --health-check-protocol HTTP \
  --health-check-port traffic-port \
  --health-check-path "${HEALTH_PATH}" \
  --matcher "HttpCode=${HEALTH_MATCHER}" \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --health-check-interval-seconds 15 \
  --health-check-timeout-seconds 5 \
  >/dev/null

https_listener_arn="$(aws_cmd elbv2 describe-listeners --load-balancer-arn "${alb_arn}" \
  --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text 2>/dev/null || true)"
if [[ -z "${https_listener_arn}" || "${https_listener_arn}" == "None" ]]; then
  echo "HTTPS listener (:443) not found on ${ALB_NAME}" >&2
  exit 1
fi

IFS=',' read -r -a raw_hosts <<< "${WEB_HOSTNAMES}"
hosts_json="$(printf '%s\n' "${raw_hosts[@]}" | sed '/^\s*$/d' | awk '{$1=$1;print}' | jq -Rsc 'split("\n") | map(select(length > 0))')"
if [[ "$(echo "${hosts_json}" | jq 'length')" -eq 0 ]]; then
  echo "No web hostnames provided" >&2
  exit 1
fi

rules_json="$(aws_cmd elbv2 describe-rules --listener-arn "${https_listener_arn}" --output json)"
existing_rule_arn="$(echo "${rules_json}" | jq -r --argjson hosts "${hosts_json}" '
  .Rules[]
  | select(any(.Conditions[]?; .Field == "host-header" and ((.HostHeaderConfig.Values // []) | any(. as $v | $hosts | index($v)))))
  | .RuleArn
' | head -n1)"

conditions_json="$(jq -cn --argjson hosts "${hosts_json}" '[{Field:"host-header",HostHeaderConfig:{Values:$hosts}}]')"

if [[ -n "${existing_rule_arn}" ]]; then
  echo "==> Updating existing HTTPS host rule"
  aws_cmd elbv2 modify-rule \
    --rule-arn "${existing_rule_arn}" \
    --conditions "${conditions_json}" \
    --actions "Type=forward,TargetGroupArn=${tg_arn}" >/dev/null
  rule_arn="${existing_rule_arn}"
else
  echo "==> Creating HTTPS host rule (priority ${RULE_PRIORITY})"
  rule_arn="$(aws_cmd elbv2 create-rule \
    --listener-arn "${https_listener_arn}" \
    --priority "${RULE_PRIORITY}" \
    --conditions "${conditions_json}" \
    --actions "Type=forward,TargetGroupArn=${tg_arn}" \
    --query 'Rules[0].RuleArn' --output text)"
fi

alb_dns_name="$(aws_cmd elbv2 describe-load-balancers --load-balancer-arns "${alb_arn}" \
  --query 'LoadBalancers[0].DNSName' --output text)"
tg_json="$(aws_cmd elbv2 describe-target-groups --target-group-arns "${tg_arn}" \
  --query 'TargetGroups[0].{name:TargetGroupName,arn:TargetGroupArn,port:Port,healthPath:HealthCheckPath,matcher:Matcher.HttpCode}' \
  --output json)"

jq -n \
  --arg vpc_id "${vpc_id}" \
  --arg alb_arn "${alb_arn}" \
  --arg alb_dns_name "${alb_dns_name}" \
  --arg https_listener_arn "${https_listener_arn}" \
  --arg rule_arn "${rule_arn}" \
  --arg alb_sg_id "${alb_sg_id}" \
  --arg ecs_sg_id "${ecs_sg_id}" \
  --argjson hostnames "${hosts_json}" \
  --argjson target_group "${tg_json}" \
  '{
    vpc_id: $vpc_id,
    alb: { arn: $alb_arn, dns_name: $alb_dns_name },
    https_listener_arn: $https_listener_arn,
    listener_rule_arn: $rule_arn,
    hostnames: $hostnames,
    target_group: $target_group,
    security_groups: { alb: $alb_sg_id, ecs: $ecs_sg_id },
    note: "Attach the public site ACM cert to the ALB HTTPS listener (SNI), then point Cloudflare apex/www to the ALB and deploy the web ECS service."
  }'
