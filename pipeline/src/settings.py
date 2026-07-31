"""Environment and provider configuration.

Every value that differs between machines comes from the environment; nothing here is
committed. `.env.example` documents the full set.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

load_dotenv(ROOT / ".env")


def setup_logging() -> None:
    """Unbuffered, timestamped, single-stream — this runs under cron and the log is the record."""
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-7s %(name)-12s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


@dataclass(frozen=True)
class Settings:
    bucket: str
    data_prefix: str
    distribution_id: str | None
    region: str
    dry_run: bool
    max_headlines: int
    lookback_hours: int

    @staticmethod
    def from_env() -> "Settings":
        bucket = os.getenv("DATA_BUCKET", "")
        if not bucket:
            raise SystemExit("DATA_BUCKET is not set — see .env.example")
        return Settings(
            bucket=bucket,
            data_prefix=os.getenv("DATA_PREFIX", "data/"),
            distribution_id=os.getenv("CLOUDFRONT_DISTRIBUTION_ID") or None,
            region=os.getenv("AWS_REGION", "us-east-1"),
            dry_run=os.getenv("DRY_RUN", "").lower() in {"1", "true", "yes"},
            max_headlines=int(os.getenv("MAX_HEADLINES", "90")),
            lookback_hours=int(os.getenv("LOOKBACK_HOURS", "36")),
        )


@dataclass(frozen=True)
class Providers:
    """The provider registry — adding a model is a YAML edit, never a code change."""

    candidates: list[dict]
    judge: dict
    min_candidates: int

    @staticmethod
    def load(path: Path | None = None) -> "Providers":
        raw = yaml.safe_load((path or ROOT / "config" / "providers.yml").read_text(encoding="utf-8"))
        return Providers(
            candidates=[c for c in raw.get("candidates", []) if c.get("enabled")],
            judge=raw.get("judge", {}) or {},
            min_candidates=int(raw.get("min_candidates", 1)),
        )


def prompt(name: str) -> str:
    return (ROOT / "prompts" / name).read_text(encoding="utf-8")
