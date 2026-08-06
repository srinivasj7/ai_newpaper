output "repository_url" {
  description = "Push the image here; the task pulls the tag named by var.image_tag."
  value       = aws_ecr_repository.pipeline.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.pipeline.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.pipeline.arn
}

output "task_definition_family" {
  value = aws_ecs_task_definition.pipeline.family
}

output "log_group" {
  description = "aws logs tail <this> --follow"
  value       = aws_cloudwatch_log_group.pipeline.name
}

output "security_group_id" {
  value = aws_security_group.pipeline.id
}

output "task_role_arn" {
  description = "What the pipeline itself may do. Replaces the static key it used from a laptop."
  value       = aws_iam_role.task.arn
}

# Everything needed to run it by hand, without reconstructing the network configuration.
output "run_task_command" {
  value = format(
    "aws ecs run-task --cluster %s --task-definition %s --launch-type FARGATE --network-configuration 'awsvpcConfiguration={subnets=[%s],securityGroups=[%s],assignPublicIp=ENABLED}'",
    aws_ecs_cluster.pipeline.name,
    aws_ecs_task_definition.pipeline.family,
    join(",", var.subnet_ids),
    aws_security_group.pipeline.id,
  )
}
