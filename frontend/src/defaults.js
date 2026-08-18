/* Shipped defaults + the localStorage keys. The config here is only a starting point — the
   real one lives at /data/config/config.json and is written back through /api/config. */

export const DEFAULT_CONFIG = {
  briefName: "The Daily Compile",
  topics: [
    { slug: "ai", label: "AI & Models", weight: "high", enabled: true },
    { slug: "markets", label: "Markets", weight: "normal", enabled: true },
    { slug: "chips", label: "Chips & Hardware", weight: "high", enabled: true },
    { slug: "oss", label: "GitHub & Open Source", weight: "normal", enabled: true },
    { slug: "funding", label: "Funding & Deals", weight: "low", enabled: true },
  ],
  sources: [
    { domain: "reuters.com", trust: "preferred" },
    { domain: "sec.gov", trust: "preferred" },
    { domain: "bloomberg.com", trust: "allowed" },
    { domain: "techcrunch.com", trust: "allowed" },
    { domain: "news.ycombinator.com", trust: "allowed" },
  ],
};

export const WEIGHTS = ["high", "normal", "low"];
export const TRUSTS = ["preferred", "allowed", "blocked"];

export const K = {
  token: "dtb-token",
  theme: "dtb-theme",
  config: "dtb-config",
  feedback: "dtb-feedback",
  outbox: "dtb-feedback-outbox",
  imported: "dtb-imported-editions",
  indexCache: "dtb-index-cache",
  editionsCache: "dtb-editions-cache", // per-date cache: { "YYYY-MM-DD": edition, ... }, LRU-capped
};
