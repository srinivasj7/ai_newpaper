# CLAUDE.md — ai_newpaper ("The Daily Compile")

Condensed working context. [HANDOVER.md](HANDOVER.md) is the full spec and wins any conflict.

## What this is

A personal daily tech/markets newspaper. A multi-model pipeline generates one edition JSON per
day; a static React SPA renders it; per-story feedback flows back into the pipeline's judging.

## Architecture — three planes, deliberately decoupled

```
pipeline host (Docker: python + ollama)  ──writes──▶  S3 (private, versioned)
                                                        ▲            │
                              CloudFront (one distro) ──OAC──────────┘
                                /        → site prefix (SPA)
                                /data/*  → editions, index, config
                                /api/*   → Lambda Function URL (feedback + config writes)
                                                        ▲
                                                    browser SPA
```

- The pipeline host never serves the site and is never a runtime dependency of it. Host off ⇒ the
  site serves yesterday's paper.
- The frontend never calls a model API. It reads JSON and POSTs feedback/config.
- Infra deploys (GitHub Actions, OIDC) never touch the pipeline host.

## Repo layout

```
frontend/   Vite + React SPA (plain JS/JSX), dev-data/ fixtures for local dev
pipeline/   runs ONLY on the pipeline host (Docker Compose: pipeline + ollama)
infra/      OpenTofu — bootstrap/, modules/{data,site,api,ci}/, envs/prod/
.github/workflows/  frontend.yml (build+sync+invalidate), infra.yml (fmt/validate/plan/apply)
```

## S3 data layout

```
data/editions/YYYY-MM-DD.json   one edition per day
data/editions/index.json        manifest (see contract below)
data/config/config.json         current topics/sources config
data/feedback/YYYY-MM-DD/<storyId>-<epochMs>.json    one object per event
```

One object per feedback event, per-day prefixes — no read-modify-write anywhere. Bucket versioned;
feedback → IA after 90d; nothing auto-deleted.

## Data contracts — do not change a shape without changing both sides

### Edition — `data/editions/YYYY-MM-DD.json`

```jsonc
{
  "date": "2026-07-18",           // required, YYYY-MM-DD, unique key
  "edition": 27,                  // running number
  "generatedAt": "ISO-8601",
  "pipeline": { "candidates": ["claude","gpt","grok"], "judge": "llama3.3" },
  "lead": { /* Story */ },        // required
  "stories": [ /* Story[] */ ],   // may be empty
  "stocks": {                     // OPTIONAL block
    "updated": "post-close",
    "picks": [{ "ticker":"NVDA", "company":"NVIDIA", "sector":"Semis",
      "price": 201.60,            // nullable
      "scenarios": {"3m":-2,"6m":3,"12m":12,"18m":18,"24m":22},   // % midpoints
      "conviction":"high|med|low", "sentiment":"bullish|bearish|neutral",
      "reason":"one-liner", "sourceUrl":"https://..." }]
  },
  "options": {                    // OPTIONAL block
    "updated": "post-close",
    "ideas": [{ "ticker":"NVDA", "company":"NVIDIA", "strategy":"Bull Call Spread",
      "tag":"defined risk", "direction":"bull|bear|vol", "dte":180, "spot":201.60,
      "framing":"205 / 265", "maxLoss":"$1,800", "aggressiveCase":"~+233%",
      "probability":"med" }]
  }
}
```

**Story:**
```jsonc
{ "id":"e27-s1",                  // unique across all editions — the feedback key
  "topic":"ai",                   // slug matching a config topic
  "headline":"...", "dek":"...", "body":["para 1","para 2"], "whyItMatters":"...",
  "sources":[{"title":"...","url":"https://..."}],
  "model":"claude",               // winning provider id — registry is open-ended
  "judgeScore": 8.7,              // 0–10
  "sentiment":"bullish|bearish|neutral" }  // optional
```

### Index manifest — `data/editions/index.json`

An array, newest first. The frontend renders Archive and the "past snapshots" lists from this
alone — one fetch, not N. Fields after `storyCount` are optional; the UI degrades without them.

```jsonc
[{ "date":"2026-07-17", "edition":26, "leadHeadline":"…", "storyCount":5,
   "hasStocks":true, "hasOptions":true,
   "candidateCount":3,                                                  // "N models competed"
   "stocks": {"count":10, "lean":"bullish|bearish", "highConviction":["TSM"]},
   "options": {"count":8, "lean":"bullish|bearish"} }]
```

### Config — `data/config/config.json`

```jsonc
{ "version":1, "exportedAt":"ISO-8601", "briefName":"The Daily Compile",
  "topics": [{"slug":"ai","label":"AI & Models","weight":"high|normal|low","enabled":true}],
  "sources":[{"domain":"reuters.com","trust":"preferred|allowed|blocked"}] }
```

### Feedback event — one S3 object per event

```jsonc
{ "storyId":"e27-s1", "vote":"keep|spike", "topic":"ai", "model":"claude",
  "editionDate":"2026-07-18", "at":"ISO-8601" }
```

There is no "unvote" event. Clicking the active vote again clears it in the browser only; the
pipeline takes the **latest event per storyId** when aggregating.

## Frontend conventions

- Plain JS/JSX, no TypeScript. Design, class names, copy, and disclaimers come from
  [daily-brief.jsx](daily-brief.jsx) and are not to be redesigned.
- Typography: Newsreader (serif body), Archivo Narrow (labels), IBM Plex Mono (data). Cool paper
  `#F6F5F1`, ink `#16150F`, wire-blue accent `#1F3FAE`. Market green/red are semantic only.
- Data access goes through `src/api/client.js`; every fetched document passes through
  `src/api/normalize.js` before it reaches a component.
- Unknown provider ids must render generically in the colophon — never hardcode a closed model list.
- Mobile-first. Tables scroll horizontally with a sticky ticker column.
- Local state (votes, config draft, imported editions, the failed-POST outbox) lives in
  `localStorage` under `dtb-*` keys.

## Guardrails

- **No secrets in the repo, ever.** `.env` + GitHub OIDC only; no long-lived AWS keys in CI.
- CLI writers in the pipeline run headless with tools disabled — they generate JSON, they do not
  touch the filesystem or network.
- Keep the financial disclaimers exactly as written (footer + per-table notes). No advice framing.
- Respect source trust tiers; cite deep links; summaries stay short — never reproduce articles.
- v1 non-goals: auth/multi-user, comments, realtime anything. (A Capacitor iOS/Android wrapper that
  bundles the web build and updates over-the-air now lives in `mobile/` — see mobile/README.md.)
- Preferences: OpenTofu (not Terraform-branded), "infrastructure" framing, markdown only.
