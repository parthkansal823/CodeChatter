// Files in automations (files.mjs), on their own: node --test sandbox/image/automation/files.test.mjs. The whole way, on the real engine, in
// apps/runner/test/automation-files.e2e.mjs.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { dispositionOf, fileNameOf, filesHere, filesMatching, patternOf, roomPathOf, stepFileUrl, typeOf, wholeSteps } from "./files.mjs";

test("a file's name, its type, and how it's given back", () => {
  assert.equal(fileNameOf("report.csv"), "report.csv");
  assert.equal(fileNameOf("../../etc/passwd"), "passwd", "no folders");
  assert.equal(fileNameOf("C:\\temp\\notes.txt"), "notes.txt");
  assert.equal(fileNameOf("bad\u0000\nname.txt"), "badname.txt", "no control characters");
  assert.equal(fileNameOf(""), "file");
  assert.equal(fileNameOf(".."), "file");
  assert.equal(fileNameOf("x".repeat(300)).length, 200);
  assert.equal(typeOf("a.CSV"), "text/csv");
  assert.equal(typeOf("archive.zip"), "application/zip");
  assert.equal(typeOf("noextension"), "application/octet-stream");
  // The engine reads the name back with filename\*=UTF-8''([\w%\-.]+): everything else is encoded.
  const disposition = dispositionOf("My report (final)!.csv");
  assert.equal(disposition, "attachment; filename*=UTF-8''My%20report%20%28final%29%21.csv");
  const read = /filename\*=UTF-8''([\w%\-.]+)(?:; ?|$)/i.exec(disposition);
  assert.equal(decodeURIComponent(read[1]), "My report (final)!.csv");
  assert.equal(stepFileUrl(4100, "run-1", "f1", "a b.csv"), "http://127.0.0.1:4100/v1/step-files/run-1/f1/a%20b.csv");
});

test("files from an earlier worker are read from this one", () => {
  const old = { file: "http://127.0.0.1:38211/v1/step-files/r1/f1/a.csv", list: ["http://127.0.0.1:40001/v1/step-files/r2/f2/b.zip"], other: "http://127.0.0.1:38211/v1/files/x" };
  assert.deepEqual(filesHere(old, 5000), { file: "http://127.0.0.1:5000/v1/step-files/r1/f1/a.csv", list: ["http://127.0.0.1:5000/v1/step-files/r2/f2/b.zip"], other: "http://127.0.0.1:38211/v1/files/x" });
  const plain = { a: 1 };
  assert.equal(filesHere(plain, 5000), plain, "nothing to move, nothing copied");
  assert.equal(filesHere(undefined, 5000), undefined);
});

test("outputs kept apart are put back, in loops too, up to a budget", () => {
  const kept = { s1: Buffer.from(JSON.stringify({ text: "x".repeat(50) })), s2: Buffer.from(JSON.stringify([1, 2, 3])), bad: Buffer.from("{ not json") };
  const read = (id) => kept[id] ?? null;
  const steps = {
    big: { type: "CODE", status: "SUCCEEDED", outputType: "slice", output: { fileId: "s1", size: 61, url: "http://127.0.0.1:1/v1/files/s1" } },
    small: { type: "CODE", status: "SUCCEEDED", output: { ok: true } },
    loop: { type: "LOOP_ON_ITEMS", output: { iterations: [{ inner: { outputType: "slice", output: { fileId: "s2", size: 7 } } }] } },
    broken: { outputType: "slice", output: { fileId: "bad", size: 10 } },
    gone: { outputType: "slice", output: { fileId: "missing", size: 10 } },
  };
  wholeSteps(steps, read);
  assert.deepEqual(steps.big, { type: "CODE", status: "SUCCEEDED", output: { text: "x".repeat(50) } });
  assert.deepEqual(steps.small.output, { ok: true });
  assert.deepEqual(steps.loop.output.iterations[0].inner, { output: [1, 2, 3] });
  assert.equal(steps.broken.outputType, "slice", "what can't be read stays as it was");
  assert.equal(steps.gone.outputType, "slice");
  const tight = { big: { outputType: "slice", output: { fileId: "s1", size: 61 } } };
  wholeSteps(tight, read, { left: 10 });
  assert.equal(tight.big.outputType, "slice", "past the budget, it stays apart");
});

test("paths in the room, and patterns", () => {
  assert.equal(roomPathOf("./reports/a.csv"), "reports/a.csv");
  assert.equal(roomPathOf("reports\\a.csv"), "reports/a.csv");
  assert.equal(roomPathOf("reports//x/./a.csv"), "reports/x/a.csv");
  for (const outside of ["/etc/passwd", "../x", "a/../../x", "C:/x"]) assert.throws(() => roomPathOf(outside), /should be a path in the room/, outside);
  assert.throws(() => roomPathOf("  "), /Say which file/);
  const csv = patternOf("reports/*.csv");
  assert.ok(csv.test("reports/a.csv"));
  assert.ok(!csv.test("reports/2026/a.csv"), "* stays in its folder");
  assert.ok(!csv.test("reports/a.csv.bak"));
  const deep = patternOf("docs/**/*.md");
  assert.ok(deep.test("docs/a.md"), "** can be no folders");
  assert.ok(deep.test("docs/x/y/a.md"));
  assert.ok(patternOf("**/*.{ts,tsx}").test("src/app/page.tsx"));
  assert.ok(patternOf("data?.json").test("data1.json"));
  assert.ok(!patternOf("data?.json").test("data12.json"));
  assert.ok(patternOf("a+b (1).txt").test("a+b (1).txt"), "other characters are themselves");
});

test("the room's files a pattern names, never .git or node_modules unless named", () => {
  const root = mkdtempSync(join(tmpdir(), "files-"));
  try {
    for (const path of ["reports/b.csv", "reports/a.csv", "reports/2026/c.csv", "reports/notes.txt", ".git/x.csv", "node_modules/p/d.csv", "top.csv"]) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), "x");
    }
    assert.deepEqual(filesMatching(root, "reports/*.csv"), { paths: ["reports/a.csv", "reports/b.csv"], more: false });
    assert.deepEqual(filesMatching(root, "**/*.csv").paths, ["reports/2026/c.csv", "reports/a.csv", "reports/b.csv", "top.csv"]);
    assert.deepEqual(filesMatching(root, "node_modules/**/*.csv").paths, ["node_modules/p/d.csv"]);
    assert.deepEqual(filesMatching(root, "**/*.csv", 2), { paths: ["reports/2026/c.csv", "reports/a.csv"], more: true });
    assert.deepEqual(filesMatching(root, "reports/a.csv"), { paths: ["reports/a.csv"], more: false }, "a plain path is itself, there or not");
    assert.deepEqual(filesMatching(root, "nothing/*.csv").paths, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
