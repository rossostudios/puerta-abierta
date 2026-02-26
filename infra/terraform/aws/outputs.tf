output "vpc_id" {
  value = aws_vpc.main.id
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "backend_live_target_group_arn" {
  value = aws_lb_target_group.backend_live.arn
}

output "backend_ready_target_group_arn" {
  value = aws_lb_target_group.backend_ready.arn
}

output "admin_target_group_arn" {
  value = try(aws_lb_target_group.admin_web[0].arn, null)
}

output "web_target_group_arn" {
  value = try(aws_lb_target_group.web[0].arn, null)
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecr_backend_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_admin_repository_url" {
  value = aws_ecr_repository.admin.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "public_media_bucket_name" {
  value = try(aws_s3_bucket.public_media[0].bucket, null)
}

output "public_media_base_url" {
  value = try(
    "https://${aws_s3_bucket.public_media[0].bucket}.s3.amazonaws.com",
    null
  )
}

output "private_documents_bucket_name" {
  value = try(aws_s3_bucket.private_documents[0].bucket, null)
}

output "rds_endpoint" {
  value = try(data.aws_db_instance.prod.address, null)
}

output "rds_instance_arn" {
  value = try(data.aws_db_instance.prod.db_instance_arn, null)
}

output "scheduler_job_runner_task_definition_arn" {
  value = try(aws_ecs_task_definition.scheduler_job_runner[0].arn, null)
}

output "eventbridge_scheduler_invoke_role_arn" {
  value = try(aws_iam_role.eventbridge_ecs_run_task[0].arn, null)
}
