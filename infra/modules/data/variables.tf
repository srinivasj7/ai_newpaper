variable "bucket_name" {
  description = "Globally unique bucket name holding both the site and the data prefixes."
  type        = string
}

variable "site_prefix" {
  description = "Key prefix for the built SPA, with a trailing slash."
  type        = string
  default     = "site/"
}

variable "data_prefix" {
  description = "Key prefix for editions, config and feedback, with a trailing slash."
  type        = string
  default     = "data/"
}
