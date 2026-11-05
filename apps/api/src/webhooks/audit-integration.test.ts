/** Keep audit storage and webhook queuing failures isolated from the action that recorded them. */
import type { DbHandle } from "@codechatter/db";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "../audit/audit.service.js";
import type { WebhooksService } from "./webhooks.service.js";

const entry = { orgId: "org", actorId: "actor", action: "room.create", targetType: "room", targetId: "LOAD01", data: { name: "Audit test" } };
const written = { id: "019b76da-a800-7000-8000-000000000001", createdAt: new Date("2026-01-01T00:00:00Z") };

function setup() {
  const returning = vi.fn().mockResolvedValue([written]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  const queue = vi.fn().mockResolvedValue(undefined);
  const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  const audit = new AuditService({ db: { insert } } as unknown as DbHandle, { queue } as unknown as WebhooksService);
  return { audit, returning, values, queue, error };
}

afterEach(() => vi.restoreAllMocks());

describe("audit to outgoing-webhook integration", () => {
  it("queues the stable event only after its audit row has been stored", async () => {
    const { audit, returning, values, queue, error } = setup();
    await expect(audit.record(entry)).resolves.toBeUndefined();
    expect(values).toHaveBeenCalledWith({ ...entry, ip: null, userAgent: null });
    expect(queue).toHaveBeenCalledExactlyOnceWith({ ...entry, ...written });
    expect(returning.mock.invocationCallOrder[0]).toBeLessThan(queue.mock.invocationCallOrder[0]!);
    expect(error).not.toHaveBeenCalled();
  });

  it("does not queue an event whose audit insert failed and does not fail the action", async () => {
    const { audit, returning, queue, error } = setup();
    returning.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(audit.record(entry)).resolves.toBeUndefined();
    expect(queue).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith("audit write failed for room.create: Error: database unavailable");
  });

  it("keeps a stored event and logs a queue failure separately without failing the action", async () => {
    const { audit, returning, queue, error } = setup();
    queue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(audit.record(entry)).resolves.toBeUndefined();
    expect(returning).toHaveBeenCalledOnce();
    expect(queue).toHaveBeenCalledExactlyOnceWith({ ...entry, ...written });
    expect(error).toHaveBeenCalledExactlyOnceWith("webhook queue failed for room.create: Error: queue unavailable");
  });
});
