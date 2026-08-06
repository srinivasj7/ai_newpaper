"""Adapter for any OpenAI-compatible /chat/completions endpoint.

Used for the local judge served by Ollama, and for hosted API providers when one is enabled
in providers.yml. The judge and an API writer share this code because they share the wire
format — nothing here knows which role it is playing.
"""

from __future__ import annotations

import logging
import os

import httpx

from .base import Adapter, AdapterError

log = logging.getLogger("adapter.api")


class OpenAICompatibleAdapter(Adapter):
    def complete(self, prompt: str) -> str:
        base_url = os.path.expandvars(self.spec.get("base_url", "")).rstrip("/")
        model = self.spec.get("model")
        if not base_url or not model:
            raise AdapterError(f"{self.id}: base_url and model are required")

        api_key = os.getenv(self.spec.get("api_key_env", ""), "") if self.spec.get("api_key_env") else ""
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": float(self.spec.get("temperature", 0.2)),
            "stream": False,
        }
        if self.spec.get("json_mode", True):
            payload["response_format"] = {"type": "json_object"}

        try:
            res = httpx.post(f"{base_url}/chat/completions", json=payload, headers=headers, timeout=self.timeout)
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
