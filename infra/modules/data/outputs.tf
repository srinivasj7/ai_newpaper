output "bucket_id" {
  value = aws_s3_bucket.app.id
}

output "bucket_arn" {
  value = aws_s3_bucket.app.arn
}

output "bucket_regional_domain_name" {
  value = aws_s3_bucket.app.bucket_regional_domain_name
}

output "site_prefix" {
  value = var.site_prefix
}

output "data_prefix" {
  value = var.data_prefix
}
