output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.site.arn
}

output "domain_name" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  value = length(var.aliases) > 0 ? "https://${var.aliases[0]}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}
