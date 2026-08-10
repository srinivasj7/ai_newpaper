# ai_newpaper — The Daily Compile

A personal daily tech/markets newspaper. A multi-model pipeline generates one edition JSON per day;
a static React site renders it. Per-story feedback flows back into the pipeline's judging.

[HANDOVER.md](HANDOVER.md) is the specification (architecture, data contracts, phases).
[CLAUDE.md](CLAUDE.md) is the condensed version used for agent context.
[daily-brief.jsx](daily-brief.jsx) is the original single-file prototype — the design source of truth.

## Three planes

| Plane | What it is | Depends on |
|---|---|---|
| Pipeline | Python + Docker Compose on a dedicated host; writes edition JSON to S3 | AWS data prefix only |
| AWS | S3 (private, versioned) behind one CloudFront distribution + one Lambda for writes | — |
| Frontend | Vite + React SPA, static on S3 | The JSON it fetches |

If the pipeline host is off, the site serves yesterday's paper. The frontend never calls a model API.

## Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 — serves dev-data/ at /data and stubs /api
npm run build      # -> frontend/dist
npm run preview
```

`dev-data/` is fixture JSON served only by the dev server (see `vite.config.js`); it is never
copied into `dist/`. In production the site reads `/data/*` and posts to `/api/*` on the same
CloudFront origin. Both bases are overridable via `VITE_DATA_BASE` / `VITE_API_BASE`.

## Infrastructure

OpenTofu (not Terraform-branded). Install: `winget install OpenTofu.Tofu`.

```bash
cd infra/bootstrap && tofu init && tofu apply     # state bucket, once
cd ../envs/prod    && tofu init && tofu apply     # everything else
```

## Unlocking the site

Reading needs nothing. Changing what the paper publishes — the topics, the sources, and the
keep/spike votes that steer the judge — is gated on a shared passphrase, because CloudFront's
OAC proves a request came through the distribution, not that it came from you.

The passphrase is a 32-character random string held in Parameter Store as a `SecureString`. It
exists in exactly one place: not in this repo, not in OpenTofu state, and not in any plan
output. Retrieve it with:

```bash
aws ssm get-parameter --name /daily-compile/admin-token --with-decryption \
  --query 'Parameter.Value' --output text
```

Then open the site, click the padlock in the masthead, and paste it. The browser keeps it in
`localStorage` and sends it as `x-dtb-token` on every write; the padlock turns green. Clicking
it again locks the browser and forgets the value.

To rotate it, overwrite the parameter and re-unlock each browser. The Lambda reads it at cold
start, so a rotation takes effect within minutes rather than instantly:

```bash
aws ssm put-parameter --name /daily-compile/admin-token --type SecureString \
  --overwrite --value "$(python -c 'import secrets;print(secrets.token_urlsafe(24)[:32])')"
```

Store it with no surrounding whitespace — a stray space is compared as part of the secret and
every write then fails with a 401 that looks like a wrong passphrase.

There is deliberately no rate limit or lockout: the defence is entropy (~192 bits), and the
comparison is constant-time so a wrong guess cannot be narrowed down one character at a time.

## Pipeline

Runs only on the pipeline host, never as part of a deploy:

```bash
cd pipeline && docker compose run --rm pipeline
```

Secrets live in `pipeline/.env` (git-ignored); `pipeline/.env.example` documents every variable.

## Guardrails

- No secrets in the repo, ever. GitHub OIDC for deploys; no long-lived AWS keys in CI.
- Financial content is AI-generated research, displayed with its disclaimers. No advice framing.
- Source trust tiers are respected; summaries stay short and cite deep links.
