# Infrastructure

OpenTofu. Two roots: `bootstrap/` (state bucket, local state, applied once) and `envs/prod/`
(everything else, state in the bootstrap bucket).

```
modules/data   one private versioned bucket — site/ and data/ prefixes, lifecycle rules
modules/api    the write-path Lambda + Function URL (IAM auth, CloudFront OAC only)
modules/site   the single CloudFront distribution and its cache behaviours
modules/cert   DNS-validated certificate for the custom domain
modules/ci     GitHub OIDC roles + the pipeline IAM user
modules/runner the pipeline as a scheduled Fargate task (optional)
envs/prod      wires them together; holds the bucket policy and the Lambda invoke grant
```

## Local configuration (not committed)

Nothing in this repo names an account, a repo or a domain. Three untracked files supply those:

| File | Copy from | Holds |
|---|---|---|
| `bootstrap/bootstrap.auto.tfvars` | `.example` | the state bucket name |
| `envs/prod/backend.hcl` | `.example` | the same bucket + its region, for `tofu init` |
| `envs/prod/prod.auto.tfvars` | `.example` | state bucket, `owner/repo`, and the optional domain |

CI supplies the same values from repository variables and `github.repository`, so the workflows
need no checked-in config either.

## First apply

```bash
cd infra/bootstrap
cp bootstrap.auto.tfvars.example bootstrap.auto.tfvars   # then edit
tofu init && tofu apply                                  # creates the state bucket

cd ../envs/prod
cp backend.hcl.example backend.hcl                       # then edit
cp prod.auto.tfvars.example prod.auto.tfvars             # then edit
tofu init -backend-config=backend.hcl
tofu apply                                               # ~30 resources; CloudFront takes a few minutes
```

Then, once:

```bash
# The pipeline host's credentials — deliberately not managed by tofu, so no secret in state.
aws iam create-access-key --user-name $(tofu output -raw pipeline_user_name)
```

Put the key in `pipeline/.env` on the pipeline host. Nowhere else.

## Tests

The write-path Lambda has no AWS dependency in its logic, so its routing and validation are
testable in one command — boto3 is stubbed and the puts are captured:

```bash
python infra/modules/api/tests/test_handler.py
```

## Wiring GitHub Actions

Set these repository **variables** (not secrets — they are ARNs, not credentials):

| Variable | From |
|---|---|
| `AWS_REGION` | `us-east-1` unless you changed `var.region` |
| `AWS_DEPLOY_ROLE_ARN` | `tofu output -raw frontend_deploy_role_arn` |
| `AWS_TOFU_APPLY_ROLE_ARN` | `tofu output -raw tofu_apply_role_arn` |
| `AWS_TOFU_PLAN_ROLE_ARN` | `tofu output -raw tofu_plan_role_arn` |
| `SITE_BUCKET` | `tofu output -raw bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `tofu output -raw distribution_id` |
| `TF_STATE_BUCKET` | the bucket in `backend.hcl` |
| `SITE_DOMAIN` | your domain, or leave unset for the CloudFront domain |
| `ROUTE53_ZONE_ID` | the zone holding that domain; unset if `SITE_DOMAIN` is unset |

`github_repo` is not a variable — the infra workflow passes `github.repository`.

## The scheduled runner (optional)

Set `claude_token_parameter` in `prod.auto.tfvars` and the pipeline gets an ECR repository, a
Fargate task definition, an EventBridge schedule and a failure alarm — roughly $0.16/month for
a task that runs four minutes a day. Leave it unset and none of it is created.

```hcl
claude_token_parameter = "/daily-compile/claude-oauth-token"
alert_email            = "you@example.com"   # a silent failure looks like a quiet news day
runner_timezone        = "America/Los_Angeles"
```

After the first apply, push an image and run it once by hand:

```bash
docker buildx build --platform linux/arm64 -t "$(tofu output -raw runner_repository_url):latest" --push ../../../pipeline
eval "$(tofu output -raw runner_run_task_command)"
aws logs tail "$(tofu output -raw runner_log_group)" --follow
```

Design notes worth keeping:

- **Public subnet, no NAT.** The task talks only outbound. A NAT gateway costs $0.045/hour —
  about $33/month, roughly two hundred times the compute it would serve. A public IP is billed
  per hour of use, so a four-minute task costs about a cent a month.
- **Task role, not keys.** The container receives credentials from its role, so the pipeline
  IAM user's access key can be deleted once the task works.
- **No retries.** A failed run means the site serves yesterday's paper, which is the designed
  behaviour. A retry storm against the model API is worse than a thin news day.

## Notes

- **Custom domain is opt-in and free.** Set `domain_name` + `route53_zone_id` and the stack mints
  a DNS-validated ACM certificate, waits for validation, and points A/AAAA alias records at the
  distribution. Leave them unset and the site lives on the CloudFront domain. Certificates are
  free; alias queries to a CloudFront target are not billed. `acm_certificate_arn` reuses a
  certificate you already own instead of creating one.
- **Both buckets refuse to be destroyed** (`prevent_destroy`). Editions are one-shot model
  output and feedback is a personal history; neither is reproducible.
- **Caching is split on purpose.** `index.json` and `config.json` are 60s; dated editions are
  cached hard because their keys never change. A daily run only ever invalidates the manifest.
- **The Function URL is not public.** It is `AWS_IAM`-authed and only the distribution's OAC can
  sign for it; hitting the URL directly returns 403. That is the expected result, not a fault.
