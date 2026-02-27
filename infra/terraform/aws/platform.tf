resource "aws_ecs_cluster" "main" {
  name = local.names.ecs_cluster

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = local.names.ecs_cluster
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = local.names.backend_ecr
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "admin" {
  name                 = local.names.admin_ecr
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = local.names.web_ecr
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images beyond 100"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "admin" {
  repository = aws_ecr_repository.admin.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images beyond 100"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images beyond 100"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = local.names.backend_log_group
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "admin" {
  name              = local.names.admin_log_group
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = local.names.web_log_group
  retention_in_days = 30
}

resource "aws_s3_bucket" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = local.names.public_media_s3

  tags = merge(local.tags, {
    Name = local.names.public_media_s3
  })
}

resource "aws_s3_bucket_versioning" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = aws_s3_bucket.public_media[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_ownership_controls" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = aws_s3_bucket.public_media[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = aws_s3_bucket.public_media[0].id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_cors_configuration" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = aws_s3_bucket.public_media[0].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [
      "https://app.casaora.co",
      "https://casaora.co",
      "https://www.casaora.co",
      "http://localhost:3000",
      "http://localhost:3001",
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_policy" "public_media" {
  count  = var.enable_storage_buckets ? 1 : 0
  bucket = aws_s3_bucket.public_media[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = "${aws_s3_bucket.public_media[0].arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket" "private_documents" {
  count  = var.enable_storage_buckets && var.create_private_documents_bucket ? 1 : 0
  bucket = local.names.private_docs_s3

  tags = merge(local.tags, {
    Name = local.names.private_docs_s3
  })
}

resource "aws_s3_bucket_versioning" "private_documents" {
  count  = var.enable_storage_buckets && var.create_private_documents_bucket ? 1 : 0
  bucket = aws_s3_bucket.private_documents[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_ownership_controls" "private_documents" {
  count  = var.enable_storage_buckets && var.create_private_documents_bucket ? 1 : 0
  bucket = aws_s3_bucket.private_documents[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "private_documents" {
  count  = var.enable_storage_buckets && var.create_private_documents_bucket ? 1 : 0
  bucket = aws_s3_bucket.private_documents[0].id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
