#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
TF_DIR="$(cd "$(dirname "$0")" && pwd)"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

command -v jq >/dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 1
}

cd "${TF_DIR}"

vpc_id="$(aws_cmd ec2 describe-vpcs --filters "Name=tag:Name,Values=${NAME_PREFIX}-vpc" --query 'Vpcs[0].VpcId' --output text)"
igw_id="$(aws_cmd ec2 describe-internet-gateways --filters "Name=tag:Name,Values=${NAME_PREFIX}-igw" --query 'InternetGateways[0].InternetGatewayId' --output text)"
subnet_public_a="$(aws_cmd ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME_PREFIX}-public-1a" --query 'Subnets[0].SubnetId' --output text)"
subnet_public_b="$(aws_cmd ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME_PREFIX}-public-1b" --query 'Subnets[0].SubnetId' --output text)"
subnet_private_a="$(aws_cmd ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME_PREFIX}-private-1a" --query 'Subnets[0].SubnetId' --output text)"
subnet_private_b="$(aws_cmd ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME_PREFIX}-private-1b" --query 'Subnets[0].SubnetId' --output text)"
rt_public="$(aws_cmd ec2 describe-route-tables --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-public-rt" --query 'RouteTables[0].RouteTableId' --output text)"
rt_private="$(aws_cmd ec2 describe-route-tables --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${NAME_PREFIX}-private-rt" --query 'RouteTables[0].RouteTableId' --output text)"
alb_sg="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${NAME_PREFIX}-alb-sg" --query 'SecurityGroups[0].GroupId' --output text)"
ecs_sg="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${NAME_PREFIX}-ecs-sg" --query 'SecurityGroups[0].GroupId' --output text)"
rds_sg="$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${NAME_PREFIX}-rds-sg" --query 'SecurityGroups[0].GroupId' --output text)"

alb_arn="$(aws_cmd elbv2 describe-load-balancers --names "${NAME_PREFIX}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
backend_live_tg_arn="$(aws_cmd elbv2 describe-target-groups --names casaora-prod-backend-live-tg --query 'TargetGroups[0].TargetGroupArn' --output text)"
backend_ready_tg_arn="$(aws_cmd elbv2 describe-target-groups --names casaora-prod-backend-ready-tg --query 'TargetGroups[0].TargetGroupArn' --output text)"
admin_web_tg_arn="$(aws_cmd elbv2 describe-target-groups --names casaora-prod-admin-web-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
web_tg_arn="$(aws_cmd elbv2 describe-target-groups --names casaora-prod-web-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
http_listener_arn="$(aws_cmd elbv2 describe-listeners --load-balancer-arn "$alb_arn" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)"
https_listener_arn="$(aws_cmd elbv2 describe-listeners --load-balancer-arn "$alb_arn" --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text)"
admin_rule_arn="$(aws_cmd elbv2 describe-rules --listener-arn "$https_listener_arn" --query "Rules[?Priority=='100'].RuleArn | [0]" --output text 2>/dev/null || true)"
web_rule_arn="$(aws_cmd elbv2 describe-rules --listener-arn "$https_listener_arn" --query "Rules[?Priority=='110'].RuleArn | [0]" --output text 2>/dev/null || true)"
listener_extra_certs_json="$(aws_cmd elbv2 describe-listener-certificates --listener-arn "$https_listener_arn" --query 'Certificates[?IsDefault==`false`].CertificateArn' --output json 2>/dev/null || echo '[]')"
admin_listener_cert_arn="$(echo "${listener_extra_certs_json}" | jq -r '.[0] // empty')"
web_listener_cert_arn="$(echo "${listener_extra_certs_json}" | jq -r '.[1] // empty')"

ecs_from_alb_backend_rule_id="$(aws_cmd ec2 describe-security-group-rules --filters "Name=group-id,Values=${ecs_sg}" --output json | jq -r --arg ref "${alb_sg}" '.SecurityGroupRules[] | select((.IsEgress|not) and .IpProtocol=="tcp" and .FromPort==8000 and .ToPort==8000 and .ReferencedGroupInfo.GroupId==$ref) | .SecurityGroupRuleId' | head -n1)"
ecs_from_alb_admin_rule_id="$(aws_cmd ec2 describe-security-group-rules --filters "Name=group-id,Values=${ecs_sg}" --output json | jq -r --arg ref "${alb_sg}" '.SecurityGroupRules[] | select((.IsEgress|not) and .IpProtocol=="tcp" and .FromPort==3000 and .ToPort==3000 and .ReferencedGroupInfo.GroupId==$ref) | .SecurityGroupRuleId' | head -n1)"
rds_from_ecs_rule_id="$(aws_cmd ec2 describe-security-group-rules --filters "Name=group-id,Values=${rds_sg}" --output json | jq -r --arg ref "${ecs_sg}" '.SecurityGroupRules[] | select((.IsEgress|not) and .IpProtocol=="tcp" and .FromPort==5432 and .ToPort==5432 and .ReferencedGroupInfo.GroupId==$ref) | .SecurityGroupRuleId' | head -n1)"

echo "==> terraform init (run first if needed)"
echo "==> importing core resources"
terraform import aws_vpc.main "$vpc_id"
terraform import aws_internet_gateway.main "$igw_id"
terraform import aws_subnet.public_a "$subnet_public_a"
terraform import aws_subnet.public_b "$subnet_public_b"
terraform import aws_subnet.private_a "$subnet_private_a"
terraform import aws_subnet.private_b "$subnet_private_b"
terraform import aws_route_table.public "$rt_public"
terraform import aws_route_table.private "$rt_private"
terraform import aws_route.public_default_ipv4 "${rt_public}_0.0.0.0/0"
terraform import aws_route_table_association.public_a "${subnet_public_a}/${rt_public}"
terraform import aws_route_table_association.public_b "${subnet_public_b}/${rt_public}"
terraform import aws_route_table_association.private_a "${subnet_private_a}/${rt_private}"
terraform import aws_route_table_association.private_b "${subnet_private_b}/${rt_private}"
terraform import aws_security_group.alb "$alb_sg"
terraform import aws_security_group.ecs "$ecs_sg"
terraform import aws_security_group.rds "$rds_sg"
terraform import aws_vpc_security_group_ingress_rule.ecs_from_alb_backend "$ecs_from_alb_backend_rule_id"
terraform import aws_vpc_security_group_ingress_rule.ecs_from_alb_admin "$ecs_from_alb_admin_rule_id"
terraform import aws_vpc_security_group_ingress_rule.rds_from_ecs "$rds_from_ecs_rule_id"
terraform import aws_db_subnet_group.main "${NAME_PREFIX}-db-subnet-group"
terraform import aws_ecs_cluster.main "casaora-prod"
terraform import aws_ecr_repository.backend "casaora-backend"
terraform import aws_ecr_repository.admin "casaora-admin"
terraform import aws_ecr_repository.web "casaora-web" || true
terraform import aws_ecr_lifecycle_policy.backend "casaora-backend"
terraform import aws_ecr_lifecycle_policy.admin "casaora-admin"
terraform import aws_ecr_lifecycle_policy.web "casaora-web" || true
terraform import aws_cloudwatch_log_group.backend "/ecs/casaora-backend"
terraform import aws_cloudwatch_log_group.admin "/ecs/casaora-admin"
terraform import aws_cloudwatch_log_group.web "/ecs/casaora-web" || true
terraform import 'aws_cloudwatch_log_group.scheduler_job_runner[0]' "/ecs/casaora-job-runner" || true
terraform import aws_lb.main "$alb_arn"
terraform import aws_lb_target_group.backend_live "$backend_live_tg_arn"
terraform import aws_lb_target_group.backend_ready "$backend_ready_tg_arn"
terraform import aws_lb_listener.http "$http_listener_arn"
terraform import aws_lb_listener.https "$https_listener_arn"
if [[ -n "${admin_web_tg_arn}" && "${admin_web_tg_arn}" != "None" ]]; then
  terraform import 'aws_lb_target_group.admin_web[0]' "$admin_web_tg_arn" || true
fi
if [[ -n "${web_tg_arn}" && "${web_tg_arn}" != "None" ]]; then
  terraform import 'aws_lb_target_group.web[0]' "$web_tg_arn" || true
fi
if [[ -n "${admin_rule_arn}" && "${admin_rule_arn}" != "None" ]]; then
  terraform import 'aws_lb_listener_rule.admin_host[0]' "$admin_rule_arn" || true
fi
if [[ -n "${web_rule_arn}" && "${web_rule_arn}" != "None" ]]; then
  terraform import 'aws_lb_listener_rule.web_host[0]' "$web_rule_arn" || true
fi
if [[ -n "${admin_listener_cert_arn}" && "${admin_listener_cert_arn}" != "None" ]]; then
  terraform import 'aws_lb_listener_certificate.admin_https[0]' "${https_listener_arn}_${admin_listener_cert_arn}" || true
fi
if [[ -n "${web_listener_cert_arn}" && "${web_listener_cert_arn}" != "None" ]]; then
  terraform import 'aws_lb_listener_certificate.web_https[0]' "${https_listener_arn}_${web_listener_cert_arn}" || true
fi

eventbridge_role_arn="$(aws_cmd iam get-role --role-name casaora-eventbridge-ecs-run-task-role --query 'Role.Arn' --output text 2>/dev/null || true)"
if [[ -n "${eventbridge_role_arn}" && "${eventbridge_role_arn}" != "None" ]]; then
  terraform import 'aws_iam_role.eventbridge_ecs_run_task[0]' "casaora-eventbridge-ecs-run-task-role" || true
  terraform import 'aws_iam_role_policy.eventbridge_ecs_run_task[0]' "casaora-eventbridge-ecs-run-task-role:CasaoraEventBridgeRunEcsTask" || true
fi

scheduler_taskdef_arn="$(aws_cmd ecs describe-task-definition --task-definition casaora-job-runner --query 'taskDefinition.taskDefinitionArn' --output text 2>/dev/null || true)"
if [[ -n "${scheduler_taskdef_arn}" && "${scheduler_taskdef_arn}" != "None" ]]; then
  terraform import 'aws_ecs_task_definition.scheduler_job_runner[0]' "${scheduler_taskdef_arn}" || true
fi

for rule_name in casaora-process-notifications-5m casaora-notifications-retention-daily casaora-process-workflow-jobs-1m; do
  rule_arn="$(aws_cmd events describe-rule --name "${rule_name}" --query 'Arn' --output text 2>/dev/null || true)"
  if [[ -z "${rule_arn}" || "${rule_arn}" == "None" ]]; then
    continue
  fi
  case "${rule_name}" in
    casaora-process-notifications-5m)
      terraform import 'aws_cloudwatch_event_rule.process_notifications[0]' "${rule_name}" || true
      terraform import 'aws_cloudwatch_event_target.process_notifications[0]' "${rule_name}/process-notifications" || true
      ;;
    casaora-notifications-retention-daily)
      terraform import 'aws_cloudwatch_event_rule.notifications_retention[0]' "${rule_name}" || true
      terraform import 'aws_cloudwatch_event_target.notifications_retention[0]' "${rule_name}/notifications-retention" || true
      ;;
    casaora-process-workflow-jobs-1m)
      terraform import 'aws_cloudwatch_event_rule.process_workflow_jobs[0]' "${rule_name}" || true
      terraform import 'aws_cloudwatch_event_target.process_workflow_jobs[0]' "${rule_name}/process-workflow-jobs" || true
      ;;
  esac
done

echo
echo "RDS is represented as a data source in this Terraform scaffold (no import needed yet)."
