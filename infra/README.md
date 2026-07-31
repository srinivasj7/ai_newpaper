# Infrastructure

OpenTofu. Two roots: `bootstrap/` (state bucket, local state, applied once) and `envs/prod/`
(everything else, state in the bootstrap bucket).

```
modules/data   one private versioned bucket — site/ and data/ prefixes, lifecycle rules
modules/api    the write-path Lambda + Function URL (IAM auth, CloudFront OAC only)
modules/site   the single CloudFront distribution and its cache behaviours
modules/ci     GitHub OIDC roles + the pipeline IAM user
envs/prod      wires them together; holds the bucket policy and the Lambda invoke grant
```

## First apply

```bash
cd infra/bootstrap && tofu init && tofu apply     # creates the state bucket
cd ../envs/prod    && tofu init && tofu apply     # ~25 resources, a few minutes for CloudFront
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

## Notes

- **No custom domain by default.** `var.aliases` is empty and the distribution uses the
  CloudFront certificate. To add one: create an ACM certificate in **us-east-1**, then set
  `aliases` and `acm_certificate_arn`.
- **Both buckets refuse to be destroyed** (`prevent_destroy`). Editions are one-shot model
  output and feedback is a personal history; neither is reproducible.
- **Caching is split on purpose.** `index.json` and `config.json` are 60s; dated editions are
  cached hard because their keys never change. A daily run only ever invalidates the manifest.
- **The Function URL is not public.** It is `AWS_IAM`-authed and only the distribution's OAC can
  sign for it; hitting the URL directly returns 403. That is the expected result, not a fault.
