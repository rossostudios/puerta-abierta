locals {
  tags = {
    Project     = var.project_tag
    Environment = var.environment_tag
  }

  names = {
    vpc                               = "${var.name_prefix}-vpc"
    igw                               = "${var.name_prefix}-igw"
    public_subnet_a                   = "${var.name_prefix}-public-1a"
    public_subnet_b                   = "${var.name_prefix}-public-1b"
    private_subnet_a                  = "${var.name_prefix}-private-1a"
    private_subnet_b                  = "${var.name_prefix}-private-1b"
    public_rt                         = "${var.name_prefix}-public-rt"
    private_rt                        = "${var.name_prefix}-private-rt"
    alb_sg                            = "${var.name_prefix}-alb-sg"
    ecs_sg                            = "${var.name_prefix}-ecs-sg"
    rds_sg                            = "${var.name_prefix}-rds-sg"
    db_subnet_group                   = "${var.name_prefix}-db-subnet-group"
    alb                               = "${var.name_prefix}-alb"
    backend_live_tg                   = "casaora-prod-backend-live-tg"
    backend_ready_tg                  = "casaora-prod-backend-ready-tg"
    admin_web_tg                      = "casaora-prod-admin-web-tg"
    web_tg                            = "casaora-prod-web-tg"
    ecs_cluster                       = "casaora-prod"
    backend_ecr                       = "casaora-backend"
    admin_ecr                         = "casaora-admin"
    web_ecr                           = "casaora-web"
    backend_log_group                 = "/ecs/casaora-backend"
    admin_log_group                   = "/ecs/casaora-admin"
    web_log_group                     = "/ecs/casaora-web"
    scheduler_job_runner_log_group    = "/ecs/casaora-job-runner"
    scheduler_job_runner_family       = "casaora-job-runner"
    scheduler_job_runner_container    = "casaora-job-runner"
    eventbridge_scheduler_invoke_role = "casaora-eventbridge-ecs-run-task-role"
    process_notifications_rule        = "casaora-process-notifications-5m"
    notifications_retention_rule      = "casaora-notifications-retention-daily"
    process_workflow_jobs_rule        = "casaora-process-workflow-jobs-1m"
    public_media_s3                   = var.public_media_bucket_name
    private_docs_s3                   = var.private_documents_bucket_name
  }

  scheduler_process_notifications_command   = "set -eu; endpoint=\"$${API_BASE_URL%/}/v1/internal/process-notifications\"; echo \"POST $${endpoint}\"; curl -sS -f -X POST \"$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: $${INTERNAL_API_KEY}\""
  scheduler_notifications_retention_command = "set -eu; endpoint=\"$${API_BASE_URL%/}/v1/internal/notifications-retention\"; echo \"POST $${endpoint}\"; curl -sS -f -X POST \"$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: $${INTERNAL_API_KEY}\" --data '{\"retention_days\":${var.scheduler_notifications_retention_days}}'"
  scheduler_process_workflow_jobs_command   = "set -eu; endpoint=\"$${API_BASE_URL%/}/v1/internal/process-workflow-jobs?limit=${var.scheduler_workflow_process_limit}\"; echo \"POST $${endpoint}\"; curl -sS -f -X POST \"$endpoint\" -H \"accept: application/json\" -H \"content-type: application/json\" -H \"x-api-key: $${INTERNAL_API_KEY}\""
}
