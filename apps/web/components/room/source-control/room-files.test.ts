// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBinaryFileAtPath, createFileAtPath, findByPath, flatten, listTree, textOf, trash } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { blobMarker, markedBlob, putBack, replaceFiles, roomBlobs, roomContents, roomTexts, writeBlobs, writeFiles } from "./room-files";

const PNG = { sha256: "a".repeat(64), size: 10, type: "image/png" };
const PNG2 = { sha256: "b".repeat(64), size: 20, type: "image/png" };
const files = (doc: Y.Doc) => flatten(listTree(doc)).filter((n) => n.kind === "file");

describe("binary files in the file maps", () => {
  it("leave GitHub's text map, and appear as markers in History's", () => {
    const doc = new Y.Doc();
    createFileAtPath(doc, "a.py", "x = 1");
    createBinaryFileAtPath(doc, "img/logo.png", PNG);
    assert.deepEqual([...roomTexts(doc)], [["a.py", "x = 1"]]);
    assert.equal(markedBlob(roomContents(doc).get("img/logo.png"))?.sha256, PNG.sha256);
    assert.deepEqual([...roomBlobs(doc)], [["img/logo.png", PNG]]);
    assert.equal(markedBlob("plain text"), null);
  });

  it("are written from markers and from blobs, replacing in place", () => {
    const doc = new Y.Doc();
    writeBlobs(doc, new Map([["logo.png", PNG]]), "u1", "import");
    writeFiles(doc, new Map([["logo.png", blobMarker(PNG2)]]), "u1", "import");
    assert.equal(files(doc).length, 1);
    assert.equal(findByPath(doc, "logo.png")?.blob?.sha256, PNG2.sha256);
  });

  it("switch kind without a duplicate file", () => {
    const doc = new Y.Doc();
    createBinaryFileAtPath(doc, "out.bin", PNG);
    writeFiles(doc, new Map([["out.bin", "text now"]]), "u1", "import");
    const node = findByPath(doc, "out.bin")!;
    assert.equal(files(doc).length, 1);
    assert.equal(node.blob, null);
    assert.equal(textOf(doc, node.id)?.toString(), "text now");
  });

  it("come back with History's restore after a delete", () => {
    const doc = new Y.Doc();
    createBinaryFileAtPath(doc, "logo.png", PNG);
    const base = roomContents(doc);
    trash(doc, findByPath(doc, "logo.png")!.id);
    assert.equal(findByPath(doc, "logo.png"), null);
    putBack(doc, [{ path: "logo.png", kind: "deleted" }], base, "u1", "restore");
    assert.equal(findByPath(doc, "logo.png")?.blob?.sha256, PNG.sha256);
  });

  it("are copied by a fork's replaceFiles, and removed when not wanted", () => {
    const source = new Y.Doc();
    createFileAtPath(source, "main.py", "print(1)");
    createBinaryFileAtPath(source, "data.bin", PNG);
    const target = new Y.Doc();
    createBinaryFileAtPath(target, "old.png", PNG2);
    replaceFiles(target, roomContents(source), "u1", "fork");
    assert.deepEqual(files(target).map((n) => n.path).sort(), ["data.bin", "main.py"]);
    assert.equal(findByPath(target, "data.bin")?.blob?.sha256, PNG.sha256);
  });
});
