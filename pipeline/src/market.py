"""Spot prices for the equities and options blocks.

The models are asked to reason about tickers, never to recall prices — a fabricated price
is the one error on this site that looks most like fact. Anything we cannot fetch is
published as null, which the frontend renders as an em dash.

Yahoo's chart endpoint is public and unofficial. It is treated as best-effort: a failure
degrades one row, never the edition.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor

import httpx

log = logging.getLogger("market")

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
TIMEOUT = httpx.Timeout(12.0, connect=6.0)
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


class Quote(dict):
    """A plain dict so it drops straight into a prompt payload."""


def _fetch(client: httpx.Client, ticker: str) -> Quote | None:
    try:
        res = client.get(CHART.format(ticker=ticker), params={"range": "5d", "interval": "1d"})
        res.raise_for_status()
        result = res.json().get("chart", {}).get("result") or []
        if not result:
            return None
        meta = result[0].get("meta", {})
        price = meta.get("regularMarketPrice")
        previous = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is None:
            return None

        change_pct = None
        if previous:
            change_pct = round((price - previous) / previous * 100, 2)

        return Quote(
            ticker=ticker,
            price=round(float(price), 2),
            currency=meta.get("currency", "USD"),
            company=meta.get("longName") or meta.get("shortName") or "",
            exchange=meta.get("fullExchangeName", ""),
            previousClose=round(float(previous), 2) if previous else None,
            changePct=change_pct,
        )
    except Exception as e:
        log.warning("no quote for %s: %s", ticker, e)
        return None


def quotes(tickers: list[str], limit: int = 14) -> list[Quote]:
    """Fetch spot prices for up to `limit` tickers, preserving the order asked for."""
    wanted, seen = [], set()
    for raw in tickers:
        t = (raw or "").strip().upper()
        if t and TICKER_RE.match(t) and t not in seen:
            seen.add(t)
            wanted.append(t)
    wanted = wanted[:limit]
    if not wanted:
        return []

    headers = {"User-Agent": "Mozilla/5.0 (compatible; DailyCompile/1.0)"}
    with httpx.Client(timeout=TIMEOUT, headers=headers) as client:
        with ThreadPoolExecutor(max_workers=6) as ex:
            found = list(ex.map(lambda t: _fetch(client, t), wanted))

    got = [q for q in found if q]
    log.info("quotes: %d of %d requested (%s)", len(got), len(wanted), ", ".join(q["ticker"] for q in got))
    return got
