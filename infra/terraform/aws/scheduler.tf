data "aws_caller_identity" "current" {}

data "aws_iam_role" "backend_task_execution" {
  count = var.enable_scheduler_jobs ? 1 : 0
  name  = var.scheduler_job_runner_execution_role_name
}

data "aws_iam_role" "backend_task" {
  count = var.enable_scheduler_jobs ? 1 : 0
  name  = var.scheduler_job_runner_task_role_name
}

data "aws_secretsmanager_secret" "internal_api_key" {
  count = var.enable_scheduler_jobs ? 1 : 0
  name  = var.scheduler_internal_api_key_secret_name
}

resource "aws_cloudwatch_log_group" "scheduler_job_runner" {
  count             = var.enable_scheduler_jobs ? 1 : 0
  name              = local.names.scheduler_job_runner_log_group
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "scheduler_job_runner" {
  count                    = var.enable_scheduler_jobs ? 1 : 0
  family                   = local.names.scheduler_job_runner_family
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = data.aws_iam_role.backend_task_execution[0].arn
  task_role_arn            = data.aws_iam_role.backend_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name       = local.names.scheduler_job_runner_container
      image      = var.scheduler_job_runner_image
      essential  = true
      entryPoint = ["sh", "-lc"]
      command    = ["echo 'job runner ready'; sleep 1"]
      environment = [
        {
          name  = "API_BASE_URL"
          value = var.scheduler_api_base_url
        }
      ]
      secrets = [
        {
          name      = "INTERNAL_API_KEY"
          valueFrom = data.aws_secretsmanager_secret.internal_api_key[0].arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.scheduler_job_runner[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_iam_role" "eventbridge_ecs_run_task" {
  count = var.enable_scheduler_jobs ? 1 : 0
  name  = local.names.eventbridge_scheduler_invoke_role

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "eventbridge_ecs_run_task" {
  count = var.enable_scheduler_jobs ? 1 : 0
  name  = "CasaoraEventBridgeRunEcsTask"
  role  = aws_iam_role.eventbridge_ecs_run_task[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunSchedulerTasks"
        Effect = "Allow"
        Action = ["ecs:RunTask"]
        Resource = [
          "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.names.scheduler_job_runner_family}:*"
        ]
        Condition = {
          ArnEquals = {
            "ecs:cluster" = aws_ecs_cluster.main.arn
          }
        }
      },
      {
        Sid    = "PassTaskRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          data.aws_iam_role.backend_task_execution[0].arn,
          data.aws_iam_role.backend_task[0].arn
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "process_notifications" {
  count               = var.enable_scheduler_jobs ? 1 : 0
  name                = local.names.process_notifications_rule
  schedule_expression = var.process_notifications_schedule_expression
  state               = var.enable_scheduler_rules ? "ENABLED" : "DISABLED"
  description         = "Casaora scheduled job via ECS RunTask"
}

resource "aws_cloudwatch_event_rule" "notifications_retention" {
  count               = var.enable_scheduler_jobs ? 1 : 0
  name                = local.names.notifications_retention_rule
  schedule_expression = var.notifications_retention_schedule_expression
  state               = var.enable_scheduler_rules ? "ENABLED" : "DISABLED"
  description         = "Casaora scheduled job via ECS RunTask"
}

resource "aws_cloudwatch_event_rule" "process_workflow_jobs" {
  count               = var.enable_scheduler_jobs ? 1 : 0
  name                = local.names.process_workflow_jobs_rule
  schedule_expression = var.process_workflow_jobs_schedule_expression
  state               = var.enable_scheduler_rules ? "ENABLED" : "DISABLED"
  description         = "Casaora scheduled job via ECS RunTask"
}

resource "aws_cloudwatch_event_target" "process_notifications" {
  count     = var.enable_scheduler_jobs ? 1 : 0
  rule      = aws_cloudwatch_event_rule.process_notifications[0].name
  target_id = "process-notifications"
  arn       = aws_ecs_cluster.main.arn
  role_arn  = aws_iam_role.eventbridge_ecs_run_task[0].arn

  ecs_target {
    task_definition_arn     = aws_ecs_task_definition.scheduler_job_runner[0].arn
    task_count              = 1
    launch_type             = "FARGATE"
    platform_version        = "LATEST"
    enable_ecs_managed_tags = true

    network_configuration {
      subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = true
    }
  }

  input = jsonencode({
    containerOverrides = [
      {
        name = local.names.scheduler_job_runner_container
        command = [
          local.scheduler_process_notifications_command
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "notifications_retention" {
  count     = var.enable_scheduler_jobs ? 1 : 0
  rule      = aws_cloudwatch_event_rule.notifications_retention[0].name
  target_id = "notifications-retention"
  arn       = aws_ecs_cluster.main.arn
  role_arn  = aws_iam_role.eventbridge_ecs_run_task[0].arn

  ecs_target {
    task_definition_arn     = aws_ecs_task_definition.scheduler_job_runner[0].arn
    task_count              = 1
    launch_type             = "FARGATE"
    platform_version        = "LATEST"
    enable_ecs_managed_tags = true

    network_configuration {
      subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = true
    }
  }

  input = jsonencode({
    containerOverrides = [
      {
        name = local.names.scheduler_job_runner_container
        command = [
          local.scheduler_notifications_retention_command
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "process_workflow_jobs" {
  count     = var.enable_scheduler_jobs ? 1 : 0
  rule      = aws_cloudwatch_event_rule.process_workflow_jobs[0].name
  target_id = "process-workflow-jobs"
  arn       = aws_ecs_cluster.main.arn
  role_arn  = aws_iam_role.eventbridge_ecs_run_task[0].arn

  ecs_target {
    task_definition_arn     = aws_ecs_task_definition.scheduler_job_runner[0].arn
    task_count              = 1
    launch_type             = "FARGATE"
    platform_version        = "LATEST"
    enable_ecs_managed_tags = true

    network_configuration {
      subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = true
    }
  }

  input = jsonencode({
    containerOverrides = [
      {
        name = local.names.scheduler_job_runner_container
        command = [
          local.scheduler_process_workflow_jobs_command
        ]
      }
    ]
  })
}
