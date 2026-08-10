"""Everything that touches S3 and CloudFront.

The pipeline's AWS identity is scoped to the data prefix plus one invalidation, so the
blast radius of a bug here is the data prefix of one bucket.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import timedelta

import boto3
from botocore.exceptions import ClientError

from .models import Edition, FeedbackTally, ManifestEntry, SiteConfig
from .settings import Settings, edition_today

log = logging.getLogger("store")


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        self.s3 = boto3.client("s3", region_name=settings.region)
        self.cf = boto3.client("cloudfront", region_name="us-east-1")

    # ------------------------------------------------------------------ keys

    def _key(self, *parts: str) -> str:
        return self.s.data_prefix + "/".join(parts)

    # ------------------------------------------------------------------ reads

    def _get_json(self, key: str, default=None):
        try:
            body = self.s3.get_object(Bucket=self.s.bucket, Key=key)["Body"].read()
            return json.loads(body)
        except ClientError as e:
            if e.response["Error"]["Code"] in {"NoSuchKey", "404"}:
                return default
            raise

    def load_config(self) -> SiteConfig:
        raw = self._get_json(self._key("config", "config.json"))
        if raw is None:
            log.warning("no config.json in the bucket — falling back to built-in defaults")
            return SiteConfig(topics=[], sources=[])
        return SiteConfig.model_validate(raw)

    def load_manifest(self) -> list[ManifestEntry]:
        raw = self._get_json(self._key("editions", "index.json"), default=[]) or []
        entries = []
        for row in raw:
            try:
                entries.append(ManifestEntry.model_validate(row))
            except Exception as e:  # a malformed row must not stop today's edition
                log.warning("skipping unreadable manifest row %s: %s", row.get("date", "?"), e)
        return sorted(entries, key=lambda e: e.date, reverse=True)

    def next_edition_number(self, manifest: list[ManifestEntry]) -> int:
        return max((e.edition for e in manifest), default=0) + 1

    def load_feedback(self, days: int = 7) -> FeedbackTally:
        """Aggregate recent keep/spike events. Latest event per story wins."""
        latest: dict[str, dict] = {}
        # The same day the editions are keyed by, or the newest day of feedback is missed for
        # the seven hours the two calendars disagree.
        today = edition_today()
        for offset in range(days):
            day = (today - timedelta(days=offset)).isoformat()
            prefix = self._key("feedback", day) + "/"
            token = None
            while True:
                kwargs = {"Bucket": self.s.bucket, "Prefix": prefix, "MaxKeys": 1000}
                if token:
                    kwargs["ContinuationToken"] = token
                page = self.s3.list_objects_v2(**kwargs)
                for obj in page.get("Contents", []):
                    event = self._get_json(obj["Key"])
                    if not event or "storyId" not in event:
                        continue
                    prev = latest.get(event["storyId"])
                    if prev is None or event.get("at", "") >= prev.get("at", ""):
                        latest[event["storyId"]] = event
                if not page.get("IsTruncated"):
                    break
                token = page.get("NextContinuationToken")

        tally = FeedbackTally(events=len(latest))
        for event in latest.values():
            vote = event.get("vote")
            if vote not in {"keep", "spike"}:
                continue
            for field, key in (("by_topic", event.get("topic")), ("by_model", event.get("model"))):
                if not key:
                    continue
                bucket = getattr(tally, field).setdefault(key, {"keep": 0, "spike": 0})
                bucket[vote] += 1
        return tally

    # ------------------------------------------------------------------ writes

    def put_edition(self, edition: Edition) -> str:
        key = self._key("editions", f"{edition.date}.json")
        self._put(key, edition.to_contract(), cache="public,max-age=31536000,immutable")
        return key

    def put_manifest(self, entries: list[ManifestEntry]) -> str:
        key = self._key("editions", "index.json")
        payload = [e.model_dump(by_alias=True, exclude_none=True) for e in entries]
        self._put(key, payload, cache="no-cache")
        return key

    def _put(self, key: str, payload, cache: str) -> None:
        if self.s.dry_run:
            log.info("[dry-run] would write s3://%s/%s (%d bytes)", self.s.bucket, key, len(json.dumps(payload)))
            return
        self.s3.put_object(
            Bucket=self.s.bucket,
            Key=key,
            Body=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            ContentType="application/json",
            CacheControl=cache,
        )
        log.info("wrote s3://%s/%s", self.s.bucket, key)

    def invalidate(self, *keys: str) -> None:
        """Clear the CDN for the keys just written.

        Dated editions are served with a one-year immutable cache because their content is
        normally written once. "Normally" is doing real work there: re-running a day
        overwrites that key, and without an invalidation the site would keep serving the
        superseded edition for a year. Invalidating what we wrote costs a couple of paths a
        day against a free allowance of a thousand a month.
        """
        if self.s.dry_run or not self.s.distribution_id:
            log.info("skipping CloudFront invalidation (dry-run or no distribution id)")
            return
        paths = ["/" + key for key in keys]
        self.cf.create_invalidation(
            DistributionId=self.s.distribution_id,
            InvalidationBatch={
                "Paths": {"Quantity": len(paths), "Items": paths},
                "CallerReference": f"pipeline-{time.time_ns()}",
            },
        )
        log.info("invalidated %s", ", ".join(paths))
