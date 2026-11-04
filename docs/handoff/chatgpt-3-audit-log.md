# Task for ChatGPT: 

You are helping build **CodeChatter v2**, a real-time collaborative IDE (shared code editor, a Docker sandbox per room, chat, room tools). Another AI is working on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**.

Your job: let an organisation's **owners and admins** see what happened in it. That means an **audit log page**:
- a table of events, newest first;
- filters for action, person, room and dates;
- "Load more" paging;
- **Download CSV** for the filtered events.

The API already writes the events (since day one), and nothing reads them yet.

## Stack and house rules

- **API:**
  - NestJS 12 (`apps/api`), ESM: imports end in `.js`.
  - Drizzle ORM on Postgres (`@codechatter/db` exports `schema` and `type DbHandle`), validation with zod 4 through the project's `ZodPipe`.
  - Errors are Nest exceptions (`ForbiddenException`, `NotFoundException`, `BadRequestException`) with plain-English messages; a global filter turns them into `application/problem+json`.
- **Web:**
  - Next.js 16 and React 19 (the React Compiler is on), Tailwind 4, shadcn/ui in `apps/web/components/ui` (`Button`, `Input`, `Select`, `Table`, `Skeleton`…), `lucide-react` icons.
  - Data with `@tanstack/react-query`, and the web fetch helper `api<T>(path, init)` from `@/lib/api`, which throws `ApiError` (`status`, `detail`).
- **Design:**
  - Black and white with one orange accent (`--brand`).
  - **No hex or rgb colour literals in TSX** (a hook rejects them): use Tailwind token classes (`text-muted-foreground`, `bg-accent`, `border`…).
  - Dense: 13px text, `text-xs` in tables.
- **Copy:** plain English ("Nothing matches these filters.").
- **Comments:** every new module starts with a doc comment saying what it is and why. Comment the non-obvious only.
- **Security:**
  - Only an org's owners and admins may read its log; others get 403, and an org that doesn't exist gets 404.
  - Validate every query value.
  - Never put IP addresses or user agents in the web table by default (show them in an expandable row).
  - CSV cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with `'`, so a spreadsheet doesn't run them as formulas.

## The code you build on

The table (`packages/db/src/schema/app.ts`):

```ts
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuidv7Pk(),                               // uuid v7: sorts by time, use it for paging
    orgId: text().references(() => organization.id, { onDelete: "cascade" }),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    ip: text(),
    userAgent: text(),
    action: text().notNull(),                     // e.g. "repo.commit", "room.create", "sandbox.image"
    targetType: text(),                           // e.g. "room"
    targetId: text(),                             // e.g. a room code "TEAM22"
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.createdAt.desc()), index().on(t.targetId, t.createdAt.desc())],
);
```

Organisation membership (`packages/db/src/schema/auth.ts`, Better Auth's organisation plugin) is `schema.member`, with `organizationId`, `userId`, and `role` text (`"owner" | "admin" | "member"`). People are `schema.user` (`id`, `name`, `email`); rooms are `schema.rooms` (`id` is the 6-character code, `name`, `orgId`).

The actions written today:
- `room.create`, `room.delete`, `room.update`
- `repo.publish`, `repo.commit`, `repo.pull-request`, `repo.gist`
- `checkpoint.delete`
- `sandbox.image`, `sandbox.installs.allow`, `sandbox.installs.stop`
- `dev.start`, `dev.stop`, `run`
- `database.dump`, `database.load`, `sqlite.dump`, `sqlite.load`

There are a few more; read them from the database (see the `actions` route below) rather than hard-coding the list.

How a controller looks in this API (the pattern to follow):

```ts
import type { AuthSession } from "@codechatter/auth";
import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";   // every route is signed-in only (a global guard)
import { ZodPipe } from "../common/zod.pipe.js";                         // new ZodPipe(schema) validates a param, query or body

@Controller("orgs/:orgId/audit")
export class AuditController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}           // DB from "../infra/tokens.js"
  @Get()
  async list(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(z.string().min(1).max(64))) orgId: string, @Query(new ZodPipe(AuditQuery)) query: AuditQuery) { … }
}
```

Register a new controller in `apps/api/src/app.module.ts`, in its `controllers: [...]` array (one added entry and one import).

Shared types go in `packages/contracts/src/` (zod schemas plus their `z.infer` types) and are re-exported from `packages/contracts/src/index.ts` (`export * from "./audit.js";`). The web and the API both import from `@codechatter/contracts`.

On the web, `useMe()` (from `@/components/app/app-shell`) returns:

```ts
type Me = {
  user: { id: string; name: string; email: string };
  session: { activeOrganizationId: string };
  personalOrgId: string;
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
};
```

The audit page is for the **active** organisation (`me.session.activeOrganizationId`). If your role there isn't owner or admin, the page says so plainly instead of erroring.

Pages use `PageHeader` from `@/components/app/app-shell` (`<PageHeader title="…" description="…" actions={…} />`) and live under `apps/web/app/(app)/`. The settings page is `apps/web/app/(app)/settings/page.tsx`:

```tsx
"use client";
import { PageHeader } from "@/components/app/app-shell";
import { GithubToken } from "@/components/app/github-token";
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Connections for your account." />
      <div className="grid max-w-2xl gap-8 px-6 py-6 sm:px-8"><GithubToken /></div>
    </>
  );
}
```

## What to build

1. **Contracts** (`packages/contracts/src/audit.ts`):
   - `AuditQuery`, a zod object, every field optional: `action` (≤ 64 characters), `actorId`, `room` (a room code: 6 uppercase letters or digits), `from` and `to` (ISO date-times), `before` (an event id, uuid, for paging), `limit` (an integer 1–200, default 50).
   - `AuditEventItem`: `{ id, at, actor: { id, name, email } | null, action, targetType, targetId, room: { id, name } | null, data, ip, userAgent }`.
   - `AuditPage`: `{ items: AuditEventItem[]; next: string | null }`, where `next` is the `before` for the next page.
2. **API** (`apps/api/src/audit/audit.controller.ts`, plus a pure `audit-csv.ts`):
   - `GET /api/orgs/:orgId/audit` returns an `AuditPage`, filtered, newest first (by `id`, which is time-ordered).
   - `GET /api/orgs/:orgId/audit/actions` returns `{ actions: string[] }`: the distinct actions in that org's log, for the filter.
   - `GET /api/orgs/:orgId/audit/export.csv` takes the same filters (no `before` or `limit`) and returns at most 10,000 rows as `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="audit-<org slug>-<yyyy-mm-dd>.csv"`. Columns: time (ISO), person, email, action, target type, target, room name, details (the `data` JSON), IP, user agent. Escape cells as RFC 4180 (quote fields with commas, quotes or newlines, and double the quotes) and defuse formulas as above. Start the file with a UTF-8 BOM so Excel reads names correctly.
   - **Access:** look up the caller in `schema.member` for that org, and allow `owner` and `admin` only.
   - **Unit tests** (vitest, next to the code: `audit-csv.test.ts`): escaping (commas, quotes, newlines), formula defusing, the header row, an empty table.
3. **Web:**
   - `apps/web/app/(app)/settings/audit/page.tsx`: `PageHeader` "Audit log" (description: "What happened in <org name>: who did what, and when.") with a **Download CSV** button that links to the export route with the current filters. Below it:
     - **Filters:** Action (a select filled from `/actions`, with "Every action"), Person (a select of the org's people seen in the log, or a text box for an email; your choice, say which), Room (a room-code box), From and To (date inputs). Changing a filter starts again from the first page.
     - **Table:** columns When ("2 hours ago", with the full time on hover), Who, What (a readable label for known actions: `repo.commit` is "Committed to GitHub", `room.create` is "Created a room", `sandbox.image` is "Changed the sandbox image"; an unknown action shows as it is), Where (the room's name with its code), and Details. Details is a short summary of `data`; the row opens to show the full JSON, IP and user agent.
     - **Paging:** **Load more** until `next` is null.
     - **Empty and error states** in plain English. People who aren't owners or admins see "Only the organisation's owners and admins can see its audit log."
   - In `apps/web/app/(app)/settings/page.tsx`, add a small section "Audit log" with a link to `/settings/audit`. Show it only to owners and admins of the active org.
4. **API end-to-end test** (`apps/api/test/audit.e2e.mjs`), run against the dev stack at `http://localhost:8080`. Sign in with `POST /api/auth/sign-in/email` and body `{ email, password }`, sending an `origin: http://localhost:8080` header and keeping the session cookie from `set-cookie`; `GET /api/me` gives `personalOrgId` and `organizations`. The test accounts are `test1@codechatter.local` and `test2@codechatter.local`, password `codechatter123`. Look for the events in test1's **active** org (`session.activeOrganizationId` from `GET /api/me`): `room.create` is recorded there, and test1 owns it.
   - Make an event: create a room with `POST /api/rooms` and body `{ name: "Audit e2e" }` (it writes `room.create`), then delete it with `DELETE /api/rooms/:id` (`room.delete`).
   - Check:
     - the list has both events, newest first;
     - the `action` filter works;
     - `before` paging works;
     - the CSV has the header, both rows and a formula-safe cell;
     - test2 gets 403 on test1's org;
     - a bad `limit` gets 400.
   - Print `PASS`/`FAIL` lines and `N/M passed`, and exit non-zero on failure, like the project's other `.e2e.mjs` files.

## Files you may touch

- `packages/contracts/src/audit.ts` (new), `packages/contracts/src/index.ts` (one added export line)
- `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit-csv.ts`, `apps/api/src/audit/audit-csv.test.ts` (new)
- `apps/api/src/app.module.ts` (register the controller: one import, one entry)
- `apps/web/app/(app)/settings/audit/page.tsx` (new), plus any components it needs under `apps/web/components/settings/` (new)
- `apps/web/app/(app)/settings/page.tsx` (add the link section)
- `apps/api/test/audit.e2e.mjs` (new)

Don't change the database schema: everything needed is already in `audit_events`. If you think an index is missing, say so instead of adding a migration.

## How to answer

1. Each new file in full, in its own code block headed by its path.
2. Each edit to an existing file as a unified diff with enough context to apply.
3. The owner's commands to check it:
   - `pnpm --filter @codechatter/contracts build`
   - `pnpm --filter @codechatter/api typecheck`
   - `pnpm --filter @codechatter/api test`
   - `pnpm --filter @codechatter/web exec eslint <files>`
   - `pnpm --filter @codechatter/web typecheck`
   - from `apps/api`, with the dev stack running: `node test/audit.e2e.mjs`
4. Anything you assumed (for example, whether Better Auth's member role for the creator of a personal org is exactly `"owner"`) that the owner should check.
