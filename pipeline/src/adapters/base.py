"""Adapter contract and the JSON extraction every provider shares.

A provider is anything that turns a prompt into JSON. Adding one is a YAML edit; the only
code that knows a provider's name is the registry.
"""

from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod

log = logging.getLogger("adapter")


class AdapterError(RuntimeError):
    """A provider failed. Never fatal on its own — the run continues on the survivors."""


class Adapter(ABC):
    def __init__(self, spec: dict):
        self.spec = spec
        self.id: str = spec.get("id", "unknown")
        self.timeout: int = int(spec.get("timeout_s", 300))

    @abstractmethod
    def complete(self, prompt: str) -> str:
        """Return the provider's raw text response."""

    def complete_json(self, prompt: str, repair: bool = True) -> dict:
        """Run the prompt and return parsed JSON, with one repair attempt on failure."""
        raw = self.complete(prompt)
        try:
            return extract_json(raw)
        except ValueError as first:
            if not repair:
                raise AdapterError(f"{self.id}: {first}") from first
            log.warning("%s returned unparseable JSON (%s) — asking once for a repair", self.id, first)
            fixed = self.complete(
                "Your previous reply could not be parsed as JSON.\n"
                f"The error was: {first}\n\n"
                "Return the same content again as a single valid JSON object. "
                "Output JSON only: no prose, no markdown fences, no trailing commas.\n\n"
                "Previous reply:\n" + raw[:12000]
            )
            try:
                return extract_json(fixed)
            except ValueError as second:
                raise AdapterError(f"{self.id}: unparseable after repair: {second}") from second


def extract_json(text: str) -> dict:
    """Pull one JSON object out of a model reply.

    Tolerant by necessity: replies arrive bare, fenced, prefaced with commentary, or with a
    trailing apology. Strict about the result — it must parse and be an object.
    """
    if not text or not text.strip():
        raise ValueError("empty response")

    candidate = text.strip()

    fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", candidate, flags=re.S)
    if fenced:
        candidate = fenced.group(1).strip()

    if not candidate.startswith("{"):
        start = candidate.find("{")
        if start == -1:
            raise ValueError("no JSON object in response")
        candidate = candidate[start:]

    # Walk to the matching close brace so trailing prose is ignored.
    depth, in_string, escaped, end = 0, False, False, None
    for i, ch in enumerate(candidate):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise ValueError("unbalanced JSON object")

    try:
        parsed = json.loads(candidate[:end])
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON: {e.msg} at position {e.pos}") from e

    if not isinstance(parsed, dict):
        raise ValueError("expected a JSON object")
    return parsed


def build(spec: dict) -> Adapter:
    """Instantiate the adapter named in a providers.yml entry."""
    from .bedrock import BedrockAdapter
    from .cli import CliAdapter
    from .openai_compatible import OpenAICompatibleAdapter

    kind = spec.get("adapter")
    if kind == "bedrock":
        return BedrockAdapter(spec)
    if kind == "cli":
        return CliAdapter(spec)
    if kind == "openai_compatible":
        return OpenAICompatibleAdapter(spec)
    raise AdapterError(f"unknown adapter '{kind}' for provider '{spec.get('id')}'")
