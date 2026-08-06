variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "bucket_regional_domain_name" {
  description = "Regional domain name of the bucket holding both prefixes."
  type        = string
}

variable "site_prefix" {
  description = "Key prefix of the built SPA, with a trailing slash."
  type        = string
  default     = "site/"
}

variable "api_origin_host" {
  description = "Bare host of the Lambda Function URL."
  type        = string
}

variable "aliases" {
  description = "Custom domains. Empty means the site is served on the CloudFront domain."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "us-east-1 certificate covering the aliases. null means use the CloudFront default certificate."
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
    Web origins allowed to read /data/* and /app/* cross-origin (CORS). The bundled Capacitor
    app runs at https://localhost on both platforms. Add a custom domain here only if a separate
    web app on another origin ever needs to read the data. Leave empty to disable CORS entirely.
  EOT
  type        = list(string)
  default     = ["https://localhost"]
}
