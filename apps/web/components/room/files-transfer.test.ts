// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { importSummary, MAX_FILE_BYTES, planImport } from "./files-transfer";

const entry = (path: string, text: string | Uint8Array) => ({ path, data: typeof text === "string" ? new TextEncoder().encode(text) : text });

describe("planImport", () => {
  it("takes text files at their paths, under the folder they were dropped on", () => {
    const plan = planImport([entry("a.py", "x = 1\n"), entry("lib/b.py", "y = 2\n")], { into: "src", existing: new Set(["src/a.py"]), fromZip: false });
    assert.deepEqual([...plan.files.keys()], ["src/a.py", "src/lib/b.py"]);
    assert.deepEqual(plan.replaced, ["src/a.py"]);
    assert.deepEqual(plan.added, ["src/lib/b.py"]);
  });

  it("drops a zip's one top folder, as GitHub's zips have", () => {
    const plan = planImport([entry("project-main/README.md", "# P"), entry("project-main/src/app.ts", "")], { into: "", existing: new Set(), fromZip: true });
    assert.deepEqual([...plan.files.keys()], ["README.md", "src/app.ts"]);
    // Not when the files don't all share it, nor for files picked one by one.
    const mixed = planImport([entry("a/x.txt", "1"), entry("b/y.txt", "2")], { into: "", existing: new Set(), fromZip: true });
    assert.deepEqual([...mixed.files.keys()], ["a/x.txt", "b/y.txt"]);
  });

  it("skips binaries, big files and folders no one means to import, saying why", () => {
    const plan = planImport(
      [
        entry("logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13])),
        entry("bad.txt", new Uint8Array([0xff, 0xfe, 0xfd])),
        entry("huge.txt", "x".repeat(MAX_FILE_BYTES + 1)),
        entry("node_modules/left-pad/index.js", "module.exports = 1"),
        entry(".git/config", "[core]"),
        entry("keep.md", "kept"),
      ],
      { into: "", existing: new Set(), fromZip: false },
    );
    assert.deepEqual([...plan.files.keys()], ["keep.md"]);
    assert.deepEqual(
      plan.skipped.map((s) => s.path),
      ["logo.png", "bad.txt", "huge.txt", "node_modules/left-pad/index.js", ".git/config"],
    );
    assert.match(plan.skipped[0]!.reason, /isn't text/);
    assert.match(plan.skipped[2]!.reason, /over 1 MB/);
  });

  it("sums it up in a sentence", () => {
    const plan = planImport([entry("a.txt", "1"), entry("b.txt", "2"), entry("c.bin", new Uint8Array([0]))], { into: "", existing: new Set(["a.txt"]), fromZip: false });
    assert.equal(importSummary(plan), "Imported 2 files (1 replaced). Skipped 1: c.bin, because it isn't text (images and other binary files can't be added to a room yet).");
  });
});
