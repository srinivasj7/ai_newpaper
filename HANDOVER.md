# ai_newpaper — Implementation Handover

**Repo:** this one (monorepo) · **Working title:** The Daily Compile
**This document is the single source of truth for implementation. The design reference frontend (`daily-brief.jsx`) accompanies it.**

---

## 1. Mission

A personal daily tech/markets newspaper. A multi-model pipeline generates one edition JSON per day; a static frontend renders it. The user customizes topics/sources and gives per-story feedback, which flows back into the pipeline's judging.

Inspired by https://daily-tech-brief-self.vercel.app (feed briefs + stocks snapshot + options sheet + archive), rebuilt with: editorial newspaper design, history, custom topics with weights, custom sources with trust tiers, per-story feedback, and multi-model provenance.

## 2. Architecture (three planes, deliberately decoupled)

```
┌──────────────── PIPELINE SERVER (separate, dedicated) ───────────────┐
│ Docker Compose:                                                      │
│   pipeline (Python)  ── judge HTTP ──▶  ollama (GPU passthrough)     │
│ Scheduled by host cron/systemd: `docker compose run --rm pipeline`   │
│ AWS access: dedicated IAM role/user creds in .env, scoped to         │
│   s3://<data-prefix>/* write + cloudfront:CreateInvalidation         │
└───────────────┬──────────────────────────────────────────────────────┘
                │ writes editions/index, reads config+feedback
                ▼
┌──────────────────────────── AWS ─────────────────────────────────────┐
│ S3 (private, versioned)  ◀── OAC ──  CloudFront (single distro)      │
│   /                → frontend static site (S3 site prefix)           │
│   /data/*          → editions, index, config (S3 data prefix)        │
│   /api/*           → Lambda Function URL (feedback + config writes)  │
│ ACM cert, GitHub OIDC deploy roles. IaC: OpenTofu.                   │
└───────────────┬──────────────────────────────────────────────────────┘
                │ serves JSON + static site
                ▼
        Browser (React SPA — "The Daily Compile")
```

Decoupling rules:
- Pipeline server never hosts the site and is never a runtime dependency of it. If the server is off, the site serves yesterday's paper.
- Frontend never calls model APIs. It reads S3-backed JSON and POSTs feedback to the Lambda.
- Infra deploys (GitHub Actions) never touch the pipeline server.

## 3. Repo layout

```
ai_newpaper/
├── frontend/                  # Vite + React SPA
│   ├── src/                   # port of daily-brief.jsx (see §6)
│   └── ...
├── pipeline/                  # runs ONLY on the pipeline server
│   ├── docker-compose.yml     # pipeline + ollama (gpus: all)
│   ├── Dockerfile
│   ├── .env.example           # every secret/param documented, no values
│   ├── config/providers.yml   # provider registry (see §7)
│   ├── prompts/               # writer prompt, judge rubric — versioned
│   └── src/
│       ├── main.py            # orchestrator
│       ├── gather.py          # headlines per topic from trusted sources
│       ├── adapters/          # cli.py, openai_compatible.py, base.py
│       ├── judge.py
│       ├── publish.py         # S3 put + index update + CF invalidation
│       └── models.py          # pydantic models of the contracts in §5
├── infra/
│   ├── modules/
│   │   ├── site/              # S3 site prefix policy, CF distro, OAC, ACM
│   │   ├── data/              # data bucket/prefixes, lifecycle, versioning
│   │   ├── api/               # feedback Lambda + Function URL + CF behavior
│   │   └── ci/                # GitHub OIDC provider + deploy/pipeline roles
│   └── envs/prod/             # root module, backend config
├── .github/workflows/
│   ├── frontend.yml           # build + S3 sync + invalidation (OIDC)
│   └── infra.yml              # tofu fmt/validate/plan on PR, apply on main
├── CLAUDE.md                  # condensed version of this doc for agent context
└── README.md
```

## 4. S3 data layout

```
data/editions/YYYY-MM-DD.json      # one edition per day (contract §5.1)
data/editions/index.json           # manifest (see below)
data/config/config.json            # current topics/sources config (§5.2)
data/feedback/YYYY-MM-DD/<storyId>-<epoch-ms>.json   # one object per event (§5.3)
```

**Manifest — `data/editions/index.json`**, an array, newest first. The frontend renders the
Archive tab and the "past snapshots / past sheets" lists on the market pages from this file alone
(one fetch, not one per edition), so it carries summary fields the prototype used to read off full
editions. Everything after `hasOptions` is optional — the UI degrades gracefully without it.

```jsonc
[{ "date": "2026-07-17", "edition": 26, "leadHeadline": "…", "storyCount": 5,
   "hasStocks": true, "hasOptions": true,
   "candidateCount": 3,                                            // "N models competed"
   "stocks":  {"count": 10, "lean": "bullish|bearish", "highConviction": ["TSM"]},
   "options": {"count": 8,  "lean": "bullish|bearish"} }]
```

- Bucket versioned. Lifecycle: feedback → IA after 90d; nothing auto-deleted.
- One object per feedback event; per-day prefixes. No read-modify-write anywhere.

## 5. Data contracts (frontend already implements these — do not change shapes without updating both sides)

### 5.1 Edition (`data/editions/YYYY-MM-DD.json`)

```jsonc
{
  "date": "2026-07-18",            // required, YYYY-MM-DD, unique key
  "edition": 27,                   // running number
  "generatedAt": "ISO-8601",
  "pipeline": {
    "candidates": ["claude", "gpt", "grok"],  // provider ids that competed
    "judge": "llama3.3"
  },
  "lead": { /* Story */ },         // required
  "stories": [ /* Story[] */ ],    // may be empty
  "stocks": {                      // OPTIONAL block
    "updated": "post-close",
    "picks": [{
      "ticker": "NVDA", "company": "NVIDIA", "sector": "Semis",
      "price": 201.60,                         // nullable
      "scenarios": {"3m": -2, "6m": 3, "12m": 12, "18m": 18, "24m": 22}, // % midpoints
      "conviction": "high|med|low",
      "sentiment": "bullish|bearish|neutral",
      "reason": "one-liner", "sourceUrl": "https://..."
    }]
  },
  "options": {                     // OPTIONAL block
    "updated": "post-close",
    "ideas": [{
      "ticker": "NVDA", "company": "NVIDIA",
      "strategy": "Bull Call Spread", "tag": "defined risk",
      "direction": "bull|bear|vol", "dte": 180, "spot": 201.60,
      "framing": "205 / 265", "maxLoss": "$1,800",
      "aggressiveCase": "~+233%", "probability": "med"
    }]
  }
}
```

**Story:**
```jsonc
{
  "id": "e27-s1",                  // unique across all editions (feedback key)
  "topic": "ai",                   // slug matching config topics
  "headline": "...", "dek": "...",
  "body": ["para 1", "para 2"],
  "whyItMatters": "...",
  "sources": [{"title": "...", "url": "https://..."}],
  "model": "claude",               // winning provider id
  "judgeScore": 8.7,               // 0–10
  "sentiment": "bullish|bearish|neutral"   // optional
}
```

### 5.2 Config (`data/config/config.json`)

```jsonc
{
  "version": 1, "exportedAt": "ISO-8601",
  "briefName": "The Daily Compile",
  "topics":  [{"slug": "ai", "label": "AI & Models", "weight": "high|normal|low", "enabled": true}],
  "sources": [{"domain": "reuters.com", "trust": "preferred|allowed|blocked"}]
}
```

### 5.3 Feedback event (one S3 object per event)

```jsonc
{
  "storyId": "e27-s1", "vote": "keep|spike",
  "topic": "ai", "model": "claude",
  "editionDate": "2026-07-18", "at": "ISO-8601"
}
```

## 6. Frontend (port of the prototype)

Source of design + behavior truth: **`daily-brief.jsx`** (attached). Port it into `frontend/src` with these changes only:

1. **Data source:** replace `MOCK_EDITIONS` with fetches: `GET /data/editions/index.json` → archive list; `GET /data/editions/<date>.json` on open; newest = Today.
2. **Persistence:** replace `window.storage` with: `GET /data/config/config.json` on load; `PUT`-equivalent via `POST /api/config` (Lambda writes to S3); feedback via `POST /api/feedback` (fire-and-forget, optimistic UI, retry once). Keep the "export JSON" affordance as a fallback.
3. Keep everything else: editorial design (Newsreader/Archivo Narrow/IBM Plex Mono, cool paper, wire-blue accent), colophon with model glyph + judge score, keep/spike vocabulary, tap-to-expand table rows, sticky ticker column, graceful empty states for missing stocks/options blocks, disclaimer footer.
4. Unknown provider ids must render generically in the colophon (registry is open-ended).
5. Mobile-first; tables scroll horizontally; no login for v1 (see §10 guardrail on privacy).

## 7. Pipeline (separate server — the factory)

### 7.1 Provider registry — `pipeline/config/providers.yml`

```yaml
candidates:
  - id: claude
    enabled: true
    adapter: cli
    command: ["claude", "-p", "{prompt_file}", "--output-format", "json"]
    timeout_s: 300
  - id: gpt
    enabled: true
    adapter: cli
    command: ["codex", "exec", "{prompt_file}"]   # verify current flags
    timeout_s: 300
  - id: grok
    enabled: true
    adapter: cli
    command: ["grok", "{prompt_file}"]            # verify current flags
    timeout_s: 300
  # example API provider, off by default — adding one is YAML-only
  - id: bedrock-nova
    enabled: false
    adapter: openai_compatible
    base_url: "..."
    model: "..."

judge:
  adapter: openai_compatible
  base_url: "http://ollama:11434/v1"
  model: "llama3.3"
min_candidates: 1        # publish if at least N candidates succeeded
```

### 7.2 Adapter interface

`generate(brief: WriterBrief) -> EditionCandidate`
- **cli adapter:** substitute `{prompt_file}`/`{prompt}`, run with timeout, capture stdout, extract JSON (tolerant: strip prose/fences, one repair pass), validate against §5.1 models.
- **openai_compatible adapter:** POST chat completion; same validation. The judge reuses this adapter.
- Failures are per-provider, logged loudly, never fatal while ≥ `min_candidates` succeed. Edition `pipeline.candidates` lists only providers that actually competed.

### 7.3 Daily run (orchestrator)

1. Pull `config.json` + list yesterday's `feedback/` prefix from S3; aggregate feedback (per-topic/per-model keep-spike tallies) into the judge rubric context.
2. `gather.py`: headlines per enabled topic, honoring source trust (preferred first, blocked excluded). Weight → story count budget per topic.
3. Fan out the same WriterBrief to all enabled candidates **in parallel**.
4. `judge.py`: per-story scoring against rubric (accuracy signals, sourcing, insight, brevity; feedback-informed); winner per story; stitch final edition; compute `edition` number from index.
5. `publish.py`: put edition JSON, update `index.json`, CloudFront invalidation on `/data/editions/index.json` (edition files are new keys — no invalidation needed).
6. Exit non-zero on failure; host cron captures logs. Degraded editions (fewer candidates, missing stocks/options) are acceptable and must publish.

### 7.4 Auth (non-interactive, one-time setup per provider)

- **Claude Code:** one-time `claude setup-token` (browser, anywhere) → long-lived token (~1 yr, Pro/Max subscription) → `.env` as `CLAUDE_CODE_OAUTH_TOKEN`. Container runs `claude -p` headless. Run Claude with tools disabled / no-tool allowlist — writer, not agent. Verify on first run that subscription (not API credits) is billed in `-p` mode.
- **Codex:** login once on host; mount `~/.codex` read-only into container (or `OPENAI_API_KEY`).
- **Grok:** API key in `.env`.
- **AWS:** dedicated pipeline credentials in `.env` (or instance profile if ever on EC2), scoped: `s3:PutObject/GetObject/ListBucket` on the data prefix + `cloudfront:CreateInvalidation` on the one distro. Nothing else.
- `.env` git-ignored; `.env.example` documents every variable.

### 7.5 Compose sketch

```yaml
services:
  ollama:
    image: ollama/ollama
    deploy: {resources: {reservations: {devices: [{driver: nvidia, count: all, capabilities: [gpu]}]}}}
    volumes: ["ollama:/root/.ollama"]
  pipeline:
    build: .
    env_file: .env
    depends_on: [ollama]
    volumes:
      - ${CODEX_AUTH_DIR:-~/.codex}:/root/.codex:ro
volumes: {ollama: {}}
```

Host schedules `docker compose run --rm pipeline` (cron or systemd timer — document both). Nothing assumes a specific machine.

## 8. Infra (OpenTofu)

- State: S3 backend with native lockfile (Tofu ≥ 1.10). No DynamoDB.
- **modules/data:** bucket (private, versioned, SSE-S3), prefixes per §4, lifecycle rules, bucket policy allowing the CF OAC read on site+data prefixes and the pipeline role write on data prefixes.
- **modules/site:** CloudFront distro — default behavior → site prefix (SPA fallback to index.html), `/data/*` → data origin (short TTL on `index.json` & `config.json`, long TTL on dated edition files), `/api/*` → Lambda Function URL origin with OAC (Lambda invokable only via CF). ACM cert in us-east-1. Domain optional — parameterize.
- **modules/api:** Python Lambda: `POST /api/feedback` → validate §5.3, write one object to per-day prefix; `POST /api/config` → validate §5.2, put `config.json` (bucket versioning = undo); `GET /api/health`. Least-priv role (put on feedback prefix, put on config key). Basic rate sanity (~1k/day expected — a CF WAF rate rule is optional, skip for v1).
- **modules/ci:** GitHub OIDC provider + two roles trust-scoped to `repo:<owner>/<repo>` (supplied at apply time, never committed): frontend-deploy (sync site prefix + invalidation) and tofu-apply (broader, main branch only).
- Outputs: distro domain, bucket names, role ARNs — consumed by workflows and pipeline `.env.example`.

## 9. Phases & acceptance criteria

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Infra + repo scaffold | `tofu apply` clean; CF serves a placeholder; OIDC deploy works from Actions |
| 2 | Frontend port | Site reads a hand-uploaded edition JSON from `/data/`; all 5 tabs work on mobile |
| 3 | Pipeline v1 | Claude-only candidate, judge pass-through; cron on server publishes a real daily edition end-to-end |
| 4 | Full fan-out | ≥2 CLI providers + real judge + feedback aggregation in rubric; provider disable via YAML verified |
| 5 | Feedback loop | Site keep/spike lands in S3; next-day run demonstrably consumes it (log evidence) |

## 10. Guardrails & non-goals

- **No secrets in repo, ever.** `.env` + GitHub OIDC only. No long-lived AWS keys.
- CLI writers run headless with tools disabled — they generate JSON, they do not touch the filesystem or network beyond their own API.
- Financial content is display of AI-generated research: keep the disclaimers exactly as in the prototype (footer + per-table notes). No advice framing anywhere.
- Respect source trust tiers; cite deep links; summaries stay short — no article reproduction.
- Non-goals for v1: auth/multi-user, comments, mobile app (React-Native-friendly structure is enough), realtime anything, Claude Code Routines (revisit later only as an ops watchdog: "verify last night's edition exists; else open a GitHub issue").
- Preferences: OpenTofu (not Terraform-branded), "infrastructure" framing in docs, no Word docs — markdown only.
