/*
 * The pipeline as a scheduled Fargate task.
 *
 * The factory moves off a laptop without becoming a server: no instance to patch, no volume
 * to keep, and nothing running between the ~4 minutes a day it takes to write the paper.
 *
 * Two deliberate choices worth stating, because both are easy to get wrong and expensive:
 *
 *   Public subnet, public IP, no NAT. The task needs the open internet for RSS, market data
 *   and the model API. A NAT Gateway would be $0.045/hour — about $33 a month, roughly two
 *   hundred times the compute it would serve. A public IP is billed per hour of use, so a
 *   task that lives four minutes a day costs about a cent a month.
 *
 *   Task role, not access keys. The container gets credentials from its role at runtime, so
 *   the static key the pipeline used from a laptop stops existing.
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

data "aws_region" "current" {}

locals {
  name = "${var.name}-pipeline"
}

# --------------------------------------------------------------------------- image

resource "aws_ecr_repository" "pipeline" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# One image a day would otherwise accumulate forever at $0.10/GB-month.
resource "aws_ecr_lifecycle_policy" "pipeline" {
  repository = aws_ecr_repository.pipeline.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

# --------------------------------------------------------------------------- logs

resource "aws_cloudwatch_log_group" "pipeline" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

# --------------------------------------------------------------------------- roles

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by the Fargate agent before the container starts: pull the image, read the token,
# open the log stream. Deliberately separate from what the pipeline itself may do.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "ReadTheWriterToken"
    actions   = ["ssm:GetParameters"]
    resources = [var.claude_token_parameter_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${local.name}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Assumed by the pipeline itself. This is the same access the pipeline IAM user had, minus
# the long-lived key: write the data prefix, read the config, invalidate the manifest.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ReadWriteDataPrefix"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.bucket_arn}/${var.data_prefix}*"]
  }

  statement {
    sid       = "ListDataPrefix"
    actions   = ["s3:ListBucket"]
    resources = [var.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.data_prefix}*", var.data_prefix]
    }
  }

  statement {
    sid       = "InvalidateWhatItWrote"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [var.distribution_arn]
  }

  # Bedrock, as the writers and the judge. Empty by default: no models enabled means no grant,
  # rather than a wildcard sitting there waiting to be forgotten.
  #
  # A cross-region inference profile needs BOTH arns — the profile itself, and the underlying
  # foundation model in every region the profile can route to. Granting only the profile fails
  # at call time with AccessDenied naming a model arn you never wrote down, which is a
  # thoroughly confusing way to spend an afternoon.
  dynamic "statement" {
    for_each = length(var.bedrock_model_arns) > 0 ? [1] : []

    content {
      sid       = "InvokeTheModels"
      actions   = ["bedrock:InvokeModel"]
      resources = var.bedrock_model_arns
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = local.name
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# --------------------------------------------------------------------------- the task

resource "aws_ecs_cluster" "pipeline" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled" # a four-minute task a day does not need per-second metrics
  }
}

resource "aws_ecs_task_definition" "pipeline" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # Graviton: same work, about 20% cheaper than x86.
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "pipeline"
    image     = "${aws_ecr_repository.pipeline.repository_url}:${var.image_tag}"
    essential = true

    environment = [
      { name = "DATA_BUCKET", value = var.bucket_id },
      { name = "DATA_PREFIX", value = var.data_prefix },
      { name = "CLOUDFRONT_DISTRIBUTION_ID", value = var.distribution_id },
      { name = "AWS_REGION", value = data.aws_region.current.region },
      # The paper's calendar, taken from the schedule's own timezone so the two cannot drift.
      # The container's clock is UTC; without this the edition is dated in UTC, and any run
      # after 17:00 local publishes tomorrow's paper.
      { name = "EDITION_TZ", value = var.schedule_timezone },
      # Identifies the brief to the SEC, which rejects generic agents on its EDGAR feeds.
      { name = "SEC_USER_AGENT", value = var.sec_user_agent },
    ]

    # Injected at start from Parameter Store: never in the image, never in the task definition.
    secrets = [
      { name = "CLAUDE_CODE_OAUTH_TOKEN", valueFrom = var.claude_token_parameter_arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.pipeline.name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "run"
      }
    }
  }])
}

# --------------------------------------------------------------------------- networking

# No inbound rules at all. The task opens connections; nothing connects to it.
resource "aws_security_group" "pipeline" {
  name        = local.name
  description = "Outbound only: feeds, market data, the model API and AWS"
  vpc_id      = var.vpc_id

  egress {
    description = "all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --------------------------------------------------------------------------- schedule

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "RunTheTask"
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.pipeline.arn_without_revision}:*"]

    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.pipeline.arn]
    }
  }

  # RunTask hands the two roles above to the task; without this it cannot.
  statement {
    sid       = "PassTheRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${local.name}-scheduler"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "daily" {
  name       = local.name
  state      = var.schedule_enabled ? "ENABLED" : "DISABLED"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  target {
    arn      = aws_ecs_cluster.pipeline.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.pipeline.arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        subnets          = var.subnet_ids
        security_groups  = [aws_security_group.pipeline.id]
        assign_public_ip = true # the alternative is a NAT gateway at ~$33/month
      }
    }

    # No retries on purpose. A failed run means no edition today and the site keeps serving
    # yesterday's, which is the designed behaviour; a retry storm against the model API is
    # strictly worse than a thin news day.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# --------------------------------------------------------------------------- alerting

/*
 * A silent failure looks exactly like a quiet news day, which is the worst property this
 * system could have. This turns "the paper looks stale" into an email.
 */
resource "aws_sns_topic" "alerts" {
  count = var.alert_email == null ? 0 : 1
  name  = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts" {
  count     = var.alert_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email # requires a one-time confirmation from the inbox
}

resource "aws_cloudwatch_event_rule" "task_failed" {
  count       = var.alert_email == null ? 0 : 1
  name        = "${local.name}-task-failed"
  description = "A pipeline task stopped with a non-zero exit code"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn    = [aws_ecs_cluster.pipeline.arn]
      lastStatus    = ["STOPPED"]
      containers    = { exitCode = [{ "anything-but" = 0 }] }
      stoppedReason = [{ "exists" = true }]
    }
  })
}

resource "aws_cloudwatch_event_target" "task_failed" {
  count     = var.alert_email == null ? 0 : 1
  rule      = aws_cloudwatch_event_rule.task_failed[0].name
  target_id = "sns"
  arn       = aws_sns_topic.alerts[0].arn
}

data "aws_iam_policy_document" "alerts_topic" {
  count = var.alert_email == null ? 0 : 1

  statement {
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts[0].arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  count  = var.alert_email == null ? 0 : 1
  arn    = aws_sns_topic.alerts[0].arn
  policy = data.aws_iam_policy_document.alerts_topic[0].json
}
