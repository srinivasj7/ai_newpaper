variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "bucket_id" {
  description = "Bucket the function writes to."
  type        = string
}

variable "bucket_arn" {
  description = "ARN of that bucket."
  type        = string
}

variable "data_prefix" {
  description = "Data key prefix, with a trailing slash."
  type        = string
  default     = "data/"
}

variable "admin_token_parameter" {
  description = <<-EOT
    Name of the SecureString parameter holding the shared secret that every write must present,
    e.g. /daily-compile/admin-token. The function reads it at cold start; it is deliberately not
    a `data` source, because that would put the secret in the plan output and in state.
  EOT
  type        = string
}

variable "admin_token_parameter_arn" {
  description = "ARN of that parameter — the only one this function may read."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch retention for the function's logs."
  type        = number
  default     = 30
}

variable "allowed_origins" {
  description = <<-EOT
    Origins allowed to call the write API cross-origin (CORS). The bundled mobile app is
    https://localhost. Same-origin browsers behind CloudFront send no Origin and are unaffected.
    Empty disables cross-origin writes.
  EOT
  type        = list(string)
  default     = ["https://localhost"]
}
