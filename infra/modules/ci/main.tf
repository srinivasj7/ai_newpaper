/*
 * Who is allowed to change things, and from where.
 *
 *   frontend-deploy  GitHub Actions on main: sync the site prefix, invalidate
 *   tofu-apply       GitHub Actions on main: everything (infrastructure changes)
 *   tofu-plan        GitHub Actions on a PR: read-only, so a plan comment can't mutate
 *   pipeline (user)  the pipeline host: write the data prefix, invalidate the manifest
 *
 * No access key is created here on purpose — a key in state is a key in a file. Mint
 * the pipeline user's key by hand once:  aws iam create-access-key --user-name <name>
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

locals {
  oidc_host = "token.actions.githubusercontent.com"
  oidc_arn  = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.existing_oidc_provider_arn
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  # AWS validates GitHub's certificate chain itself now; this list is kept for
  # providers/regions that still require a value.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

/*
 * GitHub is migrating the OIDC subject claim to an "immutable" form that embeds the numeric
 * owner and repository ids:
 *
 *   classic    repo:owner/repo:pull_request
 *   immutable  repo:owner@1234567/repo@89012345:pull_request
 *
 * A repository can emit either, so both shapes are accepted. Only the numeric ids are
 * wildcarded — the owner and repository names stay pinned, and so does the trailing claim
 * that distinguishes a push to the default branch from a pull request.
 */
locals {
  owner = split("/", var.github_repo)[0]
  repo  = split("/", var.github_repo)[1]

  subject_patterns = {
    main         = ["repo:${var.github_repo}:ref:refs/heads/${var.default_branch}", "repo:${local.owner}@*/${local.repo}@*:ref:refs/heads/${var.default_branch}"]
    pull_request = ["repo:${var.github_repo}:pull_request", "repo:${local.owner}@*/${local.repo}@*:pull_request"]
  }
}

data "aws_iam_policy_document" "github_main" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values   = local.subject_patterns.main
    }
  }
}

data "aws_iam_policy_document" "github_pr" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values   = local.subject_patterns.pull_request
    }
  }
}

# --------------------------------------------------------------- frontend deploy

resource "aws_iam_role" "frontend_deploy" {
  name               = "${var.name}-frontend-deploy"
  description        = "GitHub Actions: publish the built SPA"
  assume_role_policy = data.aws_iam_policy_document.github_main.json
}

data "aws_iam_policy_document" "frontend_deploy" {
  statement {
    sid       = "SyncSitePrefix"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${var.bucket_arn}/${var.site_prefix}*"]
  }

  statement {
    sid       = "ListSitePrefix"
    actions   = ["s3:ListBucket"]
    resources = [var.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.site_prefix}*", var.site_prefix, ""]
    }
  }

  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.distribution_arn]
  }
}

resource "aws_iam_role_policy" "frontend_deploy" {
  name   = "${var.name}-frontend-deploy"
  role   = aws_iam_role.frontend_deploy.id
  policy = data.aws_iam_policy_document.frontend_deploy.json
}

# ------------------------------------------------------------------ tofu roles

resource "aws_iam_role" "tofu_apply" {
  name               = "${var.name}-tofu-apply"
  description        = "GitHub Actions on ${var.default_branch}: apply infrastructure changes"
  assume_role_policy = data.aws_iam_policy_document.github_main.json
}

# Broad by nature — it manages the stack. Scoped by *who* can assume it, not by action.
resource "aws_iam_role_policy_attachment" "tofu_apply" {
  role       = aws_iam_role.tofu_apply.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# PowerUserAccess stops short of IAM, which this stack creates.
data "aws_iam_policy_document" "tofu_apply_iam" {
  statement {
    sid = "ManageStackIdentities"
    actions = [
      "iam:*Role*", "iam:*Policy*", "iam:*User*", "iam:*AccessKey*",
      "iam:*OpenIDConnectProvider*", "iam:GetAccountSummary", "iam:TagRole", "iam:TagPolicy",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "tofu_apply_iam" {
  name   = "${var.name}-tofu-apply-iam"
  role   = aws_iam_role.tofu_apply.id
  policy = data.aws_iam_policy_document.tofu_apply_iam.json
}

resource "aws_iam_role" "tofu_plan" {
  name               = "${var.name}-tofu-plan"
  description        = "GitHub Actions on pull requests: read-only plan"
  assume_role_policy = data.aws_iam_policy_document.github_pr.json
}

resource "aws_iam_role_policy_attachment" "tofu_plan_readonly" {
  role       = aws_iam_role.tofu_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# A plan needs to read and lock state, which is a write to the state bucket.
data "aws_iam_policy_document" "tofu_plan_state" {
  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "tofu_plan_state" {
  name   = "${var.name}-tofu-plan-state"
  role   = aws_iam_role.tofu_plan.id
  policy = data.aws_iam_policy_document.tofu_plan_state.json
}

# -------------------------------------------------------------- pipeline principal

resource "aws_iam_user" "pipeline" {
  name = "${var.name}-pipeline"
  path = "/pipeline/"
}

data "aws_iam_policy_document" "pipeline" {
  statement {
    sid       = "WriteEditionsAndReadConfig"
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
    sid       = "InvalidateManifest"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [var.distribution_arn]
  }
}

resource "aws_iam_user_policy" "pipeline" {
  name   = "${var.name}-pipeline"
  user   = aws_iam_user.pipeline.name
  policy = data.aws_iam_policy_document.pipeline.json
}
