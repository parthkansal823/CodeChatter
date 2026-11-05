import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  blobOf,
  createBinaryFile,
  createBinaryFileAtPath,
  createFile,
  findByPath,
  flatten,
  isBlobRef,
  listTree,
  setBlob,
  setFileText,
  textOf,
} from "./index.js";

const PNG = { sha256: "a".repeat(64), size: 1234, type: "image/png" };
const JPG = { sha256: "b".repeat(64), size: 99, type: "image/jpeg" };

describe("binary files", () => {
  it("are file nodes with a blob and no text", () => {
    const doc = new Y.Doc();
    const id = createBinaryFile(doc, { name: "logo.png", blob: PNG });
    const node = flatten(listTree(doc)).find((n) => n.id === id)!;
    expect(node.kind).toBe("file");
    expect(node.blob).toEqual(PNG);
    expect(textOf(doc, id)).toBeUndefined();
  });

  it("make their folders from a path, like text files", () => {
    const doc = new Y.Doc();
    createBinaryFileAtPath(doc, "assets/img/logo.png", PNG);
    expect(findByPath(doc, "assets/img")?.kind).toBe("folder");
    expect(findByPath(doc, "assets/img/logo.png")?.blob?.sha256).toBe(PNG.sha256);
  });

  it("can turn a text file into a binary one and back", () => {
    const doc = new Y.Doc();
    const id = createFile(doc, { name: "out.txt", content: "hello" });
    setBlob(doc, id, JPG);
    expect(blobOf(doc, id)).toEqual(JPG);
    expect(textOf(doc, id)).toBeUndefined();
    setFileText(doc, id, "text again");
    expect(blobOf(doc, id)).toBeNull();
    expect(textOf(doc, id)?.toString()).toBe("text again");
  });

  it("replace a binary file's bytes", () => {
    const doc = new Y.Doc();
    const id = createBinaryFile(doc, { name: "a.png", blob: PNG });
    setBlob(doc, id, { ...JPG, type: "image/png" });
    expect(blobOf(doc, id)?.sha256).toBe(JPG.sha256);
  });

  it("text files and folders have no blob", () => {
    const doc = new Y.Doc();
    const id = createFile(doc, { name: "a.ts", content: "x" });
    expect(blobOf(doc, id)).toBeNull();
    setFileText(doc, id, "y");
    expect(textOf(doc, id)?.toString()).toBe("y");
  });

  it("refuse a malformed blob", () => {
    const doc = new Y.Doc();
    expect(() => createBinaryFile(doc, { name: "x.bin", blob: { sha256: "nothex", size: 1, type: "a/b" } })).toThrow();
    expect(isBlobRef({ sha256: "a".repeat(64), size: -1, type: "a/b" })).toBe(false);
    expect(isBlobRef({ sha256: "A".repeat(64), size: 1, type: "a/b" })).toBe(false);
    expect(isBlobRef(PNG)).toBe(true);
  });

  it("survive a sync to another peer", () => {
    const a = new Y.Doc();
    const id = createBinaryFile(a, { name: "font.woff2", blob: { ...PNG, type: "font/woff2" } });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(blobOf(b, id)?.type).toBe("font/woff2");
  });
});
