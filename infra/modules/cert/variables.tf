variable "domain_name" {
  description = "Domain the certificate covers, e.g. paper.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone that can answer the validation CNAME."
  type        = string
}
