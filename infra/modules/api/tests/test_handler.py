"""Routing and validation tests for the write-path Lambda.

No AWS, no dependencies, no test runner: boto3 is stubbed and the S3 puts are captured.

    python infra/modules/api/tests/test_handler.py
"""

import json
import os
import sys
import types
from pathlib import Path

puts = []
reads = []

TOKEN = "test-token-not-a-real-secret-01"


class _S3:
    def put_object(self, **kw):
        puts.append(kw)
        return {}


class _SSM:
    def get_parameter(self, **kw):
        reads.append(kw)
        return {"Parameter": {"Value": TOKEN}}


_boto3 = types.ModuleType("boto3")
_boto3.client = lambda service, *_a, **_k: _SSM() if service == "ssm" else _S3()
sys.modules["boto3"] = _boto3

os.environ.setdefault("BUCKET", "test-bucket")
os.environ.setdefault("DATA_PREFIX", "data/")
os.environ.setdefault("ADMIN_TOKEN_PARAMETER", "/test/admin-token")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lambda"))

import handler  # noqa: E402


def call(path, method="POST", body=None, token=TOKEN):
    event = {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "headers": {} if token is None else {"x-dtb-token": token},
        "body": None if body is None else json.dumps(body),
    }
    res = handler.handler(event, None)
    return res["statusCode"], json.loads(res["body"])


results = []


def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {got}{'' if ok else f'  (expected {want})'}")


# --- routing
check("health", call("/api/health", "GET")[0], 200)
check("GET on feedback rejected", call("/api/feedback", "GET")[0], 405)
check("unknown route", call("/api/nope")[0], 404)

# --- feedback
status, body = call(
    "/api/feedback",
    body={"storyId": "e27-s1", "vote": "keep", "topic": "ai", "model": "claude", "editionDate": "2026-07-18"},
)
check("valid feedback", status, 200)
check("one object per event, per-day prefix", body["key"].startswith("data/feedback/2026-07-18/e27-s1-"), True)
check("exactly one put", len(puts), 1)
stored = json.loads(puts[-1]["Body"])
check("stored vote", stored["vote"], "keep")
check("server stamps its own timestamp", stored["at"].endswith("Z"), True)

check("unknown vote", call("/api/feedback", body={"storyId": "a", "vote": "burn"})[0], 400)
check("missing storyId", call("/api/feedback", body={"vote": "keep"})[0], 400)
check("storyId cannot escape its prefix", call("/api/feedback", body={"storyId": "../../etc/x", "vote": "keep"})[0], 400)
check("malformed date", call("/api/feedback", body={"storyId": "a", "vote": "keep", "editionDate": "18-07-2026"})[0], 400)
check("missing date defaults to today", call("/api/feedback", body={"storyId": "a", "vote": "spike"})[0], 200)

# --- config
status, body = call(
    "/api/config",
    body={
        "briefName": "The Daily Compile",
        "topics": [{"slug": "ai", "label": "AI & Models", "weight": "high", "enabled": True}],
        "sources": [{"domain": "reuters.com", "trust": "preferred"}],
        "version": 4,
    },
)
check("valid config", status, 200)
check("config key", body["key"], "data/config/config.json")
check("json content type", puts[-1]["ContentType"], "application/json")

check("config needs a topic", call("/api/config", body={"topics": [], "sources": []})[0], 400)
check("topic slug must be kebab-case", call("/api/config", body={"topics": [{"slug": "AI Models"}]})[0], 400)
check(
    "source must be a bare domain",
    call("/api/config", body={"topics": [{"slug": "ai"}], "sources": [{"domain": "http://x.com/y"}]})[0],
    400,
)
call("/api/config", body={"topics": [{"slug": "ai", "weight": "urgent"}]})
check("unknown weight falls back", json.loads(puts[-1]["Body"])["topics"][0]["weight"], "normal")

# --- the write gate
vote = {"storyId": "e27-s1", "vote": "keep"}
check("feedback without a token", call("/api/feedback", body=vote, token=None)[0], 401)
check("feedback with the wrong token", call("/api/feedback", body=vote, token="wrong")[0], 401)
check("config without a token", call("/api/config", body={"topics": [{"slug": "ai"}]}, token=None)[0], 401)
check("a near miss is still 401", call("/api/config", body={"topics": [{"slug": "ai"}]}, token=TOKEN[:-1])[0], 401)

before = len(puts)
call("/api/feedback", body=vote, token=None)
check("a rejected write stores nothing", len(puts), before)

check("health stays open", call("/api/health", "GET", token=None)[0], 200)

check(
    "bearer form accepted",
    handler.handler(
        {
            "rawPath": "/api/feedback",
            "requestContext": {"http": {"method": "POST"}},
            "headers": {"authorization": f"Bearer {TOKEN}"},
            "body": json.dumps(vote),
        },
        None,
    )["statusCode"],
    200,
)

# The parameter is fetched once and cached for the life of the container, not on every request.
check("the secret is read once per container", len(reads), 1)

check("preflight advertises the auth header", "x-dtb-token" in handler._preflight_headers(None)["access-control-allow-headers"], True)

# --- body handling
raw = {
    "rawPath": "/api/config",
    "requestContext": {"http": {"method": "POST"}},
    "headers": {"x-dtb-token": TOKEN},
}
check("non-JSON body", handler.handler({**raw, "body": "{not json"}, None)["statusCode"], 400)
check("oversized body", handler.handler({**raw, "body": "x" * (300 * 1024)}, None)["statusCode"], 400)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
