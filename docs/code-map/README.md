# Code map

Start here instead of reading the code. This page says how the parts fit together. The maps below list every source file with what it is (the first sentence of its doc comment) and what it exports. Read the map for the area you're working in, then open only the files you need, and only the lines you need.

| Map | Covers |
|---|---|
| [web.md](web.md) | `apps/web`: Next.js pages, the room IDE (editor, explorer, panels), the room tools, UI primitives |
| [api.md](api.md) | `apps/api`: NestJS REST, Better Auth, Socket.IO, proxies to the runner, AI, the judge |
| [runner.md](runner.md) | `apps/runner`: sandboxes on Docker or Kubernetes, runs, terminals, preview, databases, package installs |
| [collab.md](collab.md) | `apps/collab` (Hocuspocus) and `sandbox/agent`, the program inside each sandbox |
| [packages.md](packages.md) | `packages/*`: contracts, workspace model, database schema, auth, emails |

The maps are generated: run `pnpm map` after adding, moving or deleting files, or changing a file's top comment, and `pnpm map --check` to see whether they're current. To change what a map says about a file, change the file's comment.

## The services

```
browser ─► Caddy :8080 ─┬─ /                     web     Next.js :3000
                        ├─ /api /socket.io /ws   api     NestJS :4000 ─► Postgres, Valkey, Mailpit, SeaweedFS
                        └─ /collab               collab  Hocuspocus :4100 ─► Postgres
api ─(service token)─► runner :4200 ─► Docker, or Kubernetes (RUNNER_DRIVER) ─► one sandbox per room
runner ─(service token)─► collab: a peer on each room's files document
```

Browsers never reach the runner. Services call each other with service tokens (`packages/auth`, `service-token`), and browsers use the Better Auth session cookie.

## How things flow

- **Editing together.**
  - Monaco and y-monaco (web `components/room/editor/`) bind to Yjs documents through HocuspocusProvider (`components/room/room-context.tsx`).
  - Collab checks access (`extensions/access.ts`) and stores documents in Postgres (`extensions/persistence.ts`).
  - A room's file tree and file texts live in its files document (`packages/workspace-model`: `createFile`, `textOf`, `roomDocName`).
- **Files into the sandbox.** The runner joins the files document as a peer (`doc-sync.ts`) and sends changes to the agent over the sandbox's stdio (`agent-channel.ts` ↔ `sandbox/agent/src/agent.ts`, `workspace.ts`). Changes made inside come back the same way (`watcher.ts`).
- **Run.**
  - The Run button emits over Socket.IO (api `realtime/events.gateway.ts`), and the API calls the runner (`runner/runner.client.ts`).
  - The runner then goes `server.ts` → `RoomSession.ready()` → `RunManager` (`runs.ts`), with a plan from `plans.ts`, then `sandbox.exec`.
  - Output streams back as NDJSON events.
- **Terminals.** `components/room/terminal-view.tsx` → api `realtime/terminal.proxy.ts` (`/ws/terminal`) → runner WebSocket → `terminal.ts` (an exec into tmux).
- **Preview.** Each dev server gets its own origin. The path is api `preview/preview-proxy.ts` → runner `preview.ts` → the agent's tunnel (`tunnel.ts`).
- **Room services.** Web UI → api `sandbox/sandbox.controller.ts` and `databases.controller.ts` → the runner:

  | Service | Web UI | Runner |
  |---|---|---|
  | Databases | `tools/databases` | `databases.ts`, through a driver |
  | Package installs | `ports-panel.tsx` | `egress.ts`, `kube-egress.ts`, and the sandbox's `relay.ts` |
  | Dev server | `dev-server-panel.tsx` | `dev-server.ts` |
- **Drivers.** The runner has one interface per job, with an implementation for each driver:

  | Interface | Docker (the default) | Kubernetes (a namespace per room) |
  |---|---|---|
  | `RoomSandbox` | `sandbox.ts` | `kube-sandbox.ts` |
  | `DatabaseDriver` | `docker-databases.ts` | `kube-databases.ts` |
  | `PackageProxy` | `egress.ts` | `kube-egress.ts` |
- **Isolation (ADR 0007).** A room's network reaches only the room's own services. On Docker that's an internal network. On Kubernetes it's the `room` NetworkPolicy, and the sandbox has no DNS: room services are in its `/etc/hosts`.
- **AI.** Web `tools/ai/` (the panel, chat over SSE, edits, agent steps) → api `ai/`. `providers.ts` routes to Ollama, Claude, Gemini or an OpenAI-compatible endpoint; rate limits and usage are next to it.
- **Permissions.**
  - The room roles and their actions are in `packages/contracts/src/permissions.ts`.
  - The API checks them with `RoomsService.require` (`rooms/rooms.service.ts`), and the web with `useRoom().can`.
- **Data.** The Drizzle schema is in `packages/db/src/schema`, with migrations next to it. Shared zod schemas and types are in `packages/contracts`; rebuild it after changes.

## Where to start

| To change | Look in |
|---|---|
| A room screen or panel | `apps/web/components/room/` (`room-workspace.tsx` lays it out) |
| A room tool | `apps/web/components/room/tools/` (`registry.ts`) |
| An HTTP route | The controller in `apps/api/src/<area>/` |
| Anything inside a sandbox | `apps/runner/src` and `sandbox/agent/src` |
| Tests | The "Tests" section of each map. The commands are in CLAUDE.md. |
| Plans and decisions | `docs/roadmap.md` and `docs/adr/` |
