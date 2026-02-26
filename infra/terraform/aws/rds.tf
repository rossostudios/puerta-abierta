# RDS instance is currently managed manually (bootstrap script + Secrets Manager) to avoid
# accidental credential drift during migration. We still capture it as a data source so the
# Terraform stack is aware of the live database and can reference outputs.

data "aws_db_instance" "prod" {
  db_instance_identifier = var.rds_instance_identifier
}
