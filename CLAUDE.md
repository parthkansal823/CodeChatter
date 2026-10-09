# CodeChatter v2

A real-time collaborative IDE: shared editor (Yjs), Run and terminals in a per-room Docker sandbox, chat, and plug-in room tools. Status and plan: `docs/roadmap.md`. Deploy: `docs/deploy.md`.

## Rules (the owner insists)

- **The owner does all git himself.** Never commit, branch, checkout, stash, reset, push or stage. Leave changes uncommitted on main. Read-only git: `git -c safe.directory=D:/Projects/Projects_With_Niyati/CodeChatterNK status|diff|log`.
- **The dev stack is shared.** If it's running, don't start a second copy or stop it. If nothing listens on :3000, start it with `pnpm infra:up` then `pnpm dev`. `pnpm dev:stop` stops leftover servers from this repo.
- **No `pnpm install`/`pnpm add`** without asking (shared lockfile).
- **Never print secrets from `.env`.**
- `.claude/hooks/` enforces the git and dev-stack rules, and flags hex colours in web TSX.

## Save tokens

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
  - `node --env-file=../../.env test/runner.e2e.mjs`, `test/judge.e2e.mjs`, `test/network.e2e.mjs` (the room network's isolation), `test/egress.e2e.mjs` (package installs: real downloads, takes a minute or two), `test/databases.e2e.mjs` (all five databases) and `test/dev.e2e.mjs` (the dev server from room.json), from `apps/runner`
  - `test/languages.e2e.mjs` (every language) and `test/kubernetes.e2e.mjs` (the playground), from `apps/runner`. Both need the full image: `pnpm sandbox:build:full` and `SANDBOX_IMAGE=codechatter-sandbox:full`.
  - browser tests in `apps/web/test/*.e2e.mjs` (Playwright-core + Edge against http://localhost:8080; helpers in `browser.mjs`), run from `apps/web` with `node test/<name>.e2e.mjs`
- **AI tests:**
  - `ai.e2e.mjs` needs the mock AI: run `node test/mock-ai.mjs` from `apps/api`, and point `.env` at it as its header shows
  - `ai-ollama.e2e.mjs` uses the local Ollama, which `.env` normally points at
- **Test accounts:** test1@codechatter.local (owner) and test2@codechatter.local (editor), password `codechatter123`.
- **Rooms:** TEAM22 "Team playground" is for trying things by hand. Automated tests use E2ETST "Automated tests" only (`pnpm seed` creates both).
