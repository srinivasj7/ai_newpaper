"""Adapter for coding-agent CLIs run headless as writers.

The prompt goes in on stdin rather than as an argument: it is tens of kilobytes of headlines,
well past what a Windows command line accepts, and it keeps the prompt out of the process
table. `{prompt_file}` is still substituted for CLIs that insist on reading a file.

These are writers, not agents. Tools are disabled explicitly — the model returns JSON and
touches nothing.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

from .base import Adapter, AdapterError

log = logging.getLogger("adapter.cli")


class CliAdapter(Adapter):
    def complete(self, prompt: str) -> str:
        command = list(self.spec.get("command") or [])
        if not command:
            raise AdapterError(f"{self.id}: no command configured")

        prompt_path: Path | None = None
        if any("{prompt_file}" in part for part in command):
            fd, name = tempfile.mkstemp(prefix=f"{self.id}-prompt-", suffix=".txt")
            os.close(fd)
            prompt_path = Path(name)
            prompt_path.write_text(prompt, encoding="utf-8")
            command = [part.replace("{prompt_file}", str(prompt_path)) for part in command]

        stdin_text = None if prompt_path else prompt

        try:
            log.info("%s: running %s", self.id, " ".join(command[:3]) + (" …" if len(command) > 3 else ""))
            proc = subprocess.run(
                command,
                input=stdin_text,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout,
                shell=False,
            )
        except subprocess.TimeoutExpired as e:
            raise AdapterError(f"{self.id}: timed out after {self.timeout}s") from e
        except FileNotFoundError as e:
            raise AdapterError(f"{self.id}: command not found ({command[0]})") from e
        finally:
            if prompt_path:
                prompt_path.unlink(missing_ok=True)

        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip()[:600]
            raise AdapterError(f"{self.id}: exit {proc.returncode }: {stderr or 'no stderr'}")

        return self._unwrap(proc.stdout or "")

    def _unwrap(self, stdout: str) -> str:
        """Claude Code's --output-format json wraps the reply in a result envelope."""
        if self.spec.get("output") != "claude_json":
            return stdout

        try:
            envelope = json.loads(stdout)
        except json.JSONDecodeError:
            return stdout  # not enveloped after all; let the JSON extractor try

        if envelope.get("is_error"):
            raise AdapterError(f"{self.id}: {envelope.get('result') or envelope.get('subtype')}")

        usage = envelope.get("usage") or {}
        log.info(
            "%s: %s turns, %s in / %s out tokens, %.1fs",
            self.id,
            envelope.get("num_turns", "?"),
            usage.get("input_tokens", "?"),
            usage.get("output_tokens", "?"),
            (envelope.get("duration_ms") or 0) / 1000,
        )
        return envelope.get("result") or ""
