#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-aws}"
PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

NAME_PREFIX="${NAME_PREFIX:-casaora-prod}"
PROJECT_TAG_VALUE="${PROJECT_TAG_VALUE:-Casaora}"
ENV_TAG_VALUE="${ENV_TAG_VALUE:-production}"

VPC_CIDR="${VPC_CIDR:-10.42.0.0/16}"
PUBLIC_SUBNET_A_CIDR="${PUBLIC_SUBNET_A_CIDR:-10.42.0.0/20}"
PUBLIC_SUBNET_B_CIDR="${PUBLIC_SUBNET_B_CIDR:-10.42.16.0/20}"
PRIVATE_SUBNET_A_CIDR="${PRIVATE_SUBNET_A_CIDR:-10.42.128.0/20}"
PRIVATE_SUBNET_B_CIDR="${PRIVATE_SUBNET_B_CIDR:-10.42.144.0/20}"

DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME:-${NAME_PREFIX}-db-subnet-group}"
CREATE_PRIVATE_SUBNETS="${CREATE_PRIVATE_SUBNETS:-true}"
CREATE_DB_SUBNET_GROUP="${CREATE_DB_SUBNET_GROUP:-true}"

# Cost control: NAT gateways have fixed hourly + data processing cost.
# Keep disabled by default until traffic justifies it.
ENABLE_NAT_GATEWAYS="${ENABLE_NAT_GATEWAYS:-false}"

aws_cmd() {
  "${AWS_BIN}" --profile "${PROFILE}" --region "${REGION}" "$@"
}

tag_spec() {
  local resource_type="$1"
  local name="$2"
  echo "ResourceType=${resource_type},Tags=[{Key=Name,Value=${name}},{Key=Project,Value=${PROJECT_TAG_VALUE}},{Key=Environment,Value=${ENV_TAG_VALUE}}]"
}

tag_resource() {
  local resource_id="$1"
  local name="$2"
  aws_cmd ec2 create-tags \
    --resources "${resource_id}" \
    --tags "Key=Name,Value=${name}" "Key=Project,Value=${PROJECT_TAG_VALUE}" "Key=Environment,Value=${ENV_TAG_VALUE}" \
    >/dev/null
}

find_vpc_by_name() {
  local name="$1"
  aws_cmd ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=${name}" "Name=state,Values=available" \
    --query 'Vpcs[0].VpcId' \
    --output text 2>/dev/null || true
}

find_igw_by_name() {
  local name="$1"
  aws_cmd ec2 describe-internet-gateways \
    --filters "Name=tag:Name,Values=${name}" \
    --query 'InternetGateways[0].InternetGatewayId' \
    --output text 2>/dev/null || true
}

find_subnet_by_name() {
  local name="$1"
  aws_cmd ec2 describe-subnets \
    --filters "Name=tag:Name,Values=${name}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || true
}

find_route_table_by_name() {
  local vpc_id="$1"
  local name="$2"
  aws_cmd ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=${vpc_id}" "Name=tag:Name,Values=${name}" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || true
}

find_sg_by_name() {
  local vpc_id="$1"
  local group_name="$2"
  aws_cmd ec2 describe-security-groups \
    --filters "Name=vpc-id,Values=${vpc_id}" "Name=group-name,Values=${group_name}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || true
}

ensure_vpc() {
  local name="$1"
  local vpc_id
  vpc_id="$(find_vpc_by_name "${name}")"
  if [[ -n "${vpc_id}" && "${vpc_id}" != "None" ]]; then
    echo "VPC exists: ${vpc_id} (${name})" >&2
  else
    echo "Creating VPC: ${name} (${VPC_CIDR})" >&2
    vpc_id="$(aws_cmd ec2 create-vpc \
      --cidr-block "${VPC_CIDR}" \
      --tag-specifications "$(tag_spec vpc "${name}")" \
      --query 'Vpc.VpcId' --output text)"
    aws_cmd ec2 modify-vpc-attribute --vpc-id "${vpc_id}" --enable-dns-hostnames '{"Value":true}'
    aws_cmd ec2 modify-vpc-attribute --vpc-id "${vpc_id}" --enable-dns-support '{"Value":true}'
  fi
  echo "${vpc_id}"
}

ensure_igw() {
  local vpc_id="$1"
  local name="$2"
  local igw_id
  igw_id="$(find_igw_by_name "${name}")"
  if [[ -n "${igw_id}" && "${igw_id}" != "None" ]]; then
    echo "Internet gateway exists: ${igw_id}" >&2
  else
    echo "Creating internet gateway: ${name}" >&2
    igw_id="$(aws_cmd ec2 create-internet-gateway \
      --tag-specifications "$(tag_spec internet-gateway "${name}")" \
      --query 'InternetGateway.InternetGatewayId' --output text)"
  fi

  local attached_vpc
  attached_vpc="$(aws_cmd ec2 describe-internet-gateways \
    --internet-gateway-ids "${igw_id}" \
    --query 'InternetGateways[0].Attachments[0].VpcId' \
    --output text 2>/dev/null || true)"
  if [[ "${attached_vpc}" != "${vpc_id}" ]]; then
    if [[ -n "${attached_vpc}" && "${attached_vpc}" != "None" ]]; then
      echo "WARNING: IGW ${igw_id} attached to unexpected VPC ${attached_vpc}" >&2
    else
      aws_cmd ec2 attach-internet-gateway --internet-gateway-id "${igw_id}" --vpc-id "${vpc_id}" >/dev/null
    fi
  fi
  echo "${igw_id}"
}

ensure_subnet() {
  local vpc_id="$1"
  local az="$2"
  local cidr="$3"
  local name="$4"
  local map_public="$5"
  local subnet_id
  subnet_id="$(find_subnet_by_name "${name}")"
  if [[ -n "${subnet_id}" && "${subnet_id}" != "None" ]]; then
    echo "Subnet exists: ${subnet_id} (${name})" >&2
  else
    echo "Creating subnet: ${name} (${cidr} in ${az})" >&2
    subnet_id="$(aws_cmd ec2 create-subnet \
      --vpc-id "${vpc_id}" \
      --availability-zone "${az}" \
      --cidr-block "${cidr}" \
      --tag-specifications "$(tag_spec subnet "${name}")" \
      --query 'Subnet.SubnetId' --output text)"
  fi

  if [[ "${map_public}" == "true" ]]; then
    aws_cmd ec2 modify-subnet-attribute --subnet-id "${subnet_id}" --map-public-ip-on-launch >/dev/null
  fi

  echo "${subnet_id}"
}

ensure_route_table() {
  local vpc_id="$1"
  local name="$2"
  local rt_id
  rt_id="$(find_route_table_by_name "${vpc_id}" "${name}")"
  if [[ -n "${rt_id}" && "${rt_id}" != "None" ]]; then
    echo "Route table exists: ${rt_id} (${name})" >&2
  else
    echo "Creating route table: ${name}" >&2
    rt_id="$(aws_cmd ec2 create-route-table \
      --vpc-id "${vpc_id}" \
      --tag-specifications "$(tag_spec route-table "${name}")" \
      --query 'RouteTable.RouteTableId' --output text)"
  fi
  echo "${rt_id}"
}

ensure_route() {
  local route_table_id="$1"
  local dest_cidr="$2"
  local target_flag="$3"
  local target_id="$4"

  local exists
  exists="$(aws_cmd ec2 describe-route-tables --route-table-ids "${route_table_id}" \
    --query "RouteTables[0].Routes[?DestinationCidrBlock=='${dest_cidr}'] | length(@)" --output text 2>/dev/null || true)"
  if [[ "${exists}" == "0" || "${exists}" == "None" || -z "${exists}" ]]; then
    aws_cmd ec2 create-route --route-table-id "${route_table_id}" "${target_flag}" "${target_id}" --destination-cidr-block "${dest_cidr}" >/dev/null
  fi
}

ensure_rtb_association() {
  local route_table_id="$1"
  local subnet_id="$2"
  local assoc_exists
  assoc_exists="$(aws_cmd ec2 describe-route-tables --route-table-ids "${route_table_id}" \
    --query "RouteTables[0].Associations[?SubnetId=='${subnet_id}'] | length(@)" --output text 2>/dev/null || true)"
  if [[ "${assoc_exists}" == "0" || "${assoc_exists}" == "None" || -z "${assoc_exists}" ]]; then
    aws_cmd ec2 associate-route-table --route-table-id "${route_table_id}" --subnet-id "${subnet_id}" >/dev/null
  fi
}

ensure_security_group() {
  local vpc_id="$1"
  local group_name="$2"
  local description="$3"
  local display_name="$4"
  local sg_id
  sg_id="$(find_sg_by_name "${vpc_id}" "${group_name}")"
  if [[ -n "${sg_id}" && "${sg_id}" != "None" ]]; then
    echo "Security group exists: ${sg_id} (${group_name})" >&2
  else
    echo "Creating security group: ${group_name}" >&2
    sg_id="$(aws_cmd ec2 create-security-group \
      --vpc-id "${vpc_id}" \
      --group-name "${group_name}" \
      --description "${description}" \
      --query 'GroupId' --output text)"
    tag_resource "${sg_id}" "${display_name}"
  fi
  echo "${sg_id}"
}

allow_ingress_cidr() {
  local sg_id="$1"
  local protocol="$2"
  local port="$3"
  local cidr="$4"
  aws_cmd ec2 authorize-security-group-ingress \
    --group-id "${sg_id}" \
    --ip-permissions "[{\"IpProtocol\":\"${protocol}\",\"FromPort\":${port},\"ToPort\":${port},\"IpRanges\":[{\"CidrIp\":\"${cidr}\",\"Description\":\"public ingress\"}]}]" \
    >/dev/null 2>&1 || true
}

allow_ingress_sg() {
  local sg_id="$1"
  local protocol="$2"
  local port="$3"
  local source_sg_id="$4"
  local desc="$5"
  aws_cmd ec2 authorize-security-group-ingress \
    --group-id "${sg_id}" \
    --ip-permissions "[{\"IpProtocol\":\"${protocol}\",\"FromPort\":${port},\"ToPort\":${port},\"UserIdGroupPairs\":[{\"GroupId\":\"${source_sg_id}\",\"Description\":\"${desc}\"}]}]" \
    >/dev/null 2>&1 || true
}

ensure_db_subnet_group() {
  local name="$1"
  local subnet_a="$2"
  local subnet_b="$3"
  local desc="${NAME_PREFIX} database subnet group"
  if aws_cmd rds describe-db-subnet-groups --db-subnet-group-name "${name}" >/dev/null 2>&1; then
    echo "DB subnet group exists, updating: ${name}" >&2
    aws_cmd rds modify-db-subnet-group \
      --db-subnet-group-name "${name}" \
      --db-subnet-group-description "${desc}" \
      --subnet-ids "${subnet_a}" "${subnet_b}" >/dev/null
  else
    echo "Creating DB subnet group: ${name}" >&2
    aws_cmd rds create-db-subnet-group \
      --db-subnet-group-name "${name}" \
      --db-subnet-group-description "${desc}" \
      --subnet-ids "${subnet_a}" "${subnet_b}" \
      --tags "Key=Name,Value=${name}" "Key=Project,Value=${PROJECT_TAG_VALUE}" "Key=Environment,Value=${ENV_TAG_VALUE}" \
      >/dev/null
  fi
  aws_cmd rds describe-db-subnet-groups --db-subnet-group-name "${name}" \
    --query 'DBSubnetGroups[0].{name:DBSubnetGroupName,vpcId:VpcId,subnets:Subnets[].SubnetIdentifier,status:SubnetGroupStatus}' \
    --output json
}

echo "==> Bootstrapping dedicated network foundation (cost-aware)"
echo "Profile: ${PROFILE}"
echo "Region: ${REGION}"
echo "Name prefix: ${NAME_PREFIX}"
echo "NAT gateways enabled: ${ENABLE_NAT_GATEWAYS} (default false to avoid fixed hourly cost)"

if [[ "${ENABLE_NAT_GATEWAYS}" == "true" ]]; then
  echo "This script intentionally does not create NAT gateways yet. Set up NAT in a follow-up once needed." >&2
fi

azs_json="$(aws_cmd ec2 describe-availability-zones \
  --query 'AvailabilityZones[?State==`available`].ZoneName' --output json | jq 'sort | .[:2]')"

az_count="$(echo "${azs_json}" | jq 'length')"
if [[ "${az_count}" -lt 2 ]]; then
  echo "Need at least 2 available AZs in ${REGION}" >&2
  exit 1
fi

AZ_A="$(echo "${azs_json}" | jq -r '.[0]')"
AZ_B="$(echo "${azs_json}" | jq -r '.[1]')"

VPC_NAME="${NAME_PREFIX}-vpc"
IGW_NAME="${NAME_PREFIX}-igw"
PUBLIC_SUBNET_A_NAME="${NAME_PREFIX}-public-${AZ_A##*-}"
PUBLIC_SUBNET_B_NAME="${NAME_PREFIX}-public-${AZ_B##*-}"
PRIVATE_SUBNET_A_NAME="${NAME_PREFIX}-private-${AZ_A##*-}"
PRIVATE_SUBNET_B_NAME="${NAME_PREFIX}-private-${AZ_B##*-}"
PUBLIC_RT_NAME="${NAME_PREFIX}-public-rt"
PRIVATE_RT_NAME="${NAME_PREFIX}-private-rt"
ALB_SG_NAME="${NAME_PREFIX}-alb-sg"
ECS_SG_NAME="${NAME_PREFIX}-ecs-sg"
RDS_SG_NAME="${NAME_PREFIX}-rds-sg"

vpc_id="$(ensure_vpc "${VPC_NAME}")"
igw_id="$(ensure_igw "${vpc_id}" "${IGW_NAME}")"

public_subnet_a_id="$(ensure_subnet "${vpc_id}" "${AZ_A}" "${PUBLIC_SUBNET_A_CIDR}" "${PUBLIC_SUBNET_A_NAME}" true)"
public_subnet_b_id="$(ensure_subnet "${vpc_id}" "${AZ_B}" "${PUBLIC_SUBNET_B_CIDR}" "${PUBLIC_SUBNET_B_NAME}" true)"

private_subnet_a_id=""
private_subnet_b_id=""
if [[ "${CREATE_PRIVATE_SUBNETS}" == "true" ]]; then
  private_subnet_a_id="$(ensure_subnet "${vpc_id}" "${AZ_A}" "${PRIVATE_SUBNET_A_CIDR}" "${PRIVATE_SUBNET_A_NAME}" false)"
  private_subnet_b_id="$(ensure_subnet "${vpc_id}" "${AZ_B}" "${PRIVATE_SUBNET_B_CIDR}" "${PRIVATE_SUBNET_B_NAME}" false)"
fi

public_rt_id="$(ensure_route_table "${vpc_id}" "${PUBLIC_RT_NAME}")"
ensure_route "${public_rt_id}" "0.0.0.0/0" "--gateway-id" "${igw_id}"
ensure_rtb_association "${public_rt_id}" "${public_subnet_a_id}"
ensure_rtb_association "${public_rt_id}" "${public_subnet_b_id}"

private_rt_id=""
if [[ "${CREATE_PRIVATE_SUBNETS}" == "true" ]]; then
  private_rt_id="$(ensure_route_table "${vpc_id}" "${PRIVATE_RT_NAME}")"
  ensure_rtb_association "${private_rt_id}" "${private_subnet_a_id}"
  ensure_rtb_association "${private_rt_id}" "${private_subnet_b_id}"
fi

alb_sg_id="$(ensure_security_group "${vpc_id}" "${ALB_SG_NAME}" "ALB ingress for Casaora" "${ALB_SG_NAME}")"
ecs_sg_id="$(ensure_security_group "${vpc_id}" "${ECS_SG_NAME}" "ECS service access for Casaora" "${ECS_SG_NAME}")"
rds_sg_id="$(ensure_security_group "${vpc_id}" "${RDS_SG_NAME}" "RDS access for Casaora" "${RDS_SG_NAME}")"

# ALB ingress from internet (HTTP/HTTPS). Tighten later with Cloudflare IPs if desired.
allow_ingress_cidr "${alb_sg_id}" "tcp" 80 "0.0.0.0/0"
allow_ingress_cidr "${alb_sg_id}" "tcp" 443 "0.0.0.0/0"

# ECS services only accessible from the ALB SG on app ports.
allow_ingress_sg "${ecs_sg_id}" "tcp" 8000 "${alb_sg_id}" "backend via ALB"
allow_ingress_sg "${ecs_sg_id}" "tcp" 3000 "${alb_sg_id}" "admin via ALB"

# RDS only accessible from ECS services SG.
allow_ingress_sg "${rds_sg_id}" "tcp" 5432 "${ecs_sg_id}" "postgres from ECS services"

db_subnet_group_json="null"
if [[ "${CREATE_PRIVATE_SUBNETS}" == "true" && "${CREATE_DB_SUBNET_GROUP}" == "true" ]]; then
  db_subnet_group_json="$(ensure_db_subnet_group "${DB_SUBNET_GROUP_NAME}" "${private_subnet_a_id}" "${private_subnet_b_id}")"
fi

echo "==> Network foundation summary"
jq -n \
  --arg region "${REGION}" \
  --arg az_a "${AZ_A}" \
  --arg az_b "${AZ_B}" \
  --arg vpc_id "${vpc_id}" \
  --arg vpc_name "${VPC_NAME}" \
  --arg igw_id "${igw_id}" \
  --arg public_rt_id "${public_rt_id}" \
  --arg private_rt_id "${private_rt_id}" \
  --arg public_subnet_a_id "${public_subnet_a_id}" \
  --arg public_subnet_b_id "${public_subnet_b_id}" \
  --arg private_subnet_a_id "${private_subnet_a_id}" \
  --arg private_subnet_b_id "${private_subnet_b_id}" \
  --arg alb_sg_id "${alb_sg_id}" \
  --arg ecs_sg_id "${ecs_sg_id}" \
  --arg rds_sg_id "${rds_sg_id}" \
  --argjson db_subnet_group "${db_subnet_group_json}" \
  '{
    region: $region,
    cost_profile: {
      nat_gateways_created: false,
      note: "Dedicated VPC foundation created without NAT gateways to avoid fixed hourly NAT cost."
    },
    availability_zones: [$az_a, $az_b],
    vpc: {
      id: $vpc_id,
      name: $vpc_name,
      internet_gateway_id: $igw_id
    },
    subnets: {
      public: [$public_subnet_a_id, $public_subnet_b_id],
      private: [$private_subnet_a_id, $private_subnet_b_id] | map(select(length > 0))
    },
    route_tables: {
      public: $public_rt_id,
      private: (if ($private_rt_id | length) > 0 then $private_rt_id else null end)
    },
    security_groups: {
      alb: $alb_sg_id,
      ecs_services: $ecs_sg_id,
      rds: $rds_sg_id
    },
    rds_db_subnet_group: $db_subnet_group
  }'
