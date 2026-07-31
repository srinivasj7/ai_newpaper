output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "function_arn" {
  value = aws_lambda_function.api.arn
}

# CloudFront wants a bare host, not a URL.
output "function_url_host" {
  value = replace(replace(aws_lambda_function_url.api.function_url, "https://", ""), "/", "")
}

output "function_url" {
  value = aws_lambda_function_url.api.function_url
}
