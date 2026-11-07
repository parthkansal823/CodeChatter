# Deploying CodeChatter v2

CodeChatter runs as a small set of containers on **one Linux server with Docker**.
Caddy sits in front, gets an HTTPS certificate for your domain automatically, and
puts everything on one origin, just like `http://localhost:8080` in development.

```
Internet ──443──► caddy ─┬─ /                   → web     (Next.js)
                         ├─ /api /socket.io /ws → api     (NestJS)
                         └─ /collab             → collab  (Hocuspocus)
                  api, collab ──► postgres 18 · valkey 9     (private network only)
```

Files: [`infra/compose.yaml`](../infra/compose.yaml), [`infra/docker/app.Dockerfile`](../infra/docker/app.Dockerfile),
[`infra/caddy/Caddyfile`](../infra/caddy/Caddyfile), [`infra/.env.production.example`](../infra/.env.production.example).

## Why one server and not Vercel

- Rooms keep long-lived WebSockets open (live editing, chat). Serverless platforms close them.
- Run and the terminal (next phase) start a sandbox container per room, so the host needs Docker.
- Login cookies and every socket rely on one shared origin. Splitting web and API across providers breaks that.

Any VM works: Hetzner, DigitalOcean, AWS Lightsail/EC2, Azure, GCP.
Start with **2 vCPU, 4 GB RAM, 40 GB disk, Ubuntu 24.04**. It builds the images and runs a team comfortably.

## First deploy

1. **Server and domain.** Create the VM. Add a DNS `A` record for your domain (for example `code.yourname.dev`) pointing at the server's IP. Wait until `ping code.yourname.dev` shows that IP.
2. **Firewall.** Allow inbound TCP 22, 80, 443 and 7881, and UDP 443, 7882 and 3478, both in the provider's firewall and in `ufw` if it is on. Caddy needs port 80 to get the certificate; calls need the direct media/TURN ports described below.
3. **Docker.**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # log out and back in
   ```
4. **Code and settings.**
   ```bash
   git clone <your repo url> codechatter && cd codechatter
   cp infra/.env.production.example infra/.env.production
   openssl rand -hex 32            # use separate generated values for each secret
   nano infra/.env.production      # fill in every value
   ```
   Add the LiveKit settings from **Calls (video and voice)** below; Compose requires its production key and secret too.
5. **Start.**
   ```bash
   alias dc='docker compose --env-file infra/.env.production -f infra/compose.yaml'
   dc up -d --build
   dc ps                           # app services healthy, LiveKit running; "migrate" exited 0
   curl https://code.yourname.dev/api/readyz
   ```
   The first build takes about 5–10 minutes. Then open `https://<DOMAIN>` and sign up. The verification email uses your SMTP settings.
6. **Warm the templates (optional).** Rooms made from a framework template then start in seconds, with nothing to download and no "Allow installs" step. It installs each template's packages once, in a clean container, into a volume every sandbox reads (never writes). It needs Node 24 and pnpm on the server; run it again after rebuilding the sandbox image:
   ```bash
   pnpm --filter @codechatter/runner exec tsx --env-file=../../infra/.env.production scripts/warm.ts
   ```
7. **Sign-in providers (optional).** Add these redirect URLs, then set the client id and secret in `.env.production` and run `dc up -d`:
   - Google Cloud Console → Credentials → your OAuth client: `https://<DOMAIN>/api/auth/callback/google`
   - GitHub → Settings → Developer settings → OAuth Apps: `https://<DOMAIN>/api/auth/callback/github`

## Calls (video and voice)

Production uses LiveKit `v1.13.11`, direct media, TURN/UDP, and TURN/TLS on public
TCP 443. Caddy keeps the website on that same port: its layer-4 listener wrapper
matches the TURN hostname by TLS SNI, terminates its TLS and forwards the stream
to LiveKit. Other connections continue through the existing HTTPS routes.
`infra/docker/caddy.Dockerfile` builds Caddy 2.11 with caddy-l4 pinned to commit
`8e984fe3cfd65719a13339ded5a91b48e6d0cf7e`; the standard image lacks this module.

Add an A record for **`turn.<DOMAIN>` to the website server's IP**. Add AAAA only
if IPv6 reaches it too. Use a DNS-only record, not a generic HTTP/CDN proxy.
Both names need public 80/443 reachability for Caddy's certificate issuance and
renewal. Caddy manages both certificates; no certificate files go into LiveKit.

Set these in `infra/.env.production`:

```dotenv
LIVEKIT_URL=wss://code.example.com/livekit
LIVEKIT_API_KEY=codechatter-production
LIVEKIT_API_SECRET=replace-with-a-separate-generated-secret
# Optional; defaults to turn.${DOMAIN}. Keep it distinct from DOMAIN.
TURN_DOMAIN=turn.code.example.com
```

Generate a separate secret and keep key/secret on one line. Compose sets
`LIVEKIT_KEYS` and the same TURN hostname in both services. LiveKit receives
`LIVEKIT_TURN_DOMAIN` through its pinned version's generated environment flag;
YAML does not expand variables. `LIVEKIT_URL` defaults to `wss://${DOMAIN}/livekit`.
The production API does not issue call tokens with missing LiveKit settings.

Caddy sends PROXYv2 with the decrypted stream, preserving the client's address.
LiveKit trusts only Caddy's fixed 172.30.250.2/32 on the dedicated `turn-proxy`
network. Its internal 5349 listener uses `external_tls: true`, while browsers are
given **`turns:turn.<DOMAIN>:443?transport=tcp`**. Host 5349 is not published. If the
172.30.250.0/29 subnet overlaps your network, change its subnet and Caddy address
in Compose and the matching trusted /32 in `infra/livekit/livekit.yaml` together.

| Public port | Purpose |
| --- | --- |
| TCP 80 | Certificate validation and HTTPS redirect |
| TCP 443 | Website HTTPS/WSS and TURN/TLS, selected by hostname |
| UDP 443 | Website HTTP/3 |
| TCP 7881 | Direct WebRTC TCP fallback |
| UDP 7882 | Direct media |
| UDP 3478 | Existing TURN/UDP |

Keep NAT mappings one-to-one. LiveKit discovers its public media IP; it must be
reachable. Embedded relay allocation sockets remain inside the container; do not
publish internal 30000?40000. A private media IP may need an explicit exact SFU
/32 in `turn.allow_restricted_peer_cidrs`, never whole private ranges. Test the
relay/hairpin path from outside.

Validate with test env values, then update during maintenance because replacing
LiveKit interrupts active calls:

```sh
docker compose --env-file /path/to/test.env -f infra/compose.yaml config --quiet
docker build -f infra/docker/caddy.Dockerfile -t codechatter-caddy:2.11-l4-8e984fe .
dc up -d --build caddy livekit
curl --fail https://code.example.com/livekit/    # OK: signalling only
openssl s_client -connect turn.code.example.com:443 -servername turn.code.example.com -verify_return_error </dev/null
```

The TLS check needs the correct TURN hostname and a trusted certificate chain.
It proves TLS, not authenticated media. `config` without `--quiet` prints resolved
secrets. Check startup/certificate errors in the Caddy and LiveKit logs.

For an **external relay check**, open `chrome://webrtc-internals` or
`edge://webrtc-internals`, then join a call in two browsers on different networks.
Repeat from an actual HTTPS-only network or a controlled client network allowing
DNS and outbound TCP 443 while blocking UDP and TCP 7881. A working fallback has a
selected/succeeded pair with local candidate `relay`, the TURN URL
`turns:turn.code.example.com:443?transport=tcp`, relay protocol TLS when reported,
and increasing media bytes/decoded video frames. Also share and stop a screen.
A direct call, TLS handshake, or UDP relay alone does not prove that path. Strict
HTTP CONNECT proxies or TLS inspection can still reject non-HTTP TURN traffic;
test the real policy rather than assuming that every TCP 443 network permits it.

### Development relay and screen-share tests

Development TURN/UDP is bound to **127.0.0.1:3478**, with loopback RTC candidates
and only peer 127.0.0.1/32 permitted. Check conflicts with
`ss -lunp '( sport = :3478 )'` on Linux or
`Get-NetUDPEndpoint -LocalPort 3478` in PowerShell. If occupied, change
`turn.udp_port` in the dev LiveKit YAML and both 3478 values in that service's dev
Compose mapping to the same unused port. Recreate only LiveKit:

```sh
docker compose -f infra/compose.dev.yaml up -d --no-deps --force-recreate livekit
cd apps/web
node test/call-relay.e2e.mjs
node test/call-screen-share.e2e.mjs
node test/call.e2e.mjs
```

`?callRelay=1` sets `iceTransportPolicy: relay` only in non-production builds.
Production ignores it. Tests inject a wrapper around the public browser peer
connection API; no app hook exposes room objects, tokens, addresses or ICE secrets.
The relay test requires selected relays, media bytes and increasing decoded
frames, then proves removal of TURN prevents a call. Screen-share tests use Edge
automatic tab selection and verify remote frames and tile removal. These local
UDP checks are separate from the external TURN/TLS check above.

For Kubernetes certificates, the dedicated TURN 443 LoadBalancer, external TLS
termination and renewal, see the [chart README](../infra/helm/codechatter/README.md).

## Updating

```bash
git pull
dc up -d --build        # rebuilds changed images; migrations run automatically
docker image prune -f   # reclaim space from old images
```

## Day to day

| Task | Command |
|---|---|
| Logs | `dc logs -f api` (or `web`, `collab`, `caddy`) |
| Restart one service | `dc restart api` |
| Database shell | `dc exec postgres psql -U codechatter` |
| Backup now | `dc run --rm --no-deps backup now` |
| Restore drill | Restore a completed archive into a scratch database; see **Backups** below |
| Stop everything | `dc down` (data stays in Docker volumes; `down -v` deletes it) |

**GitHub activity in chat** (a room's Source Control view → Activity in chat) needs GitHub to reach `APP_URL/api/github/webhooks/<room>`, so it works on a public address, not on localhost. Each delivery must be signed with the room's secret; nothing else is accepted on that path.

## Backups

Production Compose builds `infra/backup/Dockerfile`: PostgreSQL 18 client tools,
rclone **1.70.3** copied from its pinned official image, and time-zone data. The
`backup` service runs at **03:00 in `BACKUP_TZ`**, which defaults to UTC. Set an IANA
zone such as `Asia/Kolkata` to match the server's local clock. Archive names always
use UTC: `codechatter-YYYY-MM-DDTHHMMZ.dump`, with a matching `.dump.sha256`.

This backs up the database: accounts, organisations, rooms, persisted Yjs text
documents, checkpoints, chat, audit events and webhook configuration/deliveries.
Valkey sessions/caches and sandbox volumes are excluded; sandboxes are scratch
space. Binary room files and recordings live in the app's object store, outside
Postgres: these archives preserve their database references, not their object
payloads. Protect that separate bucket with its own versioning/replication policy.
This is a logical database backup, not continuous WAL archiving or point-in-time
recovery. Recovery may lose changes since the last successful nightly dump.
Keep matching production settings and encryption/authentication keys in a secure
secret manager separately; the dump does not back up `.env.production`, container
images or cluster-wide Postgres roles. A replacement server must recreate the
`codechatter` database owner and use the original app encryption keys.

The dump is written to a temporary filename, checked with `pg_restore --list`,
then published with its checksum. A shared volume lock prevents backup/restore
overlap. A failed dump, check, upload or prune exits non-zero. Logs end with
`backup ok: <file> <size> <duration>s` or `backup FAILED: <reason>` and never print
database passwords or S3 credentials.

### Off-server storage and retention

Add these to **`infra/.env.production`**, using a private bucket on a different
server or provider. These are separate from the app's `S3_*` settings:

```dotenv
BACKUP_TZ=UTC
BACKUP_S3_URL=s3://your-private-backups/codechatter
BACKUP_S3_ENDPOINT=https://s3.your-provider.example
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=replace-with-a-backup-only-access-key
BACKUP_S3_SECRET_KEY=replace-with-its-secret
BACKUP_S3_FORCE_PATH_STYLE=true
```

For AWS S3, leave the endpoint empty and use the bucket's region. For other
S3-compatible stores, use their endpoint and region. Grant list/get/put/delete
only for this dedicated backup prefix; deletion is needed for retention. Keep
the bucket private and use HTTPS. Server-side encryption and provider versioning
are additional bucket settings; account for retained versions in storage costs.

```sh
dc up -d --build backup
dc logs --tail=30 backup
```

For an immediate run when the scheduler is idle, use `dc run --rm --no-deps
backup now`. A second run in the same UTC minute is refused instead of
overwriting a completed archive. After fixing a failure, retry in a later minute.
The scheduler checks the local clock every 30 seconds, catches up once after
03:00 if it was down, and records each attempted calendar day before running.
It keeps running after a failed attempt; alert on `last-failure` and retry manually.
A skipped local hour during a time-zone change runs at the first observed time
after 03:00; repeated hours do not duplicate that day's scheduled attempt.

Without an S3 URL and credentials, archives stay on the `backups` Docker volume
at `/backups`; the log explicitly says they are **not off the server**. Local-only
storage does not protect against losing the host. The default retention is the
union of **7 daily, 4 Sunday and 6 first-of-month backups**, applied independently
to local and S3 inventories. Override `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY` and
`BACKUP_KEEP_MONTHLY` if needed. A backup can satisfy more than one category.
The current run and newest timestamp are protected even after a clock rollback;
this can retain an extra archive. Each deletion is logged. Use one deployment
as the writer of a given S3 prefix; the filesystem lock does not span clusters.
Allow space for retained archives plus an extra dump-sized temporary copy used
to verify S3 uploads. A scratch restore also needs room for a second database on
the Postgres volume. Pruning happens after the new backup is safely published;
a full disk fails the run rather than deleting old copies first.

List completed local files without starting another scheduler:

```sh
dc run --rm --no-deps --entrypoint sh backup -c 'ls -lh /backups/codechatter-*.dump /backups/codechatter-*.dump.sha256'
```

### Monthly restore drill

Run this monthly and record its output. It uses the latest completed nightly
archive and leaves the live database and application services running. Check the
filename's UTC date against last night's expected run, especially after changing
time zones or fixing the server clock. If there is no archive, stop and investigate.

```sh
LAST_BACKUP=$(dc run --rm --no-deps --entrypoint sh backup -c 'for f in /backups/codechatter-*.dump; do test -f "$f.sha256" && printf "%s\n" "$f"; done | sort | tail -n 1')
test -n "$LAST_BACKUP"
SCRATCH="codechatter_restore_$(date -u +%Y%m%dT%H%M%S)_$$"
dc run --rm --no-deps -e BACKUP_RESTORE_DATABASE="$SCRATCH" backup restore "$LAST_BACKUP"
dc exec -T postgres psql -U codechatter -d "$SCRATCH" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS users FROM public."user"; SELECT count(*) AS rooms FROM public.rooms; SELECT count(*) AS snapshots FROM public.doc_snapshots; SELECT count(*) AS checkpoints FROM public.checkpoints; SELECT count(*) AS audit_events FROM public.audit_events;'
# Drop only the scratch database named above after reviewing the results.
dc exec -T postgres dropdb -U codechatter "$SCRATCH"
```

Good means: checksum and archive checks succeed, restore exits zero, all five
tables can be read, and counts match the data expected at backup time (zero can
be valid for an unused feature). For stronger confidence, check a known room or
checkpoint too. Default restoration creates a unique
`codechatter_restore_<stamp>` database and refuses to reuse an existing one.
To exercise the off-server copy instead, use its full key as the restore argument:

```sh
dc run --rm --no-deps backup restore s3://your-private-backups/codechatter/codechatter-YYYY-MM-DDTHHMMZ.dump
```

Both local and S3 restoration check the companion checksum **before creating or
replacing a database**. Restore only trusted archives: checksums detect corruption,
not malicious changes to both the dump and checksum.

### Restore the live database

For recovery, first choose and drill the archive as above. Stop the app writers
and the backup scheduler; leave Postgres up. Coordinate a maintenance window:

```sh
dc stop web api collab runner backup
# Type codechatter at the prompt only after checking the selected archive.
if dc run --rm --no-deps -e BACKUP_APP_STOPPED=yes backup restore /backups/codechatter-YYYY-MM-DDTHHMMZ.dump --into-live; then
  printf '%s\n' 'Restore completed. Check the printed row counts before restarting writers.'
else
  printf '%s\n' 'Restore failed. Leave writers stopped and investigate.' >&2
fi
```

After a successful restore, reviewed counts and any required schema migrations,
restart access separately:

```sh
dc up -d web api collab runner backup
```

`--into-live` requires both the stopped-app acknowledgement and typed database
name; remaining database connections cause refusal. It replaces the live database
and loses changes after that archive. If restoration fails after replacement,
keep writers stopped and recover with a verified archive. Do not use `down -v`:
it removes the database and backup volumes. After recovery, use the app's normal
migration/update procedure if the archive predates the deployed schema. Valkey
can still contain sessions or cache entries for newer data; invalidate those
through a separately planned cache reset before reopening access if necessary.

### Detect a missed backup

`/backups/last-success` contains completion time as Unix seconds; `last-failure`
records a safe failure reason. Alert on a failure log/status and on no success in
26 hours. This one-line check exits non-zero on missing, stale or future success
time; run it hourly from host cron or an uptime monitor using the same `dc` command:

```sh
dc run --rm --no-deps --entrypoint sh backup -c 'test -s /backups/last-success && last=$(cat /backups/last-success) && now=$(date -u +%s) && test "$last" -le "$now" && test "$((now-last))" -le 93600'
```

Cron does not inherit an interactive shell alias: expand `dc` to
`docker compose --env-file /absolute/path/infra/.env.production -f /absolute/path/infra/compose.yaml`.
On Kubernetes, enable the chart's backup settings and alert when the CronJob's
`.status.lastSuccessfulTime` is absent or older than 26 hours; see the
[chart README](../infra/helm/codechatter/README.md). Kubernetes-managed external
databases are excluded from this CronJob and need their provider's backup policy.

The isolated local drill is `sh infra/backup/test-backup.sh`; it owns its own
Postgres, S3 server, network and volumes and cleans them up. It never connects to
the shared dev database.

## Safety rules the stack enforces

- **The API refuses to start** if `APP_URL` is not `https://`. Production cookies are Secure, so over plain http nobody could stay signed in.
- **The API also refuses to start** if `SMTP_HOST` points at a dev mail catcher.
- **Compose stops with a clear message** if a required secret is empty.
- **Caddy exposes HTTP/HTTPS; LiveKit exposes only media and TURN.** Postgres and Valkey have no public ports, and LiveKit signalling stays behind Caddy.
- **The app containers run as the unprivileged `node` user.**
- **Images never contain `.env` files, v1 code, or spikes.** The Dockerfile has its own allow-list ignore file.

**Before the first deploy, rotate every secret that v1 used** (`server/.env`): the OAuth client secrets, the Gmail App Password, and the database credentials. Then put the new values in `infra/.env.production` only.

## Interviews and assessments

Recording assessments needs the object store (`S3_*`). Recordings are deleted `INTERVIEW_RECORDING_RETENTION_DAYS` (30) after they're made. They're large, at about 250 MB an hour per candidate for webcam and screen, so size the store for that. Check the law where your candidates are before turning recording or the AI review on: `docs/interviews.md` has what each does.

## The security policy (CSP)

Every page carries a Content-Security-Policy with a nonce of its own (`apps/web/lib/csp.ts`, and why in `docs/adr/0010-content-security-policy.md`). You only need to think about it in two cases:

- **LiveKit somewhere other than this site's `/livekit`:** set `LIVEKIT_URL`. Compose and the Helm chart pass it to the web service, and the policy allows that host.
- **A self-hosted draw.io:** set `NEXT_PUBLIC_DRAWIO_URL` when you **build** the image, as the Diagrams tool reads it then too.

If a call or a diagram doesn't connect, look in the browser's console for "Content Security Policy".

## Showcase on Vercel (free)

The landing page can go live on its own, with no app behind it: the code, a demo video and how to run it, for anyone you send the link to. Its sign-in buttons become "Watch the 2-minute demo", "See the code" and "Run it yourself", and the app's pages lead back home (`apps/web/lib/showcase.ts`).

In Vercel, import the repository and set:

- **Root Directory:** `apps/web` (the framework, Next.js, is detected)
- **Build Command:** `cd ../.. && pnpm turbo run build --filter=@codechatter/web`, which builds the workspace packages the web app uses first
- **Environment variables**, read at build time:
  - `NEXT_PUBLIC_SHOWCASE=1`
  - `NEXT_PUBLIC_REPO_URL=https://github.com/<you>/<repo>`
  - `NEXT_PUBLIC_DEMO_VIDEO_URL=<the video>` (optional)

The same works as a container: build `infra/docker/app.Dockerfile` with `--target web` and those three as `--build-arg`s. That container is how showcase mode was tested; a Vercel deployment itself hasn't been tried yet.

## On Kubernetes

The Helm chart [`infra/helm/codechatter`](../infra/helm/codechatter/README.md) runs the same app on a cluster, with one difference: each room's sandbox, databases and package proxy run on that cluster too, a namespace per room (`RUNNER_DRIVER=kubernetes`). Its defaults are a demo on Docker Desktop's built-in Kubernetes: `pnpm k8s:images`, `pnpm sandbox:build`, `helm install`, then http://localhost:8090. Its README lists what to change for production.

## Binary files (images, PDFs, fonts)

Text files live in the room's document. Binary files (up to 20 MB from an upload, 5 MB from a program in the sandbox) are kept in an **S3-compatible bucket**: AWS S3, Cloudflare R2, Backblaze B2, MinIO or SeaweedFS. Without one, the app works as before: uploads of binary files are refused with a message, and binaries made in a sandbox stay there.

1. Make a private bucket, and a key that can read, write and delete objects in it (nothing else).
2. Set these in `.env.production` (the API and the runner both use them), then run `dc up -d`:
   ```
   S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com   # or https://<account>.r2.cloudflarestorage.com, …
   S3_REGION=eu-west-1                               # "auto" on R2
   S3_BUCKET=codechatter-files
   S3_ACCESS_KEY=…
   S3_SECRET_KEY=…
   ```
3. Check it: upload an image in a room (Files view, More file actions, Upload files); it opens as an image for everyone, and `ls` in the room's terminal shows it.

Objects are kept under `rooms/<room code>/<sha256>`, and are never served from the bucket directly: browsers get them from the API, which checks the room first. The bucket needs no public access and no CORS. Nothing deletes objects yet when a room or file is deleted (History can still restore them); see the roadmap.

## Not in production yet
- **Several collab instances behind the load balancer.** The Valkey extension already supports this; one instance is plenty to start.
- **Prebuilt images from CI** (GitHub Actions to GHCR), so the server pulls images instead of building them.
