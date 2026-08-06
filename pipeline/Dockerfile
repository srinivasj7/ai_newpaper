# The pipeline runs on a dedicated host, never as part of a deploy.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_MAJOR=22 \
    # npm is removed from the final image, and a self-update attempt in a read-only,
    # unattended container would fail anyway. Pin the version by rebuilding instead.
    DISABLE_AUTOUPDATER=1

# Node is here only because the writer CLIs are node programs. curl is needed to install it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 # Pinned so the image is reproducible. Unpinned, every build resolves a different transitive
 # tree and reports a different set of CVEs, which makes any accepted-findings list obsolete
 # the moment it is written. Bump deliberately; Dependabot cannot see this (it is a command,
 # not a manifest).
 && npm install -g @anthropic-ai/claude-code@2.1.223 \
 # Two tempting changes are deliberately absent, both verified broken by building the image:
 #
 #   npm install -g npm@latest — the writer then fails at startup with "claude native binary
 #   not installed". The CLI places a native binary from a postinstall script, and the newer
 #   npm does not run it, with or without --ignore-scripts=false --foreground-scripts.
 #
 #   rm -rf /usr/lib/node_modules/npm — same failure, and it is npm's vendored dependencies
 #   (brace-expansion, ip-address, tar, undici) that carry almost every image finding.
 #
 # So the scanner findings are accepted by id in .trivyignore instead. A working paper beats a
 # clean report.
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config ./config
COPY prompts ./prompts
COPY src ./src

# Writers are not agents: nothing here should ever need to write to the filesystem.
RUN useradd --create-home --uid 10001 pipeline && chown -R pipeline /app
USER pipeline

ENTRYPOINT ["python", "-m", "src.main"]
