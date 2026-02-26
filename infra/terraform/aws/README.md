# Terraform (AWS Foundation)

This folder codifies the AWS foundation created manually during the Railway/Supabase migration:

- VPC / subnets / route tables / internet gateway
- ALB + backend target groups + listeners
- ALB host-routing target groups/listener rules for admin and public web
- Security groups
- ECS cluster
- ECR repositories + lifecycle policies
- CloudWatch log groups
- DB subnet group
- RDS instance discovery (data source)

## Scope (Current)

This is an **import-friendly foundation**. It intentionally does **not** yet manage:

- ECS task definitions / ECS services (deployed by CI/scripts today)
- IAM roles/policies for ECS/GitHub OIDC
- Secrets Manager secrets
- RDS instance lifecycle (captured as a data source first to avoid DB drift)

## First Use

1. Copy variables:

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. Set the live ACM cert ARNs in `terraform.tfvars`:
   - `alb_certificate_arn` (default listener cert, currently `api.casaora.co`)
   - `admin_alb_certificate_arn` (additional SNI cert, currently `app.casaora.co`)
   - `web_alb_certificate_arn` (additional SNI cert for `casaora.co` + `www.casaora.co`, after web cutover)

3. Initialize and import the existing foundation resources:

```bash
terraform init
./import-existing.sh
```

4. Review drift safely:

```bash
terraform plan
```

## Remote State (Recommended Before More Cutovers)

Bootstrap an S3 + DynamoDB backend and migrate the current local state:

```bash
./bootstrap-remote-backend.sh
terraform plan
```

This writes a local `backend.hcl` (gitignored) and runs `terraform init -migrate-state`.

## Notes

- `enable_admin_alb_rule` defaults to `true` because `app.casaora.co` now routes through the shared ALB.
- `enable_web_alb_rule` defaults to `false` until the public web ECS service and ALB host rule are live.
- The RDS instance is exposed via `data.aws_db_instance.prod` outputs; move it to a managed resource in a dedicated follow-up after secrets/password handling is standardized.
