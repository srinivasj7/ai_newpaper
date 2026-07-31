/*
 * A DNS-validated certificate for the site's custom domain, and the CNAME that proves
 * ownership. Free, and renewed automatically as long as the validation record stays put.
 *
 * Deliberately separate from modules/site: the distribution needs a *validated* certificate
 * ARN before it can carry an alias, while the alias A/AAAA records need the distribution.
 * Splitting the two keeps that ordering honest instead of circular — the alias records live
 * in the root module next to the other joins.
 *
 * CloudFront only accepts certificates from us-east-1, so the caller must pass a provider
 * pinned to that region regardless of where the rest of the stack lives.
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

resource "aws_acm_certificate" "site" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Blocks until ACM has seen the record — without this the distribution can be created
# with a certificate that is still PENDING_VALIDATION and the apply fails late.
resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}
