output "certificate_arn" {
  description = "Validated certificate — safe to hand straight to CloudFront."
  value       = aws_acm_certificate_validation.site.certificate_arn
}
