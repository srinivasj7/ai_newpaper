"""The data contracts, as code.

These mirror CLAUDE.md section "Data contracts" exactly. The frontend reads what this
module writes, so a change here is a change to the site — update both or neither.

Field names are the JSON names (camelCase) via aliases, so a model written by a language
model parses without translation and `model_dump(by_alias=True)` produces the contract.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Sentiment = Literal["bullish", "bearish", "neutral"]
Conviction = Literal["high", "med", "low"]
Direction = Literal["bull", "bear", "vol"]
Weight = Literal["high", "normal", "low"]
Trust = Literal["preferred", "allowed", "blocked"]

HORIZONS = ("3m", "6m", "12m", "18m", "24m")


class Contract(BaseModel):
    """Base: accept camelCase or snake_case in, emit camelCase out, reject unknown fields."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- edition


class Source(Contract):
    title: str = ""
    url: str


class Story(Contract):
    id: str
    topic: str | None = None
    headline: str
    dek: str = ""
    body: list[str] = Field(default_factory=list)
    why_it_matters: str = Field(default="", alias="whyItMatters")
    sources: list[Source] = Field(default_factory=list)
    model: str | None = None
    judge_score: float | None = Field(default=None, alias="judgeScore")
    sentiment: Sentiment | None = None

    @field_validator("body", mode="before")
    @classmethod
    def _body_as_paragraphs(cls, v):
        """Models sometimes return one string where the contract wants paragraphs."""
        if isinstance(v, str):
            return [p.strip() for p in v.split("\n\n") if p.strip()]
        return v


class StockPick(Contract):
    ticker: str
    company: str = ""
    sector: str = ""
    price: float | None = None
    scenarios: dict[str, float] = Field(default_factory=dict)
    conviction: Conviction = "med"
    sentiment: Sentiment = "neutral"
    reason: str = ""
    source_url: str | None = Field(default=None, alias="sourceUrl")

    @field_validator("scenarios")
    @classmethod
    def _known_horizons(cls, v: dict[str, float]) -> dict[str, float]:
        return {h: float(v[h]) for h in HORIZONS if h in v and v[h] is not None}


class StocksBlock(Contract):
    updated: str = "post-close"
    picks: list[StockPick] = Field(default_factory=list)


class OptionIdea(Contract):
    ticker: str
    company: str = ""
    strategy: str = ""
    tag: str = ""
    direction: Direction = "bull"
    dte: int | None = None
    spot: float | None = None
    framing: str = ""
    max_loss: str = Field(default="", alias="maxLoss")
    aggressive_case: str = Field(default="", alias="aggressiveCase")
    probability: str = ""


class OptionsBlock(Contract):
    updated: str = "post-close"
    ideas: list[OptionIdea] = Field(default_factory=list)


class PipelineInfo(Contract):
    candidates: list[str] = Field(default_factory=list)
    judge: str | None = None


class Edition(Contract):
    date: str
    edition: int = 0
    generated_at: str = Field(default_factory=now_iso, alias="generatedAt")
    pipeline: PipelineInfo = Field(default_factory=PipelineInfo)
    lead: Story | None = None
    stories: list[Story] = Field(default_factory=list)
    stocks: StocksBlock | None = None
    options: OptionsBlock | None = None

    def to_contract(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=False)


# --------------------------------------------------------------------------- manifest


class SnapshotSummary(Contract):
    count: int
    lean: Sentiment | None = None
    high_conviction: list[str] = Field(default_factory=list, alias="highConviction")


class ManifestEntry(Contract):
    date: str
    edition: int
    lead_headline: str = Field(alias="leadHeadline")
    story_count: int = Field(alias="storyCount")
    has_stocks: bool = Field(alias="hasStocks")
    has_options: bool = Field(alias="hasOptions")
    candidate_count: int | None = Field(default=None, alias="candidateCount")
    stocks: SnapshotSummary | None = None
    options: SnapshotSummary | None = None


def summarize(edition: Edition) -> ManifestEntry:
    """Build the manifest row for an edition — the same summary the frontend expects."""

    def lean(items: list) -> Sentiment:
        bulls = sum(1 for i in items if getattr(i, "sentiment", None) == "bullish" or getattr(i, "direction", None) == "bull")
        return "bullish" if bulls >= len(items) / 2 else "bearish"

    return ManifestEntry(
        date=edition.date,
        edition=edition.edition,
        leadHeadline=edition.lead.headline if edition.lead else "Untitled edition",
        storyCount=len(edition.stories) + (1 if edition.lead else 0),
        hasStocks=edition.stocks is not None,
        hasOptions=edition.options is not None,
        candidateCount=len(edition.pipeline.candidates) or None,
        stocks=(
            SnapshotSummary(
                count=len(edition.stocks.picks),
                lean=lean(edition.stocks.picks),
                highConviction=[p.ticker for p in edition.stocks.picks if p.conviction == "high"],
            )
            if edition.stocks
            else None
        ),
        options=(
            SnapshotSummary(count=len(edition.options.ideas), lean=lean(edition.options.ideas))
            if edition.options
            else None
        ),
    )


# --------------------------------------------------------------------------- config


class Topic(Contract):
    slug: str
    label: str
    weight: Weight = "normal"
    enabled: bool = True


class SourceRule(Contract):
    domain: str
    trust: Trust = "allowed"


class SiteConfig(Contract):
    version: int = 1
    brief_name: str = Field(default="The Daily Compile", alias="briefName")
    topics: list[Topic] = Field(default_factory=list)
    sources: list[SourceRule] = Field(default_factory=list)

    @property
    def enabled_topics(self) -> list[Topic]:
        return [t for t in self.topics if t.enabled]

    def blocked_domains(self) -> set[str]:
        return {s.domain for s in self.sources if s.trust == "blocked"}

    def trust_of(self, domain: str) -> Trust:
        for rule in self.sources:
            if domain == rule.domain or domain.endswith("." + rule.domain):
                return rule.trust
        return "allowed"


# --------------------------------------------------------------------------- gathering


class Headline(Contract):
    """One candidate item from a feed. Never published as-is; it is input for the writer."""

    title: str
    url: str
    summary: str = ""
    published: str = ""
    domain: str
    trust: Trust = "allowed"


class FeedbackTally(Contract):
    """Aggregated keep/spike counts, fed into the writer and the judge as context."""

    by_topic: dict[str, dict[str, int]] = Field(default_factory=dict)
    by_model: dict[str, dict[str, int]] = Field(default_factory=dict)
    events: int = 0
