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
