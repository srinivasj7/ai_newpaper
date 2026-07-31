/*
 * One distribution, three origins, one bucket.
 *
 *   /            -> S3 origin with origin_path=/site   (the SPA)
 *   /data/*      -> the same bucket at its root        (editions, manifest, config)
 *   /api/*       -> the Lambda Function URL            (feedback + config writes)
 *
 * Cache split on the data side is deliberate: dated edition files are immutable and
 * cached hard, while the manifest and the config change daily and are cached for a
 * minute — so a fresh edition shows up without an invalidation on every object.
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

locals {
  s3_site_origin = "s3-site"
  s3_data_origin = "s3-data"
  api_origin     = "lambda-api"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${var.name}-lambda"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Short-lived cache for the two documents that change every day.
resource "aws_cloudfront_cache_policy" "short" {
  name        = "${var.name}-short"
  comment     = "60s — the edition manifest and the pipeline config"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.aliases

  origin {
    origin_id                = local.s3_site_origin
    domain_name              = var.bucket_regional_domain_name
    origin_path              = "/${trimsuffix(var.site_prefix, "/")}"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.s3_data_origin
    domain_name              = var.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.api_origin
    domain_name              = var.api_origin_host
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = local.s3_site_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  ordered_cache_behavior {
    path_pattern           = "/data/editions/index.json"
    target_origin_id       = local.s3_data_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.short.id
  }

  ordered_cache_behavior {
    path_pattern           = "/data/config/config.json"
    target_origin_id       = local.s3_data_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.short.id
  }

  # Dated editions never change once published.
  ordered_cache_behavior {
    path_pattern           = "/data/*"
    target_origin_id       = local.s3_data_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.api_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    # Not compressed on purpose: CloudFront rewrites Accept-Encoding when it compresses, and
    # on an OAC-signed Lambda origin that happens after signing — the origin then rejects the
    # request as Forbidden. The responses here are a few dozen bytes of JSON regardless.
    compress = false

    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  # No custom_error_response on purpose. Custom error responses are distribution-wide, so a
  # blanket 403/404 -> /index.html rule would also swallow a failed /api/* call and a missing
  # edition under /data/*, turning both into a 200 of HTML — which is exactly how a broken API
  # first hid here. The app keeps all its state in memory and has no deep links, so there is
  # nothing for an SPA fallback to rescue. If client-side routing is ever added, do it with a
  # CloudFront Function on the default behaviour only, not with error responses.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }
}
