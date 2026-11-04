# Task for ChatGPT: GitHub Actions CI for CodeChatter

You are helping build **CodeChatter v2**, a real-time collaborative IDE (a shared code editor, a Docker sandbox per room to run code, chat, and plug-in tools). Another AI is working on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**.

Your job: write the project's first **GitHub Actions CI**. It has to run lint, type checks, unit tests, a migration check, Docker image builds and a vulnerability scan on every push and pull request.

## The repository

A pnpm monorepo, run with Turborepo.

- **Tooling:**
  - Root `package.json` sets `"packageManager": "pnpm@12.6.0"` and `"engines": { "node": ">=24" }`.
  - Turborepo 2.11.3, TypeScript 6.0.3.
- **Root scripts:**
  - `"build": "turbo run build"`, `"lint": "turbo run lint"`, `"typecheck": "turbo run typecheck"`, `"test": "turbo run test"`
  - `"db:migrate": "pnpm --filter @codechatter/db build && pnpm --filter @codechatter/db migrate"`
  - The migrate script runs `node --env-file-if-exists=../../.env ./dist/migrate.js` and reads `DATABASE_URL`.
- **Packages, and the scripts each has:**

| Package | Path | Scripts |
|---|---|---|
| `@codechatter/api` (NestJS) | `apps/api` | typecheck, test (vitest), build |
| `@codechatter/collab` (Hocuspocus) | `apps/collab` | typecheck, build |
| `@codechatter/runner` (sandbox manager) | `apps/runner` | typecheck, test (vitest), build |
| `@codechatter/web` (Next.js 16) | `apps/web` | lint (eslint), typecheck (`next typegen && tsc --noEmit`), build |
| `@codechatter/auth` | `packages/auth` | typecheck, test, build |
| `@codechatter/contracts` | `packages/contracts` | typecheck, test, build |
| `@codechatter/db` (Drizzle) | `packages/db` | typecheck, build |
| `@codechatter/emails` | `packages/emails` | typecheck, build |
| `@codechatter/workspace-model` | `packages/workspace-model` | typecheck, test, build |
| `@codechatter/sandbox-agent` | `sandbox/agent` | typecheck, test, build |
| `@codechatter/config` | `packages/config` | (shared tsconfig and eslint config, no scripts) |

- **Build order is handled:** the `packages/*` export from `dist/`, so the apps' type checks and tests need them built first. `turbo.json` already declares `"dependsOn": ["^build"]` for `lint`, `typecheck` and `test`, so `pnpm typecheck` and `pnpm test` build what they need. You don't need a separate build step.
- **Two sets of tests are not run by `pnpm test`:**
  - The web package's unit tests are `node:test` files (`apps/web/**/*.test.ts`, for example `apps/web/components/room/editor/keybindings.test.ts`). The web package has no `tsx`, so they're run with the runner's: `cd apps/runner && pnpm exec tsx --test <absolute paths of the files>`.
  - `apps/collab/src/extensions/*.test.ts` are also `node:test` files, run with `cd apps/collab && pnpm exec tsx --test <paths>` (collab has tsx).
- **Docker:**
  - `infra/docker/app.Dockerfile` has the targets `migrate`, `api`, `collab`, `runner` and `web`, built from the repo root. For example: `docker build -f infra/docker/app.Dockerfile --target api -t codechatter-api .`.
  - `sandbox/image/Dockerfile` builds the code sandbox: `docker build --target base -t codechatter-sandbox:dev -f sandbox/image/Dockerfile sandbox`. It downloads language toolchains and is large; the `full` target is much larger (Go, Rust, Java, PHP).
- **Database:**
  - Postgres 18 (`postgres:18-alpine` in `infra/compose.dev.yaml`): use the same image for the service container.
  - Migrations are SQL files in `packages/db/drizzle/` (`0000_init.sql` … `0006_notification_digest.sql`).
- **The owner does all git himself.** Don't suggest commits or branch names; just give the files.

## What to build

`.github/workflows/ci.yml`, triggered on `push` to `main` and on every `pull_request`. Use `concurrency` so a new push cancels the old run for the same branch, and `permissions: contents: read` at the top (raise it only where a job needs more).

Jobs:

1. **`checks`** (ubuntu-latest):
   - `actions/checkout@v4`.
   - `pnpm/action-setup@v4`, which reads the version from `packageManager`.
   - `actions/setup-node@v4` with `node-version: 24` and `cache: pnpm`.
   - `pnpm install --frozen-lockfile`.
   - Run `pnpm lint`, `pnpm typecheck` and `pnpm test` (turbo builds the packages they depend on).
   - Run the web and collab `node:test` files as described above. Find them with `git ls-files 'apps/web/**/*.test.ts'` and `git ls-files 'apps/collab/src/**/*.test.ts'`, and pass absolute paths (`$GITHUB_WORKSPACE/...`). Skip the step cleanly when there are none.
   - The web type check runs `next typegen`. If it needs environment variables, set harmless placeholder values in the job's `env` (for example `APP_URL: http://localhost:8080`), never real secrets.
2. **`migrations`**:
   - A `postgres:18-alpine` service container with health checks.
   - Install, then `pnpm db:migrate` with `DATABASE_URL` pointing at the service, to prove every migration applies to an empty database.
   - Then run it again to prove it's a no-op the second time.
3. **`images`** (needs `checks`):
   - Build every `app.Dockerfile` target (`migrate`, `api`, `collab`, `runner`, `web`) with `docker/setup-buildx-action` and `docker/build-push-action`, `push: false`, using the GitHub Actions cache (`cache-from: type=gha`, `cache-to: type=gha,mode=max`). A matrix over the targets is good.
   - Build the sandbox `base` target too, as a separate matrix entry with a longer timeout. Don't build `full` on every push: add a `workflow_dispatch` input, or a separate workflow, that builds `full` by hand.
4. **`security`**:
   - `pnpm audit --prod --audit-level=high` (failing on high and critical).
   - Trivy (`aquasecurity/trivy-action`) in filesystem mode over the repo, for vulnerabilities and leaked secrets, with severity `HIGH,CRITICAL`.
   - Upload the SARIF to GitHub code scanning with `github/codeql-action/upload-sarif` (this job needs `security-events: write`).
   - Skip `node_modules`, `.next`, `dist`, `client/` and `server/`: the last two are the old v1 app, being deleted.

Pin actions to a major version (`@v4` and so on), name every step in plain English, and keep each job under about 30 minutes (the sandbox image job can have 60). The workflow must need **no repository secrets**.

Also give:

- `docs/ci.md`: a short page for the owner. What each job checks, how to run the same checks locally (the exact commands), and what to do when a job fails, for example "Trivy found a HIGH vulnerability in package X: update it, or add it to `.trivyignore` with a reason".
- A README badge line the owner can paste into `README.md`. Don't edit the README yourself.
- If Trivy needs it: a `.trivyignore`, empty except for a comment explaining its format.

## Files you may touch

- `.github/workflows/ci.yml` (new)
- `.github/workflows/sandbox-full.yml` (new, optional: the manual `full` image build)
- `docs/ci.md` (new)
- `.trivyignore` (new, optional)

Don't change `package.json`, `pnpm-lock.yaml`, `turbo.json` or any source file. If a check can't pass without a change there, don't make it: list the change you'd need at the end of your answer and why.

## How to answer

1. Each new file's full contents, in its own code block, headed by its path.
2. A short list of anything you weren't sure of: version numbers you guessed, or assumptions about `turbo.json` and the Dockerfiles, so the owner can check them.
3. What the owner should expect on the first run: which jobs might fail, and why, for example a vulnerability Trivy finds in an existing dependency.
