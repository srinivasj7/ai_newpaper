output "site_url" {
  description = "Where the paper lives."
  value       = module.site.site_url
}

output "cloudfront_domain" {
  description = "The distribution's own domain — still works when a custom domain is set."
  value       = module.site.domain_name
}

output "distribution_id" {
  description = "Needed by the frontend deploy workflow for invalidations."
  value       = module.site.distribution_id
}

output "bucket_name" {
  value = module.data.bucket_id
}

output "site_prefix" {
  value = module.data.site_prefix
}

output "data_prefix" {
  value = module.data.data_prefix
}

output "frontend_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in the repo's Actions variables."
  value       = module.ci.frontend_deploy_role_arn
}

output "tofu_apply_role_arn" {
  description = "Set as AWS_TOFU_APPLY_ROLE_ARN in the repo's Actions variables."
  value       = module.ci.tofu_apply_role_arn
}

output "tofu_plan_role_arn" {
  description = "Set as AWS_TOFU_PLAN_ROLE_ARN in the repo's Actions variables."
  value       = module.ci.tofu_plan_role_arn
}

output "pipeline_user_name" {
  description = "Mint its access key by hand: aws iam create-access-key --user-name <this>"
  value       = module.ci.pipeline_user_name
}

output "api_function_url" {
  description = "Direct URL — should answer 403 to anything but CloudFront."
  value       = module.api.function_url
}

output "runner_repository_url" {
  description = "Push the pipeline image here."
  value       = try(module.runner[0].repository_url, null)
}

output "runner_log_group" {
  description = "aws logs tail <this> --follow"
  value       = try(module.runner[0].log_group, null)
}

output "runner_run_task_command" {
  description = "Run today's edition by hand, with the network configuration filled in."
  value       = try(module.runner[0].run_task_command, null)
}
