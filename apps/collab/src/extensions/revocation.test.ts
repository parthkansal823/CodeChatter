import assert from "node:assert/strict";
import { test } from "node:test";

import type { Hocuspocus } from "@hocuspocus/server";

import { closeRoomConnections } from "./revocation.js";

function connection(userId: string | null = "ana") {
  const log: string[] = [];
  return { log, context: { userId }, close: () => log.push("detached"), webSocket: { close: (code: number) => log.push(`socket ${code}`) } };
}

test("closes the sockets of every document in the room, and nothing else", () => {
  const [files, notes, other] = [connection(), connection(), connection()];
  const documents = new Map([
    ["room:ABC234:files", { connections: new Map([[files, {}]]) }],
    ["room:ABC234:notes", { connections: new Map([[notes, {}]]) }],
    ["room:XYZ789:files", { connections: new Map([[other, {}]]) }],
  ]);
  const closed = closeRoomConnections({ documents } as unknown as Pick<Hocuspocus, "documents">, { roomId: "ABC234" });
  assert.deepEqual(closed, ["room:ABC234:files", "room:ABC234:notes"]);
  // The socket itself must close: detaching alone leaves the browser's editor silently stale.
  assert.deepEqual(files.log, ["detached", "socket 4205"]);
  assert.deepEqual(notes.log, ["detached", "socket 4205"]);
  assert.deepEqual(other.log, []);
});

test("about one person, it closes only their sockets: nobody else, and not the runner's", () => {
  const [ana, ben, runner] = [connection("ana"), connection("ben"), connection(null)];
  const documents = new Map([["room:ABC234:files", { connections: new Map([[ana, {}], [ben, {}], [runner, {}]]) }]]);
  closeRoomConnections({ documents } as unknown as Pick<Hocuspocus, "documents">, { roomId: "ABC234", userId: "ana" });
  assert.deepEqual(ana.log, ["detached", "socket 4205"]);
  assert.deepEqual(ben.log, []);
  assert.deepEqual(runner.log, []);
});

test("a room nobody has open is fine", () => {
  assert.deepEqual(closeRoomConnections({ documents: new Map() } as unknown as Pick<Hocuspocus, "documents">, { roomId: "ABC234" }), []);
});
