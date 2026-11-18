/** Verify unread query batching, cursor validation, literal scoped search, contextual history and deletion-driven live refreshes. */
import type { DbHandle } from "@codechatter/db";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { MessagesService } from "./messages.service.js";

const dialect = new PgDialect({ casing: "snake_case" });
const id = (number: number) => `019baabc-0000-7000-8000-${String(number).padStart(12, "0")}`;
const state = { roomId: "E2ETST", count: 3, readThroughId: id(1), firstUnreadId: id(2) };
function row(number: number) {
  return {
    message: {
      id: id(number),
      roomId: "E2ETST",
      userId: "sender",
      kind: "text",
      body: `Message ${number}`,
      clientId: null,
      createdAt: new Date("2026-11-18T00:00:00Z"),
    },
    author: { id: "sender", name: "Sender", image: null },
  };
}
function setup() {
  const where = vi.fn<(predicate: SQL) => unknown>();
  const orderBy = vi.fn<(order: SQL) => unknown>();
  const limit = vi.fn<(count: number) => Promise<ReturnType<typeof row>[]>>().mockResolvedValue([]);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: where.mockImplementation(() => ({ orderBy: orderBy.mockImplementation(() => ({ limit })) })),
      })),
    })),
  }));
  const execute = vi.fn().mockResolvedValue([]);
  const returning = vi.fn().mockResolvedValue([{ id: id(1) }]);
  const updateWhere = vi.fn((_predicate: SQL) => ({ returning }));
  const set = vi.fn((_fields: { deletedAt: SQL }) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((_input: { roomId: string; userId: string }) => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const service = new MessagesService({ db: { select, execute, update, insert } } as unknown as DbHandle);
  return {
    service,
    execute,
    select,
    where,
    orderBy,
    limit,
    updateWhere,
    set,
    returning,
    insert,
    values,
    onConflictDoNothing,
  };
}

describe("retried chat sends", () => {
  function sender() {
    const original = { ...row(1).message, clientId: id(99) };
    const returning = vi.fn().mockResolvedValue([]);
    const values = vi.fn(() => ({ onConflictDoNothing: vi.fn(() => ({ returning })) }));
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }));
    const author = vi.fn().mockResolvedValue(row(1).author);
    const execute = vi.fn().mockResolvedValue([{ userId: "reader" }]);
    const service = new MessagesService({
      db: {
        insert: vi.fn(() => ({ values })),
        update,
        execute,
        query: { messages: { findFirst: vi.fn().mockResolvedValue(original) }, user: { findFirst: author } },
      },
    } as unknown as DbHandle);
    return { service, returning, update, author, original, execute };
  }

  it("returns the same original send on a retry and invalidates unread only once", async () => {
    const f = sender();
    const push = vi.fn();
    f.service.setUnreadPush(push);
    f.returning.mockResolvedValueOnce([f.original]).mockResolvedValueOnce([]);
    const input = { roomId: "E2ETST", userId: "sender", clientId: id(99), body: "Message 1" };
    const first = await f.service.create(input),
      retry = await f.service.create(input);
    expect(retry).toEqual(first);
    expect(retry.author?.id).toBe("sender");
    expect(push).toHaveBeenCalledExactlyOnceWith("reader", { roomId: "E2ETST", reason: "message" });
  });

  it("rejects a reused client ID owned by another sender instead of assigning the current author", async () => {
    const f = sender();
    const push = vi.fn();
    f.service.setUnreadPush(push);
    await expect(
      f.service.create({ roomId: "E2ETST", userId: "impostor", clientId: id(99), body: "Different text" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.author).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("chat unread service", () => {
  it("fetches all dashboard room counts in exactly one database call", async () => {
    const f = setup();
    f.execute.mockResolvedValue([
      { ...state, count: 5000 },
      { ...state, roomId: "ROOM02", count: 0, firstUnreadId: null },
    ]);
    expect(await f.service.unread("reader")).toEqual({
      rooms: [
        { ...state, count: 100 },
        { ...state, roomId: "ROOM02", count: 0, firstUnreadId: null },
      ],
    });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("registers a reader without marking anything read", async () => {
    const f = setup();
    f.execute.mockResolvedValue([state]);
    expect(await f.service.unreadInRoom("E2ETST", "reader")).toEqual(state);
    expect(f.values).toHaveBeenCalledWith({ roomId: "E2ETST", userId: "reader" });
    expect(f.onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it("pushes a successful atomic read to the same person's devices and returns authoritative state", async () => {
    const f = setup();
    const push = vi.fn();
    f.service.setUnreadPush(push);
    f.execute
      .mockResolvedValueOnce([{ readThroughId: id(5) }])
      .mockResolvedValueOnce([{ ...state, readThroughId: id(5), count: 0, firstUnreadId: null }]);
    expect(await f.service.markRead("E2ETST", "reader", id(2))).toMatchObject({
      readThroughId: id(5),
      count: 0,
    });
    expect(dialect.sqlToQuery(f.execute.mock.calls[0]![0]).sql).toContain("greatest(");
    expect(push).toHaveBeenCalledExactlyOnceWith("reader", { roomId: "E2ETST", reason: "read" });
  });

  it("does not advance or push a missing or other-room message", async () => {
    const f = setup();
    const push = vi.fn();
    f.service.setUnreadPush(push);
    await expect(f.service.markRead("E2ETST", "reader", id(1))).rejects.toBeInstanceOf(NotFoundException);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("room-scoped chat search and history", () => {
  it("binds escaped AND search terms and cursor, limits to 50, and exposes a More cursor", async () => {
    const f = setup();
    f.limit.mockResolvedValue(Array.from({ length: 51 }, (_, index) => row(100 - index)));
    const result = await f.service.search("E2ETST", { q: "100% path_name C:\\tmp", before: id(110) });
    const predicate = dialect.sqlToQuery(f.where.mock.calls[0]![0]);
    expect(predicate.sql).toContain('"messages"."room_id" =');
    expect(predicate.sql).toContain('"messages"."deleted_at" is null');
    expect(predicate.sql.match(/ilike/g)).toHaveLength(3);
    expect(predicate.params).toEqual(["E2ETST", id(110), "%100\\%%", "%path\\_name%", "%c:\\\\tmp%"]);
    expect(f.limit).toHaveBeenCalledWith(51);
    expect(result.messages).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextBefore).toBe(id(51));
  });

  it("does not invent another search page when only 50 results exist", async () => {
    const f = setup();
    f.limit.mockResolvedValue(Array.from({ length: 50 }, (_, index) => row(100 - index)));
    expect(await f.service.search("E2ETST", { q: "%" })).toMatchObject({ hasMore: false, nextBefore: null });
    expect(dialect.sqlToQuery(f.where.mock.calls[0]![0]).params).toEqual(["E2ETST", "%\\%%"]);
  });

  it("refuses a missing/deleted or other-room context before asking for surrounding messages", async () => {
    const f = setup();
    await expect(f.service.context("E2ETST", id(9))).rejects.toBeInstanceOf(NotFoundException);
    expect(f.limit).toHaveBeenCalledTimes(1);
    const predicate = dialect.sqlToQuery(f.where.mock.calls[0]![0]);
    expect(predicate.params).toEqual(["E2ETST", id(9)]);
    expect(predicate.sql).toContain('"messages"."deleted_at" is null');
  });

  it("returns 25 neighbours each side in chronological order with further-page flags", async () => {
    const f = setup();
    f.limit
      .mockResolvedValueOnce([row(50)])
      .mockResolvedValueOnce(Array.from({ length: 26 }, (_, index) => row(49 - index)))
      .mockResolvedValueOnce(Array.from({ length: 26 }, (_, index) => row(51 + index)));
    const result = await f.service.context("E2ETST", id(50));
    expect(result.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 51 }, (_, index) => id(25 + index)),
    );
    expect(result).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
  });

  it("selects the nearest newer page but preserves the existing newest-first response shape", async () => {
    const f = setup();
    f.limit.mockResolvedValue([row(2), row(3)]);
    expect((await f.service.list("E2ETST", { after: id(1), limit: 2 })).map((message) => message.id)).toEqual(
      [id(3), id(2)],
    );
    expect(dialect.sqlToQuery(f.orderBy.mock.calls[0]![0]).sql).toContain("asc");
  });
});

describe("chat deletion and personal refresh recipients", () => {
  it("soft-deletes only the caller's message and invalidates current permitted readers", async () => {
    const f = setup();
    const push = vi.fn();
    f.service.setUnreadPush(push);
    f.execute.mockResolvedValue([{ userId: "reader" }, { userId: "sender" }]);
    expect(await f.service.deleteOwn("E2ETST", "sender", id(1))).toEqual({ ok: true });
    const predicate = dialect.sqlToQuery(f.updateWhere.mock.calls[0]![0]);
    expect(predicate.params).toEqual(["E2ETST", id(1), "sender"]);
    expect(dialect.sqlToQuery(f.set.mock.calls[0]![0].deletedAt).sql).toContain("coalesce(");
    expect(push.mock.calls).toEqual([
      ["reader", { roomId: "E2ETST", reason: "deleted" }],
      ["sender", { roomId: "E2ETST", reason: "deleted" }],
    ]);
    const audience = dialect.sqlToQuery(f.execute.mock.calls[0]![0]).sql;
    expect(audience).toContain("membership.status = 'active'");
    expect(audience).toContain("room.visibility = 'public'");
  });

  it("returns the same not-found result for a missing message or someone else's message", async () => {
    const f = setup();
    f.returning.mockResolvedValue([]);
    await expect(f.service.deleteOwn("E2ETST", "other", id(1))).rejects.toBeInstanceOf(NotFoundException);
    expect(f.execute).not.toHaveBeenCalled();
  });
});
