output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.site.arn
}

output "domain_name" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "hosted_zone_id" {
  description = "CloudFront's own zone id, for Route 53 alias records."
  value       = aws_cloudfront_distribution.site.hosted_zone_id
}

output "site_url" {
  value = length(var.aliases) > 0 ? "https://${var.aliases[0]}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}
