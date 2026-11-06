/** Exercise delivery safety, retry accounting and organisation scoping without making network calls. */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { schema, type DbHandle } from "@codechatter/db";
import { WebhookPatch } from "@codechatter/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../config/env.js";
import { openToken, sealToken } from "../github/token-box.js";
import { transport } from "../http-studio/transport.js";
import { verify } from "./signature.js";
import { RETRY_MS, WebhooksService } from "./webhooks.service.js";

vi.mock("../http-studio/transport.js", () => ({ transport: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) }));

type Hook = typeof schema.webhooks.$inferSelect;
type Delivery = typeof schema.webhookDeliveries.$inferSelect;
const key = "a".repeat(40);
const now = new Date("2026-01-01T00:00:00Z");
const hook: Hook = {
  id: "019b76da-a800-7000-8000-000000000001", orgId: "org", url: "https://receiver.example/events", events: ["room.create"],
  secretSealed: sealToken(key, "webhook-secret"), privateTestOwner: null, active: true, description: "", createdBy: "owner", createdAt: now, updatedAt: now,
};
const delivery: Delivery = {
  id: "019b76da-a800-7000-8000-000000000002", webhookId: hook.id, event: "room.create",
  payload: { id: "event", event: "room.create", createdAt: now.toISOString(), org: { id: "org" }, actor: null, target: null, data: {} },
  status: "pending", attempts: 0, nextAttemptAt: now, lastStatusCode: null, lastError: null, lastResponse: null,
  attemptLog: [], createdAt: now, deliveredAt: null, lockedBy: null, lockedUntil: null,
};

function query(rows: unknown[]) {
  const q = {
    from: vi.fn(() => q), where: vi.fn(() => q), orderBy: vi.fn(() => q), limit: vi.fn(() => q),
    innerJoin: vi.fn(() => q), for: vi.fn(() => q), getSQL: () => sql`select 1`,
    then: Promise.resolve(rows).then.bind(Promise.resolve(rows)),
  };
  return q;
}

function setup(selectRows: unknown[][] = [], overrides: Partial<Env> = {}) {
  const selected: ReturnType<typeof query>[] = [];
  const sets: Record<string, unknown>[] = [];
  const inserted: unknown[] = [];
  const returns: unknown[][] = [];
  const claims: Record<string, unknown>[] = [];
  const predicates: SQL[] = [];
  const cleanupLimits: number[] = [];
  const deleted: unknown[][] = [];
  const acknowledgements: Array<Error | undefined> = [];
  const workerRows = selectRows[0]?.some((row) => Boolean((row as { delivery?: unknown }).delivery))
    ? selectRows.shift() as Array<{ hook: Hook; delivery: Delivery }> : [];
  let inTransaction = false;
  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      const idOnly = fields && Object.keys(fields).length === 1 && fields.id === schema.webhookDeliveries.id;
      const q = query(idOnly ? [] : selectRows.shift() ?? workerRows.map((row) => row.hook));
      if (idOnly) {
        const limit = q.limit;
        q.limit = vi.fn((n: number) => { if (n === 1000) cleanupLimits.push(n); return limit(); });
      }
      selected.push(q); return q;
    }),
    selectDistinctOn: vi.fn(() => { const q = query(selectRows.shift() ?? []); selected.push(q); return q; }),
    insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { inserted.push(value); return { returning: vi.fn(async () => returns.shift() ?? [hook]), then: Promise.resolve().then.bind(Promise.resolve()) }; }) })),
    update: vi.fn((table: unknown) => ({ set: vi.fn((value: Record<string, unknown>) => {
      const claim = typeof value.lockedBy === "string";
      (claim ? claims : sets).push(value);
      return { where: vi.fn((predicate: SQL) => {
        predicates.push(predicate);
        const failure = !claim && value.attemptLog ? acknowledgements.shift() : undefined;
        const promise = failure ? Promise.reject(failure) : Promise.resolve();
        // Attach rejection handling immediately; the caller still observes the rejected await.
        void promise.catch(() => {});
        return {
          returning: vi.fn(async () => claim ? workerRows.map((row) => ({ ...row.delivery, lockedBy: value.lockedBy, lockedUntil: new Date(Date.now() + 60_000) })) : returns.shift() ?? [table === schema.webhooks ? hook : delivery]),
          then: promise.then.bind(promise),
        };
      }) };
    }) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => deleted.shift() ?? []) })) })),
    transaction: vi.fn(async (callback: (tx: DbHandle["db"]) => Promise<unknown>) => {
      inTransaction = true;
      try { return await callback(db as unknown as DbHandle["db"]); } finally { inTransaction = false; }
    }),
  };
  const env = { NODE_ENV: "test", BETTER_AUTH_SECRET: key, WEBHOOKS_ALLOW_PRIVATE: false, ...overrides } as Env;
  const service = new WebhooksService({ db } as unknown as DbHandle, env);
  return { service, db, selected, sets, inserted, returns, claims, predicates, cleanupLimits, deleted, acknowledgements, inTransaction: () => inTransaction };
}

beforeEach(() => vi.clearAllMocks());

describe("outgoing webhook administration", () => {
  it("does not apply create defaults to a partial update", () => {
    expect(WebhookPatch.parse({ active: false })).toEqual({ active: false });
    expect(WebhookPatch.parse({ description: "Updated" })).toEqual({ description: "Updated" });
    expect(WebhookPatch.safeParse({}).success).toBe(false);
  });

  it("refuses members and nonmembers before exposing endpoint data", async () => {
    for (const memberships of [[], [{ role: "member" }], [{ role: "owner,admin" }]]) {
      const { service, db } = setup([memberships]);
      await expect(service.list("org", "outsider")).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.select).toHaveBeenCalledTimes(1);
    }
  });

  it("returns a new secret once and seals it at rest", async () => {
    const { service, inserted } = setup([[{ role: "owner" }]]);
    const result = await service.create("org", "owner", { url: hook.url, events: ["room.create"], description: "", active: true });
    expect(Buffer.from(result.secret, "base64url")).toHaveLength(32);
    const saved = inserted[0] as Record<string, unknown>;
    expect(openToken(key, saved.secretSealed as string)).toBe(result.secret);
    expect(JSON.stringify(result.webhook)).not.toContain("secret");
    expect(JSON.stringify(result.webhook)).not.toContain("privateTestOwner");
  });

  it("rejects private URLs on save and still requires HTTPS in production", async () => {
    const ordinary = setup([[{ role: "owner" }]]);
    await expect(ordinary.service.create("org", "owner", { url: "http://127.0.0.1:9000", events: ["*"], active: true, description: "" })).rejects.toThrow("Blocked");
    expect(ordinary.db.insert).not.toHaveBeenCalled();
    for (const url of ["http://8.8.8.8", "https://127.0.0.1"]) {
      const prod = setup([[{ role: "admin" }]], { NODE_ENV: "production", WEBHOOKS_ALLOW_PRIVATE: true });
      await expect(prod.service.create("org", "admin", { url, events: ["*"], active: true, description: "" })).rejects.toThrow();
      expect(prod.db.insert).not.toHaveBeenCalled();
    }
  });

  it("keeps a private development fixture assigned to its own API process", async () => {
    const { service, inserted } = setup([[{ role: "owner" }]], { WEBHOOKS_ALLOW_PRIVATE: true });
    await service.create("org", "owner", { url: "http://127.0.0.1:9000", events: ["*"], active: true, description: "" });
    expect((inserted[0] as Record<string, unknown>).privateTestOwner).toEqual(expect.any(String));
  });

  it("lists only explicit public fields, with the latest delivery state", async () => {
    const { service } = setup([[{ role: "admin" }], [hook], [{ webhookId: hook.id, status: "failed", createdAt: now, lastStatusCode: 500 }]]);
    const result = await service.list("org", "owner");
    expect(result.items[0]?.lastDelivery?.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secretSealed");
    expect(JSON.stringify(result)).not.toContain("privateTestOwner");
  });

  it("keeps failed-attempt history when a manual redelivery resets the retry budget", async () => {
    const { service, sets } = setup([[{ role: "owner" }], [hook]]);
    await service.redeliver("org", "owner", hook.id, delivery.id);
    expect(sets[0]).toMatchObject({ status: "pending", attempts: 0, deliveredAt: null });
    expect(sets[0]).not.toHaveProperty("attemptLog");
    expect(sets[0]).not.toHaveProperty("payload");
  });
});

describe("outgoing webhook queue", () => {
  it("ignores events without an organisation without touching the database", async () => {
    const { service, db } = setup();
    await service.queue({ orgId: null, actorId: null, action: "room.create" });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts only matching subscriptions and keeps the audit event ID stable", async () => {
    const { service, inserted, db, selected } = setup([[{ id: "a", events: ["room.create"] }, { id: "b", events: ["*"] }, { id: "c", events: ["room.delete"] }]]);
    await service.queue({ id: "audit-event", createdAt: now, orgId: "org", actorId: null, action: "room.create", targetType: "room", targetId: "LOAD01", data: { name: "Load" } });
    const rows = inserted[0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.webhookId)).toEqual(["a", "b"]);
    expect(rows[0]?.payload).toEqual(rows[1]?.payload);
    expect(rows[0]?.payload).toMatchObject({ id: "audit-event", createdAt: now.toISOString(), target: { type: "room", id: "LOAD01" }, actor: null });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(selected[0]?.for).toHaveBeenCalledWith("share");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("outgoing webhook worker", () => {
  it("claims at most twenty due rows with skip-locked row locks and logs a signed success", async () => {
    vi.mocked(transport).mockResolvedValue({ status: 204, statusText: "No Content", headers: [], body: Buffer.alloc(0), truncated: false, totalMs: 1, firstByteMs: 1 });
    const { service, selected, sets } = setup([[{ hook, delivery }]]);
    await service.runWorker();
    expect(selected[0]?.limit).toHaveBeenCalledWith(20);
    expect(selected[0]?.for).toHaveBeenCalledWith("update", { of: schema.webhookDeliveries, skipLocked: true });
    expect(sets[0]).toMatchObject({ status: "delivered", attempts: 1, lastStatusCode: 204, lastError: null, nextAttemptAt: null });
    const request = vi.mocked(transport).mock.calls[0]![0];
    expect(request.address).toEqual({ address: "8.8.8.8", family: 4 });
    expect(request.maxBytes).toBe(65536);
    expect(request.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(request.headers["X-CodeChatter-Delivery"]).toBe(delivery.id);
    expect(verify("webhook-secret", request.headers["X-CodeChatter-Timestamp"] as string, request.body!, request.headers["X-CodeChatter-Signature"] as string)).toBe(true);
    expect(sets[0]?.attemptLog).toHaveLength(1);
  });

  it("uses all five backoff steps and gives up on the sixth failed attempt", async () => {
    vi.mocked(transport).mockResolvedValue({ status: 500, statusText: "Error", headers: [], body: Buffer.from("failed"), truncated: false, totalMs: 1, firstByteMs: 1 });
    for (let count = 0; count < 6; count++) {
      const { service, sets } = setup([[{ hook, delivery: { ...delivery, attempts: count } }]]);
      const before = Date.now();
      await service.runWorker();
      expect(sets[0]).toMatchObject({ attempts: count + 1, status: count === 5 ? "failed" : "pending", lastStatusCode: 500 });
      if (count < 5) expect((sets[0]?.nextAttemptAt as Date).getTime() - before).toBeGreaterThanOrEqual(RETRY_MS[count]!);
      else expect(sets[0]?.nextAttemptAt).toBeNull();
    }
  });

  it("records timeouts, caps errors and stores only the first 2 KB of response", async () => {
    vi.mocked(transport).mockRejectedValueOnce(new Error("x".repeat(1000)));
    const timeout = setup([[{ hook, delivery }]]);
    await timeout.service.runWorker();
    expect(timeout.sets[0]?.lastError).toHaveLength(500);
    vi.mocked(transport).mockResolvedValueOnce({ status: 200, statusText: "OK", headers: [], body: Buffer.alloc(65536, "a"), truncated: false, totalMs: 1, firstByteMs: 1 });
    const large = setup([[{ hook, delivery }]]);
    await large.service.runWorker();
    expect(large.sets[0]?.lastResponse).toHaveLength(2048);
  });

  it("rechecks DNS before sending and refuses a rebound address even on the test API", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    const { service, sets } = setup([[{ hook, delivery }]], { WEBHOOKS_ALLOW_PRIVATE: true });
    await service.runWorker();
    expect(transport).not.toHaveBeenCalled();
    expect(sets[0]?.lastError).toContain("Blocked");
  });

  it("never overlaps ticks in one process", async () => {
    let finish: (() => void) | undefined;
    const { service, db } = setup();
    db.transaction.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = service.runWorker();
    await service.runWorker();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    finish!();
    await first;
  });
});
