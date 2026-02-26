variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "aws_profile" {
  type        = string
  description = "AWS CLI profile for local Terraform runs"
  default     = "default"
}

variable "name_prefix" {
  type        = string
  description = "Resource naming prefix"
  default     = "casaora-prod"
}

variable "project_tag" {
  type        = string
  description = "Project tag value"
  default     = "Casaora"
}

variable "environment_tag" {
  type        = string
  description = "Environment tag value"
  default     = "production"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "public_subnet_a_cidr" {
  type    = string
  default = "10.42.0.0/20"
}

variable "public_subnet_b_cidr" {
  type    = string
  default = "10.42.16.0/20"
}

variable "private_subnet_a_cidr" {
  type    = string
  default = "10.42.128.0/20"
}

variable "private_subnet_b_cidr" {
  type    = string
  default = "10.42.144.0/20"
}

variable "public_subnet_a_az" {
  type    = string
  default = "us-east-1a"
}

variable "public_subnet_b_az" {
  type    = string
  default = "us-east-1b"
}

variable "private_subnet_a_az" {
  type    = string
  default = "us-east-1a"
}

variable "private_subnet_b_az" {
  type    = string
  default = "us-east-1b"
}

variable "alb_certificate_arn" {
  type        = string
  description = "ACM certificate ARN attached to the shared ALB HTTPS listener"
}

variable "admin_alb_certificate_arn" {
  type        = string
  description = "Additional ACM certificate ARN for admin hostnames on the shared ALB listener"
  default     = null
  nullable    = true
}

variable "backend_port" {
  type    = number
  default = 8000
}

variable "admin_port" {
  type    = number
  default = 3000
}

variable "web_port" {
  type    = number
  default = 3001
}

variable "rds_instance_identifier" {
  type    = string
  default = "casaora-prod-postgres"
}

variable "enable_admin_alb_rule" {
  type        = bool
  description = "Enable ALB host rule + target group for the admin frontend"
  default     = true
}

variable "admin_hostnames" {
  type        = list(string)
  description = "Hostnames routed to the admin ECS service on the shared ALB"
  default     = ["app.casaora.co"]
}

variable "admin_rule_priority" {
  type    = number
  default = 100
}

variable "web_alb_certificate_arn" {
  type        = string
  description = "Additional ACM certificate ARN for public web hostnames on the shared ALB listener"
  default     = null
  nullable    = true
}

variable "enable_web_alb_rule" {
  type        = bool
  description = "Enable ALB host rule + target group for the public web frontend"
  default     = true
}

variable "web_hostnames" {
  type        = list(string)
  description = "Hostnames routed to the public web ECS service on the shared ALB"
  default     = ["casaora.co", "www.casaora.co"]
}

variable "web_rule_priority" {
  type    = number
  default = 110
}

variable "enable_storage_buckets" {
  type        = bool
  description = "Manage S3 storage buckets for media/documents"
  default     = true
}

variable "public_media_bucket_name" {
  type        = string
  description = "Public media bucket name"
  default     = "casaora-prod-public-media-341112583495"
}

variable "private_documents_bucket_name" {
  type        = string
  description = "Private documents bucket name"
  default     = "casaora-prod-private-documents-341112583495"
}

variable "create_private_documents_bucket" {
  type        = bool
  description = "Whether to create the private documents bucket"
  default     = false
}

variable "enable_scheduler_jobs" {
  type        = bool
  description = "Manage EventBridge -> ECS scheduled jobs for internal processors"
  default     = true
}

variable "enable_scheduler_rules" {
  type        = bool
  description = "Enable EventBridge scheduled rules (when scheduler jobs are managed)"
  default     = true
}

variable "scheduler_job_runner_image" {
  type        = string
  description = "Container image used by the ECS scheduler job runner task"
  default     = "curlimages/curl:8.12.1"
}

variable "scheduler_api_base_url" {
  type        = string
  description = "Base URL for internal scheduler HTTP calls"
  default     = "https://api.casaora.co"
}

variable "scheduler_internal_api_key_secret_name" {
  type        = string
  description = "Secrets Manager secret name containing INTERNAL_API_KEY"
  default     = "casaora/backend/INTERNAL_API_KEY"
}

variable "scheduler_job_runner_execution_role_name" {
  type        = string
  description = "IAM role name used as executionRoleArn for scheduler ECS tasks"
  default     = "casaora-backend-task-execution-role"
}

variable "scheduler_job_runner_task_role_name" {
  type        = string
  description = "IAM role name used as taskRoleArn for scheduler ECS tasks"
  default     = "casaora-backend-task-role"
}

variable "process_notifications_schedule_expression" {
  type        = string
  description = "EventBridge schedule expression for process-notifications"
  default     = "rate(5 minutes)"
}

variable "notifications_retention_schedule_expression" {
  type        = string
  description = "EventBridge schedule expression for notifications retention"
  default     = "cron(15 3 * * ? *)"
}

variable "process_workflow_jobs_schedule_expression" {
  type        = string
  description = "EventBridge schedule expression for workflow queue processing"
  default     = "rate(1 minute)"
}

variable "scheduler_workflow_process_limit" {
  type        = number
  description = "Limit query parameter for /v1/internal/process-workflow-jobs"
  default     = 100
}

variable "scheduler_notifications_retention_days" {
  type        = number
  description = "Retention window used by /v1/internal/notifications-retention"
  default     = 180
}
