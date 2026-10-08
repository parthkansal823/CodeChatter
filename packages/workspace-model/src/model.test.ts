import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createFile,
  createFileAtPath,
  createFolder,
  flatten,
  initDoc,
  listTree,
  move,
  parseDocName,
  pathOf,
  rename,
  restore,
  seedFiles,
  setText,
  textOf,
  trash,
  validateName,
} from "./index.js";

/** Two replicas exchanging updates, like two browsers through the collab server. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => origin !== "net" && Y.applyUpdate(b, u, "net"));
  b.on("update", (u: Uint8Array, origin: unknown) => origin !== "net" && Y.applyUpdate(a, u, "net"));
  return { a, b };
}

const paths = (doc: Y.Doc) => flatten(listTree(doc)).map((n) => n.path);

describe("workspace model", () => {
  it("seeds nested files with derived paths, folders first", () => {
    const doc = new Y.Doc();
    initDoc(doc, "node", [
      { path: "src/server.js", content: "x" },
      { path: "package.json", content: "{}" },
      { path: "src/lib/util.js", content: "y" },
    ]);
    expect(paths(doc)).toEqual(["src", "src/lib", "src/lib/util.js", "src/server.js", "package.json"]);
  });

  it("keeps text when a file is renamed while someone types in it", () => {
    const { a, b } = pair();
    const id = createFile(a, { name: "draft.ts", content: "const a = 1;" });
    textOf(b, id)!.insert(textOf(b, id)!.length, "\nconst b = 2;");
    rename(a, id, "final.ts");
    expect(pathOf(b, id)).toBe("final.ts");
    expect(textOf(a, id)!.toString()).toBe("const a = 1;\nconst b = 2;");
  });

  it("moves between folders without touching content, and refuses cycles", () => {
    const doc = new Y.Doc();
    const outer = createFolder(doc, { name: "outer" });
    const inner = createFolder(doc, { name: "inner", parentId: outer });
    const file = createFile(doc, { name: "a.py", parentId: inner, content: "print(1)" });
    expect(move(doc, outer, inner)).toBe(false);
    expect(move(doc, file, null)).toBe(true);
    expect(pathOf(doc, file)).toBe("a.py");
    expect(textOf(doc, file)!.toString()).toBe("print(1)");
  });

  it("trashes a folder with everything in it, and restores it", () => {
    const doc = new Y.Doc();
    seedFiles(doc, [{ path: "lib/a.ts", content: "" }, { path: "main.ts", content: "" }]);
    const lib = listTree(doc).find((n) => n.name === "lib")!;
    trash(doc, lib.id);
    expect(paths(doc)).toEqual(["main.ts"]);
    restore(doc, lib.id);
    expect(paths(doc)).toContain("lib/a.ts");
  });

  it("recreating a deleted path starts empty — old text never comes back", () => {
    const doc = new Y.Doc();
    const first = createFile(doc, { name: "notes.md", content: "secret" });
    trash(doc, first);
    const second = createFile(doc, { name: "notes.md" });
    expect(second).not.toBe(first);
    expect(textOf(doc, second)!.toString()).toBe("");
  });

  it("shows two concurrent same-name files identically on every replica", () => {
    const { a, b } = pair();
    // Created "at the same time": each replica adds main.py before seeing the other's.
    const x = new Y.Doc();
    const y = new Y.Doc();
    createFile(x, { name: "main.py" });
    createFile(y, { name: "main.py" });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(x));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(y));
    expect(paths(a).sort()).toEqual(["main (2).py", "main.py"]);
    expect(paths(b)).toEqual(paths(a));
  });

  it("validates names and document names", () => {
    expect(validateName("ok.ts")).toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName("..")).not.toBeNull();
    expect(validateName("   ")).not.toBeNull();
    expect(parseDocName("room:TEAM22:files")).toEqual({ roomId: "TEAM22", kind: "files" });
    expect(parseDocName("room:../x:files")).toBeNull();
    expect(parseDocName("room:TEAM22:pages")).toEqual({ roomId: "TEAM22", kind: "pages" });
    expect(parseDocName("room:TEAM22:page:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toEqual({ roomId: "TEAM22", kind: "page", id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
    expect(parseDocName("room:TEAM22:page:../../x")).toBeNull();
    expect(parseDocName("room:TEAM22:secrets")).toBeNull();
  });

  it("creates a file at a path, reusing folders that already exist", () => {
    const doc = new Y.Doc();
    seedFiles(doc, [{ path: "src/app.py", content: "" }]);
    createFileAtPath(doc, "src/out/report.txt", "done\n");
    createFileAtPath(doc, "notes.md", "# hi");
    expect(paths(doc)).toEqual(["src", "src/out", "src/out/report.txt", "src/app.py", "notes.md"]);
    const report = flatten(listTree(doc)).find((n) => n.path === "src/out/report.txt")!;
    expect(textOf(doc, report.id)!.toString()).toBe("done\n");
  });

  it("setText changes only the middle, so a concurrent edit elsewhere survives", () => {
    const a = new Y.Doc();
    const id = createFile(a, { name: "main.py", content: "def f():\n    return 1\n\nprint(f())\n" });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Offline from each other: b types at the end while the sandbox rewrites line 2 on a.
    textOf(b, id)!.insert(textOf(b, id)!.length, "# tail\n");
    setText(textOf(a, id)!, "def f():\n    return 2\n\nprint(f())\n");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    expect(textOf(a, id)!.toString()).toBe("def f():\n    return 2\n\nprint(f())\n# tail\n");
    expect(textOf(b, id)!.toString()).toBe(textOf(a, id)!.toString());
  });

  it("setText keeps emoji intact at the edit boundary", () => {
    const doc = new Y.Doc();
    const id = createFile(doc, { name: "a.txt", content: "x😀y" });
    setText(textOf(doc, id)!, "x😃y");
    expect(textOf(doc, id)!.toString()).toBe("x😃y");
  });
});
