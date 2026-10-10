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
2. **Firewall.** Allow inbound TCP 22, 80 and 443, and UDP 443, both in the provider's firewall and in `ufw` if it is on. Caddy needs port 80 to get the certificate.
3. **Docker.**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # log out and back in
   ```
4. **Code and settings.**
   ```bash
   git clone <your repo url> codechatter && cd codechatter
   cp infra/.env.production.example infra/.env.production
   openssl rand -hex 32            # run twice: POSTGRES_PASSWORD, BETTER_AUTH_SECRET
   nano infra/.env.production      # fill in every value
   ```
5. **Start.**
   ```bash
   alias dc='docker compose --env-file infra/.env.production -f infra/compose.yaml'
   dc up -d --build
   dc ps                           # all healthy; "migrate" exited 0
   curl https://code.yourname.dev/api/readyz
   ```
   The first build takes about 5–10 minutes. Then open `https://<DOMAIN>` and sign up. The verification email uses your SMTP settings.
6. **Sign-in providers (optional).** Add these redirect URLs, then set the client id and secret in `.env.production` and run `dc up -d`:
   - Google Cloud Console → Credentials → your OAuth client: `https://<DOMAIN>/api/auth/callback/google`
   - GitHub → Settings → Developer settings → OAuth Apps: `https://<DOMAIN>/api/auth/callback/github`

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
| Backup | `dc exec -T postgres pg_dump -U codechatter codechatter \| gzip > backup-$(date +%F).sql.gz` |
| Restore | `gunzip -c backup.sql.gz \| dc exec -T postgres psql -U codechatter codechatter` |
| Stop everything | `dc down` (data stays in Docker volumes; `down -v` deletes it) |

Copy backups off the server, for example with a nightly cron job to object storage.

## Safety rules the stack enforces

- **The API refuses to start** if `APP_URL` is not `https://`. Production cookies are Secure, so over plain http nobody could stay signed in.
- **The API also refuses to start** if `SMTP_HOST` points at a dev mail catcher.
- **Compose stops with a clear message** if a required secret is empty.
- **Only Caddy is exposed.** Postgres and Valkey have no public ports.
- **The app containers run as the unprivileged `node` user.**
- **Images never contain `.env` files, v1 code, or spikes.** The Dockerfile has its own allow-list ignore file.

**Before the first deploy, rotate every secret that v1 used** (`server/.env`): the OAuth client secrets, the Gmail App Password, and the database credentials. Then put the new values in `infra/.env.production` only.

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

## Not in production yet

- **File uploads and object storage** (Phase 3). They will use any S3-compatible bucket.
- **Several collab instances behind the load balancer.** The Valkey extension already supports this; one instance is plenty to start.
- **Prebuilt images from CI** (GitHub Actions to GHCR), so the server pulls images instead of building them.
