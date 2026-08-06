# Pipeline

Generates one edition per day and publishes it to S3. Runs on a dedicated host; it is never a
runtime dependency of the site. If this host is off, the site serves yesterday's edition.

```
config + feedback  ->  gather  ->  writers (parallel)  ->  judge  ->  markets  ->  publish
```

## Run it

```bash
cp .env.example .env        # then fill it in
docker compose run --rm pipeline
docker compose run --rm pipeline --dry-run     # everything except the S3 write
```

Without Docker, on a host that already has Python and the writer CLIs:

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m src.main --dry-run --out edition.json
```

Useful flags: `--date YYYY-MM-DD`, `--no-markets`, `--out FILE`, `--dry-run`.

## What each part does

| Module | Responsibility |
|---|---|
| `gather.py` | The only code that reads the outside world: RSS/Atom per configured domain, plus the Hacker News API. Blocked domains are never fetched; preferred ones survive the trim. |
| `market.py` | Spot prices from Yahoo's public chart endpoint. Best-effort — a missing quote publishes as null, never as a guess. |
| `adapters/` | Turns a prompt into JSON. `cli.py` runs a coding-agent CLI headless with tools disabled; `openai_compatible.py` covers Ollama and hosted APIs. |
| `judge.py` | Pass-through with one writer; the rubric in `prompts/judge.md` when there are several. |
| `publish` (`store.py`) | Writes the edition, rebuilds the manifest, invalidates only `index.json`. |

## Rules the code enforces, not just the prompt

- **Citations must come from the pool.** A URL the writer invented is removed before publishing,
  because an invented source is the failure that most looks like fact.
- **Prices are never model-supplied.** Every `price` and `spot` is overwritten from market data
  after the model replies; tickers without a quote are dropped.
- **Story ids are unique across editions** — they are the key feedback is recorded against.
- **A degraded edition still publishes.** A failed provider, no quotes, or an empty options
  block are survivable. Publishing nothing is not, so those paths log loudly and continue.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Published |
| 2 | Nothing to run: no enabled candidate, or no enabled topic in the config |
| 3 | No headlines gathered — refuses to publish a fabricated edition |
| 4 | Fewer candidates succeeded than `min_candidates` |
| 5 | The winning edition had no publishable stories |

## Scheduling on AWS (Fargate)

`infra/modules/runner` runs this as a scheduled Fargate task: no instance to patch, no volume
to keep, and nothing running between the ~4 minutes a day it takes to write the paper. About
$0.16/month.

```bash
# 1. one-time: mint a long-lived token and store it, with no surrounding whitespace
claude setup-token
aws ssm put-parameter --name /daily-compile/claude-oauth-token --type SecureString --value "<token>"

# 2. create the runner (set claude_token_parameter in prod.auto.tfvars first)
cd infra/envs/prod && tofu apply

# 3. build and push the image the task pulls
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/arm64 -t "$(tofu output -raw runner_repository_url):latest" --push pipeline/

# 4. run it once by hand before trusting the schedule
eval "$(tofu output -raw runner_run_task_command)"
aws logs tail "$(tofu output -raw runner_log_group)" --follow
```

The container gets its AWS credentials from the task role, so `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` are not set on Fargate at all — delete the pipeline user's access key
once this works. The writer's token is injected from Parameter Store at start; it is never in
the image or the task definition.

Two things that bite:

- **Store the token with no leading or trailing whitespace.** A stray space is sent as part of
  the bearer token and the run fails with `401 Invalid bearer token` — at 06:15, silently.
- **The task runs in a public subnet on purpose.** A private subnet needs a NAT gateway at
  ~$33/month to serve a job that runs four minutes a day.

## Scheduling on your own host

The host owns the schedule; nothing here assumes a particular machine.

**systemd timer** — `/etc/systemd/system/daily-compile.service`:

```ini
[Service]
Type=oneshot
WorkingDirectory=/opt/ai_newpaper/pipeline
ExecStart=/usr/bin/docker compose run --rm pipeline
```

`/etc/systemd/system/daily-compile.timer`:

```ini
[Timer]
OnCalendar=*-*-* 06:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

**cron** — equivalent:

```cron
15 6 * * * cd /opt/ai_newpaper/pipeline && docker compose run --rm pipeline >> /var/log/daily-compile.log 2>&1
```

## Authentication

Claude Code authenticates from stored credentials, which expire within hours of an interactive
login. An unattended host needs a long-lived token instead: run `claude setup-token` once,
anywhere with a browser, and put the result in `.env` as `CLAUDE_CODE_OAUTH_TOKEN`. Usage
counts against the subscription rather than being billed per call.

AWS credentials belong to the dedicated pipeline user, scoped to the data prefix of one bucket
plus one invalidation:

```bash
aws iam create-access-key --user-name daily-compile-pipeline
```
