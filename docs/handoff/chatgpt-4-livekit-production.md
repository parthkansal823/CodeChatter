# Task for ChatGPT: calls (LiveKit) and a TURN server in CodeChatter's production setup

You are helping build **CodeChatter v2**, a real-time collaborative IDE (shared editor, a Docker sandbox per room, chat). Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself: give files, never commands that commit.

Your job: video and voice calls already work **in development**. Make them work in the two **production** setups too: Docker Compose (one server), and the Helm chart (Kubernetes). That includes a **TURN** server, so people behind strict networks (corporate firewalls, some mobile carriers) can still connect.

## What exists (development)

- **LiveKit server 1.13.11** runs in `infra/compose.dev.yaml`:

  ```yaml
  livekit:
    image: livekit/livekit-server:v1.13.11
    command: --config /etc/livekit.yaml
    ports: ["7880:7880", "7881:7881", "7882:7882/udp"]
    volumes: ["./livekit/livekit.dev.yaml:/etc/livekit.yaml:ro"]
  ```

- **Its config** is `infra/livekit/livekit.dev.yaml`:

  ```yaml
  port: 7880
  rtc:
    tcp_port: 7881
    udp_port: 7882        # one UDP port, muxed
    use_external_ip: false
    node_ip: 127.0.0.1
  keys:
    codechatter-dev: codechatter-dev-livekit-secret-not-for-production
  logging:
    level: info
  ```

- **Caddy** (`infra/caddy/Caddyfile.dev`) forwards the browser's signalling, with the prefix stripped:

  ```
  handle_path /livekit* {
  	reverse_proxy livekit:7880
  }
  ```

  Media doesn't go through Caddy: it goes straight to UDP 7882 (or TCP 7881).
- **The API** (`apps/api/src/calls/calls.controller.ts`) gives browsers `{ url, token, room }` at `POST /api/rooms/:id/call`. It reads three environment variables:
  - `LIVEKIT_URL`: the address browsers reach LiveKit at, for example `wss://example.com/livekit`;
  - `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`: the key pair in LiveKit's `keys:`, which tokens are signed with (HS256 JWT).

  In development they default to the dev values. **In production, calls are off until all three are set.**
- **The browser** uses `livekit-client` 2.23 and connects to `LIVEKIT_URL`.

## The production setup today

- **`infra/compose.yaml`** has the services `caddy` (ports `80:80`, `443:443`, `443:443/udp`, env `DOMAIN` and `ACME_EMAIL`), `web`, `api`, `collab`, `runner`, `sandbox-image`, `migrate`, `postgres` and `valkey`.
  - It uses YAML anchors: `<<: *app` for the app services, and `<<: *server-env` for shared environment.
  - The `api` service's environment is a list like `SMTP_HOST: ${SMTP_HOST:?set SMTP_HOST}`, with optional values written `${NAME:-}`.
- **`infra/caddy/Caddyfile`** serves `{$DOMAIN}` with automatic HTTPS:
  - `handle /api/*`, `/socket.io/*` and `/ws/*` go to `api:4000`;
  - `handle_path /collab*` goes to `collab:4100`;
  - everything else goes to `web:3000`;
  - it already sends `Permissions-Policy "camera=(self), microphone=(self), display-capture=(self), geolocation=()"`.
- **Production environment** is documented in `docs/deploy.md` and in the root `.env.example` (a block for LiveKit is already there, commented out).
- **The Helm chart** is `infra/helm/codechatter/`:
  - templates: `apps.yaml`, `data.yaml`, `edge.yaml` (the Caddy edge), `runner.yaml`, `secret.yaml`, `seed.yaml`, `_helpers.tpl`, `NOTES.txt`;
  - top-level `values.yaml` keys: `url`, `previewOrigin`, `images`, `edge`, `web`, `api`, `collab`, `runner`, `postgres`, `valkey`, `mail`, `seed`, `ai`, `secrets`, `storageClass`;
  - its README is `infra/helm/codechatter/README.md`, and its demo runs on Docker Desktop's Kubernetes at `http://localhost:8090`.
  - **Read those files first**, and follow their style exactly: helper names, how secrets are made, labels, comments.

## What to build

1. **Compose (`infra/compose.yaml`).**
   - A `livekit` service: the same image, `restart: unless-stopped`, its config from `infra/livekit/livekit.yaml` (new).
   - Ports: `7881/tcp` and `7882/udp` published on the host for media; 7880 stays internal (Caddy reaches it).
   - Its key and secret come from env `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, through LiveKit's `LIVEKIT_KEYS` environment variable (`"key: secret"`), so the config file holds none.
   - Set `rtc.use_external_ip: true` (it finds the server's public IP) and `node_ip` empty.
   - Pass `LIVEKIT_URL` (default `wss://${DOMAIN}/livekit`), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the `api` service.
2. **TURN.**
   - Use LiveKit's **built-in TURN** (`turn.enabled: true`), on TLS port 5349 with the certificate Caddy obtained, or on UDP 3478. Choose the simplest that works with Caddy holding the certificates, and say why. If sharing Caddy's certificate is awkward, `turn.udp_port: 3478` without TLS is acceptable for a first version; say so.
   - Publish its port(s) in compose, and document which firewall ports the server must open: 80, 443, 443/udp, 7881/tcp, 7882/udp and the TURN port.
3. **Caddy (`infra/caddy/Caddyfile`):** `handle_path /livekit* { reverse_proxy livekit:7880 }`, before the final `handle`.
4. **Helm:**
   - A `livekit` section in `values.yaml` (enabled by default, image, resources, the service type for media: `LoadBalancer` or `NodePort`, with a comment on the trade-off), and a new template `livekit.yaml` (Deployment, Service, ConfigMap for the config).
   - The key and secret in the chart's existing secret (generated the way the chart makes its other secrets).
   - The edge routes `/livekit` the same way as in Caddy.
   - The API gets the three variables.
   - Explain in the chart README how media reaches the pod (UDP through a LoadBalancer, or a NodePort on the node), and what to set on Docker Desktop's demo. For the demo, `node_ip` 127.0.0.1 with a NodePort mapped to 7882 is fine; say which ports to forward.
5. **Docs:**
   - **`docs/deploy.md`:** a "Calls (video and voice)" section: what to set, the ports to open, how to check it (`curl https://DOMAIN/livekit/` should answer `OK`), and what people see when calls are off.
   - **`.env.example`:** fill in the commented LiveKit block with production values and comments.

## Files you may touch

- `infra/compose.yaml`, `infra/caddy/Caddyfile`, `infra/livekit/livekit.yaml` (new)
- `infra/helm/codechatter/values.yaml`, `infra/helm/codechatter/templates/livekit.yaml` (new), `infra/helm/codechatter/templates/edge.yaml`, `infra/helm/codechatter/templates/apps.yaml` (the API's env only), `infra/helm/codechatter/templates/secret.yaml`, `infra/helm/codechatter/README.md`
- `docs/deploy.md`, `.env.example`

Don't change any application code; the API already reads the three variables.

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context to apply.
2. How the owner checks it:
   - `docker compose -f infra/compose.yaml config` (it must render without errors);
   - `helm lint infra/helm/codechatter` and `helm template infra/helm/codechatter | less`;
   - in the Kubernetes demo, `curl http://localhost:8090/livekit/` answers `OK`;
   - two browsers can call each other in a room (the Call button in the title bar).
3. What you weren't sure of (LiveKit config keys for TURN and certificates, how the chart generates secrets), so the owner knows where to look.
