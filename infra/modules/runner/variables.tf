variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "bucket_id" {
  description = "Bucket the pipeline publishes to."
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

variable "distribution_id" {
  description = "Distribution whose manifest is invalidated after a publish."
  type        = string
}

variable "distribution_arn" {
  description = "ARN of that distribution."
  type        = string
}

variable "claude_token_parameter_arn" {
  description = <<-EOT
    ARN of the SecureString parameter holding the writer's long-lived token, created by hand:
      claude setup-token
      aws ssm put-parameter --name /daily-compile/claude-oauth-token --type SecureString --value <token>
    Store it with no surrounding whitespace — a stray space is sent as part of the bearer
    token and the run fails with 401 Invalid bearer token.
  EOT
  type        = string
}

variable "bedrock_model_arns" {
  description = <<-EOT
    Model ARNs the task may invoke, matching what is enabled in config/providers.yml. Empty
    grants nothing at all.

    A cross-region inference profile needs both its own ARN and the foundation-model ARN in
    every region it routes to, e.g.
      arn:aws:bedrock:us-east-1:<account>:inference-profile/us.xai.grok-4-3-v1:0
      arn:aws:bedrock:us-east-1::foundation-model/xai.grok-4-3-v1:0
      arn:aws:bedrock:us-west-2::foundation-model/xai.grok-4-3-v1:0
    Note the empty account field on foundation-model ARNs: they are AWS-owned, not yours.
  EOT
  type        = list(string)
  default     = []
}

variable "vpc_id" {
  description = "VPC for the task's security group. The default VPC is fine."
  type        = string
}

variable "subnet_ids" {
  description = "Public subnets. Public on purpose: a private subnet needs a NAT gateway at roughly $33/month to serve a task that runs four minutes a day."
  type        = list(string)
}

variable "cpu" {
  description = "Fargate CPU units. 1024 = 1 vCPU."
  type        = string
  default     = "1024"
}

variable "memory" {
  description = "Fargate memory in MiB. Node plus the writer CLI wants headroom; 2048 is the floor."
  type        = string
  default     = "4096"
}

variable "image_tag" {
  description = "Image tag to run. The task definition is rewritten when this changes."
  type        = string
  default     = "latest"
}

variable "schedule_expression" {
  description = "When to publish. Default is early morning, after the US close and before the reader wakes."
  type        = string
  default     = "cron(15 6 * * ? *)"
}

variable "schedule_timezone" {
  description = "Timezone for the schedule expression."
  type        = string
  default     = "America/Los_Angeles"
}

variable "schedule_enabled" {
  description = "Set false to keep the task runnable by hand without it firing daily."
  type        = bool
  default     = true
}

variable "sec_user_agent" {
  description = "Contact string sent to SEC EDGAR, which rejects generic agents."
  type        = string
  default     = "DailyCompile personal-brief admin@example.com"
}

variable "alert_email" {
  description = "Address notified when a run fails. null disables the alarm, and a silent failure then looks exactly like a quiet news day."
  type        = string
  default     = null
}

variable "log_retention_days" {
  description = "CloudWatch retention for the run log."
  type        = number
  default     = 30
}
