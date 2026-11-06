import assert from "node:assert/strict";
import { test } from "node:test";

import type { Hocuspocus } from "@hocuspocus/server";

import { closeRoomConnections } from "./revocation.js";

function connection() {
  const log: string[] = [];
  return { log, close: () => log.push("detached"), webSocket: { close: (code: number) => log.push(`socket ${code}`) } };
}

test("closes the sockets of every document in the room, and nothing else", () => {
  const [files, notes, other] = [connection(), connection(), connection()];
  const documents = new Map([
    ["room:ABC234:files", { connections: new Map([[files, {}]]) }],
    ["room:ABC234:notes", { connections: new Map([[notes, {}]]) }],
    ["room:XYZ789:files", { connections: new Map([[other, {}]]) }],
  ]);
  const closed = closeRoomConnections({ documents } as unknown as Pick<Hocuspocus, "documents">, "ABC234");
  assert.deepEqual(closed, ["room:ABC234:files", "room:ABC234:notes"]);
  // The socket itself must close: detaching alone leaves the browser's editor silently stale.
  assert.deepEqual(files.log, ["detached", "socket 4205"]);
  assert.deepEqual(notes.log, ["detached", "socket 4205"]);
  assert.deepEqual(other.log, []);
});

test("a room nobody has open is fine", () => {
  assert.deepEqual(closeRoomConnections({ documents: new Map() } as unknown as Pick<Hocuspocus, "documents">, "ABC234"), []);
});
