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

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/handler.zip"

  # Without a fixed mode the zip carries whatever permission bits the local filesystem reports,
  # so Windows and Linux produce different hashes for identical source and every CI plan shows
  # the function as changed. Pinning it makes the artifact reproducible anywhere.
  output_file_mode = "0644"
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
    }
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}
