provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  retry_mode  = "adaptive"
  max_retries = 10

  default_tags {
    tags = local.tags
  }
}
