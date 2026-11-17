import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOM_EVENTS_QUEUE } from "@codechatter/contracts";
import { createFileAtPath, createFolder, findByPath, initDoc, move, rename, restore, setFileText, trash } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { automationEventsExtension, FileChanges, personOf, watchFileChanges } from "./automation-events.js";

const ana = { source: "connection", connection: { context: { userId: "u-ana", name: "Ana" } } };
const ben = { source: "connection", connection: { context: { userId: "u-ben", name: "Ben" } } };
const sandbox = { source: "connection", connection: { context: { userId: null, name: "Sandbox" } } };

function room() {
  const doc = new Y.Doc();
  initDoc(doc, "blank", [
    { path: "src/app.py", content: "print(1)\n" },
    { path: "README.md", content: "# hi\n" },
  ]);
  return doc;
}
/** Changes the doc as if someone's connection sent it. */
const as = (doc: Y.Doc, origin: unknown, change: () => void) => doc.transact(change, origin);
const idOf = (doc: Y.Doc, path: string) => findByPath(doc, path)!.id;

function collect(doc: Y.Doc) {
  const changes = new FileChanges();
  const stop = watchFileChanges(doc, (id, change, who, from) => changes.note(id, change, who, from));
  return { changes, stop };
}

test("only a person's own connection counts", () => {
  assert.deepEqual(personOf(ana), { id: "u-ana", name: "Ana" });
  assert.equal(personOf(sandbox), null);
  assert.equal(personOf({ source: "redis" }), null);
  assert.equal(personOf({ source: "local" }), null);
  assert.equal(personOf(null), null);
});

test("edits, additions, renames, moves and deletions, with who", () => {
  const doc = room();
  const { changes, stop } = collect(doc);
  as(doc, ana, () => setFileText(doc, idOf(doc, "src/app.py"), "print(2)\n"));
  as(doc, ben, () => createFileAtPath(doc, "src/new.py", "x = 1\n"));
  as(doc, ana, () => rename(doc, idOf(doc, "README.md"), "READ.md"));
  const lib = createFolder(doc, { name: "lib" });
  as(doc, ana, () => move(doc, idOf(doc, "src/app.py"), lib));
  const event = changes.take(doc);
  stop();
  assert.deepEqual(event.files, [
    { path: "lib/app.py", kind: "file", change: "moved", from: "src/app.py" },
    { path: "READ.md", kind: "file", change: "renamed", from: "README.md" },
    { path: "src/new.py", kind: "file", change: "added" },
  ]);
  assert.deepEqual(
    event.by.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { id: "u-ana", name: "Ana" },
      { id: "u-ben", name: "Ben" },
    ],
  );
  assert.equal(changes.size, 0);
});

test("the sandbox's changes and the server's don't count", () => {
  const doc = room();
  const { changes, stop } = collect(doc);
  as(doc, sandbox, () => setFileText(doc, idOf(doc, "src/app.py"), "written by a run\n"));
  as(doc, { source: "local" }, () => createFileAtPath(doc, "seeded.txt", "x"));
  setFileText(doc, idOf(doc, "README.md"), "no origin\n");
  stop();
  assert.equal(changes.size, 0);
});

test("added then deleted is nothing; deleted then restored is a change; renamed back is nothing", () => {
  const doc = room();
  const { changes, stop } = collect(doc);
  as(doc, ana, () => createFileAtPath(doc, "tmp.txt", "x"));
  as(doc, ana, () => trash(doc, idOf(doc, "tmp.txt")));
  const readme = idOf(doc, "README.md");
  as(doc, ana, () => trash(doc, readme));
  as(doc, ana, () => restore(doc, readme));
  const app = idOf(doc, "src/app.py");
  as(doc, ana, () => rename(doc, app, "main.py"));
  as(doc, ana, () => rename(doc, app, "app.py"));
  const event = changes.take(doc);
  stop();
  assert.deepEqual(event.files, [{ path: "README.md", kind: "file", change: "changed" }]);
});

test("a deleted file keeps its path, and a deleted folder is one change", () => {
  const doc = room();
  const { changes, stop } = collect(doc);
  as(doc, ana, () => trash(doc, idOf(doc, "src/app.py")));
  as(doc, ana, () => trash(doc, idOf(doc, "src")));
  const event = changes.take(doc);
  stop();
  assert.deepEqual(event.files, [
    { path: "src", kind: "folder", change: "deleted" },
    { path: "src/app.py", kind: "file", change: "deleted" },
  ]);
});

test("an edited new file is added; many keystrokes are one change", () => {
  const doc = room();
  const { changes, stop } = collect(doc);
  as(doc, ana, () => createFileAtPath(doc, "notes.md", ""));
  for (let i = 0; i < 20; i++) as(doc, ana, () => setFileText(doc, idOf(doc, "notes.md"), "x".repeat(i)));
  for (let i = 0; i < 20; i++) as(doc, ana, () => setFileText(doc, idOf(doc, "README.md"), `# ${i}\n`));
  const event = changes.take(doc);
  stop();
  assert.deepEqual(event.files, [
    { path: "notes.md", kind: "file", change: "added" },
    { path: "README.md", kind: "file", change: "changed" },
  ]);
});

test("the extension queues one event once the edits stop", async () => {
  const pushed: string[] = [];
  const redis = { rpush: async (key: string, value: string) => (pushed.push(`${key} ${value}`), 1), ltrim: async () => "OK" as const };
  const extension = automationEventsExtension(redis as never, { quietMs: 50, mostWaitMs: 1000 });
  const doc = room();
  await extension.afterLoadDocument!({ documentName: "room:ABC123:files", document: doc } as never);
  as(doc, ana, () => setFileText(doc, idOf(doc, "src/app.py"), "a\n"));
  as(doc, ana, () => setFileText(doc, idOf(doc, "src/app.py"), "ab\n"));
  assert.equal(pushed.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(pushed.length, 1);
  const [key, json] = [pushed[0]!.slice(0, ROOM_EVENTS_QUEUE.length), pushed[0]!.slice(ROOM_EVENTS_QUEUE.length + 1)];
  assert.equal(key, ROOM_EVENTS_QUEUE);
  const event = JSON.parse(json);
  assert.equal(event.room, "ABC123");
  assert.equal(event.event, "files.changed");
  assert.deepEqual(event.files, [{ path: "src/app.py", kind: "file", change: "changed" }]);
  // What's left when the document closes goes at once.
  as(doc, ben, () => createFileAtPath(doc, "late.txt", "x"));
  await extension.beforeUnloadDocument!({ documentName: "room:ABC123:files" } as never);
  assert.equal(pushed.length, 2);
  // Other documents aren't watched.
  const page = new Y.Doc();
  await extension.afterLoadDocument!({ documentName: "room:ABC123:pages", document: page } as never);
  page.transact(() => page.getMap("x").set("a", 1), ana);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(pushed.length, 2);
});

test("a long stream of edits still sends within the most wait", async () => {
  const pushed: string[] = [];
  const redis = { rpush: async (_key: string, value: string) => (pushed.push(value), 1), ltrim: async () => "OK" as const };
  const extension = automationEventsExtension(redis as never, { quietMs: 60, mostWaitMs: 150 });
  const doc = room();
  await extension.afterLoadDocument!({ documentName: "room:ABC123:files", document: doc } as never);
  for (let i = 0; i < 10; i++) {
    as(doc, ana, () => setFileText(doc, idOf(doc, "README.md"), `${i}`));
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(pushed.length >= 1, "sent while still being edited");
  await extension.onDestroy!({} as never);
});
