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

# Formatters for the editor's Format document (apps/runner/src/format.ts): Ruff for
# Python, clang-format for C and C++, shfmt for shell. Standalone binaries from a
# stage of their own (Debian's clang-format would bring all of LLVM), copied into
# both images late, so changing them doesn't rebuild the toolchains.
FROM debian:trixie-slim AS formatters
ARG RUFF_VERSION=0.11.0
ARG CLANG_FORMAT_VERSION=19.1.7
RUN apt-get update  && apt-get install -y --no-install-recommends python3-pip shfmt  && pip install --no-cache-dir --break-system-packages --target /tmp/py "ruff==${RUFF_VERSION}" "clang-format==${CLANG_FORMAT_VERSION}"  && mkdir /out  && cp /tmp/py/bin/ruff /out/ruff  && cp "$(find /tmp/py -type f -path '*/clang_format/data/bin/clang-format' | head -n 1)" /out/clang-format  && cp /usr/bin/shfmt /out/shfmt  && /out/ruff --version && /out/clang-format --version && /out/shfmt --version

# Language servers for the editor's IntelliSense (apps/runner/src/lsp.ts): Pyright for
# Python, a Node program like the rest of Node here. Its own stage and copied late,
# like the formatters.
FROM node:24-slim AS lsp
ARG PYRIGHT_VERSION=1.1.400
RUN npm install -g --prefix /tmp/npm "pyright@${PYRIGHT_VERSION}"  && mkdir -p /out/lib /out/bin  && mv /tmp/npm/lib/node_modules/pyright /out/lib/pyright  && ln -s /usr/local/lib/pyright/langserver.index.js /out/bin/pyright-langserver  && node /out/lib/pyright/index.js --version

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

# The Python data pack and notebooks: numpy, pandas and matplotlib, and Jupyter's kernel
# and client, which kernel.py drives for the runner (apps/runner/src/notebooks.ts). Its
# own layer, so the toolchains above stay cached.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3-numpy python3-pandas python3-matplotlib python3-ipykernel python3-jupyter-client \
 && rm -rf /var/lib/apt/lists/*
COPY image/kernel.py /usr/local/lib/codechatter/kernel.py

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

# js-debug, VS Code's JavaScript debugger, as a standalone Debug Adapter Protocol server
# (apps/runner/src/debug.ts, through js-debug-bridge.mjs), checked against the SHA-256
# GitHub publishes for the release.
FROM debian:trixie-slim AS jsdebug
ARG JS_DEBUG_VERSION=v1.140.0
ARG JS_DEBUG_SHA256=27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968
RUN apt-get update  && apt-get install -y --no-install-recommends curl ca-certificates  && rm -rf /var/lib/apt/lists/*  && curl -fsSL --retry 5 --retry-all-errors -o /tmp/js-debug.tgz "https://github.com/microsoft/vscode-js-debug/releases/download/${JS_DEBUG_VERSION}/js-debug-dap-${JS_DEBUG_VERSION}.tar.gz"  && echo "${JS_DEBUG_SHA256}  /tmp/js-debug.tgz" | sha256sum -c --quiet -  && mkdir -p /out  && tar -xzf /tmp/js-debug.tgz -C /out  && test -f /out/js-debug/src/dapDebugServer.js  && rm /tmp/js-debug.tgz

# DuckDB's Python package, for the Databases tool's DuckDB files and its SQL over the room's
# CSV, Parquet and JSON files (apps/runner/src/duckdb.ts): the wheel for the images' Python
# 3.13, checked against the SHA-256 PyPI publishes, with nothing else.
FROM debian:trixie-slim AS duckdb
ARG DUCKDB_VERSION=1.5.6
ARG DUCKDB_SHA256=644f54ce99b3b61844bc9a3fe80e0aecb1ea4084b1fffc4396d1569db6111679
RUN apt-get update  && apt-get install -y --no-install-recommends python3-pip  && rm -rf /var/lib/apt/lists/*  && echo "duckdb==${DUCKDB_VERSION} --hash=sha256:${DUCKDB_SHA256}" > /tmp/duckdb.txt  && pip install --no-cache-dir --break-system-packages --no-deps --only-binary :all: --require-hashes --target /out -r /tmp/duckdb.txt  && PYTHONPATH=/out python3 -c "import duckdb; print(duckdb.__version__)"

# The base image: what every room gets by default.
FROM core AS base
# clangd, the C and C++ language server (apps/runner/src/lsp.ts); its own layer.
RUN apt-get update  && apt-get install -y --no-install-recommends clangd  && rm -rf /var/lib/apt/lists/*
COPY --from=formatters /out/ /usr/local/bin/
COPY --from=lsp /out/ /usr/local/
COPY --from=jsdebug /out/js-debug /usr/local/lib/js-debug
COPY image/js-debug-bridge.mjs /usr/local/lib/codechatter/js-debug-bridge.mjs
COPY --from=duckdb /out/ /usr/local/lib/python3.13/dist-packages/
COPY --from=jail /cc-jail /usr/local/bin/cc-jail
COPY --from=agent /out/ /opt/ccagent/
# Marks it, so a rebuild can remove the copy it replaces (pnpm docker:tidy).
LABEL codechatter.sandbox=1
USER 10002

# Downloads for the full image, each in a stage of its own: changing the shared
# layers (core) doesn't fetch them again, and they download while the
# toolchains install. Every download retries when a connection drops.
FROM debian:trixie-slim AS fetch
RUN apt-get update  && apt-get install -y --no-install-recommends curl ca-certificates unzip  && rm -rf /var/lib/apt/lists/*

# Kotlin's Debian package is years old, so the official compiler is used instead.
FROM fetch AS kotlin
ARG KOTLIN_VERSION=2.2.0
RUN curl -fsSL --retry 5 --retry-all-errors -o /tmp/kotlin.zip "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip"  && unzip -q /tmp/kotlin.zip -d /out  && rm /tmp/kotlin.zip

# The Kubernetes playground (`k8s up`): kubectl and Helm, and KWOK, a real API
# server with simulated nodes that runs unprivileged and offline. Kubernetes and
# Helm downloads are checked against their published SHA-256 sums. Inside the
# loop, `|| exit 1` is what stops the build on a bad checksum: in an && chain
# the shell ignores set -e there, and only the last file's check would count.
FROM fetch AS java
# Java's language server, Eclipse JDT LS (apps/runner/src/lsp.ts; it runs on Java 25, installed with it),
# and google-java-format for Format document (apps/runner/src/format.ts), each checked against
# the SHA-256 its publisher gives: Eclipse's .sha256 file, GitHub's digest.
ARG JDTLS_VERSION=1.62.0
ARG JDTLS_BUILD=202610131109
ARG JDTLS_SHA256=f587dafd8410633c2c2bf005e853a2bbb03cddee88933d49bfe6d9cb1cf09342
ARG GJF_VERSION=1.37.0
ARG GJF_SHA256=834b2a0c38cb774953322a84b5ca3f2f40dd3156650b3cd44d3b744345962f7a
# java-debug, the Java debugger, which runs inside JDT LS (apps/runner/src/debug.ts): the plugin
# jar from VS Code's Java debugger extension on Open VSX, checked against Open VSX's SHA-256.
ARG JAVA_DEBUG_VERSION=0.60.0
ARG JAVA_DEBUG_SHA256=f09ebe358a7b08b3c17b21b8d8207b0649acad120eb6f1604dc4f15379f59d66
RUN set -eu; get() { curl -fsSL --retry 5 --retry-all-errors "$@"; }  && get -o /tmp/java-debug.vsix "https://open-vsx.org/api/vscjava/vscode-java-debug/${JAVA_DEBUG_VERSION}/file/vscjava.vscode-java-debug-${JAVA_DEBUG_VERSION}.vsix"  && echo "${JAVA_DEBUG_SHA256}  /tmp/java-debug.vsix" | sha256sum -c --quiet -  && mkdir -p /tmp/java-debug /out/java-debug  && unzip -q /tmp/java-debug.vsix 'extension/server/com.microsoft.java.debug.plugin-*.jar' -d /tmp/java-debug  && mv /tmp/java-debug/extension/server/com.microsoft.java.debug.plugin-*.jar /out/java-debug/com.microsoft.java.debug.plugin.jar  && rm -rf /tmp/java-debug /tmp/java-debug.vsix
RUN set -eu; get() { curl -fsSL --retry 5 --retry-all-errors "$@"; }  && get -o /tmp/jdtls.tgz "https://download.eclipse.org/jdtls/milestones/${JDTLS_VERSION}/jdt-language-server-${JDTLS_VERSION}-${JDTLS_BUILD}.tar.gz"  && echo "${JDTLS_SHA256}  /tmp/jdtls.tgz" | sha256sum -c --quiet -  && mkdir -p /out/jdtls  && tar -xzf /tmp/jdtls.tgz -C /out/jdtls  && rm /tmp/jdtls.tgz  && ls /out/jdtls/plugins/org.eclipse.equinox.launcher_*.jar  && get -o /out/google-java-format.jar "https://github.com/google/google-java-format/releases/download/v${GJF_VERSION}/google-java-format-${GJF_VERSION}-all-deps.jar"  && echo "${GJF_SHA256}  /out/google-java-format.jar" | sha256sum -c --quiet -

FROM fetch AS k8s
ARG K8S_VERSION=v1.37.1
ARG KWOK_VERSION=v0.8.0
ARG ETCD_VERSION=v3.6.10
ARG HELM_VERSION=v4.3.0
RUN set -eu; B=/out/k8s; mkdir -p "$B"; cd "$B"; get() { curl -fsSL --retry 5 --retry-all-errors "$@"; }  && for c in kube-apiserver kube-controller-manager kube-scheduler kubectl; do       get -o "$c" "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/$c" || exit 1;       echo "$(get "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/$c.sha256")  $c" | sha256sum -c --quiet - || exit 1;     done  && get -o kwokctl "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/kwokctl-linux-amd64"  && get -o kwok "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/kwok-linux-amd64"  && get "https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz" | tar -xz -C /tmp  && mv "/tmp/etcd-${ETCD_VERSION}-linux-amd64/etcd" etcd && rm -rf "/tmp/etcd-${ETCD_VERSION}-linux-amd64"  && get -o /tmp/helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"  && echo "$(get "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz.sha256sum" | cut -d' ' -f1)  /tmp/helm.tgz" | sha256sum -c --quiet -  && tar -xzf /tmp/helm.tgz -C /tmp && mv /tmp/linux-amd64/helm helm && rm -rf /tmp/helm.tgz /tmp/linux-amd64  && chmod 755 ./*

# kubeconform, and Kubernetes JSON schemas for it made from the OpenAPI spec of the
# playground's Kubernetes version (image/k8s-schemas.py; K8S_VERSION as in the k8s stage), so
# manifests can be checked without a cluster. Both downloads are checked against SHA-256 sums:
# kubeconform's as GitHub publishes it, the spec's as it was when pinned. The build checks a
# good manifest passes and a misspelt field doesn't.
FROM debian:trixie-slim AS kubeschemas
ARG K8S_VERSION=v1.37.1
ARG K8S_SPEC_SHA256=465276aedf437726de5a6ed23a41b86d78bb0d347edf251a755ae26a93cdd8a6
ARG KUBECONFORM_VERSION=v0.8.0
ARG KUBECONFORM_SHA256=9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
COPY image/k8s-schemas.py /tmp/k8s-schemas.py
RUN set -eu; apt-get update  && apt-get install -y --no-install-recommends curl ca-certificates python3  && rm -rf /var/lib/apt/lists/*  && curl -fsSL --retry 5 --retry-all-errors -o /tmp/kubeconform.tgz "https://github.com/yannh/kubeconform/releases/download/${KUBECONFORM_VERSION}/kubeconform-linux-amd64.tar.gz"  && echo "${KUBECONFORM_SHA256}  /tmp/kubeconform.tgz" | sha256sum -c --quiet -  && mkdir -p /out/bin  && tar -xzf /tmp/kubeconform.tgz -C /out/bin kubeconform  && curl -fsSL --retry 5 --retry-all-errors -o /tmp/swagger.json "https://raw.githubusercontent.com/kubernetes/kubernetes/${K8S_VERSION}/api/openapi-spec/swagger.json"  && echo "${K8S_SPEC_SHA256}  /tmp/swagger.json" | sha256sum -c --quiet -  && python3 /tmp/k8s-schemas.py /tmp/swagger.json /out/schemas  && check() { /out/bin/kubeconform -strict -summary -schema-location '/out/schemas/{{ .ResourceKind }}{{ .KindSuffix }}.json' -; }  && echo '{"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "web", "creationTimestamp": null}, "spec": {"replicas": 2, "selector": {"matchLabels": {"app": "web"}}, "template": {"metadata": {"labels": {"app": "web"}}, "spec": {"containers": [{"name": "web", "image": "nginx", "ports": [{"containerPort": 80}], "resources": {"limits": {"cpu": "500m"}}}]}}}}' | check  && ! echo '{"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "web"}, "spec": {"replica": 2, "selector": {"matchLabels": {"app": "web"}}, "template": {"spec": {"containers": [{"name": "web", "image": "nginx"}]}}}}' | check  && rm -f /tmp/kubeconform.tgz /tmp/swagger.json

# The full image: every language the run plans know (apps/runner/src/plans.ts).
#   pnpm sandbox:build:full     (dev: tags codechatter-sandbox:full; point SANDBOX_IMAGE at it)
# Most toolchains come from Debian; apt downloads are cached between builds.
# Toolchains live under /usr, where the jail lets programs run.
FROM core AS full
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked     --mount=type=cache,target=/var/lib/apt/lists,sharing=locked     rm -f /etc/apt/apt.conf.d/docker-clean  && apt-get update  && apt-get install -y --no-install-recommends       golang-go rustc cargo ruby php-cli perl lua5.4 r-base-core       gfortran nasm fp-compiler fp-units-rtl gnucobol3 swi-prolog-nox sqlite3       ocaml-nox ghc elixir erlang-nox racket clojure       mono-mcs mono-runtime gdc gnat groovy crystal       curl unzip
COPY --from=kotlin /out/kotlinc /usr/local/lib/kotlinc
COPY --from=k8s /out/k8s /usr/local/lib/k8s
RUN ln -s ../lib/kotlinc/bin/kotlinc /usr/local/bin/kotlinc  && ln -s ../lib/k8s/kubectl ../lib/k8s/helm ../lib/k8s/kwokctl /usr/local/bin/
COPY --chmod=755 image/k8s /usr/local/bin/k8s
COPY image/kwok.yaml /usr/local/lib/k8s/kwok.yaml
COPY --from=kubeschemas /out/bin/kubeconform /usr/local/bin/kubeconform
COPY --from=kubeschemas /out/schemas /usr/local/share/kubernetes-schemas
COPY --from=java /out/jdtls /usr/local/lib/jdtls
COPY --from=java /out/google-java-format.jar /usr/local/lib/google-java-format.jar
COPY --from=java /out/java-debug /usr/local/lib/java-debug
COPY --chmod=755 image/jdtls image/google-java-format /usr/local/bin/
# rustfmt for Format document (gofmt comes with Go), the language servers for C and C++,
# Go and Rust (apps/runner/src/lsp.ts; rust-src lets rust-analyzer read the standard library),
# and Delve, Go's debugger (apps/runner/src/debug.ts); a layer of their own, so the big one stays cached.
# Java 25's runtime is only for JDT LS (image/jdtls), which needs it: rooms' `java` stays 21.
# Maven builds Java projects (the Spring Boot template); its settings send it through the room's package proxy.
# Composer and the PHP extensions Laravel needs (the Laravel template); Composer reads HTTPS_PROXY.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked     --mount=type=cache,target=/var/lib/apt/lists,sharing=locked     apt-get update  && apt-get install -y --no-install-recommends rustfmt clangd gopls rust-analyzer rust-src delve openjdk-25-jre-headless maven composer php-mbstring php-xml php-curl php-sqlite3 php-zip php-bcmath php-intl  && update-alternatives --set java /usr/lib/jvm/java-21-openjdk-amd64/bin/java  && java -version 2>&1 | grep -q '"21'
COPY image/maven-settings.xml /etc/maven/settings.xml
COPY --from=formatters /out/ /usr/local/bin/
COPY --from=lsp /out/ /usr/local/
COPY --from=jsdebug /out/js-debug /usr/local/lib/js-debug
COPY image/js-debug-bridge.mjs /usr/local/lib/codechatter/js-debug-bridge.mjs
COPY --from=duckdb /out/ /usr/local/lib/python3.13/dist-packages/
COPY --from=jail /cc-jail /usr/local/bin/cc-jail
COPY --from=agent /out/ /opt/ccagent/
# Marks it, so a rebuild can remove the copy it replaces (pnpm docker:tidy).
LABEL codechatter.sandbox=1
USER 10002
