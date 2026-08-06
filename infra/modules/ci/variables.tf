variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "github_repo" {
  description = "owner/repo allowed to assume the deploy roles."
  type        = string
}

variable "default_branch" {
  description = "Branch permitted to deploy and apply."
  type        = string
  default     = "main"
}

variable "deploy_environment" {
  description = "GitHub deployment environment used by gated jobs. A job declaring it is identified by it in the OIDC subject claim, not by its branch."
  type        = string
  default     = "prod"
}

variable "create_oidc_provider" {
  description = "false if the account already has a GitHub OIDC provider."
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  description = "ARN of the existing provider when create_oidc_provider is false."
  type        = string
  default     = null
}

variable "bucket_arn" {
  description = "ARN of the site/data bucket."
  type        = string
}

variable "site_prefix" {
  description = "Site key prefix, with a trailing slash."
  type        = string
  default     = "site/"
}

variable "data_prefix" {
  description = "Data key prefix, with a trailing slash."
  type        = string
  default     = "data/"
}

variable "distribution_arn" {
  description = "ARN of the distribution these principals may invalidate."
  type        = string
}

variable "state_bucket" {
  description = "OpenTofu state bucket, so the plan role can take the state lock."
  type        = string
}
