# syntax=docker/dockerfile:1

# ── Stage 1: build the frontend ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS client-build

WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODECHATTER_DATA_DIR=/data

WORKDIR /app

# Language runtimes for the "run this file" feature. Without these the runner
# can only execute Python and every other language returns
# "<language> is not installed on the server".
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        curl \
        default-jdk-headless \
        golang-go \
        nodejs \
        npm \
        php-cli \
        ruby \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY server /app/server
COPY --from=client-build /app/client/dist /app/client/dist

# Run as an unprivileged user. This matters more than usual here: the app
# executes user-submitted code, so the runner should never hold root.
RUN useradd --create-home --uid 10001 codechatter \
    && mkdir -p /data \
    && chown -R codechatter:codechatter /data /app

USER codechatter

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1

CMD ["sh", "-c", "python -m uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000}"]


# ── Dev stage: backend with auto-reload ──────────────────────────────────────
# Used only by docker-compose.dev.yml. The server source is bind-mounted over
# /app/server, so the COPY in the runtime stage is just a fallback here.
FROM runtime AS server-dev

# uvicorn is installed without the [standard] extra, so --reload falls back to
# StatReload, which polls. That is what we want: inotify events do not cross a
# Docker Desktop bind mount, so an event-based watcher would never fire.
CMD ["sh", "-c", "python -m uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000} --reload --reload-dir /app/server"]


# ── Dev stage: frontend with hot module replacement ──────────────────────────
# node_modules lives in the image. docker-compose.dev.yml mounts an anonymous
# volume over /app/client/node_modules so the bind mount of ./client does not
# hide it with the host's (possibly absent or platform-wrong) copy.
FROM node:22-bookworm-slim AS client-dev

WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
