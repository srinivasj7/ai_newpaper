"""Tests for the parts of the pipeline that decide what reaches print.

No network, no AWS, no model. Run from the pipeline directory:

    python -m tests.test_pipeline
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.adapters.base import extract_json  # noqa: E402
from src.main import assign_ids, to_edition, verify_sources  # noqa: E402
from src.models import Edition, Headline, SiteConfig, StockPick, Story, summarize  # noqa: E402

results: list[bool] = []


def check(label: str, got, want) -> None:
    ok = got == want
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {got!r}{'' if ok else f'  (expected {want!r})'}")


def raises(label: str, fn) -> None:
    try:
        fn()
    except Exception:
        results.append(True)
        print(f"PASS  {label}: rejected")
        return
    results.append(False)
    print(f"FAIL  {label}: accepted, should have been rejected")


# --------------------------------------------------------------- JSON extraction

check("bare object", extract_json('{"a": 1}'), {"a": 1})
check("fenced json", extract_json('```json\n{"a": 1}\n```'), {"a": 1})
check("fenced, no language", extract_json("```\n{\"a\": 1}\n```"), {"a": 1})
check("preamble prose", extract_json('Here is the edition:\n{"a": 1}'), {"a": 1})
check("trailing prose", extract_json('{"a": 1}\nLet me know if you need changes.'), {"a": 1})
check("braces inside strings", extract_json('{"a": "} not the end {"}'), {"a": "} not the end {"})
check("nested objects", extract_json('prose {"a": {"b": [1, 2]}} more'), {"a": {"b": [1, 2]}})
check("escaped quotes", extract_json(r'{"a": "say \"hi\""}'), {"a": 'say "hi"'})
raises("empty response", lambda: extract_json("   "))
raises("no object at all", lambda: extract_json("I cannot help with that."))
raises("unbalanced object", lambda: extract_json('{"a": 1'))
raises("json array, not object", lambda: extract_json("[1, 2, 3]"))

# --------------------------------------------------------------- writer output

raw = {
    "lead": {
        "headline": "A real headline",
        "dek": "A dek.",
        "body": "One paragraph.\n\nAnother paragraph.",
        "whyItMatters": "Because.",
        "topic": "ai",
        "sentiment": "bullish",
        "sources": [{"title": "Real", "url": "https://real.example/a"}],
    },
    "stories": [
        {"headline": "Second", "topic": "chips", "sources": [{"url": "https://real.example/b"}]},
        {"dek": "no headline, must be dropped"},
        "not an object at all",
    ],
}

edition = to_edition("2026-07-31", raw)
check("lead parsed", edition.lead.headline, "A real headline")
check("body split into paragraphs", len(edition.lead.body), 2)
check("camelCase alias accepted", edition.lead.why_it_matters, "Because.")
check("headline-less story dropped", len(edition.stories), 1)

edition.edition = 27
assign_ids(edition)
check("lead id", edition.lead.id, "e27-lead")
check("story id", edition.stories[0].id, "e27-s1")

# --------------------------------------------------------------- citation checking

pool = [Headline(title="t", url="https://real.example/a", domain="real.example")]
edition.lead.sources.append(type(edition.lead.sources[0])(title="Invented", url="https://fake.example/x"))
check("lead had two citations", len(edition.lead.sources), 2)
verify_sources(edition, pool)
check("invented citation removed", [s.url for s in edition.lead.sources], ["https://real.example/a"])
check("unsourced story stripped too", edition.stories[0].sources, [])

# --------------------------------------------------------------- manifest summary

full = Edition(date="2026-07-31", edition=27)
full.lead = Story(id="e27-lead", headline="Lead")
full.stories = [Story(id="e27-s1", headline="One"), Story(id="e27-s2", headline="Two")]
full.pipeline.candidates = ["claude", "gpt"]
entry = summarize(full)
check("storyCount includes the lead", entry.story_count, 3)
check("candidateCount", entry.candidate_count, 2)
check("hasStocks false when absent", entry.has_stocks, False)
check("manifest emits camelCase", "leadHeadline" in entry.model_dump(by_alias=True), True)

from src.models import StocksBlock  # noqa: E402

full.stocks = StocksBlock(
    picks=[
        StockPick(ticker="AAA", conviction="high", sentiment="bullish"),
        StockPick(ticker="BBB", conviction="low", sentiment="bearish"),
    ]
)
entry = summarize(full)
check("stocks summary count", entry.stocks.count, 2)
check("lean from sentiment mix", entry.stocks.lean, "bullish")
check("high-conviction tickers", entry.stocks.high_conviction, ["AAA"])

# --------------------------------------------------------------- contract shape

pick = StockPick(ticker="AAA", scenarios={"3m": 1, "12m": 5, "99y": 1000})
check("unknown horizon dropped", sorted(pick.scenarios), ["12m", "3m"])
check("sourceUrl alias on output", "sourceUrl" in pick.model_dump(by_alias=True), True)

payload = full.to_contract()
check("edition emits generatedAt", "generatedAt" in payload, True)
check("edition emits whyItMatters", "whyItMatters" in payload["lead"], True)

# --------------------------------------------------------------- config

config = SiteConfig.model_validate(
    {
        "briefName": "X",
        "topics": [
            {"slug": "ai", "label": "AI", "weight": "high", "enabled": True},
            {"slug": "off", "label": "Off", "enabled": False},
        ],
        "sources": [{"domain": "good.example", "trust": "preferred"}, {"domain": "bad.example", "trust": "blocked"}],
    }
)
check("enabled topics only", [t.slug for t in config.enabled_topics], ["ai"])
check("blocked domains", config.blocked_domains(), {"bad.example"})
check("trust of a subdomain", config.trust_of("www.good.example"), "preferred")
check("trust of an unknown domain", config.trust_of("other.example"), "allowed")

# --- the feedback window, at the boundary where the two calendars disagree
#
# A vote cast between 17:00 Pacific and midnight UTC reaches the Lambda without an editionDate
# only if the browser omitted it, and the Lambda then keys it by the UTC date — a day ahead of
# the pipeline's. It is the vote most likely to matter, because it was cast for the edition the
# next morning's run is about to replace.
from datetime import date  # noqa: E402

import src.store as _store  # noqa: E402
from src.settings import Settings  # noqa: E402
from src.store import Store  # noqa: E402


class _S3Stub:
    """Records which day-prefixes were listed; serves one event from the day it is given."""

    def __init__(self, event_day: str) -> None:
        self.event_day = event_day
        self.listed: list[str] = []

    def list_objects_v2(self, **kw):
        self.listed.append(kw["Prefix"])
        if kw["Prefix"].endswith(f"{self.event_day}/"):
            return {"Contents": [{"Key": kw["Prefix"] + "e1-s1-1.json"}]}
        return {}


def _window(event_day: str, today: date):
    stub = _S3Stub(event_day)
    store = Store.__new__(Store)  # no AWS: only load_feedback is under test
    store.s = Settings(
        bucket="b",
        data_prefix="data/",
        distribution_id=None,
        region="us-east-1",
        dry_run=True,
        max_headlines=1,
        lookback_hours=1,
    )
    store.s3 = stub
    store._get_json = lambda key: {
        "storyId": "e1-s1",
        "vote": "keep",
        "topic": "ai",
        "at": "2026-08-09T18:59:00Z",
    }

    real_today, _store.edition_today = _store.edition_today, lambda: today
    try:
        return stub.listed, store.load_feedback(days=7)
    finally:
        _store.edition_today = real_today


TODAY = date(2026, 8, 9)  # Pacific; in UTC it is already the 10th
ahead, ahead_tally = _window("2026-08-10", TODAY)

check("scan reaches one day ahead", any(d.endswith("2026-08-10/") for d in ahead), True)
check("a vote keyed by the UTC date is still counted", ahead_tally.events, 1)
check("still covers seven days of history", any(d.endswith("2026-08-03/") for d in ahead), True)
check("does not scan two days ahead", any(d.endswith("2026-08-11/") for d in ahead), False)

same, same_tally = _window("2026-08-09", TODAY)
check("the ordinary same-day case still works", same_tally.events, 1)

# --------------------------------------------------------------- the bedrock adapter
#
# Converse rather than the OpenAI-compatible endpoint: support for /chat/completions is
# per-model on Bedrock, and the documentation maps models to endpoints rather than to APIs.
# These assert the request shape, because a wrong one fails once a day at 06:15 and nowhere else.

import boto3  # noqa: E402

from src.adapters import build  # noqa: E402


class _BedrockStub:
    def __init__(self, blocks, stop="end_turn", raises=None):
        self.blocks, self.stop, self.raises, self.calls = blocks, stop, raises, {}

    def converse(self, **kw):
        self.calls.update(kw)
        if self.raises:
            raise self.raises
        return {
            "output": {"message": {"content": self.blocks}},
            "usage": {"inputTokens": 13900, "outputTokens": 16472},
            "stopReason": self.stop,
        }


def _run(stub, method="complete", spec=None):
    real, boto3.client = boto3.client, lambda service, **kw: stub
    try:
        adapter = build(
            {
                "id": "llama",
                "adapter": "bedrock",
                "timeout_s": 420,
                "model": "us.meta.llama4-maverick-17b-instruct-v1:0",
                **(spec or {}),
            }
        )
        return getattr(adapter, method)("write the paper")
    finally:
        boto3.client = real


ANSWER = [
    {"reasoningContent": {"reasoningText": {"text": "thinking out loud"}}},
    {"text": '{"lead": {"headline": "ok"}}'},
]

stub = _BedrockStub(ANSWER)
out = _run(stub)
check("bedrock: modelId passed through", stub.calls["modelId"], "us.meta.llama4-maverick-17b-instruct-v1:0")
check(
    "bedrock: Converse message shape",
    stub.calls["messages"],
    [{"role": "user", "content": [{"text": "write the paper"}]}],
)
check("bedrock: no maxTokens unless configured", "maxTokens" in stub.calls["inferenceConfig"], False)
check("bedrock: reasoning blocks are not the answer", out, '{"lead": {"headline": "ok"}}')
check("bedrock: parses to the edition object", _run(_BedrockStub(ANSWER), "complete_json"), {"lead": {"headline": "ok"}})

stub = _BedrockStub(ANSWER)
_run(stub, spec={"max_tokens": 8000})
check("bedrock: maxTokens reaches inferenceConfig", stub.calls["inferenceConfig"].get("maxTokens"), 8000)

# A client error must surface as AdapterError, so the run drops one candidate and continues
# rather than taking the edition down with it.
raises(
    "bedrock: client errors become AdapterError",
    lambda: _run(_BedrockStub(ANSWER, raises=RuntimeError("AccessDeniedException"))),
)
raises("bedrock: a malformed response is rejected", lambda: _run(_BedrockStub(None)))

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
