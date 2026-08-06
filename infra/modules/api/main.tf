/*
 * The write path: one small Python Lambda behind a Function URL.
 *
 * The URL is AWS_IAM-authed and invoked by CloudFront's OAC, so the function is
 * unreachable except through the distribution. The lambda:InvokeFunctionUrl grant
 * for CloudFront lives in the root module — it needs the distribution ARN, which
 * depends on this module's URL, and the cycle has to be broken somewhere.
 */

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
  }
}

/*
 * Zipped from inline content rather than source_dir on purpose. With source_dir the archive
 * carries each file's modification time, which is set afresh by every git checkout — so the
 * hash changed on every runner and each CI plan reported the function as modified even though
 * the source was identical. Content blocks have no mtime to record, and the pinned file mode
 * keeps Windows and Linux from disagreeing about permission bits. The result depends on the
 * source and nothing else.
 */
data "archive_file" "lambda" {
  type             = "zip"
  output_path      = "${path.module}/.build/handler.zip"
  output_file_mode = "0644"

  source {
    content  = file("${path.module}/lambda/handler.py")
    filename = "handler.py"
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Exactly two things it may write: the feedback prefix and the one config key.
data "aws_iam_policy_document" "api" {
  statement {
    sid       = "WriteFeedbackEvents"
    actions   = ["s3:PutObject"]
    resources = ["${var.bucket_arn}/${var.data_prefix}feedback/*"]
  }

  statement {
    sid       = "WriteConfig"
    actions   = ["s3:PutObject"]
    resources = ["${var.bucket_arn}/${var.data_prefix}config/config.json"]
  }

  # One parameter, read-only. The secret never reaches the task definition, the plan output or
  # state — only this grant, and the function reads it for itself at cold start.
  statement {
    sid       = "ReadTheAdminToken"
    actions   = ["ssm:GetParameter"]
    resources = [var.admin_token_parameter_arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${var.name}-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.name}-api"
  role             = aws_iam_role.api.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      BUCKET      = var.bucket_id
      DATA_PREFIX = var.data_prefix
      # The parameter's name, not its value.
      ADMIN_TOKEN_PARAMETER = var.admin_token_parameter
      ALLOWED_ORIGINS       = join(",", var.allowed_origins)
    }
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}
