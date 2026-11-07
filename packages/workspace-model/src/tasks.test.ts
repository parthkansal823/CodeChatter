/** Exercise the task model and comment lexer with both node:test and the workspace's existing Vitest command. */
import assert from "node:assert/strict";
import * as Y from "yjs";

import { parseDocName, roomDocName } from "./index.js";
import { addTask, assignTask, codeTaskCard, codeTaskKey, deleteTask, editTask, findCodeTasks, MAX_TASK_DESCRIPTION, MAX_TASK_TITLE, moveTask, readTasks, scanCodeTasks, taskMaps, type TaskCard } from "./tasks.js";

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
