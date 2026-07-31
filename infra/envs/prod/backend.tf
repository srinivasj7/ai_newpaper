/*
 * State lives in the bucket created by infra/bootstrap. Native S3 locking (OpenTofu
 * >= 1.10) — no DynamoDB table to own. Backend blocks take no variables, so the bucket
 * name is repeated here from var.state_bucket's default; change both together.
 */

terraform {
  backend "s3" {
    bucket       = "daily-compile-tofu-state-962765734576"
    key          = "envs/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
