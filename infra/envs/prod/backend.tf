/*
 * Partial backend on purpose: the state bucket name is account-specific, so it is not
 * committed. Supply it at init time from the untracked backend.hcl (copy backend.hcl.example):
 *
 *     tofu init -backend-config=backend.hcl
 *
 * Native S3 locking (OpenTofu >= 1.10) — no DynamoDB table to own.
 */

terraform {
  backend "s3" {
    key          = "envs/prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
