/*
 * The Daily Compile — production stack.
 *
 * Order of the world: data (bucket) -> api (lambda) -> site (distribution) -> ci (roles).
 * The two resources that would close a loop between those modules live here instead:
 * the bucket policy (needs the distribution and the pipeline user) and CloudFront's
 * permission to invoke the Function URL (needs the distribution).
 */

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "opentofu"
      Repo      = var.github_repo
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  bucket_name = coalesce(var.bucket_name, "${var.project}-${data.aws_caller_identity.current.account_id}")
  site_prefix = "site/"
  data_prefix = "data/"
}

module "data" {
  source = "../../modules/data"

  bucket_name = local.bucket_name
  site_prefix = local.site_prefix
  data_prefix = local.data_prefix
}

module "api" {
  source = "../../modules/api"

  name        = var.project
  bucket_id   = module.data.bucket_id
  bucket_arn  = module.data.bucket_arn
  data_prefix = local.data_prefix
}

module "site" {
  source = "../../modules/site"

  name                        = var.project
  bucket_regional_domain_name = module.data.bucket_regional_domain_name
  site_prefix                 = local.site_prefix
  api_origin_host             = module.api.function_url_host
  aliases                     = var.aliases
  acm_certificate_arn         = var.acm_certificate_arn
  price_class                 = var.price_class
}

module "ci" {
  source = "../../modules/ci"

  name                       = var.project
  github_repo                = var.github_repo
  default_branch             = var.default_branch
  create_oidc_provider       = var.create_oidc_provider
  existing_oidc_provider_arn = var.existing_oidc_provider_arn
  bucket_arn                 = module.data.bucket_arn
  site_prefix                = local.site_prefix
  data_prefix                = local.data_prefix
  distribution_arn           = module.site.distribution_arn
  state_bucket               = var.state_bucket
}

# --------------------------------------------------------------- the joins

# CloudFront reads both prefixes; the pipeline user writes the data prefix; the
# deploy role writes the site prefix. Nothing else can touch the bucket.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${module.data.bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [module.site.distribution_arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [module.data.bucket_arn, "${module.data.bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "app" {
  bucket = module.data.bucket_id
  policy = data.aws_iam_policy_document.bucket.json
}

# The Function URL is IAM-authed; this is the single grant that lets the distribution
# sign requests to it. Without it, /api/* returns 403 — which is the point.
resource "aws_lambda_permission" "cloudfront" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = module.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = module.site.distribution_arn
  function_url_auth_type = "AWS_IAM"
}
