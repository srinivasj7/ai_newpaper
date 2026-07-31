/*
 * Chicken-and-egg breaker: the bucket that holds the state for everything else.
 * Applied once, with LOCAL state (this directory has no backend block on purpose).
 * The resulting terraform.tfstate is small, boring, and safe to commit-ignore —
 * if it is ever lost, `tofu import` the bucket back.
 */

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  description = "Region for the state bucket. Must match the backend block in envs/prod."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket" {
  description = <<-EOT
    Globally unique name for the OpenTofu state bucket. No default: bucket names are public
    namespace, so pick one that doesn't advertise the account — a random suffix beats the
    account id. Pass it with -var or an untracked tfvars file, and use the same value in
    envs/prod/backend.hcl.
  EOT
  type        = string
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State history is useful; unbounded state history is not.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days           = 90
      newer_noncurrent_versions = 20
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}
