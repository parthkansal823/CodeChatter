# CodeChatter v2

A real-time collaborative IDE: shared editor (Yjs), Run and terminals in a per-room Docker sandbox, chat, and plug-in room tools. Status and plan: `docs/roadmap.md`. Deploy: `docs/deploy.md`.

## Rules (the owner insists)

- **The owner does all git himself.** Never commit, branch, checkout, stash, reset, push or stage. Leave changes uncommitted on main. Read-only git: `git -c safe.directory=D:/Projects/Projects_With_Niyati/CodeChatterNK status|diff|log`.
- **The dev stack is shared.** If it's running, don't start a second copy or stop it. If nothing listens on :3000, start it with `pnpm infra:up` then `pnpm dev`. `pnpm dev:stop` stops leftover servers from this repo.
- **No `pnpm install`/`pnpm add`** without asking (shared lockfile).
- **Never print secrets from `.env`.**
- `.claude/hooks/` enforces the git and dev-stack rules, and flags hex colours in web TSX.

## Save tokens

- **Code map first:** read `docs/code-map/README.md` (how the parts connect), then the map for your area (`docs/code-map/<area>.md`: every file, what it is, what it exports), before opening code. A Stop hook regenerates the maps after each turn (`pnpm map` by hand). To change what a map says about a file, fix the file's top comment.
- Read only what the task needs: grep first, then read the relevant lines. Don't open `client/`, `server/` (v1, being retired), `spikes/`, `node_modules`, or `dist`.
- Pipe long output through `tail`/`grep`. Don't rerun slow commands to re-read output.
- Work one piece at a time in the main session; no parallel subagents (they hit the usage limit together and leave half-built code). Never run agents on Sonnet.
- After each finished piece, update its status in `docs/roadmap.md`.
- Keep messages short; report results, not process.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (Turbopack), React 19, Tailwind 4 tokens in `app/globals.css`, shadcn/ui in `components/ui` |
| `apps/web/components/room` | Room IDE: editor (Monaco + y-monaco), explorer, Run/Output/Tests/Ports/terminal panel, preview |
| `apps/web/components/room/tools` | Plug-in tools (`registry.ts`): ai, docs, api-studio, databases, canvas/design/board, diagrams |
| `apps/api` | NestJS 12: REST + Better Auth + Socket.IO; proxies terminals and previews to the runner |
| `apps/collab` | Hocuspocus (Yjs) with Postgres persistence; authorises `room:ID:<kind>` documents |
| `apps/runner` | Sandbox manager (dockerode): container per room, file-sync agent, runs, judge, terminals, preview tunnel |
| `sandbox/agent`, `sandbox/image` | In-container sync agent and sandbox image (`pnpm sandbox:build`) |
| `packages/contracts` | Shared zod schemas and types (rebuild with `pnpm --filter @codechatter/contracts build`) |
| `packages/workspace-model` | Yjs file tree, doc names (`roomDocName`), templates |
| `packages/db`, `packages/auth` | Drizzle schema and migrations; Better Auth and service tokens |
| `infra/` | Dev and production compose, Caddy, Dockerfiles |

## Patterns

- **Permissions:**
  - API: `RoomsService.require(roomId, userId, action)`
  - Web: `useRoom().can(action)`
  - The matrix is in `packages/contracts/src/permissions.ts`.
- **Live documents:** Yjs via HocuspocusProvider (pattern in `components/room/room-context.tsx`, with `provider.attach()`). Kinds: files, pages, api, designs, boards; per item page/design/board.
- **Between services:** service tokens (`@codechatter/auth/service-token`). The runner is never exposed to browsers.
- **Design:**
  - Pure black and white with one orange (`--brand`); people get presence hues `--p-1..8`.
  - Tokens only, no hex in TSX; canvas and xterm colours come from `cssVar()` in `lib/css-color.ts`.
  - 13px UI and dense controls; plain English copy.

## Checks

- **Typecheck:** `pnpm --filter <pkg> typecheck`. The web one takes 1–2 minutes.
- **Lint web files:** `pnpm --filter @codechatter/web exec eslint <files>`.
- **Unit tests:**
  - `pnpm --filter <pkg> test`
  - the canvas engine's `node:test` files (`apps/web/components/room/tools/canvas/*.test.ts`) need tsx, which the web package doesn't have yet: run `pnpm exec tsx --test <absolute paths>` from `apps/runner`
- **End-to-end** (dev stack running):
  - `node --env-file=../../.env test/runner.e2e.mjs`, `test/judge.e2e.mjs`, `test/network.e2e.mjs` (the room network's isolation), `test/egress.e2e.mjs` (package installs: real downloads, takes a minute or two), `test/databases.e2e.mjs` (all five databases), `test/sqlite.e2e.mjs` (the room's SQLite files), `test/duckdb.e2e.mjs` (DuckDB files, and SQL over CSV, Parquet and JSON), `test/dev.e2e.mjs` (the dev server from room.json), `test/isolation.e2e.mjs` (rooms can't read each other's files), `test/notebooks.e2e.mjs` (notebook kernels), `test/format.e2e.mjs` (formatters in the sandbox), `test/check.e2e.mjs` (Check all files: the project-wide checkers), `test/image.e2e.mjs` (a room's sandbox image: starts a runner of its own on :4203), `test/lsp.e2e.mjs` (language servers) and `test/debug.e2e.mjs` (the shared debugger; its Go part runs when `SANDBOX_IMAGE` is the full image), from `apps/runner`
  - `test/languages.e2e.mjs` (every language), `test/kubernetes.e2e.mjs` (the playground) and `test/kube.e2e.mjs` (the Kubernetes panel's runner side), from `apps/runner`, and `apps/web/test/kubernetes-panel.e2e.mjs`. They need the full image: `pnpm sandbox:build:full` and `SANDBOX_IMAGE=codechatter-sandbox:full`.
  - the same runner tests on the Kubernetes driver (Docker Desktop's cluster): a second runner, `RUNNER_PORT=4202 RUNNER_DRIVER=kubernetes SANDBOX_NAMESPACE=kube pnpm exec tsx watch --env-file-if-exists=../../.env src/main.ts` from `apps/runner`, and `RUNNER_URL=http://127.0.0.1:4202` for the tests
  - browser tests in `apps/web/test/*.e2e.mjs` (Playwright-core + Edge against http://localhost:8080; helpers in `browser.mjs`), run from `apps/web` with `node test/<name>.e2e.mjs`
  - `apps/web/scripts/kubernetes-schema.mjs` remakes the editor's Kubernetes schema (`public/schemas/kubernetes.json`) when the playground's Kubernetes version changes (keep its version and SHA-256 as in `sandbox/image/Dockerfile`)
  - `apps/web/test/templates.e2e.mjs` runs every framework template in the preview (`TEMPLATES=react,flask` for some). After `pnpm sandbox:warm` (template installs cached in a read-only volume every sandbox sees), new template rooms unpack instead of installing; `WARM=1` checks they start with plain Start and installs off (Gin, Axum and Spring Boot always install: Go's, Cargo's and Maven's downloads aren't cached)
  - the same browser tests against the Kubernetes demo (the Helm chart, `infra/helm/codechatter/README.md`, at http://localhost:8090): `APP_URL=http://localhost:8090 node test/<name>.e2e.mjs`
- **GitHub tests:** `test/source-control.e2e.mjs` from `apps/api` starts its own API on :4011 (from the dev watcher's `dist`) against a mock GitHub (`test/mock-github.mjs`); `apps/web/test/github-import.e2e.mjs`, `source-control.e2e.mjs`, `pull-requests.e2e.mjs`, `webhooks.e2e.mjs` and `export.e2e.mjs` use real GitHub without a token (octocat/Spoon-Knife; GitHub allows 60 requests an hour without one, about 25 for all five), answering writes in the browser. `apps/web/test/secret-scan.e2e.mjs` needs no GitHub: it stops at the missing token.
- **AI tests:**
  - `ai.e2e.mjs` needs the mock AI: run `node test/mock-ai.mjs` from `apps/api`, and point `.env` at it as its header shows
  - `ai-ollama.e2e.mjs` uses the local Ollama, which `.env` normally points at
- **Test accounts:** test1@codechatter.local (owner) and test2@codechatter.local (editor), password `codechatter123`.
- **Rooms:** TEAM22 "Team playground" is for trying things by hand. Automated tests use E2ETST "Automated tests" only (`pnpm seed` creates both).
