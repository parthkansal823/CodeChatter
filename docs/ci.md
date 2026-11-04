# Continuous integration

`CI` runs on pushes to `main` and every pull request. A newer run cancels the previous run for the same branch or pull request. It uses Node 24 and the pnpm version in `package.json`, with a frozen lockfile. No repository secrets are needed; GitHub supplies the token for caches and code scanning.

| Job | What it checks |
| --- | --- |
| `checks` | Lint, TypeScript, package unit tests, and the web and collab `node:test` files tracked by Git. Turbo builds workspace dependencies first. |
| `migrations` | Applies all SQL migrations to an empty Postgres 18 database, then runs the migrator again to check that it succeeds without reapplying them. |
| `images` | After `checks` passes, builds `migrate`, `api`, `collab`, `runner`, `web`, and sandbox `base`. Each image has its own GitHub Actions cache. |
| `security` | Fails on HIGH or CRITICAL production dependency advisories, or HIGH or CRITICAL vulnerabilities and leaked secrets found by Trivy. Uploads Trivy's SARIF report to code scanning even when findings fail the scan. |

Jobs have a 30-minute limit; sandbox builds have 60 minutes. Images are built without publishing. Run **Actions → Sandbox full image → Run workflow** to build the larger sandbox `full` target manually.

## Run the checks locally

These commands use Bash (Git Bash or WSL on Windows), from the repository root, with Node 24, pnpm, Docker, and Trivy available. Ask the owner before running `pnpm install` in the shared checkout. CI runs this installation command:

```bash
pnpm install --frozen-lockfile
```

Run lint, types, and package tests:

```bash
export APP_URL=http://localhost:8080
pnpm lint
pnpm typecheck
pnpm test
```

Run the additional tracked `node:test` files. Both lists may be empty; untracked files are excluded just as they are in CI.

```bash
workspace="$PWD"
mapfile -d '' web_tests < <(git ls-files -z 'apps/web/**/*.test.ts')
if ((${#web_tests[@]})); then
  (cd apps/runner && pnpm exec tsx --test "${web_tests[@]/#/$workspace/}")
fi
mapfile -d '' collab_tests < <(git ls-files -z 'apps/collab/src/**/*.test.ts')
if ((${#collab_tests[@]})); then
  (cd apps/collab && pnpm exec tsx --test "${collab_tests[@]/#/$workspace/}")
fi
```

Check migrations in a disposable database on port 55432. This container is separate from the shared development stack and is removed when stopped. Run the whole block; its cleanup stops only `codechatter-ci-db`.

```bash
(
  set -e
  docker run --rm -d --name codechatter-ci-db \
    -p 127.0.0.1:55432:5432 \
    -e POSTGRES_USER=codechatter -e POSTGRES_PASSWORD=codechatter \
    -e POSTGRES_DB=codechatter postgres:18-alpine
  trap 'docker stop codechatter-ci-db >/dev/null' EXIT
  for attempt in {1..60}; do
    if docker exec codechatter-ci-db pg_isready -U codechatter -d codechatter; then
      break
    fi
    sleep 1
  done
  docker exec codechatter-ci-db pg_isready -U codechatter -d codechatter
  export DATABASE_URL=postgres://codechatter:codechatter@localhost:55432/codechatter
  pnpm db:migrate
  pnpm db:migrate
)
```

Build the same images; sandbox `full` is optional:

```bash
(
  set -e
  for target in migrate api collab runner web; do
    docker build -f infra/docker/app.Dockerfile --target "$target" \
      -t "codechatter-$target:ci" .
  done
)
docker build --target base -t codechatter-sandbox:dev \
  -f sandbox/image/Dockerfile sandbox
# Manual workflow equivalent:
docker build --target full -t codechatter-sandbox:full \
  -f sandbox/image/Dockerfile sandbox
```

Run both security checks, even if the first reports findings:

```bash
pnpm audit --prod --audit-level=high
trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 --timeout 10m \
  --skip-dirs '.git,**/node_modules,**/.next,**/dist,client,server' \
  --format sarif --limit-severities-for-sarif --output trivy-results.sarif .
```

## When a job fails

- **Install:** a frozen-lockfile error means the manifests and lockfile disagree. The owner must reconcile them; do not remove the frozen check or update dependencies silently.
- **Checks:** start with the first failing command and file. Package builds can fail before a dependent type check or test runs. `APP_URL` is a harmless placeholder; CI needs no application secrets.
- **Migrations:** inspect the first SQL error and migration journal. Fix the migration and rerun against a fresh disposable database; do not test destructive repairs against the shared development database.
- **Images:** every app target uses a shared stage that builds all applications, so an error in one app can fail every target. Sandbox builds download language toolchains; cold caches, upstream outages, and disk limits can cause failures.
- **Security:** update a vulnerable dependency, or record a justified exception in `.trivyignore` with a comment and the finding ID on its own line. Trivy exceptions do not suppress `pnpm audit`; its advisories need a dependency fix. Remove and rotate a real leaked credential. The report is under **Security → Code scanning**; audit output is in the job log.
- **SARIF upload:** code scanning must be enabled and available for the repository (public repositories, or eligible private repositories with GitHub Code Security). Check repository settings if GitHub rejects the upload. No personal access token is required.

The first run may reveal existing lint, type, build, test, migration, vulnerability, or secret findings; no clean baseline is assumed. Trivy scans source and lockfiles, excluding generated directories and the retired `client/` and `server/` trees; this is not a container-image scan.

Trivy's action is pinned to the published `v0.36.0` release because it has no major-only `v0` tag. Other actions use major version pins. Review the Trivy release pin when updating CI tooling.
