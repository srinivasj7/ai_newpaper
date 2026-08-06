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

# CloudFront only accepts certificates from us-east-1, wherever the rest of the stack lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "opentofu"
      Repo      = var.github_repo
    }
  }
}

data "aws_caller_identity" "current" {}

# The task needs somewhere to run. The default VPC's public subnets are the right answer for
# a job that talks only outbound: no NAT gateway, no private networking to maintain.
data "aws_vpc" "default" {
  count   = var.claude_token_parameter == null ? 0 : 1
  default = true
}

data "aws_subnets" "runner" {
  count = var.claude_token_parameter == null ? 0 : 1

  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}

locals {
  bucket_name = coalesce(var.bucket_name, "${var.project}-${data.aws_caller_identity.current.account_id}")
  site_prefix = "site/"
  data_prefix = "data/"

  # An unset repository variable reaches TF_VAR_* as "", not null. Treat both as absent.
  domain_name = var.domain_name == null || var.domain_name == "" ? null : var.domain_name
  zone_id     = var.route53_zone_id == null || var.route53_zone_id == "" ? null : var.route53_zone_id
  given_cert  = var.acm_certificate_arn == null || var.acm_certificate_arn == "" ? null : var.acm_certificate_arn

  aliases = local.domain_name == null ? [] : [local.domain_name]

  # Create a certificate only when a domain is wanted and one wasn't supplied.
  create_cert     = local.domain_name != null && local.given_cert == null
  certificate_arn = local.create_cert ? module.cert[0].certificate_arn : local.given_cert

  runner_vpc_id     = var.runner_vpc_id != null ? var.runner_vpc_id : try(data.aws_vpc.default[0].id, null)
  runner_subnet_ids = length(var.runner_subnet_ids) > 0 ? var.runner_subnet_ids : try(data.aws_subnets.runner[0].ids, [])
}

module "cert" {
  source = "../../modules/cert"
  count  = local.create_cert ? 1 : 0

  providers = {
    aws = aws.us_east_1
  }

  domain_name     = local.domain_name
  route53_zone_id = local.zone_id
}

module "data" {
  source = "../../modules/data"

  bucket_name = local.bucket_name
  site_prefix = local.site_prefix
  data_prefix = local.data_prefix
}

module "api" {
  source = "../../modules/api"

  name            = var.project
  bucket_id       = module.data.bucket_id
  bucket_arn      = module.data.bucket_arn
  data_prefix     = local.data_prefix
  allowed_origins = var.app_origins

  admin_token_parameter     = var.admin_token_parameter
  admin_token_parameter_arn = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.admin_token_parameter}"
}

module "site" {
  source = "../../modules/site"

  name                        = var.project
  bucket_regional_domain_name = module.data.bucket_regional_domain_name
  site_prefix                 = local.site_prefix
  api_origin_host             = module.api.function_url_host
  aliases                     = local.aliases
  acm_certificate_arn         = local.certificate_arn
  price_class                 = var.price_class
  app_origins                 = var.app_origins
}

# The pipeline host, as a scheduled task rather than a machine. Optional: leave
# claude_token_parameter unset and the paper is published from wherever you run it by hand.
module "runner" {
  source = "../../modules/runner"
  count  = var.claude_token_parameter == null ? 0 : 1

  name             = var.project
  bucket_id        = module.data.bucket_id
  bucket_arn       = module.data.bucket_arn
  data_prefix      = local.data_prefix
  distribution_id  = module.site.distribution_id
  distribution_arn = module.site.distribution_arn

  claude_token_parameter_arn = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.claude_token_parameter}"

  vpc_id     = local.runner_vpc_id
  subnet_ids = local.runner_subnet_ids

  image_tag           = var.runner_image_tag
  schedule_expression = var.runner_schedule
  schedule_timezone   = var.runner_timezone
  schedule_enabled    = var.runner_schedule_enabled
  sec_user_agent      = var.sec_user_agent
  alert_email         = var.alert_email
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

# The Function URL is IAM-authed; these are the grants that let the distribution reach it.
# Both are required — with only InvokeFunctionUrl the function URL answers every request with
# "Forbidden" and the function is never invoked at all.
resource "aws_lambda_permission" "cloudfront_invoke_url" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = module.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = module.site.distribution_arn
  function_url_auth_type = "AWS_IAM"
}

# No function_url_auth_type here: Lambda rejects that condition for anything but
# lambda:InvokeFunctionUrl.
resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = module.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = module.site.distribution_arn
}

# Point the domain at the distribution. Alias records, so there is no TTL to wait out and
# no charge for the lookups. Here rather than in modules/cert for the same reason the
# certificate is split out: the records need the distribution, the distribution needs the cert.
resource "aws_route53_record" "site" {
  for_each = local.domain_name == null ? toset([]) : toset(["A", "AAAA"])

  zone_id = local.zone_id
  name    = local.domain_name
  type    = each.value

  alias {
    name                   = module.site.domain_name
    zone_id                = module.site.hosted_zone_id
    evaluate_target_health = false
  }
}
