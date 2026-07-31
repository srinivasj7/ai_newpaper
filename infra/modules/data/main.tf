/*
 * The one bucket. Two prefixes:
 *   site/   the built SPA, served as the CloudFront default behaviour
 *   data/   editions, the manifest, config, and one object per feedback event
 *
 * Private throughout — the only readers are CloudFront (via OAC) and the pipeline
 * principal. The bucket policy itself lives in the root module, because it needs
 * ARNs from the site and ci modules and would otherwise make the modules circular.
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

resource "aws_s3_bucket" "app" {
  bucket = var.bucket_name

  # Nothing here is reproducible from source: editions are one-shot model output
  # and feedback is the user's own history. Refuse to delete a non-empty bucket.
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  # Feedback is small, write-once and read once a day. Cool it down, never delete it.
  rule {
    id     = "feedback-to-ia"
    status = "Enabled"

    filter {
      prefix = "${var.data_prefix}feedback/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }

  # Editions and the site are kept forever; only stale versions of overwritten
  # objects (the manifest, the config) are pruned.
  rule {
    id     = "prune-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days           = 365
      newer_noncurrent_versions = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
