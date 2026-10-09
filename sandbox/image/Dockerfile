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

# The agent, and the egress proxy that runs from this image while a room's
# owner allows package installs (ADR 0007): each bundled from TypeScript into
# one file (they have no dependencies).
FROM node:24-slim AS agent
WORKDIR /src
COPY agent/src ./src
RUN npx --yes esbuild@0.28.2 src/agent.ts src/egress.ts --bundle --platform=node --target=node24 --format=esm --outdir=/out --out-extension:.js=.mjs

FROM node:24-slim AS node

# cc-jail confines terminals, Run and the judge to the workspace with Landlock
# (see cc-jail.c). Built on its own and, like the agent, copied in last, so
# changing either doesn't rebuild the toolchains.
FROM debian:trixie-slim AS jail
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*
COPY image/cc-jail.c /src/cc-jail.c
RUN gcc -O2 -Wall -Werror -o /cc-jail /src/cc-jail.c

# Shared by both images: the base languages, Node and the users.
FROM debian:trixie-slim AS core
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip python3-pytest \
      gcc g++ make libc6-dev \
      default-jdk-headless \
      tmux git procps less nano ca-certificates \
      postgresql-client default-mysql-client redis-tools \
 && rm -rf /var/lib/apt/lists/* \
 # The room's databases (apps/runner/src/databases.ts) are reached on its private
 # network, where MySQL's self-signed certificate is expected; the MariaDB client
 # would otherwise refuse it.
 && mkdir -p /etc/mysql/conf.d \
 && printf '[client]\nskip-ssl-verify-server-cert\n' > /etc/mysql/conf.d/codechatter.cnf

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
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/ccagent/agent.mjs"]

# The base image: what every room gets by default.
FROM core AS base
COPY --from=jail /cc-jail /usr/local/bin/cc-jail
COPY --from=agent /out/ /opt/ccagent/
USER 10002

# The full image: every language the run plans know (apps/runner/src/plans.ts).
#   pnpm sandbox:build:full     (dev: tags codechatter-sandbox:full; point SANDBOX_IMAGE at it)
# Most toolchains come from Debian; downloads are cached between builds. Kotlin's
# Debian package is years old, so the official compiler is used instead. Toolchains
# live under /usr, where the jail lets programs run.
FROM core AS full
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      golang-go rustc cargo ruby php-cli perl lua5.4 r-base-core \
      gfortran nasm fp-compiler fp-units-rtl gnucobol3 swi-prolog-nox sqlite3 \
      ocaml-nox ghc elixir erlang-nox racket clojure \
      mono-mcs mono-runtime gdc gnat groovy crystal \
      curl unzip
ARG KOTLIN_VERSION=2.2.0
RUN curl -fsSL -o /tmp/kotlin.zip "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" \
 && unzip -q /tmp/kotlin.zip -d /usr/local/lib \
 && rm /tmp/kotlin.zip \
 && ln -s ../lib/kotlinc/bin/kotlinc /usr/local/bin/kotlinc
# The Kubernetes playground (`k8s up`): kubectl and Helm, and KWOK, a real API
# server with simulated nodes that runs unprivileged and offline. Kubernetes and
# Helm downloads are checked against their published SHA-256 sums.
ARG K8S_VERSION=v1.37.1
ARG KWOK_VERSION=v0.8.0
ARG ETCD_VERSION=v3.6.10
ARG HELM_VERSION=v4.3.0
RUN set -eu; B=/usr/local/lib/k8s; mkdir -p "$B"; cd "$B" \
 && for c in kube-apiserver kube-controller-manager kube-scheduler kubectl; do \
      curl -fsSL -o "$c" "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/$c"; \
      echo "$(curl -fsSL "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/$c.sha256")  $c" | sha256sum -c --quiet -; \
    done \
 && curl -fsSL -o kwokctl "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/kwokctl-linux-amd64" \
 && curl -fsSL -o kwok "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/kwok-linux-amd64" \
 && curl -fsSL "https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz" | tar -xz -C /tmp \
 && mv "/tmp/etcd-${ETCD_VERSION}-linux-amd64/etcd" etcd && rm -rf "/tmp/etcd-${ETCD_VERSION}-linux-amd64" \
 && curl -fsSL -o /tmp/helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
 && echo "$(curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz.sha256sum" | cut -d' ' -f1)  /tmp/helm.tgz" | sha256sum -c --quiet - \
 && tar -xzf /tmp/helm.tgz -C /tmp && mv /tmp/linux-amd64/helm helm && rm -rf /tmp/helm.tgz /tmp/linux-amd64 \
 && chmod 755 ./* \
 && ln -s ../lib/k8s/kubectl ../lib/k8s/helm ../lib/k8s/kwokctl /usr/local/bin/
COPY --chmod=755 image/k8s /usr/local/bin/k8s
COPY image/kwok.yaml /usr/local/lib/k8s/kwok.yaml
COPY --from=jail /cc-jail /usr/local/bin/cc-jail
COPY --from=agent /out/ /opt/ccagent/
USER 10002
