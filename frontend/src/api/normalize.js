/* Everything fetched passes through here before a component sees it.
   The pipeline is a fleet of language models writing JSON: assume any field can be missing,
   the wrong type, or new. Never throw on a story — drop it or default it, and keep printing. */

import { DEFAULT_CONFIG, WEIGHTS, TRUSTS } from "../defaults.js";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const SENTIMENTS = ["bullish", "bearish", "neutral"];

export const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const sentiment = (v) => (SENTIMENTS.includes(v) ? v : undefined);

function normalizeStory(raw, fallbackId) {
  if (!isObj(raw)) return null;
  const headline = str(raw.headline).trim();
  if (!headline) return null; // a story with no headline has nothing to print
  return {
    id: str(raw.id) || fallbackId,
    topic: str(raw.topic) || null,
    headline,
    dek: str(raw.dek),
    body: arr(raw.body).filter((p) => typeof p === "string" && p.trim()),
    whyItMatters: str(raw.whyItMatters),
    sources: arr(raw.sources)
      .filter((s) => isObj(s) && typeof s.url === "string" && s.url)
      .map((s) => ({ title: str(s.title), url: s.url })),
    model: str(raw.model) || null,
    judgeScore: num(raw.judgeScore),
    sentiment: sentiment(raw.sentiment),
  };
}

function normalizeStocks(raw) {
  if (!isObj(raw)) return null;
  const picks = arr(raw.picks)
    .filter(isObj)
    .map((p) => ({
      ticker: str(p.ticker, "—"),
      company: str(p.company),
      sector: str(p.sector),
      price: num(p.price),
      scenarios: isObj(p.scenarios) ? p.scenarios : {},
      conviction: ["high", "med", "low"].includes(p.conviction) ? p.conviction : "med",
      sentiment: sentiment(p.sentiment) ?? "neutral",
      reason: str(p.reason),
      sourceUrl: str(p.sourceUrl) || null,
    }));
  return picks.length ? { updated: str(raw.updated, "post-close"), picks } : null;
}

function normalizeOptions(raw) {
  if (!isObj(raw)) return null;
  const ideas = arr(raw.ideas)
    .filter(isObj)
    .map((o) => ({
      ticker: str(o.ticker, "—"),
      company: str(o.company),
      strategy: str(o.strategy),
      tag: str(o.tag),
      direction: ["bull", "bear", "vol"].includes(o.direction) ? o.direction : "bull",
      dte: num(o.dte),
      spot: num(o.spot),
      framing: str(o.framing, "—"),
      maxLoss: str(o.maxLoss, "—"),
      aggressiveCase: str(o.aggressiveCase, "—"),
      probability: str(o.probability, "—"),
    }));
  return ideas.length ? { updated: str(raw.updated, "post-close"), ideas } : null;
}

/** Returns null when the document is too broken to be an edition at all. */
export function normalizeEdition(raw) {
  if (!isObj(raw) || !isDate(raw.date)) return null;
  const prefix = `e${raw.edition ?? raw.date}`;
  return {
    date: raw.date,
    edition: num(raw.edition) ?? 0,
    generatedAt: str(raw.generatedAt) || null,
    pipeline: isObj(raw.pipeline)
      ? { candidates: arr(raw.pipeline.candidates).filter((c) => typeof c === "string"), judge: str(raw.pipeline.judge) || null }
      : { candidates: [], judge: null },
    lead: normalizeStory(raw.lead, `${prefix}-lead`),
    stories: arr(raw.stories)
      .map((s, i) => normalizeStory(s, `${prefix}-s${i + 1}`))
      .filter(Boolean),
    stocks: normalizeStocks(raw.stocks),
    options: normalizeOptions(raw.options),
  };
}

function normalizeSnapshot(raw) {
  if (!isObj(raw)) return null;
  return {
    count: num(raw.count),
    lean: SENTIMENTS.includes(raw.lean) ? raw.lean : null,
    highConviction: arr(raw.highConviction).filter((t) => typeof t === "string"),
  };
}

/** Manifest entries, newest first. Summary fields are optional — the UI copes without them. */
export function normalizeIndex(raw) {
  return arr(raw)
    .filter((e) => isObj(e) && isDate(e.date))
    .map((e) => ({
      date: e.date,
      edition: num(e.edition) ?? 0,
      leadHeadline: str(e.leadHeadline) || "Untitled edition",
      storyCount: num(e.storyCount),
      hasStocks: !!e.hasStocks,
      hasOptions: !!e.hasOptions,
      candidateCount: num(e.candidateCount),
      stocks: normalizeSnapshot(e.stocks),
      options: normalizeSnapshot(e.options),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Derive a manifest entry from a full edition — used for hand-imported editions. */
export function summarize(edition) {
  const bulls = (items) => items.filter((i) => (i.sentiment ?? i.direction) === "bullish" || i.direction === "bull").length;
  const lean = (items) => (bulls(items) >= items.length / 2 ? "bullish" : "bearish");
  return {
    date: edition.date,
    edition: edition.edition,
    leadHeadline: edition.lead?.headline || "Untitled edition",
    storyCount: edition.stories.length + (edition.lead ? 1 : 0),
    hasStocks: !!edition.stocks,
    hasOptions: !!edition.options,
    candidateCount: edition.pipeline.candidates.length || null,
    stocks: edition.stocks
      ? {
          count: edition.stocks.picks.length,
          lean: lean(edition.stocks.picks),
          highConviction: edition.stocks.picks.filter((p) => p.conviction === "high").map((p) => p.ticker),
        }
      : null,
    options: edition.options
      ? { count: edition.options.ideas.length, lean: lean(edition.options.ideas), highConviction: [] }
      : null,
  };
}

export function normalizeConfig(raw) {
  const src = isObj(raw) ? raw : {};
  const topics = arr(src.topics)
    .filter((t) => isObj(t) && typeof t.slug === "string" && t.slug)
    .map((t) => ({
      slug: t.slug,
      label: str(t.label) || t.slug,
      weight: WEIGHTS.includes(t.weight) ? t.weight : "normal",
      enabled: t.enabled !== false,
    }));
  const sources = arr(src.sources)
    .filter((s) => isObj(s) && typeof s.domain === "string" && s.domain)
    .map((s) => ({ domain: s.domain, trust: TRUSTS.includes(s.trust) ? s.trust : "allowed" }));
  return {
    version: num(src.version) ?? 1,
    briefName: str(src.briefName) || DEFAULT_CONFIG.briefName,
    topics: topics.length ? topics : DEFAULT_CONFIG.topics,
    sources: sources.length ? sources : DEFAULT_CONFIG.sources,
  };
}
