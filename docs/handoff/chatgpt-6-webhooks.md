# Task for ChatGPT: outgoing webhooks for CodeChatter organisations

You are helping build **CodeChatter v2**, a real-time collaborative IDE. Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

Your job is the roadmap item "**Outgoing webhooks:** signed with HMAC, with retries and a delivery log."
- An organisation's owners and admins add a webhook (a URL and the events it wants).
- When one of those events happens, CodeChatter POSTs it there as JSON, signed so the receiver can check it came from us.
- A failed delivery is retried with backoff, and every attempt is in a delivery log they can see.

## Stack and house rules

- **API:**
  - NestJS 12 (`apps/api`, ESM: imports end in `.js`), Drizzle ORM on Postgres 18.
  - zod 4 validation through the project's `ZodPipe`, plus `@CurrentSession()` for the signed-in user (from `../auth/current-session.decorator.js`); every route needs a signed-in user (a global guard).
  - Errors are Nest exceptions with plain-English messages.
  - Services are `@Injectable()` and take the database as `@Inject(DB) private readonly handle: DbHandle` (`DB` from `../infra/tokens.js`, `DbHandle` and `schema` from `@codechatter/db`), and env as `@Inject(ENV) private readonly env: Env`.
- **Database:**
  - Tables in `packages/db/src/schema/app.ts`, ids with the project's `uuidv7Pk()` helper, timestamps with `timestamp({ withTimezone: true })`.
  - The owner makes migrations with `pnpm db:generate` and applies them with `pnpm db:migrate`. Give the schema change; **don't hand-write the migration SQL**. Say "run `pnpm db:generate`", and describe the SQL it should produce so the owner can check it.
- **Web:**
  - Next.js 16 and React 19 (React Compiler on), Tailwind 4 tokens (**no hex or rgb colours in TSX**: a hook rejects them), shadcn/ui in `apps/web/components/ui`, `lucide-react` icons.
  - `@tanstack/react-query`, and the fetch helper `api<T>(path, { method, json })` from `@/lib/api`, which throws `ApiError` with `detail`.
  - Dense: `text-xs` tables, 13px UI. Plain English copy.
- **Comments:** every new module starts with a doc comment saying what it is and why.

## Where events come from: the audit log

Every important action already calls `AuditService.record(entry, request)` in `apps/api/src/audit/audit.service.ts`:

```ts
export interface AuditEntry {
  orgId: string | null;
  actorId: string | null;
  action: string;          // e.g. "room.create", "room.delete", "room.update", "repo.commit", "repo.publish", "repo.pull-request", "sandbox.image", "checkpoint.delete"
  targetType?: string;     // e.g. "room"
  targetId?: string;       // e.g. a room code
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  async record(entry: AuditEntry, request?: Request): Promise<void> {
    try {
      await this.handle.db.insert(schema.auditEvents).values({ ...entry, ip: request?.ip ?? null, userAgent: request?.get("user-agent")?.slice(0, 300) ?? null });
    } catch (error) {
      this.logger.error(`audit write failed for ${entry.action}: ${String(error)}`);
    }
  }
}
```

**Make webhooks follow the audit log:** after the audit row is written, queue a delivery for every active webhook of that org that wants the event. Never let webhooks slow down or fail the action: queuing is a quick insert, and sending happens later in a worker. Events with `orgId: null` aren't delivered.

## Safety you must keep

Webhook URLs are typed by users, so they must never reach CodeChatter's own network (SSRF). The API Studio tool already guards this; reuse it, don't write a new one. `apps/api/src/http-studio/ssrf-guard.ts` exports:

```ts
export class BlockedTargetError extends Error {}
export class InvalidTargetError extends Error {}
export class UnresolvedHostError extends Error {}
export function parseInternetUrl(raw: string): URL;                     // http(s) only, throws InvalidTargetError
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type VettedTarget = { url: URL; address: string; family: 4 | 6 };
export async function vetTarget(raw: string, resolve: Resolver): Promise<VettedTarget>;  // refuses private, loopback, link-local… addresses
```

API Studio's service resolves with `(host) => lookup(host, { all: true, verbatim: true })` from `node:dns/promises`.

`apps/api/src/http-studio/transport.ts` exports `transport(req: TransportRequest): Promise<TransportResponse>`. It makes one HTTP exchange with hard limits, no redirects, and the connection pinned to the vetted address:

```ts
export type TransportRequest = { url: URL; method: string; headers: Record<string, string | string[]>; body: Buffer | null; address?: { address: string; family: 4 | 6 }; timeoutMs: number; maxBytes: number };
export type TransportResponse = { status: number; statusText: string; headers: Array<[string, string]>; body: Buffer; truncated: boolean; firstByteMs: number; totalMs: number };
```

Vet the URL **when it's saved and again before every delivery** (DNS can change). Require `https://` in production (`env.NODE_ENV === "production"`); allow `http://` in development.

## What to build

1. **Schema** (`packages/db/src/schema/app.ts`):
   - **`webhooks`:**
     - `id`;
     - `orgId` (references `organization.id`, cascade on delete);
     - `url`;
     - `secretSealed` (the signing secret, encrypted at rest: use `sealToken(key, plain)` and `openToken(key, sealed)` from `apps/api/src/github/token-box.ts`, keyed with `env.BETTER_AUTH_SECRET`, as GitHub tokens are stored);
     - `events` (`text[]`, or `jsonb` of strings; `["*"]` means every event);
     - `active` (boolean, default true);
     - `description`;
     - `createdBy` (references `user.id`, set null);
     - `createdAt` and `updatedAt`.
   - **`webhook_deliveries`:**
     - `id`;
     - `webhookId` (cascade);
     - `event`, `payload` (jsonb);
     - `status`: `"pending" | "delivered" | "failed"`, where failed means given up;
     - `attempts`, `nextAttemptAt`, `lastStatusCode`, `lastError` (text, up to 500 characters), `lastResponse` (the first 2 KB of the body);
     - `createdAt`, `deliveredAt`.
     - An index on `(status, nextAttemptAt)` for the worker, and one on `(webhookId, createdAt desc)` for the log.
2. **Contracts** (`packages/contracts/src/webhooks.ts`, re-exported from `packages/contracts/src/index.ts`):
   - zod `WebhookInput` (`url`, `events` (a non-empty array, at most 50), `description`, `active`);
   - the types `WebhookItem` (never with the secret) and `WebhookDelivery`;
   - `WEBHOOK_EVENTS`: the list of the actions above, plus `"*"`.
3. **API** (`apps/api/src/webhooks/`):
   - **`webhooks.service.ts`:** CRUD; `queue(entry)`, called by `AuditService` after its insert; and the **worker**.
     - The worker runs every 5 seconds (`setInterval`, `unref`), takes up to 20 due deliveries with `select … for update skip locked` (so several API instances never send one twice), sends each, and updates it.
     - Backoff: 1 minute, 5, 30, 2 hours, 6 hours, then **failed** (6 attempts).
     - A 2xx counts as delivered; anything else, a timeout (10 s) or a blocked address is a failure, with its reason recorded.
     - Response bodies are capped (`maxBytes: 64 * 1024`).
   - **What we send:**
     - `POST`, `content-type: application/json`, `user-agent: CodeChatter-Webhooks/1`;
     - `X-CodeChatter-Event: <action>`, `X-CodeChatter-Delivery: <delivery id>`, `X-CodeChatter-Timestamp: <unix seconds>`;
     - `X-CodeChatter-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret>`;
     - body `{ id, event, createdAt, org: { id }, actor: { id, name } | null, target: { type, id } | null, data }`.
   - **`webhooks.controller.ts`**, for owners and admins of the org only (look the caller up in `schema.member`, `organizationId` and `role` in `"owner" | "admin"`; 403 otherwise):
     - `GET /api/orgs/:orgId/webhooks`
     - `POST /api/orgs/:orgId/webhooks`, which answers with the **secret, shown once** (generate 32 random bytes, base64url)
     - `PATCH /api/orgs/:orgId/webhooks/:id`
     - `DELETE /api/orgs/:orgId/webhooks/:id`
     - `POST /api/orgs/:orgId/webhooks/:id/rotate-secret`, which answers with the new secret once
     - `POST /api/orgs/:orgId/webhooks/:id/test`, which queues an event `"ping"` for this webhook only
     - `GET /api/orgs/:orgId/webhooks/:id/deliveries?before=<id>` (50 per page)
     - `POST /api/orgs/:orgId/webhooks/:id/deliveries/:deliveryId/redeliver`
   - **A pure `signature.ts`** with `sign(secret, timestamp, body)` and `verify(…)` (constant-time), and its vitest tests (`signature.test.ts`): a known vector, a wrong secret, an old timestamp (verify takes a tolerance, default 5 minutes).
   - Register the controller and service in `apps/api/src/app.module.ts` (the `controllers` and `providers` arrays), and change `AuditService` to call `webhooks.queue(entry)` after its insert, inside its existing try. Watch for a circular import: if `WebhooksService` needs nothing from `AuditService`, inject `WebhooksService` into `AuditService`.
4. **Web:**
   - **`apps/web/app/(app)/settings/webhooks/page.tsx`**, for the active org (`useMe()` from `@/components/app/app-shell` returns `{ session: { activeOrganizationId }, organizations: [{ id, name, role }] }`):
     - the list of webhooks: URL, events, active switch, last delivery status;
     - **Add webhook** (URL, events as checkboxes with "Everything", description), which shows the secret once with a Copy button;
     - for each webhook: Send a test, Rotate secret, Delete (with a confirm), and its delivery log (time, event, status, HTTP code, attempts, and the next try, expandable to show the payload and the response), with Redeliver.
     - Only owners and admins see it; others get a plain sentence.
   - A link to it in `apps/web/app/(app)/settings/page.tsx`, shown to owners and admins.
5. **Docs:** `docs/webhooks.md` for people writing a receiver: the headers, the body, how to verify the signature (a 10-line Node example and a Python example), the retry schedule, and that an endpoint should answer 2xx fast and do its work later.
6. **API end-to-end test** (`apps/api/test/webhooks-out.e2e.mjs`):
   - It starts its own small HTTP receiver on a free port, and **its own API instance**: `spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], { env: { ...process.env, API_PORT: "4013", LOG_LEVEL: "warn" } })`, then polls `http://127.0.0.1:4013/api/healthz`. Look at `apps/api/test/notifications.e2e.mjs` for this exact pattern.
   - The receiver is on 127.0.0.1, which the SSRF guard would refuse, so add an env switch: **`WEBHOOKS_ALLOW_PRIVATE=1` is honoured only when `NODE_ENV !== "production"`**, and the test sets it on its API instance.
   - Sign in as `test1@codechatter.local` / `codechatter123` (`POST /api/auth/sign-in/email` with an `origin: http://localhost:8080` header; keep the cookie). Get the org with `GET /api/me` (`session.activeOrganizationId`).
   - Check:
     - adding a webhook for `room.create` returns its secret;
     - creating a room (`POST /api/rooms` `{ name }`, then `DELETE` it) delivers one signed POST, and the test verifies the signature;
     - a receiver that answers 500 makes a retry get scheduled;
     - **ping** works;
     - a private URL is refused when saved (on the shared dev API, which doesn't have the switch);
     - test2 gets 403;
     - and cleanup deletes the webhook.
   - Print `PASS`/`FAIL` lines and `N/M passed`, and exit non-zero on failure.

## Files you may touch

- `packages/db/src/schema/app.ts` (add the two tables only)
- `packages/contracts/src/webhooks.ts` (new), `packages/contracts/src/index.ts` (one line)
- `apps/api/src/webhooks/*` (new), `apps/api/src/audit/audit.service.ts`, `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts` (the `WEBHOOKS_ALLOW_PRIVATE` switch)
- `apps/web/app/(app)/settings/webhooks/page.tsx` (new), `apps/web/components/settings/*` (new), `apps/web/app/(app)/settings/page.tsx` (a link)
- `apps/api/test/webhooks-out.e2e.mjs` (new), `docs/webhooks.md` (new)

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's steps, in order:
   1. `pnpm db:generate`, then what to check in the SQL it makes;
   2. `pnpm db:migrate`;
   3. `pnpm --filter @codechatter/contracts build`;
   4. `pnpm --filter @codechatter/api typecheck` and `pnpm --filter @codechatter/api test`;
   5. `pnpm --filter @codechatter/web typecheck`;
   6. from `apps/api`: `node test/webhooks-out.e2e.mjs`.
3. What you assumed, for example how the org member role is stored.
