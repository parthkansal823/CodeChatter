# ADR 0004: The v2 stack is TypeScript end to end

- **Status:** Accepted (2026-09-24). Supersedes ADR 0002.
- **Decided by:** the project owner. The engineering trade-offs are recorded below.

## Decisions

| Layer | Choice |
|---|---|
| Monorepo | pnpm 12 workspaces + Turborepo 2.11. Node 24 LTS. TypeScript 6.0 (typescript-eslint supports `<6.1`) |
| Web | **Next.js 16** App Router: Turbopack, React Compiler, `typedRoutes`, `output: 'standalone'`, `proxy.ts` auth redirect. React 19.2, shadcn/ui, Tailwind 4.3, TanStack Query 5, Zustand 5, zod 4 |
| API | **NestJS 12** on Express 5: nestjs-zod DTOs from `packages/contracts`, OpenAPI, Socket.IO 4.8 gateway + Valkey adapter, pino, OpenTelemetry |
| Collaboration | **Hocuspocus 4.7** in its own app. Redis extension for scaling out; a custom Postgres persistence extension (update log, snapshots, checkpoints) |
| Auth | **Better Auth 1.7**: sessions, email verification and reset, Google/GitHub, two-factor, organization, admin, multi-session. argon2id via `@node-rs/argon2` |
| Database | **PostgreSQL 18** + **Drizzle ORM 0.45** / drizzle-kit. PGlite for unit tests |
| Cache / queue | **Valkey 9** + **BullMQ 6** |
| Sandbox | Node runner with **dockerode 5**. Container per room, as in ADR 0003 |
| Other | LiveKit, Excalidraw 0.18, MinIO (S3), Nodemailer + React Email, Mailpit (dev), Caddy 2.11 |

## Why these choices

- **Next.js** was the owner's choice. The earlier recommendation (Vite + TanStack Router, ADR 0002) rested on the IDE being client-only. That still holds, so the room page loads through `next/dynamic` with `ssr: false`. Next.js adds real value on the marketing, docs and auth pages, which it renders on the server.
- **A TypeScript backend.** Once the web app is Next.js, one language lets DTOs, socket event types, the permission matrix and the Yjs workspace model live in shared packages. No OpenAPI codegen is needed between our own services.
- **Hocuspocus** replaces a hand-written pycrdt relay. It already provides authentication hooks, read-only connections, debounced persistence hooks and Redis-backed scaling. The Yjs server and the browsers now run the same CRDT implementation (yjs), so the pycrdt ↔ yjs parity risk goes away.
- **PostgreSQL** replaces MongoDB (the owner asked to change the database):
  - The core data is relational: users, orgs, members, roles, invitations, audit. Foreign keys with cascades fix v1's orphaned messages and uploads on room delete.
  - Monthly range partitioning suits the append-only audit and usage tables.
  - Postgres 18 generates `uuidv7()` natively, so ids sort by time.
- **Better Auth** replaces about 1,000 lines of v1 auth code. It has plugins for two-factor auth and for organizations with roles and invitations, which the Teams feature needs anyway.
- **Same origin behind Caddy.** Every WebSocket authenticates with the session cookie plus an Origin check, which removes v1's JWT-in-query-string. Single-use tickets are kept only for the cross-origin preview domain.

## Consequences

- The Python backend is rewritten. v1 (`client/`, `server/`) keeps running until the Phase 3 cutover.
- The 44 pytest cases become the regression checklist for the Vitest suite.
- A one-shot migration (`tools/migrate-v1`) moves MongoDB data to Postgres. Legacy PBKDF2 hashes are verified on sign-in, then rehashed to argon2id.
- New spikes: **S1b** (editor stack under Turbopack), **S3b** (two Hocuspocus instances plus the Redis extension, with chaos testing), and **S6** (Better Auth + NestJS + Next.js behind Caddy).
