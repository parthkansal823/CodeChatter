/** Exercise the task model and comment lexer with both node:test and the workspace's existing Vitest command. */
import assert from "node:assert/strict";
import * as Y from "yjs";

import { parseDocName, roomDocName } from "./index.js";
import { createBinaryFile, createFile, maps, textOf } from "./model.js";
import { CodeTaskIndex } from "./task-scan.js";
import { addTask, assignTask, codeTaskCard, codeTaskKey, deleteTask, editTask, findCodeTasks, MAX_TASK_DESCRIPTION, MAX_TASK_TITLE, moveTask, readTasks, restoreTask, scanCodeTasks, taskMaps, type TaskCard } from "./tasks.js";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
const code = (fileId = "file-1", text = "handle retries", line = 2) => codeTaskCard(fileId, { marker: "TODO", text, line });
function sync(a: Y.Doc, b: Y.Doc) { Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); }
function fixture(doc: Y.Doc, title = "Ship it"): TaskCard { const id = addTask(doc, { title, createdBy: "ana" })!; return readTasks(doc).find((card) => card.id === id)!; }

test("tasks is an authorized single-document name, never a per-item kind", () => {
  assert.equal(roomDocName("E2ETST", "tasks"), "room:E2ETST:tasks");
  assert.deepEqual(parseDocName("room:E2ETST:tasks"), { roomId: "E2ETST", kind: "tasks" });
  assert.equal(parseDocName("room:E2ETST:tasks:abcdefgh"), null);
});

test("manual cards can be added, edited, moved, assigned and deleted with bounded data", () => {
  const doc = new Y.Doc();
  const first = fixture(doc);
  assert.equal(first.source, null);
  assert.equal(first.column, "todo");
  assert.equal(first.createdBy, "ana");
  assert.ok(first.createdAt > 0);
  assert.equal(editTask(doc, first.id, { title: "  Send it  ", description: "A useful note" }), true);
  assert.equal(moveTask(doc, first, "doing"), true);
  assert.equal(assignTask(doc, first, "ben"), true);
  assert.deepEqual(readTasks(doc).map(({ title, description, column, assigneeId }) => ({ title, description, column, assigneeId })), [{ title: "Send it", description: "A useful note", column: "doing", assigneeId: "ben" }]);
  assert.equal(assignTask(doc, first, null), true);
  assert.equal(readTasks(doc)[0]!.assigneeId, null);
  assert.equal(deleteTask(doc, first.id), true);
  assert.equal(deleteTask(doc, first.id), false);
  assert.deepEqual(readTasks(doc), []);
  assert.ok(Object.values(taskMaps(doc)).every((map) => map.size === 0));
  assert.equal(addTask(doc, { title: "   ", createdBy: "ana" }), null);
  const long = fixture(doc, "x".repeat(1000));
  editTask(doc, long.id, { description: "n".repeat(10_000) });
  assert.equal(readTasks(doc)[0]!.title.length, MAX_TASK_TITLE);
  assert.equal(readTasks(doc)[0]!.description.length, MAX_TASK_DESCRIPTION);
  assert.equal(editTask(doc, long.id, { title: "" }), false);
  assert.equal(editTask(doc, "absent", { title: "gone" }), false);
});

test("moving different cards at once preserves both and converges even when ranks tie", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = fixture(ana, "First"), second = fixture(ana, "Second");
  sync(ana, ben);
  moveTask(ana, first, "doing");
  moveTask(ben, second, "doing");
  sync(ana, ben);
  assert.equal(readTasks(ana).filter((card) => card.column === "doing").length, 2);
  assert.deepEqual(readTasks(ana), readTasks(ben));
  assert.equal(readTasks(ana)[0]!.order, readTasks(ana)[1]!.order);
  assert.deepEqual(readTasks(ana).map((card) => card.id), [first.id, second.id].sort());
});

test("same-card concurrent moves converge to one whole placement, never mixed column and order", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = fixture(ana);
  const doing = fixture(ana, "Doing peer"), done = fixture(ana, "Done peer");
  moveTask(ana, doing, "doing");
  moveTask(ana, done, "done");
  sync(ana, ben);
  moveTask(ana, first, "doing");
  moveTask(ben, first, "done");
  const one = taskMaps(ana).placements.get(first.id)!, two = taskMaps(ben).placements.get(first.id)!;
  sync(ana, ben);
  const result = taskMaps(ana).placements.get(first.id)!;
  assert.ok(JSON.stringify(result) === JSON.stringify(one) || JSON.stringify(result) === JSON.stringify(two));
  assert.deepEqual(result, taskMaps(ben).placements.get(first.id));
  assert.equal(readTasks(ana).length, 3);
});

test("concurrent text, assignment and movement edit independent keys", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = fixture(ana);
  sync(ana, ben);
  editTask(ana, first.id, { title: "Updated title" });
  moveTask(ben, first, "done");
  assignTask(ben, first, "ben");
  sync(ana, ben);
  assert.equal(readTasks(ana)[0]!.title, "Updated title");
  assert.equal(readTasks(ana)[0]!.column, "done");
  assert.equal(readTasks(ana)[0]!.assigneeId, "ben");
  assert.deepEqual(readTasks(ana), readTasks(ben));
});

test("concurrent first-time code moves and assignments do not overwrite independent state or create duplicates", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = code();
  moveTask(ana, first, "doing");
  assignTask(ben, first, "ben");
  sync(ana, ben);
  const cards = readTasks(ana, [first, { ...first, source: { ...first.source!, line: 99 } }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.column, "doing");
  assert.equal(cards[0]!.assigneeId, "ben");
  assert.equal(cards[0]!.source!.line, 2);
  assert.equal(taskMaps(ana).cards.size, 1);
  assert.deepEqual(cards, readTasks(ben, [first]));
});

test("a stale move or assignment cannot recreate a deleted hand-written card", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = fixture(ana);
  sync(ana, ben);
  deleteTask(ana, first.id);
  moveTask(ben, first, "doing");
  sync(ana, ben);
  assert.deepEqual(readTasks(ana), []);
  assert.deepEqual(readTasks(ben), []);
  assert.equal(moveTask(ana, first, "done"), false);
  assert.equal(assignTask(ana, first, "ben"), false);
});

test("code cards are computed without writes, and identity survives preceding lines and a rename", () => {
  const doc = new Y.Doc();
  let updates = 0;
  doc.on("update", () => updates++);
  const initial = findCodeTasks("app.ts", "// TODO: handle retries\n")[0]!;
  const shifted = findCodeTasks("renamed.ts", "one\ntwo\n// TODO: handle retries\n")[0]!;
  assert.equal(codeTaskKey("file-1", initial.marker, initial.text), codeTaskKey("file-1", shifted.marker, shifted.text));
  assert.notEqual(codeTaskKey("file-1", initial.marker, initial.text), codeTaskKey("file-2", initial.marker, initial.text));
  assert.notEqual(codeTaskKey("file-1", initial.marker, initial.text), codeTaskKey("file-1", "FIXME", initial.text));
  assert.notEqual(codeTaskKey("file-1", initial.marker, initial.text), codeTaskKey("file-1", initial.marker, "changed"));
  readTasks(doc, [codeTaskCard("file-1", initial)]);
  assert.equal(updates, 0);
  assert.ok(Object.values(taskMaps(doc)).every((map) => map.size === 0));
});

test("identical comments have separate stable ordinal IDs through unrelated edits and added lines", () => {
  const doc = new Y.Doc();
  const source = "// TODO: check this\nconst value = 1;\n// TODO: check this\n";
  const cards = (text: string) => findCodeTasks("app.ts", text).map((task) => codeTaskCard("file-1", task));
  const initial = cards(source);
  assert.equal(initial.length, 2);
  assert.notEqual(initial[0]!.id, initial[1]!.id);
  assert.equal(initial[0]!.id, codeTaskKey("file-1", "TODO", "check this"));
  assert.equal(initial[1]!.source!.occurrence, 2);
  moveTask(doc, initial[1]!, "doing");
  assignTask(doc, initial[1]!, "ben");
  const shifted = cards(`\nconst header = 0;\n${source.replace("value = 1", "value = 99")}`);
  assert.deepEqual(shifted.map((card) => card.id), initial.map((card) => card.id));
  assert.deepEqual(shifted.map((card) => card.source!.line), [3, 5]);
  const moved = readTasks(doc, shifted).find((card) => card.id === initial[1]!.id)!;
  assert.equal(moved.column, "doing");
  assert.equal(moved.assigneeId, "ben");
});

test("deleting a later duplicate retains the first ID; deleting the middle of three renumbers later ordinals", () => {
  const cards = (count: number) => findCodeTasks("app.ts", "// TODO: check this\n".repeat(count)).map((task) => codeTaskCard("file-1", task));
  const two = cards(2), one = cards(1), three = cards(3);
  assert.equal(one[0]!.id, two[0]!.id);
  // Identical text carries no authored identity: remaining comments are numbered from the top on every peer.
  const afterMiddleRemoved = findCodeTasks("app.ts", "// TODO: check this\nconst removed = true;\n// TODO: check this\n").map((task) => codeTaskCard("file-1", task));
  assert.equal(afterMiddleRemoved[0]!.id, three[0]!.id);
  assert.equal(afterMiddleRemoved[1]!.id, three[1]!.id);
  assert.notEqual(afterMiddleRemoved[1]!.id, three[2]!.id);
});

test("a board written with legacy three-part code IDs keeps its placement and assignee", () => {
  const doc = new Y.Doc();
  const id = `code:${JSON.stringify(["file-1", "TODO", "check this"])}`;
  const old: TaskCard = { id, title: "check this", description: "", column: "todo", order: 0, assigneeId: null, createdBy: "", createdAt: 0, source: { fileId: "file-1", marker: "TODO", text: "check this", line: 1 } };
  taskMaps(doc).cards.set(id, old);
  taskMaps(doc).placements.set(id, { column: "doing", order: 17.5 });
  taskMaps(doc).assignees.set(id, "ben");
  const live = findCodeTasks("app.ts", "\n// TODO: check this\n// TODO: check this").map((task) => codeTaskCard("file-1", task));
  const merged = readTasks(doc, live);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find((card) => card.id === id), { ...old, column: "doing", order: 17.5, assigneeId: "ben", source: { ...old.source!, line: 2 }, noLongerInCode: false });
  assert.equal(merged.find((card) => card.id !== id)!.column, "todo");
  assert.equal(merged.find((card) => card.id !== id)!.assigneeId, null);
});

test("Undo restores the same effective manual card and refuses code cards or an already restored card", () => {
  const doc = new Y.Doc();
  const first = fixture(doc);
  editTask(doc, first.id, { title: "Edited title", description: "Edited description" });
  moveTask(doc, first, "doing");
  assignTask(doc, first, "ben");
  const snapshot = readTasks(doc)[0]!;
  deleteTask(doc, first.id);
  assert.equal(restoreTask(doc, snapshot), true);
  assert.deepEqual(readTasks(doc), [snapshot]);
  moveTask(doc, readTasks(doc)[0]!, "done");
  assert.equal(restoreTask(doc, snapshot), false);
  assert.equal(readTasks(doc)[0]!.column, "done");
  assert.equal(restoreTask(doc, code()), false);
  assert.equal(taskMaps(doc).cards.size, 1);
});

test("two people deleting and undoing the same manual card converge to one original ID", () => {
  const ana = new Y.Doc(), ben = new Y.Doc();
  const first = fixture(ana);
  moveTask(ana, first, "doing");
  assignTask(ana, first, "ben");
  sync(ana, ben);
  const a = readTasks(ana)[0]!, b = readTasks(ben)[0]!;
  deleteTask(ana, a.id);
  deleteTask(ben, b.id);
  sync(ana, ben);
  assert.equal(restoreTask(ana, a), true);
  assert.equal(restoreTask(ben, b), true);
  sync(ana, ben);
  assert.deepEqual(readTasks(ana), [a]);
  assert.deepEqual(readTasks(ana), readTasks(ben));
  assert.equal(taskMaps(ana).cards.size, 1);
});

test("missing Doing code cards remain as orphans, while missing To do and Done cards disappear", () => {
  const doc = new Y.Doc(), first = code();
  assert.equal(readTasks(doc, [first]).length, 1);
  assert.deepEqual(readTasks(doc), []);
  moveTask(doc, first, "doing");
  assert.equal(readTasks(doc)[0]!.noLongerInCode, true);
  const movedLine = code("file-1", "handle retries", 22);
  assert.equal(readTasks(doc, [movedLine])[0]!.source!.line, 22);
  assert.equal(readTasks(doc, [movedLine])[0]!.noLongerInCode, false);
  assert.equal(editTask(doc, first.id, { title: "The file owns this" }), false);
  moveTask(doc, first, "done");
  assert.deepEqual(readTasks(doc), []);
  assert.equal(readTasks(doc, [movedLine])[0]!.column, "done");
  moveTask(doc, first, "doing");
  deleteTask(doc, first.id);
  assert.deepEqual(readTasks(doc), []);
});

test("insertion before a persisted card changes only the moved card and keeps finite order", () => {
  const doc = new Y.Doc();
  const first = fixture(doc, "First"), second = fixture(doc, "Second"), third = fixture(doc, "Third");
  moveTask(doc, third, "todo", first.id);
  assert.deepEqual(readTasks(doc).map((card) => card.id), [third.id, first.id, second.id]);
  assert.ok(readTasks(doc).every((card) => Number.isFinite(card.order)));
});

test("all required language comment styles and uppercase markers are recognized", () => {
  const cases = [
    ["app.ts", "// TODO: slash", "TODO", "slash"],
    ["app.py", "# FIXME: hash", "FIXME", "hash"],
    ["query.sql", "-- HACK: dash", "HACK", "dash"],
    ["app.c", "/* XXX: block */", "XXX", "block"],
    ["index.html", "<!-- TODO: html -->", "TODO", "html"],
    ["math.m", "% FIXME: percent", "FIXME", "percent"],
    ["app.clj", "; HACK: semicolon", "HACK", "semicolon"],
  ] as const;
  for (const [path, text, marker, body] of cases) assert.deepEqual(findCodeTasks(path, text), [{ line: 1, marker, text: body }]);
  assert.deepEqual(findCodeTasks("app.c", "/*\r\n * TODO: first\r\n * FIXME: second\r\n */"), [{ line: 2, marker: "TODO", text: "first" }, { line: 3, marker: "FIXME", text: "second" }]);
});

test("ordinary quoted strings, escapes, identifiers and non-uppercase or non-boundary markers do not become cards", () => {
  const js = ['const s = "// TODO: string";', "const a = '// FIXME: string';", "const escaped = '\\' // HACK: still string';", 'const triple = """ // XXX: still string """;', "const template = `// TODO: template`;", "const TODOS = 1; const FIXMEs = 2;", "// TODOS FIXME_suffix myTODO todo Fixme XXXword"].join("\n");
  assert.deepEqual(findCodeTasks("app.ts", js), []);
  assert.deepEqual(findCodeTasks("app.py", 's = "# TODO: string"\ns = """\n# FIXME: still a string\n"""\n# TODO: real'), [{ line: 5, marker: "TODO", text: "real" }]);
  assert.deepEqual(findCodeTasks("app.ts", 'let value = 5 % TODO; const FIXMEs = 1;'), []);
});

test("PHP hash comments are recognized alongside slash comments while quoted hashes stay data", () => {
  assert.deepEqual(findCodeTasks("app.php", '<?php\n$s = "# TODO: quoted";\n# TODO: hash task\n$x = 1; // FIXME: slash task'), [{ line: 3, marker: "TODO", text: "hash task" }, { line: 4, marker: "FIXME", text: "slash task" }]);
});

test("Rust lifetimes and loop labels do not hide following comments, while actual character literals remain quoted", () => {
  const source = ["fn f<'a>(x: &'a str) { // TODO: real lifetime task", "  let byte = b'/'; let quoted = '\\''; let unicode = '\\u{1F4A1}'; // FIXME: after characters", "  'outer: loop { break 'outer; } // HACK: after label", '  let text = "// XXX: only a string";', "}"].join("\n");
  assert.deepEqual(findCodeTasks("app.rs", source), [{ line: 1, marker: "TODO", text: "real lifetime task" }, { line: 2, marker: "FIXME", text: "after characters" }, { line: 3, marker: "HACK", text: "after label" }]);
});

test("C and C++ numeric separators do not hide comments or turn prefixed character literals into numbers", () => {
  const source = ["int limit = 1'000; // TODO: decimal", "int mask = 0xAB'CD; // FIXME: hexadecimal", "int bits = 0b10'01; // HACK: binary", "auto value = 1 + u8'c'; // XXX: prefixed character", "auto other = '// TODO: quoted character text';", 'auto text = "// FIXME: only a string";'].join("\n");
  assert.deepEqual(findCodeTasks("app.cpp", source), [{ line: 1, marker: "TODO", text: "decimal" }, { line: 2, marker: "FIXME", text: "hexadecimal" }, { line: 3, marker: "HACK", text: "binary" }, { line: 4, marker: "XXX", text: "prefixed character" }]);
  assert.deepEqual(findCodeTasks("app.c", "int limit = 1'000; // TODO: C separator"), [{ line: 1, marker: "TODO", text: "C separator" }]);
  assert.deepEqual(findCodeTasks("app.cpp", "123\nu8'c'; // TODO: new token\n1/**/u8'c'; // FIXME: comment separates tokens"), [{ line: 2, marker: "TODO", text: "new token" }, { line: 3, marker: "FIXME", text: "comment separates tokens" }]);
});

test("the scanner resumes inside large strings and comments rather than consuming a whole file in one step", () => {
  const source = `const text = "${"x".repeat(100_000)}";\n// TODO: final`;
  const values = [...scanCodeTasks("app.ts", source)];
  assert.ok(values.filter((value) => value === null).length >= 24);
  assert.deepEqual(values.filter((value) => value !== null), [{ line: 2, marker: "TODO", text: "final" }]);
  const comment = [...scanCodeTasks("app.c", `/* ${"x".repeat(20_000)} TODO: final */`)];
  assert.ok(comment.filter((value) => value === null).length >= 4);
  assert.equal(comment.at(-1)!.text, "final");
});

test("prototype-shaped content remains data and malformed shared records are ignored", () => {
  const doc = new Y.Doc();
  const first = fixture(doc, "<script>literal title</script>");
  assignTask(doc, first, "__proto__");
  assert.equal(readTasks(doc)[0]!.assigneeId, "__proto__");
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  taskMaps(doc).cards.set("malformed", JSON.parse('{"__proto__":{"polluted":true}}') as TaskCard);
  assert.equal(readTasks(doc).length, 1);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

function scanIndex(index: CodeTaskIndex, tracked: readonly TaskCard[] = []) {
  const iterator = index.scan(tracked);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return next.value;
}

test("the incremental index rescans only the Y.Text whose real deep event changed", () => {
  const doc = new Y.Doc();
  const one = createFile(doc, { name: "one.ts", content: "// TODO: first" });
  const two = createFile(doc, { name: "two.ts", content: "// TODO: second" });
  const scanned: string[] = [];
  const index = new CodeTaskIndex(doc, 1_000_000, function* (path, text) { scanned.push(path); yield* scanCodeTasks(path, text); });
  const files = [{ id: one, path: "one.ts" }, { id: two, path: "two.ts" }];
  index.setFiles(files);
  const initial = scanIndex(index);
  assert.deepEqual(scanned, ["one.ts", "two.ts"]);
  scanned.length = 0;
  maps(doc).contents.observeDeep((events) => { index.invalidateContents(events); });
  textOf(doc, one)!.insert(0, "\n");
  const updated = scanIndex(index);
  assert.deepEqual(scanned, ["one.ts"]);
  assert.equal(updated.cards.find((card) => card.source?.fileId === one)!.source!.line, 2);
  assert.equal(updated.cards.find((card) => card.source?.fileId === two)!.id, initial.cards.find((card) => card.source?.fileId === two)!.id);
  scanned.length = 0;
  index.setFiles(files.map((file) => ({ ...file })));
  scanIndex(index, updated.cards);
  assert.deepEqual(scanned, []);
  maps(doc).contents.set(two, new Y.Text("// FIXME: replaced source"));
  assert.equal(scanIndex(index).cards.find((card) => card.source?.fileId === two)!.source!.marker, "FIXME");
  assert.deepEqual(scanned, ["two.ts"]);
});

test("metadata changes rescan only added or renamed/moved files and remove deleted results", () => {
  const doc = new Y.Doc();
  const one = createFile(doc, { name: "one.ts", content: "// TODO: first" });
  const two = createFile(doc, { name: "two.ts", content: "// TODO: second" });
  const scanned: string[] = [];
  const index = new CodeTaskIndex(doc, 1_000_000, function* (path, text) { scanned.push(path); yield* scanCodeTasks(path, text); });
  index.setFiles([{ id: one, path: "one.ts" }, { id: two, path: "two.ts" }]);
  scanIndex(index);
  scanned.length = 0;
  index.setFiles([{ id: one, path: "one.ts" }, { id: two, path: "folder/renamed.ts" }]);
  scanIndex(index);
  assert.deepEqual(scanned, ["folder/renamed.ts"]);
  scanned.length = 0;
  const three = createFile(doc, { name: "three.ts", content: "// TODO: added" });
  index.setFiles([{ id: one, path: "one.ts" }, { id: three, path: "three.ts" }]);
  const result = scanIndex(index);
  assert.deepEqual(scanned, ["three.ts"]);
  assert.ok(!result.cards.some((card) => card.source?.fileId === two));
});

test("binary and oversized sources skip copying while a tracked skipped card remains available", () => {
  const doc = new Y.Doc();
  const one = createFile(doc, { name: "one.ts", content: "// TODO: first" });
  const binary = createBinaryFile(doc, { name: "asset.png", blob: { sha256: "a".repeat(64), size: 1, type: "image/png" } });
  const index = new CodeTaskIndex(doc, 50);
  index.setFiles([{ id: one, path: "one.ts" }, { id: binary, path: "asset.png" }]);
  const tracked = scanIndex(index).cards[0]!;
  maps(doc).contents.observeDeep((events) => { index.invalidateContents(events); });
  textOf(doc, one)!.insert(0, "x".repeat(51));
  const source = textOf(doc, one)!;
  const copy = source.toString;
  source.toString = () => { throw new Error("Oversized source must not be copied"); };
  try {
    const result = scanIndex(index, [tracked]);
    assert.equal(result.skipped, 1);
    assert.ok(result.unread.includes(one) && result.unread.includes(binary));
    assert.ok(result.cards.some((card) => card.id === tracked.id));
  } finally { source.toString = copy; }
});

test("a file removed during a scan cannot publish stale cards, and cancellation keeps work dirty", () => {
  const doc = new Y.Doc();
  const file = createFile(doc, { name: "large.ts", content: `const text = "${"x".repeat(12_000)}";\n// TODO: final` });
  let scanned = 0;
  const index = new CodeTaskIndex(doc, 100_000, function* (path, text) { scanned++; yield* scanCodeTasks(path, text); });
  index.setFiles([{ id: file, path: "large.ts" }]);
  const cancelled = index.scan();
  assert.equal(cancelled.next().done, false);
  cancelled.return({ cards: [], capped: false, skipped: 0, unread: [] });
  assert.equal(scanIndex(index).cards.length, 1);
  assert.equal(scanned, 2);
  index.setFiles([{ id: file, path: "renamed.ts" }]);
  const removed = index.scan();
  assert.equal(removed.next().done, false);
  index.setFiles([]);
  let next = removed.next();
  while (!next.done) next = removed.next();
  assert.deepEqual(next.value.cards, []);
  assert.deepEqual(scanIndex(index).cards, []);
});
