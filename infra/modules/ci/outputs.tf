output "frontend_deploy_role_arn" {
  value = aws_iam_role.frontend_deploy.arn
}

output "tofu_apply_role_arn" {
  value = aws_iam_role.tofu_apply.arn
}

output "tofu_plan_role_arn" {
  value = aws_iam_role.tofu_plan.arn
}

output "pipeline_user_name" {
  value = aws_iam_user.pipeline.name
}

output "pipeline_user_arn" {
  value = aws_iam_user.pipeline.arn
}
