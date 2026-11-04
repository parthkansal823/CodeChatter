# Task for ChatGPT: Prometheus metrics and Grafana dashboards for CodeChatter

You are helping build **CodeChatter v2**, a real-time collaborative IDE made of four Node services. Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

Your job is the metrics part of the roadmap item "**Operations:** OpenTelemetry traces, Prometheus metrics, dashboards, and nightly backups." Each service exposes **Prometheus metrics**, and the repo gets **Grafana dashboards** and a dev setup to see them. Traces and backups are not part of this task.

## The services (all TypeScript ESM on Node 24, run with `pnpm dev`)

| Service | Path | Port | How it serves HTTP |
|---|---|---|---|
| api | `apps/api` | 4000 | NestJS 12 on Express (`apps/api/src/main.ts`). Routes are under `/api` (a global prefix); Socket.IO at `/socket.io`; WebSocket proxies at `/ws/*` |
| collab | `apps/collab` | 4100 | Hocuspocus 4 `Server` (`apps/collab/src/main.ts`), with extensions in `apps/collab/src/extensions/`. A Hocuspocus extension can answer plain HTTP with an `onRequest({ request, response })` hook (resolve or reject to pass it on) |
| runner | `apps/runner` | 4200 | `node:http` `createServer` in `apps/runner/src/server.ts`. It's never reachable from browsers: only the API calls it, with service tokens |
| web | `apps/web` | 3000 | Next.js 16: no metrics needed |

In development **Caddy** (`infra/caddy/Caddyfile.dev`) puts everything on `http://localhost:8080`:
- `/api/*`, `/socket.io/*` and `/ws/*` go to the API;
- `/collab*` goes to collab, with the prefix stripped;
- the rest goes to web.

**`/metrics` must never be public.** Serve it on each service's own port at `/metrics`, never behind Caddy, and require `Authorization: Bearer <METRICS_TOKEN>` when the env var `METRICS_TOKEN` is set. In development, with it unset, allow requests from 127.0.0.1 only. For the API, make sure `/metrics` is outside the `/api` prefix (Caddy only forwards `/api/*` to it) and outside the global auth guard.

Use **`prom-client`** (the standard library; the owner adds it: give the exact `pnpm --filter <pkg> add prom-client@<version>` commands for api, collab and runner). Each service gets a `metrics.ts` that makes one `Registry`, calls `collectDefaultMetrics({ register, prefix: "codechatter_" })`, and exports the service's own metrics.

## What to measure

- **API:**
  - `codechatter_http_requests_total{method, route, status}` and `codechatter_http_request_duration_seconds{method, route}` (a histogram, buckets from 5 ms to 10 s). Take `route` from the matched route pattern, for example `/api/rooms/:id`, **never** the raw URL (room codes and ids would explode the label count). Use a Nest interceptor or Express middleware that reads `req.route?.path`, or Nest's matched handler.
  - `codechatter_socketio_connections` (gauge) and `codechatter_chat_messages_total`. The gateway is `apps/api/src/realtime/events.gateway.ts`; increment there with one added line.
  - `codechatter_ai_requests_total{provider, outcome}`, if you can do it in one place in `apps/api/src/ai/` without restructuring; skip it otherwise, and say so.
- **Collab:**
  - `codechatter_collab_connections` (gauge) and `codechatter_collab_documents_loaded` (gauge);
  - `codechatter_collab_updates_total` and `codechatter_collab_update_bytes_total`;
  - `codechatter_collab_store_duration_seconds` (a histogram of `onStoreDocument`).

  Do all of it in one new extension, `apps/collab/src/extensions/metrics.ts`, added to the `extensions` list in `main.ts`, so the other extensions stay untouched. It also answers `/metrics` through `onRequest`.
- **Runner:**
  - `codechatter_runner_runs_total{language, outcome}` and `codechatter_runner_run_duration_seconds{language}`;
  - `codechatter_runner_sandboxes` (gauge: running containers);
  - `codechatter_runner_terminals` (gauge).

  Read `apps/runner/src/server.ts` and the run code to find the one place each happens. If a metric would need deep changes, leave it out and say which. Serve `/metrics` from the same `createServer` handler, before the service-token check.

## Dashboards and the dev setup

- **`infra/grafana/dashboards/codechatter.json`:** a Grafana dashboard (schema version 39 or so, datasource uid `prometheus`) with rows for:
  - the API: request rate by route, p95 latency by route, the 5xx rate, Socket.IO connections;
  - collab: connections, documents, updates per second, the store time's p95;
  - the runner: runs per minute by language, failure rate, p95 run time, sandboxes;
  - Node (each service): event-loop lag, heap, CPU.
- **`infra/compose.metrics.yaml`:** an **optional** compose file the owner can start next to the dev stack: `docker compose -f infra/compose.metrics.yaml up -d`.
  - It runs Prometheus (`prom/prometheus`, a pinned recent version), scraping the three services on the host through `host.docker.internal:4000`, `:4100` and `:4200` with `extra_hosts: ["host.docker.internal:host-gateway"]`.
  - It runs Grafana (`grafana/grafana`, pinned), with the datasource and the dashboard provisioned from `infra/grafana/provisioning/`, anonymous viewer access in dev, on port 3300.
  - In dev, the services see Prometheus's requests coming from the Docker host gateway, not 127.0.0.1. So either set `METRICS_TOKEN` for both (a dev value in the compose file and in `.env.example`), or allow private addresses in dev. Choose one, say which and why.
- **`docs/metrics.md`:** what each metric means, how to start the dev Prometheus and Grafana, how production should scrape (the token, the internal network only), and three starter alert rules, in Prometheus rule syntax, in `infra/prometheus/alerts.yml`:
  - API 5xx rate over 5% for 5 minutes;
  - collab store p95 over 1 s;
  - the runner's run failure rate over 50% for 10 minutes.

## Rules

- Keep each service's changes small: a `metrics.ts`, and one-line hooks where events happen. Don't restructure modules.
- Comments in plain English, and a doc comment at the top of each new file.
- Never put user content (room codes, file paths, user ids, emails) in label values.
- Add `METRICS_TOKEN` (optional) to each service's env schema:
  - API: `apps/api/src/config/env.ts`, a zod object;
  - collab: `apps/collab/src/env.ts`;
  - runner: `apps/runner/src/env.ts`.
  - Document it in `.env.example`.

## Files you may touch

- `apps/api/src/metrics/*` (new), `apps/api/src/main.ts`, `apps/api/src/app.module.ts` (register an interceptor or middleware), `apps/api/src/realtime/events.gateway.ts` (one-line increments), `apps/api/src/config/env.ts`
- `apps/collab/src/extensions/metrics.ts` (new), `apps/collab/src/main.ts` (add the extension), `apps/collab/src/env.ts`
- `apps/runner/src/metrics.ts` (new), `apps/runner/src/server.ts` and the run code (one-line hooks), `apps/runner/src/env.ts`
- `infra/compose.metrics.yaml`, `infra/grafana/**`, `infra/prometheus/**` (new)
- `docs/metrics.md` (new), `.env.example`

## How to answer

1. The `pnpm add` commands for `prom-client`.
2. Each new file in full, and each edit as a unified diff with enough context.
3. How the owner checks it:
   - `pnpm --filter @codechatter/api typecheck`, `pnpm --filter @codechatter/collab typecheck` and `pnpm --filter @codechatter/runner typecheck`;
   - `curl -s localhost:4000/metrics | grep codechatter_` (and the same on 4100 and 4200), and the same request through Caddy (`localhost:8080/metrics`) must **not** return metrics;
   - start `infra/compose.metrics.yaml` and open Grafana on http://localhost:3300.
4. Which metrics you left out and why.
