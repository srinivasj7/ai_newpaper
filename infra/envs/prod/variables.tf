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
  description = "Override the generated bucket name (<project>-<account id>)."
  type        = string
  default     = null
}

variable "state_bucket" {
  description = "OpenTofu state bucket, created by infra/bootstrap."
  type        = string
  default     = "daily-compile-tofu-state-962765734576"
}

variable "github_repo" {
  description = "owner/repo trusted by the OIDC deploy roles."
  type        = string
  default     = "srinivasj7/ai_newpaper"
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

variable "aliases" {
  description = "Custom domains for the site. Empty means the CloudFront domain is the site."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "us-east-1 certificate covering the aliases. Required only when aliases is non-empty."
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}
