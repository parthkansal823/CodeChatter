# syntax=docker/dockerfile:1.7
#
# Every v2 service image from one Dockerfile (build context: repo root).
# The workspace is installed and built once; each target then copies only
# what its service needs:
#
#   web      Next.js standalone server          :3000
#   api      NestJS (REST, auth, Socket.IO)     :4000
#   collab   Hocuspocus document server         :4100
#   runner   sandbox manager (needs the Docker socket) :4200
#   migrate  applies Drizzle migrations, then exits
#
# The sandbox image itself is built from sandbox/image/Dockerfile.
#
# infra/compose.yaml builds all four; to build one by hand:
#   docker build -f infra/docker/app.Dockerfile --target api -t codechatter-api .

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
WORKDIR /repo
# pnpm at the exact version the repo pins in package.json "packageManager".
COPY package.json ./
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")"

# Download every dependency from the lockfile alone, so this layer is reused
# until pnpm-lock.yaml changes (source edits don't re-download anything).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build \
      --filter=@codechatter/web --filter=@codechatter/api \
      --filter=@codechatter/collab --filter=@codechatter/runner --filter=@codechatter/db
# Self-contained production folders: the app, its prod dependencies, and the
# built workspace packages it uses (each package's "files" decides what ships).
RUN pnpm --filter=@codechatter/api deploy --prod /out/api \
 && pnpm --filter=@codechatter/collab deploy --prod /out/collab \
 && pnpm --filter=@codechatter/runner deploy --prod /out/runner \
 && pnpm --filter=@codechatter/db deploy --prod /out/db

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS web
# Next binds to $HOSTNAME, which Docker sets to the container id by default.
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS collab
COPY --from=build --chown=node:node /out/collab ./
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS runner
COPY --from=build --chown=node:node /out/runner ./
# The runner talks to the Docker socket, which only root can open on most
# hosts. It is the one service with that access and it is never exposed:
# only the API reaches it, on the private network, with signed tokens.
USER root
EXPOSE 4200
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4200/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS migrate
COPY --from=build --chown=node:node /out/db ./
CMD ["node", "dist/migrate.js"]
