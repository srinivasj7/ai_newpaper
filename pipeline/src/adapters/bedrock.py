"""Adapter for Amazon Bedrock's Converse API.

Converse is the one API every text model on Bedrock speaks. The OpenAI-compatible
/chat/completions endpoint is tempting — the existing openai_compatible adapter would have
handled it with no new code — but support for it is per-model and the documentation maps models
to *endpoints* rather than to APIs. Nova and Llama are listed as bedrock-runtime models, and
bedrock-runtime is listed as offering Chat Completions, and neither statement promises the pair
of them holds. Converse removes the question instead of betting on the answer.

Credentials come from the ambient chain, which on Fargate is the task role: no API key exists
for this anywhere, nothing to rotate, nothing that expires mid-run. boto3 signs the request
itself, so there is no hand-rolled SigV4 here either.
"""

from __future__ import annotations

import logging
import os

from .base import Adapter, AdapterError

log = logging.getLogger("adapter.bedrock")


class BedrockAdapter(Adapter):
    def complete(self, prompt: str) -> str:
        model = self.spec.get("model")
        if not model:
            raise AdapterError(f"{self.id}: model is required")

        region = os.path.expandvars(self.spec.get("aws_region") or os.getenv("AWS_REGION", "us-east-1"))

        try:
            import boto3
            from botocore.config import Config
        except ImportError as e:  # pragma: no cover - boto3 is a hard dependency
            raise AdapterError(f"{self.id}: boto3 is required for the bedrock adapter: {e}") from e

        # read_timeout, not just the socket default: a writer pass runs for minutes and botocore
        # would otherwise give up at 60s. retries stay low because the caller already treats a
        # failed candidate as survivable, and a retried writer pass is a second full bill.
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(read_timeout=self.timeout, connect_timeout=15, retries={"max_attempts": 2}),
        )

        inference_config = {"temperature": float(self.spec.get("temperature", 0.2))}
        if self.spec.get("max_tokens"):
            inference_config["maxTokens"] = int(self.spec["max_tokens"])

        try:
            response = client.converse(
                modelId=model,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig=inference_config,
            )
        except Exception as e:
            # AccessDeniedException here usually names a foundation-model arn the caller never
            # configured: invoking through a cross-region inference profile needs the profile
            # *and* the underlying model in each region it routes to.
            raise AdapterError(f"{self.id}: {type(e).__name__}: {e}") from e

        try:
            blocks = response["output"]["message"]["content"]
        except (KeyError, TypeError) as e:
            raise AdapterError(f"{self.id}: unexpected response shape") from e

        # A reasoning model returns its thinking as separate blocks; only the text is the answer.
        text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict))

        usage = response.get("usage") or {}
        log.info(
            "%s: %s in / %s out tokens, stop=%s",
            self.id,
            usage.get("inputTokens", "?"),
            usage.get("outputTokens", "?"),
            response.get("stopReason", "?"),
        )

        # maxTokens truncation produces valid-looking prose that stops mid-object, which then
        # fails JSON extraction with a confusing parse error rather than the real cause.
        if response.get("stopReason") == "max_tokens":
            log.warning("%s hit the output limit — the reply is truncated", self.id)

        return text
