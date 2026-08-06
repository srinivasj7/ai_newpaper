"""Daily run.

    config + feedback  ->  gather  ->  writers (parallel)  ->  judge  ->  markets  ->  publish

Degraded editions are acceptable and must still publish: a failed provider, an empty options
block, or missing quotes are all survivable. Publishing nothing is not — the site would show
yesterday's paper with no explanation. The run exits non-zero only when it genuinely could not
produce an edition, which is the signal the host's scheduler acts on.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

from . import gather, market
from .adapters import AdapterError, build
from .judge import adjudicate
from .models import (
    Edition,
    FeedbackTally,
    Headline,
    MoviesBlock,
    OptionsBlock,
    SiteConfig,
    StocksBlock,
    Story,
    summarize,
)
from .settings import Providers, Settings, prompt, setup_logging
from .store import Store

log = logging.getLogger("main")

WEIGHT_BUDGET = {"high": 4, "normal": 3, "low": 2}


def writer_brief(
    edition_date: str,
    config: SiteConfig,
    headlines: list[Headline],
    feedback: FeedbackTally,
) -> str:
    """Everything the writer is allowed to know, as one JSON payload."""
    topics = [
        {
            "slug": t.slug,
            "label": t.label,
            "weight": t.weight,
            "maxStories": WEIGHT_BUDGET.get(t.weight, 3),
        }
        for t in config.enabled_topics
    ]
    payload = {
        "date": edition_date,
        "briefName": config.brief_name,
        "topics": topics,
        "feedback": feedback.model_dump(by_alias=True),
        "pool": [h.model_dump(by_alias=True) for h in headlines],
    }
    return json.dumps(payload, ensure_ascii=False, indent=1)


def run_writer(spec: dict, prompt_text: str) -> tuple[str, dict] | None:
    """One candidate. Returns None on failure — the run continues on the survivors."""
    cid = spec.get("id", "unknown")
    try:
        adapter = build(spec)
        return cid, adapter.complete_json(prompt_text)
    except AdapterError as e:
        log.error("candidate %s failed: %s", cid, e)
    except Exception as e:  # a broken adapter must not take the run down
        log.exception("candidate %s raised: %s", cid, e)
    return None


def to_edition(edition_date: str, raw: dict) -> Edition:
    """Validate a writer's reply against the contract, dropping stories that do not fit."""
    edition = Edition(date=edition_date)

    if isinstance(raw.get("lead"), dict):
        try:
            edition.lead = Story.model_validate({"id": "lead", **raw["lead"]})
        except Exception as e:
            log.warning("lead story rejected: %s", e)

    for i, item in enumerate(raw.get("stories") or []):
        if not isinstance(item, dict):
            continue
        try:
            edition.stories.append(Story.model_validate({"id": f"s{i + 1}", **item}))
        except Exception as e:
            log.warning("story %d rejected: %s", i + 1, e)

    return edition


def assign_ids(edition: Edition) -> None:
    """Story ids must be unique across all editions — they are the feedback key."""
    prefix = f"e{edition.edition}"
    if edition.lead:
        edition.lead.id = f"{prefix}-lead"
    for i, story in enumerate(edition.stories, start=1):
        story.id = f"{prefix}-s{i}"


def verify_sources(edition: Edition, pool: list[Headline]) -> None:
    """Drop citations the writer did not get from the pool.

    A model that invents a plausible URL produces a story that looks sourced and is not. The
    pool is the only place a citation may come from, so anything else is removed here rather
    than trusted.
    """
    allowed = {h.url for h in pool}
    for story in ([edition.lead] if edition.lead else []) + edition.stories:
        kept = [s for s in story.sources if s.url in allowed]
        dropped = len(story.sources) - len(kept)
        if dropped:
            log.warning("dropped %d unsourced citation(s) from %r", dropped, story.headline[:60])
        story.sources = kept


def build_markets(spec: dict, edition: Edition, tickers: list[str]) -> tuple[StocksBlock | None, OptionsBlock | None]:
    """Second pass: real prices in, scenarios out. Optional — failure costs two blocks, not the edition."""
    quotes = market.quotes(tickers)
    if not quotes:
        log.warning("no quotes available — publishing without the market blocks")
        return None, None

    payload = {
        "date": edition.date,
        "quotes": quotes,
        "edition": {
            "lead": edition.lead.model_dump(by_alias=True, exclude_none=True) if edition.lead else None,
            "stories": [s.model_dump(by_alias=True, exclude_none=True) for s in edition.stories],
        },
    }
    prompt_text = f"{prompt('markets.md')}\n\n## Input\n\n{json.dumps(payload, ensure_ascii=False, indent=1)}"

    try:
        raw = build(spec).complete_json(prompt_text)
    except AdapterError as e:
        log.error("markets pass failed: %s — publishing without the market blocks", e)
        return None, None

    stocks = options = None
    try:
        if raw.get("stocks"):
            stocks = StocksBlock.model_validate(raw["stocks"])
            priced = {q["ticker"]: q["price"] for q in quotes}
            for pick in stocks.picks:
                pick.price = priced.get(pick.ticker)  # never trust a model-supplied price
            stocks.picks = [p for p in stocks.picks if p.ticker in priced]
    except Exception as e:
        log.warning("equities block rejected: %s", e)

    try:
        if raw.get("options"):
            options = OptionsBlock.model_validate(raw["options"])
            priced = {q["ticker"]: q["price"] for q in quotes}
            for idea in options.ideas:
                idea.spot = priced.get(idea.ticker)
            options.ideas = [i for i in options.ideas if i.ticker in priced]
    except Exception as e:
        log.warning("options block rejected: %s", e)

    return (stocks if stocks and stocks.picks else None), (options if options and options.ideas else None)


def build_movies(spec: dict, edition: Edition, pool: list[Headline]) -> MoviesBlock | None:
    """Third pass: the release calendar.

    Fed the same gathered pool rather than the finished edition, because a date change is
    rarely front-page news — it lives in the items the writer passed over. Optional: a failure
    costs one tab, not the paper.
    """
    payload = {
        "date": edition.date,
        "pool": [h.model_dump(by_alias=True) for h in pool],
    }
    prompt_text = f"{prompt('movies.md')}\n\n## Input\n\n{json.dumps(payload, ensure_ascii=False, indent=1)}"

    try:
        raw = build(spec).complete_json(prompt_text)
    except AdapterError as e:
        log.error("movies pass failed: %s — publishing without the film desk", e)
        return None

    try:
        block = MoviesBlock.model_validate(raw.get("movies") or raw)
    except Exception as e:
        log.warning("movies block rejected: %s", e)
        return None

    # Same rule as the stories: a citation the writer invented is worse than no citation.
    allowed = {h.url for h in pool}
    for release in block.releases:
        if release.source_url and release.source_url not in allowed:
            log.warning("dropped unsourced citation from %r", release.title[:50])
            release.source_url = None

    if not block.releases and not block.summary:
        return None
    return block


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate and publish one edition.")
    parser.add_argument("--date", default=date.today().isoformat(), help="edition date, YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="do everything except write to S3")
    parser.add_argument("--no-markets", action="store_true", help="skip the equities and options blocks")
    parser.add_argument("--no-movies", action="store_true", help="skip the release calendar")
    parser.add_argument("--out", help="also write the edition JSON to this local path")
    parser.add_argument(
        "--config",
        help="read the site config from a local file instead of S3 — lets a dry run exercise "
        "gathering and writing on a machine with no AWS credentials",
    )
    args = parser.parse_args(argv)

    setup_logging()
    started = datetime.now(timezone.utc)

    settings = Settings.from_env()
    if args.dry_run:
        settings = Settings(**{**settings.__dict__, "dry_run": True})
    providers = Providers.load()

    if not providers.candidates:
        log.error("no enabled candidates in config/providers.yml")
        return 2

    log.info("edition %s — %d candidate(s): %s", args.date, len(providers.candidates),
             ", ".join(c.get("id", "?") for c in providers.candidates))

    # A dry run with a local config touches no AWS at all, so the writing half can be
    # exercised anywhere. Any other mode needs the store, and fails loudly without it.
    store: Store | None = None
    if args.config:
        config = SiteConfig.model_validate(json.loads(Path(args.config).read_text(encoding="utf-8")))
        log.info("config: read from %s", args.config)
    else:
        store = Store(settings)
        config = store.load_config()

    if not config.enabled_topics:
        log.error("no enabled topics in the config — nothing to write about")
        return 2

    if store is None and not settings.dry_run:
        store = Store(settings)

    manifest = store.load_manifest() if store else []
    feedback = store.load_feedback() if store else FeedbackTally()
    log.info("config: %d topics, %d sources · feedback: %d recent events",
             len(config.enabled_topics), len(config.sources), feedback.events)

    headlines = gather.collect(config, settings.lookback_hours, settings.max_headlines)
    if not headlines:
        log.error("no headlines gathered — refusing to publish a fabricated edition")
        return 3

    brief = writer_brief(args.date, config, headlines, feedback)
    prompt_text = f"{prompt('writer.md')}\n\n## Brief\n\n{brief}"
    log.info("writer prompt: %.1f KB", len(prompt_text) / 1024)

    with ThreadPoolExecutor(max_workers=max(1, len(providers.candidates))) as ex:
        results = [r for r in ex.map(lambda s: run_writer(s, prompt_text), providers.candidates) if r]

    if len(results) < providers.min_candidates:
        log.error("only %d of %d candidates succeeded (minimum %d)",
                  len(results), len(providers.candidates), providers.min_candidates)
        return 4

    editions = {cid: to_edition(args.date, raw) for cid, raw in results}
    tickers: list[str] = []
    for _, raw in results:
        tickers.extend(t for t in (raw.get("tickers") or []) if isinstance(t, str))

    # A judge is only worth reaching for when there is something to choose between.
    judge_adapter = build(providers.judge) if (providers.judge.get("enabled") and len(editions) > 1) else None
    edition = adjudicate(judge_adapter, prompt("judge.md") if judge_adapter else "", editions, feedback)

    if not edition.lead and not edition.stories:
        log.error("the winning edition has no publishable stories")
        return 5

    # Re-running a day republishes that day's paper; it does not mint a new one. The edition
    # number identifies the day, so it is reused when one already exists for this date.
    existing = next((e.edition for e in manifest if e.date == edition.date), None)
    edition.edition = existing or (max((e.edition for e in manifest), default=0) + 1)
    edition.pipeline.candidates = [cid for cid, _ in results]
    edition.pipeline.judge = providers.judge.get("model") if judge_adapter else "pass-through"
    assign_ids(edition)
    verify_sources(edition, headlines)

    if not args.no_markets and tickers:
        stocks, options = build_markets(providers.candidates[0], edition, tickers)
        edition.stocks, edition.options = stocks, options

    if not args.no_movies:
        edition.movies = build_movies(providers.candidates[0], edition, headlines)

    log.info(
        "edition No. %d: lead %r, %d stories, %s, %s, %s",
        edition.edition,
        (edition.lead.headline[:60] + "…") if edition.lead else "none",
        len(edition.stories),
        f"{len(edition.stocks.picks)} picks" if edition.stocks else "no equities",
        f"{len(edition.options.ideas)} ideas" if edition.options else "no options",
        f"{len(edition.movies.releases)} releases" if edition.movies else "no film desk",
    )

    if args.out:
        Path(args.out).write_text(json.dumps(edition.to_contract(), ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("wrote %s", args.out)

    if store is None:
        log.info("no store configured (dry run with a local config) — nothing published")
    else:
        edition_key = store.put_edition(edition)
        entries = [e for e in manifest if e.date != edition.date]
        entries.append(summarize(edition))
        entries.sort(key=lambda e: e.date, reverse=True)
        manifest_key = store.put_manifest(entries)
        store.invalidate(manifest_key, edition_key)

    log.info("done in %.1fs", (datetime.now(timezone.utc) - started).total_seconds())
    return 0


if __name__ == "__main__":
    sys.exit(main())
