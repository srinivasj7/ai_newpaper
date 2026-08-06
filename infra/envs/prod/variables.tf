/*
 * Values that identify the account, the repo or the domain are deliberately not defaulted
 * here — they live in an untracked prod.auto.tfvars (see prod.auto.tfvars.example).
 * Everything with a default is generic and safe to publish.
 */

variable "project" {
  description = "Name prefix for every resource in the stack."
  type        = string
  default     = "daily-compile"
}

variable "region" {
  description = "Region for the bucket and the Lambda. Keep it equal to the state bucket's region."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Site/data bucket. Defaults to <project>-<account id>, which is unique without being guessable."
  type        = string
  default     = null
}

variable "state_bucket" {
  description = "OpenTofu state bucket created by infra/bootstrap. Needed so the PR plan role can take the state lock."
  type        = string
}

variable "github_repo" {
  description = "owner/repo trusted by the OIDC deploy roles. CI passes this as TF_VAR_github_repo."
  type        = string
}

variable "default_branch" {
  description = "Branch allowed to deploy and apply."
  type        = string
  default     = "main"
}

variable "create_oidc_provider" {
  description = "false if this account already has a GitHub OIDC provider."
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  description = "ARN of that existing provider, when create_oidc_provider is false."
  type        = string
  default     = null
}

# These three arrive from CI as environment variables, where an unset repository variable is an
# empty string rather than null. Both are treated as "no custom domain" — see locals in main.tf.

variable "domain_name" {
  description = "Custom domain for the site, e.g. paper.example.com. Unset serves the site on the CloudFront domain."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Hosted zone holding domain_name. Required when domain_name is set and acm_certificate_arn is not."
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null || var.domain_name == "" || (var.route53_zone_id != null && var.route53_zone_id != "")
    error_message = "route53_zone_id is required when domain_name is set."
  }
}

variable "acm_certificate_arn" {
  description = "Reuse an existing us-east-1 certificate covering domain_name instead of creating one."
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "app_origins" {
  description = <<-EOT
    Web origins allowed to read /data|/app and write /api cross-origin (CORS), for the bundled
    mobile app. Both platforms run at https://localhost. Same-origin browsers behind CloudFront
    are unaffected. Add a custom domain here only if a separate web origin must reach the data.
  EOT
  type        = list(string)
  default     = ["https://localhost"]
}

variable "admin_token_parameter" {
  description = <<-EOT
    Name of the SecureString parameter holding the shared secret that gates every write to the
    API. Created by hand, so the value exists in exactly one place and never in state:
      aws ssm put-parameter --name /daily-compile/admin-token --type SecureString --value <32 random chars>
    Defaulted rather than left to a repository variable on purpose: an input that is set locally
    but absent in CI makes CI compute a smaller configuration and delete the difference.
  EOT
  type        = string
  default     = "/daily-compile/admin-token"
}

# ------------------------------------------------------------------ scheduled pipeline
# All optional. Without claude_token_parameter the runner is not created at all and the
# paper is published from wherever you run the pipeline by hand.

variable "claude_token_parameter" {
  description = "Name of the SecureString parameter holding the writer's long-lived token, e.g. /daily-compile/claude-oauth-token. null disables the scheduled runner."
  type        = string
  default     = null
}

variable "runner_image_tag" {
  description = "Image tag the scheduled task runs."
  type        = string
  default     = "latest"
}

variable "runner_schedule" {
  description = "When the paper is written."
  type        = string
  default     = "cron(15 6 * * ? *)"
}

variable "runner_timezone" {
  description = "Timezone for runner_schedule."
  type        = string
  default     = "America/Los_Angeles"
}

variable "runner_schedule_enabled" {
  description = "false keeps the task runnable by hand without firing daily."
  type        = bool
  default     = true
}

variable "runner_vpc_id" {
  description = "Override the default VPC for the task."
  type        = string
  default     = null
}

variable "runner_subnet_ids" {
  description = "Override the public subnets for the task. Must be public: a private subnet needs a NAT gateway."
  type        = list(string)
  default     = []
}

variable "sec_user_agent" {
  description = "Contact string sent to SEC EDGAR, which rejects generic user agents."
  type        = string
  default     = "DailyCompile personal-brief admin@example.com"
}

variable "alert_email" {
  description = "Address notified when a scheduled run fails. Without it, a failure is indistinguishable from a quiet news day."
  type        = string
  default     = null
}
