# The pipeline runs on a dedicated host, never as part of a deploy.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_MAJOR=22

# Node is here only because the writer CLIs are node programs. curl is needed to install it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 # The npm bundled with the distro package lags, and its own dependencies carry most of the
 # image's fixable CVEs. Updating it first is the cheapest way to keep the scan clean.
 && npm install -g npm@latest \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force \
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
