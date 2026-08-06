"""Write path for The Daily Compile.

Three routes, reachable only through CloudFront (the Function URL is IAM-authed and
signed by the distribution's OAC):

    GET  /api/health    liveness
    POST /api/feedback  one keep/spike event -> data/feedback/<date>/<storyId>-<ms>.json
    POST /api/config    the topics/sources config -> data/config/config.json

Everything is validated against the contracts in CLAUDE.md before it touches S3.
The bucket is versioned, so a bad config push is undone by restoring a version.
"""

import hmac
import json
import os
import re
import time
from datetime import datetime, timezone

import boto3

s3 = boto3.client("s3")
ssm = boto3.client("ssm")

BUCKET = os.environ["BUCKET"]
DATA_PREFIX = os.environ.get("DATA_PREFIX", "data/")
CONFIG_KEY = f"{DATA_PREFIX}config/config.json"
FEEDBACK_PREFIX = f"{DATA_PREFIX}feedback/"

# Origins allowed to call this cross-origin (CORS). Same-origin browsers behind CloudFront send
# no Origin and are unaffected; the mobile app runs at https://localhost and is not same-origin.
# Comma-separated, exact match — an origin not on this list is never echoed back.
ALLOWED_ORIGINS = tuple(o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip())

MAX_BODY_BYTES = 256 * 1024
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STORY_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
DOMAIN_RE = re.compile(r"^[a-z0-9.-]{3,253}$")
VOTES = ("keep", "spike")
WEIGHTS = ("high", "normal", "low")
TRUSTS = ("preferred", "allowed", "blocked")


# The shared secret guarding every write. Read from Parameter Store at cold start and cached
# for the life of the container, so it is never an environment variable, never in the task
# definition, and never in OpenTofu state — a `data.aws_ssm_parameter` would put it in all three.
ADMIN_TOKEN_PARAMETER = os.environ.get("ADMIN_TOKEN_PARAMETER", "")
_admin_token: str | None = None


class Invalid(Exception):
    """Client error — reported as a 400 with the offending field."""


class Unauthorized(Exception):
    """Missing or wrong credential — reported as a 401, with no detail about which."""


def _expected_token() -> str:
    global _admin_token
    if _admin_token is None:
        if not ADMIN_TOKEN_PARAMETER:
            raise RuntimeError("ADMIN_TOKEN_PARAMETER is not configured")
        _admin_token = ssm.get_parameter(Name=ADMIN_TOKEN_PARAMETER, WithDecryption=True)["Parameter"]["Value"].strip()
    return _admin_token


def _authorize(event) -> None:
    """Every write needs the shared secret.

    Compared with hmac.compare_digest rather than ==, so the time taken does not depend on how
    many leading characters matched. The secret is 32 characters from a 64-symbol alphabet —
    about 192 bits — so guessing is not a practical attack; constant-time comparison closes the
    side channel that would otherwise let an attacker learn it a character at a time.
    """
    headers = event.get("headers") or {}
    supplied = (headers.get("x-dtb-token") or headers.get("X-DTB-Token") or "").strip()

    # Bearer is accepted as a convenience for calling the Function URL directly with signed
    # credentials. It is not the path the site uses, and it must not be: through CloudFront the
    # Authorization header carries OAC's own SigV4 signature, so sending a bearer token there
    # replaces the signature and the origin refuses the request before this code runs.
    if not supplied:
        auth = headers.get("authorization") or headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()

    if not supplied or not hmac.compare_digest(supplied, _expected_token()):
        raise Unauthorized()


def handler(event, _context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "GET")
    path = event.get("rawPath", "") or ""
    origin = _allowed_origin(event)

    # The mobile app is cross-origin (https://localhost), and every write carries a custom
    # x-amz-content-sha256 header, which makes the POST non-simple — so the browser fires an
    # OPTIONS preflight first. CloudFront forwards OPTIONS to this origin (it cannot synthesize
    # the 2xx itself), so answer it here, before the method check that would otherwise 405 it.
    if method == "OPTIONS":
        return _reply(204, None, _preflight_headers(origin))

    resp = _route(method, path, event)

    # Let the browser read the response of the actual request, too.
    if origin:
        resp["headers"]["access-control-allow-origin"] = origin
        resp["headers"]["vary"] = "Origin"
    return resp


def _route(method, path, event):
    try:
        if path.endswith("/health"):
            return _reply(200, {"ok": True, "at": _now()})

        if method != "POST":
            return _reply(405, {"error": "method not allowed"})

        # Before the body is read, let alone written anywhere: every write is gated, including
        # feedback. Health stays open — it carries nothing and is what tells you the API is up.
        _authorize(event)

        # Authorization succeeded, so the secret is right. Nothing is read or written: this
        # exists so the settings panel can say "wrong passphrase" when it is typed, rather
        # than silently much later when a save fails.
        if path.endswith("/session"):
            return _reply(200, {"ok": True})

        body = _body(event)

        if path.endswith("/feedback"):
            return _feedback(body)
        if path.endswith("/config"):
            return _config(body)

        return _reply(404, {"error": "no such route", "path": path})

    except Unauthorized:
        # Deliberately identical for a missing and a wrong token: distinguishing them tells an
        # attacker which half of the problem they have solved.
        return _reply(401, {"error": "unauthorized"})
    except Invalid as e:
        return _reply(400, {"error": str(e)})
    except Exception as e:  # noqa: BLE001 — never leak a stack trace to the browser
        print(f"ERROR {type(e).__name__}: {e}")
        return _reply(500, {"error": "internal error"})


def _allowed_origin(event):
    """The request's Origin, but only if it is on the allowlist — an untrusted origin is never
    echoed back. A same-origin request (the website) sends no Origin and gets None, which is
    correct: it needs no CORS headers."""
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    return origin if origin in ALLOWED_ORIGINS else None


def _preflight_headers(origin):
    headers = {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-amz-content-sha256, x-dtb-token",
        "access-control-max-age": "600",
        "vary": "Origin",
    }
    if origin:
        headers["access-control-allow-origin"] = origin
    return headers


# --------------------------------------------------------------------------- routes


def _feedback(body):
    story_id = _str(body, "storyId")
    if not STORY_ID_RE.match(story_id):
        raise Invalid("storyId must be 1-120 chars of [A-Za-z0-9._-]")

    vote = _str(body, "vote")
    if vote not in VOTES:
        raise Invalid(f"vote must be one of {VOTES}")

    edition_date = body.get("editionDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not DATE_RE.match(str(edition_date)):
        raise Invalid("editionDate must be YYYY-MM-DD")

    event_doc = {
        "storyId": story_id,
        "vote": vote,
        "topic": _opt_str(body.get("topic"), 64),
        "model": _opt_str(body.get("model"), 64),
        "editionDate": edition_date,
        "at": _now(),
    }

    key = f"{FEEDBACK_PREFIX}{edition_date}/{story_id}-{int(time.time() * 1000)}.json"
    _put(key, event_doc)
    return _reply(200, {"ok": True, "key": key})


def _config(body):
    topics = []
    for t in _list(body, "topics", limit=64):
        slug = _str(t, "slug")
        if not SLUG_RE.match(slug):
            raise Invalid(f"topic slug '{slug}' must be lowercase kebab-case")
        weight = t.get("weight", "normal")
        topics.append(
            {
                "slug": slug,
                "label": _opt_str(t.get("label"), 120) or slug,
                "weight": weight if weight in WEIGHTS else "normal",
                "enabled": t.get("enabled") is not False,
            }
        )
    if not topics:
        raise Invalid("config needs at least one topic")

    sources = []
    for s in _list(body, "sources", limit=256):
        domain = _str(s, "domain").lower()
        if not DOMAIN_RE.match(domain):
            raise Invalid(f"source domain '{domain}' is not a bare domain")
        trust = s.get("trust", "allowed")
        sources.append({"domain": domain, "trust": trust if trust in TRUSTS else "allowed"})

    version = body.get("version")
    doc = {
        "version": version if isinstance(version, int) and version > 0 else 1,
        "exportedAt": _now(),
        "briefName": _opt_str(body.get("briefName"), 120) or "The Daily Compile",
        "topics": topics,
        "sources": sources,
    }
    _put(CONFIG_KEY, doc)
    return _reply(200, {"ok": True, "key": CONFIG_KEY, "version": doc["version"]})


# --------------------------------------------------------------------------- helpers


def _put(key, doc):
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(doc, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-cache",
    )


def _body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8", "replace")
    if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
        raise Invalid("body too large")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise Invalid(f"body is not JSON: {e.msg}") from e
    if not isinstance(parsed, dict):
        raise Invalid("body must be a JSON object")
    return parsed


def _str(obj, field):
    value = obj.get(field) if isinstance(obj, dict) else None
    if not isinstance(value, str) or not value.strip():
        raise Invalid(f"{field} is required")
    return value.strip()


def _opt_str(value, limit):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _list(body, field, limit):
    value = body.get(field, [])
    if not isinstance(value, list):
        raise Invalid(f"{field} must be an array")
    if len(value) > limit:
        raise Invalid(f"{field} has more than {limit} entries")
    return [v for v in value if isinstance(v, dict)]


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _reply(status, payload, extra_headers=None):
    headers = {"content-type": "application/json", "cache-control": "no-store"}
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status,
        "headers": headers,
        "body": "" if payload is None else json.dumps(payload),
    }
