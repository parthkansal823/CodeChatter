<!-- Explain the private service metrics and the optional local monitoring stack so operators can use them safely. -->
# Prometheus metrics

The API, collab and runner each expose `GET /metrics` on their own HTTP port: 4000, 4100 and 4200. `HEAD` is also supported. The endpoint is outside the API's `/api` prefix and auth guard, and outside the runner's service-token guard. The web service has no metrics endpoint. Each service has one independent `prom-client` Registry with default Node/process metrics prefixed `codechatter_`.

These are **direct, private service endpoints**. A configured `METRICS_TOKEN` requires an exact `Authorization: Bearer <token>` header, including in development and from loopback. Without a token, only TCP loopback (`127.0.0.1`, its IPv4-mapped address, or `::1`) may scrape in development/test; production denies access without a token. The handlers reject forwarding headers even when the token is correct. This also blocks Caddy's stripped `/collab/metrics` route. Never add `/metrics` to Caddy or another public proxy.

## Development

The owner installs the only additional dependency, pinned to the same version in each service:

```powershell
corepack pnpm --filter @codechatter/api add prom-client@15.1.3
corepack pnpm --filter @codechatter/collab add prom-client@15.1.3
corepack pnpm --filter @codechatter/runner add prom-client@15.1.3
```

Copy the following settings into your local root `.env` if enabling the optional Docker scrapers:

```dotenv
METRICS_TOKEN=codechatter-dev-metrics
```

The public development token is also in `.env.example` and the Compose `metrics-token` config. Prometheus reads it through a mounted credentials file; it is not a dashboard label. Docker requests arrive from the host gateway, so TCP loopback access alone cannot work. Token authentication avoids granting access to an entire private IP range.

Keep the existing service listener bindings, including the runner's development loopback default. Docker Desktop supplies host-service forwarding through `host.docker.internal`; this setup does not require widening the runner listener. The token does not replace network isolation. If the shared app stack is already running, have its owner restart that same stack after updating the token; do not launch a second stack.

From the repository root, start only the additional monitoring services:

```powershell
docker compose -f infra/compose.metrics.yaml up -d
```

Docker Compose 2.23.1 or newer is required for the inline development token config. Prometheus is pinned to `prom/prometheus:v3.15.1`; Grafana to `grafana/grafana:13.3.0`. This is a separate Compose project, `codechatter-metrics`, with seven days / 2 GB of Prometheus retention and persistent data volumes.

Open [Grafana](http://localhost:3300/d/codechatter) and select **CodeChatter services** in the **CodeChatter** folder if needed. The provisioned datasource has UID `prometheus`; anonymous users have Viewer access. Both Grafana (3300) and [Prometheus](http://localhost:9090/targets) bind only to `127.0.0.1`. Check that all three scrape jobs are **UP**. Initial counters and histograms can show no data until the relevant activity occurs; rates need at least two scrapes. The dashboard refreshes every 15 seconds.

Check types and private endpoints:

```powershell
corepack pnpm --filter @codechatter/api typecheck
corepack pnpm --filter @codechatter/collab typecheck
corepack pnpm --filter @codechatter/runner typecheck

curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:4000/metrics | Select-String codechatter_
curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:4100/metrics | Select-String codechatter_
curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:4200/metrics | Select-String codechatter_
```

With that dev token configured, the same direct request without the header, or with a wrong token, must return 401. `POST /metrics` with the correct token must return 405. Through Caddy, each of the following must return **no Prometheus metrics**, even with the valid token:

```powershell
curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:8080/metrics
curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:8080/api/metrics
curl.exe -sS -H "Authorization: Bearer codechatter-dev-metrics" http://localhost:8080/collab/metrics
```

The first routes to web, the second is not the private API endpoint, and the collab path is rejected because Caddy adds forwarding headers. An individual app route's normal HTML/404/auth response is acceptable; the Prometheus metric exposition is not. A direct request carrying `Forwarded` or `X-Forwarded-*` must also be rejected.

If a target is DOWN, check that its dependency is installed, its shared dev process is running, the token matches, and Docker Desktop can reach its host listener. Native Linux's `host-gateway` mapping does not itself forward a loopback-only host listener: this optional Compose setup then needs a monitoring-network adaptation, such as host networking for the scraper, that preserves the app's existing bindings. That native Linux adaptation is not provided here. Do not expose a service through Caddy or widen the runner listener just to enable monitoring.

To stop only monitoring, preserving the shared application stack and monitoring data:

```powershell
docker compose -f infra/compose.metrics.yaml down
```

## Application metrics

No metric has room codes, document names, file paths, user IDs, emails or request bodies as label values. The Prometheus `job` label is the bounded service name (`api`, `collab`, `runner`), while `instance` is its configured private scrape address. Registries are process-local: counters reset on restart and Prometheus `rate()` handles those resets.

| Metric | Meaning and labels |
| --- | --- |
| `codechatter_http_requests_total{method,route,status}` | API HTTP requests counted once when the response finishes or the connection closes. The route is the matched Express pattern, never the URL; requests without one share `unmatched`. Methods and status values are bounded. The private scrape handler and WebSocket frames are excluded. |
| `codechatter_http_request_duration_seconds{method,route}` | API response duration histogram in seconds; buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 and the automatic `+Inf`. |
| `codechatter_socketio_connections` | Current accepted default-namespace Socket.IO sockets per API process, collected from the namespace map rather than increments/decrements. |
| `codechatter_chat_messages_total` | Successfully accepted Socket.IO `chat:send` calls. Rejected validation, permission failures and failed writes do not increment it. An idempotent retry accepted by `MessagesService.create` counts again; server-posted integration messages are excluded. |
| `codechatter_collab_connections` | Current collab sockets deduplicated across documents in a process, plus direct connections. Summing replicas is a connection count, not unique people. |
| `codechatter_collab_documents_loaded` | Fully loaded documents held by each process. The same document can be loaded on several replicas. |
| `codechatter_collab_updates_total` | Yjs updates applied to this process, including replicated updates; not unique human edits. |
| `codechatter_collab_update_bytes_total` | Bytes in those applied update payloads. |
| `codechatter_collab_store_duration_seconds` | Successful `onStoreDocument` hook chains, including Redis locking and persistence, using the API histogram's buckets. Skipped/failed store chains do not produce a latency sample. |
| `codechatter_runner_runs_total{language,outcome}` | Started Run executions, counted once on completion. Language comes from the supported language map, with a fixed `unknown` fallback. Outcomes: `success`, `error`, `timeout`, `stopped`, `output-limit`, `reset`. Preparation failures, judge jobs and arbitrary terminal commands are excluded. |
| `codechatter_runner_run_duration_seconds{language}` | Completed Run execution duration, excluding synchronization/preparation/startup. Buckets extend through 30, 60, 300 and 1800 seconds beyond the API buckets. |
| `codechatter_runner_sandboxes` | Running managed room sandbox containers (Docker or Kubernetes). Warm containers, database and egress containers are excluded. Inventory errors/timeouts yield `NaN`, not an inaccurate zero. |
| `codechatter_runner_terminals` | Authenticated attached terminal WebSocket clients, including terminal startup; detached tmux shells are excluded. |

The optional AI request counter was omitted. Reliable provider/outcome instrumentation would need edits in `apps/api/src/ai/`, outside the permitted files, and streaming failures cannot reliably be inferred from HTTP status alone. No required metric was intentionally omitted.

## Dashboard and alerts

The checked-in dashboard has API, collab, runner and Node rows. Node panels show `codechatter_nodejs_eventloop_lag_p99_seconds`, `codechatter_nodejs_heap_size_used_bytes` and the rate of `codechatter_process_cpu_seconds_total`, grouped by scrape job. CPU 100% means one core; it can exceed 100%. p95 values are histogram estimates, not exact percentiles. API's ten-second upper finite bucket limits the estimate for slower responses.

Prometheus loads `infra/prometheus/alerts.yml`:

| Alert | Condition |
| --- | --- |
| `CodeChatterApiHighErrorRate` | API 5xx responses / all API HTTP requests is greater than 5% for five minutes. |
| `CodeChatterCollabSlowStore` | The p95 of successful collab store duration is greater than one second for five minutes. |
| `CodeChatterRunnerHighFailureRate` | Failed completed Runs / all completed started Runs is greater than 50% for ten minutes. Errors, timeouts, output limits and resets are failures; user stops are in the denominator but not the numerator. |

Rates use five-minute windows and aggregate across replicas. Zero traffic does not produce ratio alerts. A small number of requests can still cross a threshold; choose minimum traffic criteria for your workload. Missing targets need a separate `up == 0` availability alert. Alerts are visible in Prometheus; this dev setup has no Alertmanager and sends no notifications.

Validate syntax and the threshold/pending-period tests using the running monitoring container:

```powershell
docker compose -f infra/compose.metrics.yaml exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose -f infra/compose.metrics.yaml exec prometheus promtool check rules /etc/prometheus/alerts.yml
docker run --rm --entrypoint promtool --mount "type=bind,source=$($PWD.Path)/infra/prometheus,target=/rules,readonly" --workdir /rules prom/prometheus:v3.15.1 test rules alerts.test.yml
```

## Production

Do not deploy the anonymous development Compose file in production. Keep all three service ports on an internal network, inaccessible to browsers and the public Internet. Generate a unique random token in your secret manager, set it as `METRICS_TOKEN` for the three services, and mount it as a read-only credentials file in the private Prometheus scraper. Do not put the production token in this repository, URLs, shell history, dashboards or labels.

Use the same `authorization: { type: Bearer, credentials_file: /run/secrets/codechatter_metrics_token }` structure as the development scrape jobs, replacing targets with the services' private DNS addresses and ports. Scrape the services directly, without a reverse proxy that adds forwarding headers. Use TLS if the private network is not trusted. Allow ingress to the service ports only from the app's required peers and monitoring network; a bearer token does not make a public endpoint private. API auth and runner service tokens still protect their separate application routes.

Authenticate Grafana users, keep Prometheus private, and connect Alertmanager before relying on alerts for operations. Metrics contain process/route information even without user labels. Restrict access accordingly. Token rotation requires updating the service environment, restarting the same service processes, and updating the scraper's mounted secret. Counters and gauges are rebuilt from the new process; persistent Prometheus history remains available.

Future work, separate from this task: store failure counters, preparation failure counters, unique accepted chat message counts, availability/minimum-volume alerts, Alertmanager routing, and production monitoring deployment. Traces and backups are separate roadmap work.
