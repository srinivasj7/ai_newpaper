"""Collect candidate headlines from the configured sources.

The writer models never touch the network — this module is the only thing that reads the
outside world, which keeps sourcing auditable and the writers deterministic in what they see.

Trust tiers from the config decide what is collected and in what order: blocked domains are
never fetched, preferred domains are kept first when the pool is trimmed.
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import feedparser
import httpx

from .models import Headline, SiteConfig

log = logging.getLogger("gather")

USER_AGENT = "DailyCompile/1.0 (personal news brief; contact via site)"
TIMEOUT = httpx.Timeout(15.0, connect=8.0)

# The SEC rejects generic agents and asks for a contact address. Its filings are the single
# most citable source here, so it is worth honouring exactly.
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "DailyCompile personal-brief admin@example.com")

# No single feed may dominate the pool. arXiv alone returns hundreds of items a day; without a
# cap it would crowd out every regulator and newsroom on the list and the brief would be a
# preprint digest. The cap is what keeps a mixed pool mixed.
MAX_PER_DOMAIN = 12

# Feed paths worth trying when a domain publishes no discoverable <link rel="alternate">.
COMMON_PATHS = ("/feed", "/rss", "/feed/", "/rss.xml", "/index.xml", "/atom.xml", "/feeds/all.atom.xml")

# Outlets whose feed lives somewhere the generic probes will not find.
#
# Deliberately no aggregator fallbacks. Google News search feeds would "cover" outlets that
# publish no RSS, but every link is an opaque redirect token that cannot be resolved back to
# the publisher — the brief would cite news.google.com for everything, trust tiers would all
# collapse to one domain, and the reader could not check a claim against its source. An outlet
# we cannot deep-link is reported as unavailable instead.
# Every entry below was fetched and checked before being listed: it returns items, the items
# are recent, and the links point at the publisher rather than at a redirect. Where a domain
# lists several feeds, all of them are fetched and the result is capped per domain.
KNOWN_FEEDS: dict[str, tuple[str, ...]] = {
    # Primary sources — the issuer publishing its own facts, with no editorial layer.
    "sec.gov": ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=40&output=atom",),
    "federalreserve.gov": ("https://www.federalreserve.gov/feeds/press_all.xml",),
    "bls.gov": ("https://www.bls.gov/feed/bls_latest.rss",),
    "justice.gov": ("https://www.justice.gov/news/rss?type=press_release",),
    "ftc.gov": ("https://www.ftc.gov/feeds/press-release.xml",),
    "cftc.gov": ("https://www.cftc.gov/RSS/RSSGP/rssgp.xml",),
    "ecb.europa.eu": ("https://www.ecb.europa.eu/rss/press.html",),
    "bankofengland.co.uk": ("https://www.bankofengland.co.uk/rss/news",),
    "esma.europa.eu": ("https://www.esma.europa.eu/rss.xml",),
    "nist.gov": ("https://www.nist.gov/news-events/news/rss.xml",),

    # Open research and open source.
    "arxiv.org": ("http://export.arxiv.org/rss/cs.AI", "http://export.arxiv.org/rss/cs.LG"),
    "lwn.net": ("https://lwn.net/headlines/rss",),
    "phoronix.com": ("https://www.phoronix.com/rss.php",),

    # Public-service and non-profit newsrooms: free to read, not ad-driven.
    "bbc.co.uk": ("https://feeds.bbci.co.uk/news/business/rss.xml", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
    "npr.org": ("https://feeds.npr.org/1006/rss.xml",),
    "propublica.org": ("https://www.propublica.org/feeds/propublica/main",),

    # First-party engineering and product announcements — useful as a source of record, and
    # promotional by nature, which is why the config trusts them at `allowed` rather than
    # `preferred`.
    "openai.com": ("https://openai.com/news/rss.xml",),
    "deepmind.google": ("https://deepmind.google/blog/rss.xml",),
    "blogs.nvidia.com": ("https://blogs.nvidia.com/feed/",),
    "blog.google": ("https://blog.google/rss/",),
    "blog.cloudflare.com": ("https://blog.cloudflare.com/rss/",),
    "engineering.fb.com": ("https://engineering.fb.com/feed/",),
    "aws.amazon.com": ("https://aws.amazon.com/blogs/aws/feed/",),
    "github.blog": ("https://github.blog/feed/",),

    # Independent technical press with free feeds.
    "arstechnica.com": ("https://feeds.arstechnica.com/arstechnica/index",),
    "theregister.com": ("https://www.theregister.com/headlines.atom",),
    "techcrunch.com": ("https://techcrunch.com/feed/",),
    "theverge.com": ("https://www.theverge.com/rss/index.xml",),
    "semiengineering.com": ("https://semiengineering.com/feed/",),
    "wired.com": ("https://www.wired.com/feed/rss",),

    # Ad-funded market press. Free and factual on price action; kept at `allowed`.
    "cnbc.com": (
        "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        "https://www.cnbc.com/id/19854910/device/rss/rss.html",
    ),
    "marketwatch.com": ("https://feeds.content.dowjones.io/public/rss/mw_topstories",),
}

# Domains that only ever yield redirect tokens or syndication stubs. Items pointing at these
# are dropped rather than cited.
UNCITEABLE = {"news.google.com", "news.yahoo.com", "flipboard.com", "msn.com"}

# Hacker News is an API, not a feed; treated as its own source.
HN_DOMAIN = "news.ycombinator.com"
HN_API = "https://hn.algolia.com/api/v1/search_by_date"


def _clean(text: str, limit: int = 400) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except ValueError:
        return ""


def _published(entry) -> tuple[datetime | None, str]:
    for field in ("published_parsed", "updated_parsed"):
        parsed = entry.get(field)
        if parsed:
            dt = datetime(*parsed[:6], tzinfo=timezone.utc)
            return dt, dt.isoformat(timespec="seconds").replace("+00:00", "Z")
    return None, ""


def discover_feeds(client: httpx.Client, domain: str) -> list[str]:
    """Known feed first, then the page's declared feed, then the usual paths."""
    if domain in KNOWN_FEEDS:
        return list(KNOWN_FEEDS[domain])

    try:
        res = client.get(f"https://{domain}/", follow_redirects=True)
        declared = re.findall(
            r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*href=["\']([^"\']+)["\']',
            res.text[:200_000],
            flags=re.I,
        )
        if declared:
            return [href if href.startswith("http") else f"https://{domain}{href}" for href in declared[:2]]
    except Exception as e:
        log.debug("no declared feed for %s: %s", domain, e)

    return [f"https://{domain}{path}" for path in COMMON_PATHS[:3]]


def fetch_domain(client: httpx.Client, domain: str, trust: str, cutoff: datetime) -> list[Headline]:
    """Fetch one source.

    A vetted domain has every one of its listed feeds read, because they cover different desks.
    An unvetted one is probed until something answers, then left alone.
    """
    vetted = domain in KNOWN_FEEDS
    headers = {"User-Agent": SEC_USER_AGENT} if domain.endswith("sec.gov") else None
    items: list[Headline] = []
    reachable = False  # did any feed parse at all, regardless of how recent its entries were

    for feed_url in discover_feeds(client, domain):
        try:
            res = client.get(feed_url, follow_redirects=True, headers=headers)
            if res.status_code != 200 or not res.content:
                continue
            parsed = feedparser.parse(res.content)
            if not parsed.entries:
                continue
            reachable = True

            for entry in parsed.entries:
                link = entry.get("link") or ""
                title = _clean(entry.get("title", ""), 240)
                if not link or not title:
                    continue
                when, when_iso = _published(entry)
                if when and when < cutoff:
                    continue
                items.append(
                    Headline(
                        title=title,
                        url=link,
                        summary=_clean(entry.get("summary", "")),
                        published=when_iso,
                        domain=_domain(link) or domain,
                        trust=trust,
                    )
                )
            # A probed domain stops at the first feed that answers; a vetted one reads them all,
            # since its entries were chosen to cover different desks.
            if items and not vetted:
                break
        except Exception as e:
            log.debug("feed failed %s: %s", feed_url, e)

    if not items:
        if reachable:
            # A regulator that published nothing today is working exactly as intended. Saying
            # otherwise would push a reader to prune a good source from the config.
            log.info("%-24s  0 items — feed is fine, nothing published in the window", domain)
        else:
            # An editorial fact, not a glitch: some outlets publish no public feed at all, so
            # the brief cannot cite them however highly the config trusts them.
            log.warning("%-24s no public feed — this source cannot be cited", domain)
        return items

    items.sort(key=lambda h: h.published or "", reverse=True)
    capped = items[:MAX_PER_DOMAIN]
    log.info("%-24s %2d items%s", domain, len(capped), f" (of {len(items)})" if len(items) > len(capped) else "")
    return capped


def fetch_hacker_news(client: httpx.Client, trust: str, cutoff: datetime) -> list[Headline]:
    """Front-page-grade stories only — the API returns everything otherwise."""
    try:
        res = client.get(
            HN_API,
            params={
                "tags": "story",
                "numericFilters": f"created_at_i>{int(cutoff.timestamp())},points>80",
                "hitsPerPage": 40,
            },
        )
        res.raise_for_status()
        hits = res.json().get("hits", [])
    except Exception as e:
        log.warning("hacker news unavailable: %s", e)
        return []

    items = []
    for hit in hits:
        url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        title = _clean(hit.get("title", ""), 240)
        if not title:
            continue
        items.append(
            Headline(
                title=title,
                url=url,
                summary=f"{hit.get('points', 0)} points, {hit.get('num_comments', 0)} comments on Hacker News",
                published=hit.get("created_at", ""),
                domain=_domain(url) or HN_DOMAIN,
                trust=trust,
            )
        )
    log.info("%-24s %2d items", HN_DOMAIN, len(items))
    return items


def collect(config: SiteConfig, lookback_hours: int, limit: int) -> list[Headline]:
    """Fetch every allowed source in parallel and return a deduplicated, trimmed pool."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
    blocked = config.blocked_domains()
    domains = [s for s in config.sources if s.trust != "blocked"]

    if not domains:
        log.warning("no usable sources configured")
        return []

    headers = {"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, text/xml, */*"}
    pool: list[Headline] = []

    with httpx.Client(timeout=TIMEOUT, headers=headers) as client:
        jobs = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            for rule in domains:
                if rule.domain == HN_DOMAIN:
                    jobs.append(ex.submit(fetch_hacker_news, client, rule.trust, cutoff))
                else:
                    jobs.append(ex.submit(fetch_domain, client, rule.domain, rule.trust, cutoff))
            for job in jobs:
                try:
                    pool.extend(job.result())
                except Exception as e:
                    log.warning("source failed: %s", e)

    # A blocked domain can still appear as the target of a syndicated link, and an item we
    # cannot deep-link is worse than no item — the reader could not verify it.
    pool = [h for h in pool if h.domain not in blocked and h.domain not in UNCITEABLE]

    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    unique: list[Headline] = []
    for h in pool:
        title_key = re.sub(r"[^a-z0-9]+", "", h.title.lower())[:60]
        if h.url in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(h.url)
        seen_titles.add(title_key)
        unique.append(h)

    # Newest first, then a stable pass that lifts preferred sources to the top — so trimming
    # the pool drops the oldest allowed items rather than the best-sourced ones.
    rank = {"preferred": 0, "allowed": 1}
    unique.sort(key=lambda h: h.published or "", reverse=True)
    unique.sort(key=lambda h: rank.get(h.trust, 1))

    log.info("pool: %d unique items from %d sources (trimmed to %d)", len(unique), len(domains), min(limit, len(unique)))
    return unique[:limit]
