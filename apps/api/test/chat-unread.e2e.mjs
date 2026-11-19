/**
 * Verify chat unread eligibility and monotonic cursors against PostgreSQL, including
 * searchable integration posts. Every fixture lives in one rolled-back transaction.
 * From apps/api: node --env-file=../../.env test/chat-unread.e2e.mjs
 */
import "reflect-metadata";

import { createHash, randomUUID } from "node:crypto";

import { createDb, schema } from "@codechatter/db";
import { eq, inArray } from "drizzle-orm";

import { MessagesService } from "../dist/messages/messages.service.js";

const rollback = new Error("FixtureRollback");
const roomId = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const baseId = randomUUID().slice(0, -12);
const id = (number) => `${baseId}${String(number).padStart(12, "0")}`;
const body = `chat-unread-${randomUUID()}`;
let handle;
let stage = "configuration";
let passed = 0;

function check(name, condition) {
  if (!condition) throw new Error("CheckFailed");
  passed++;
  console.log(`PASS  ${name}`);
}

try {
  if (!process.env.DATABASE_URL) throw new Error("MissingConfiguration");
  handle = createDb(process.env.DATABASE_URL, { max: 1 });
  try {
    await handle.db.transaction(async (tx) => {
      stage = "fixtures";
      const people = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.user)
        .where(inArray(schema.user.email, ["test1@codechatter.local", "test2@codechatter.local"]));
      const author = people.find((person) => person.email === "test1@codechatter.local");
      const reader = people.find((person) => person.email === "test2@codechatter.local");
      const [seed] = await tx.select().from(schema.rooms).where(eq(schema.rooms.id, "E2ETST")).limit(1);
      if (!author || !reader || !seed) throw new Error("MissingSeedFixtures");
      await tx.insert(schema.rooms).values({
        ...seed, id: roomId, name: "Chat unread transaction fixture",
        inviteTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      });
      await tx.insert(schema.messages).values([
        { id: id(1), roomId, userId: author.id, body: `${body} normal`, kind: "text" },
        { id: id(2), roomId, userId: null, body: `${body} retained author`, kind: "text" },
        { id: id(3), roomId, userId: null, body: `${body} integration`, kind: "automation" },
        { id: id(4), roomId, userId: null, body: `${body} system`, kind: "system" },
        { id: id(5), roomId, userId: null, body: `${body} repository`, kind: "github" },
        { id: id(6), roomId, userId: reader.id, body: `${body} own`, kind: "text" },
        { id: id(7), roomId, userId: author.id, body: `${body} deleted`, kind: "text", deletedAt: new Date() },
      ]);
      const messages = new MessagesService({ db: tx });

      stage = "unread eligibility";
      const unread = await messages.unreadInRoom(roomId, reader.id);
      check("only other people's retained messages count as unread", unread.count === 2 && unread.firstUnreadId === id(1));

      stage = "integration search";
      const found = await messages.search(roomId, { q: `${body} integration` });
      check("automation posts remain searchable without contributing to unread", found.messages.length === 1 && found.messages[0].id === id(3));
      const deleted = await messages.search(roomId, { q: `${body} deleted` });
      check("deleted messages are absent from search", deleted.messages.length === 0);

      stage = "monotonic cursors";
      const later = await messages.markRead(roomId, reader.id, id(2));
      const stale = await messages.markRead(roomId, reader.id, id(1));
      check("reading a later message clears its unread prefix", later.count === 0 && later.readThroughId === id(2));
      check("a stale second device cannot move the cursor backwards", stale.count === 0 && stale.readThroughId === id(2));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  stage = "rollback verification";
  const remaining = await handle.db.select({ id: schema.rooms.id }).from(schema.rooms).where(eq(schema.rooms.id, roomId));
  check("the transaction leaves no fixture room or messages", remaining.length === 0);
  console.log(`\n${passed}/${passed} passed`);
} catch {
  // Database errors can include query values or connection details; keep output structural.
  console.error(`FAIL  chat unread database workflow (${stage})`);
  process.exitCode = 1;
} finally {
  await handle?.close();
}
