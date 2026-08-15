"""Adapter for any OpenAI-compatible /chat/completions endpoint.

Used for the local judge served by Ollama, for hosted API providers, and for Amazon Bedrock,
which speaks the same wire format on its bedrock-runtime endpoint. The judge and a writer share
this code because they share that format — nothing here knows which role it is playing.

Two ways to authenticate:

  api_key_env  a bearer token read from the environment (Ollama needs none; a hosted vendor
               needs its own key)
  auth: sigv4  request signing from the ambient AWS credential chain — on Fargate that is the
               task role, so a Bedrock model is reachable with no key stored anywhere, nothing
               to rotate, and nothing that can expire mid-run. Bedrock also accepts a bearer
               API key; we deliberately do not use one.
"""

from __future__ import annotations

import json
import logging
import os

import httpx

from .base import Adapter, AdapterError

log = logging.getLogger("adapter.api")


def _sigv4_headers(url: str, body: str, service: str, region: str) -> dict[str, str]:
    """Sign a POST with the ambient AWS credentials and return the auth headers.

    botocore ships with boto3, which the pipeline already depends on, so this costs no new
    package. It signs a throwaway request object and we lift the headers onto the httpx call.
    """
    try:
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        from botocore.session import Session
    except ImportError as e:  # pragma: no cover - boto3 is a hard dependency
        raise AdapterError(f"sigv4 signing needs botocore: {e}") from e

    credentials = Session().get_credentials()
    if credentials is None:
        raise AdapterError("sigv4 requested but no AWS credentials are available")

    request = AWSRequest(method="POST", url=url, data=body, headers={"Content-Type": "application/json"})
    SigV4Auth(credentials.get_frozen_credentials(), service, region).add_auth(request)
    return dict(request.headers)


class OpenAICompatibleAdapter(Adapter):
    def complete(self, prompt: str) -> str:
        base_url = os.path.expandvars(self.spec.get("base_url", "")).rstrip("/")
        model = self.spec.get("model")
        if not base_url or not model:
            raise AdapterError(f"{self.id}: base_url and model are required")

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": float(self.spec.get("temperature", 0.2)),
            "stream": False,
        }
        if self.spec.get("json_mode", True):
            payload["response_format"] = {"type": "json_object"}

        url = f"{base_url}/chat/completions"

        if self.spec.get("auth") == "sigv4":
            # The body must be serialised once and sent byte-for-byte: SigV4 hashes the payload,
            # so re-encoding it after signing invalidates the signature.
            raw = json.dumps(payload)
            region = os.path.expandvars(self.spec.get("aws_region") or os.getenv("AWS_REGION", "us-east-1"))
            headers = _sigv4_headers(url, raw, self.spec.get("aws_service", "bedrock"), region)
            request = {"content": raw, "headers": headers}
        else:
            api_key = os.getenv(self.spec.get("api_key_env", ""), "") if self.spec.get("api_key_env") else ""
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            request = {"json": payload, "headers": headers}

        try:
            res = httpx.post(url, timeout=self.timeout, **request)
            res.raise_for_status()
            body = res.json()
        except httpx.HTTPStatusError as e:
            raise AdapterError(f"{self.id}: HTTP {e.response.status_code}: {e.response.text[:300]}") from e
        except Exception as e:
            raise AdapterError(f"{self.id}: {e}") from e

        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise AdapterError(f"{self.id}: unexpected response shape") from e

        usage = body.get("usage") or {}
        log.info(
            "%s: %s in / %s out tokens",
            self.id,
            usage.get("prompt_tokens", "?"),
            usage.get("completion_tokens", "?"),
        )
        return content or ""
