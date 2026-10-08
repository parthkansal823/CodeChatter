# syntax=docker/dockerfile:1.7
#
# The per-room sandbox image (ADR 0003). Build context: sandbox/
#   pnpm sandbox:build          (dev: tags codechatter-sandbox:dev)
#   infra/compose.yaml          (production)
#
# User code and terminals run as ccuser (uid 10001). The file-sync agent runs
# as ccagent (uid 10002). They share group 10000 and a setgid /workspace, so
# each can edit the other's files, but neither can signal or trace the
# other's processes. The runner starts containers with no network, a
# read-only root filesystem and no capabilities.

# The agent: bundled from TypeScript into one file (it has no dependencies).
FROM node:24-slim AS agent
WORKDIR /src
COPY agent/src ./src
RUN npx --yes esbuild@0.28.2 src/agent.ts --bundle --platform=node --target=node24 --format=esm --outfile=/out/agent.mjs

FROM node:24-slim AS node

FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pytest \
      gcc g++ make libc6-dev \
      default-jdk-headless \
      tmux git procps less nano ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Terminals, Run and the judge start through cc-jail, which confines them to
# the workspace with Landlock (see cc-jail.c).
RUN --mount=type=bind,source=image/cc-jail.c,target=/tmp/cc-jail.c \
    gcc -O2 -Wall -Werror -o /usr/local/bin/cc-jail /tmp/cc-jail.c

# Node from the official image, copied without its ENV (NODE_VERSION, YARN_VERSION
# would otherwise leak into every program's environment; spike S2 finding 3).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && groupadd -g 10000 ccshared \
 && useradd -m -u 10001 -g 10000 -s /bin/bash ccuser \
 && useradd -M -u 10002 -g 10000 -s /usr/sbin/nologin ccagent \
 && mkdir -p /workspace /opt/ccagent \
 && chown 10002:10000 /workspace && chmod 2775 /workspace

COPY image/tmux.conf /etc/tmux.conf
COPY image/bashrc /etc/codechatter.bashrc
RUN cat /etc/codechatter.bashrc >> /etc/bash.bashrc
COPY --from=agent /out/agent.mjs /opt/ccagent/agent.mjs

USER 10002
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/ccagent/agent.mjs"]
