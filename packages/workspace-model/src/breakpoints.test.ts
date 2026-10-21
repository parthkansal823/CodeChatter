import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { allBreakpoints, breakpointLines, clearBreakpoints, toggleBreakpoint } from "./breakpoints.js";
import { createFile, textOf } from "./model.js";

function room(content: string) {
  const doc = new Y.Doc();
  const id = createFile(doc, { name: "main.py", content });
  return { doc, id, text: textOf(doc, id)! };
}

describe("breakpoints", () => {
  it("toggles on and off by line", () => {
    const { doc, id } = room("a = 1\nb = 2\nc = 3\n");
    expect(toggleBreakpoint(doc, id, 2)).toBe(true);
    expect(toggleBreakpoint(doc, id, 3)).toBe(true);
    expect(breakpointLines(doc, id)).toEqual([2, 3]);
    expect(toggleBreakpoint(doc, id, 2)).toBe(false);
    expect(breakpointLines(doc, id)).toEqual([3]);
  });

  it("stays on its line while lines are added or removed above it", () => {
    const { doc, id, text } = room("a = 1\nb = 2\nc = 3\n");
    toggleBreakpoint(doc, id, 3);
    text.insert(0, "import os\nimport sys\n");
    expect(breakpointLines(doc, id)).toEqual([5]);
    text.delete(0, "import os\n".length);
    expect(breakpointLines(doc, id)).toEqual([4]);
    expect(text.toString().split("\n")[3]).toBe("c = 3");
  });

  it("follows the same edits made by someone else", () => {
    const { doc, id } = room("x\ny\nz\n");
    toggleBreakpoint(doc, id, 2);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    textOf(other, id)!.insert(0, "first\n");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(breakpointLines(doc, id)).toEqual([3]);
    expect(breakpointLines(other, id)).toEqual([3]);
  });

  it("lists every file's, and clears", () => {
    const { doc, id } = room("1\n2\n");
    const second = createFile(doc, { name: "b.py", content: "x\n" });
    toggleBreakpoint(doc, id, 1);
    toggleBreakpoint(doc, second, 1);
    expect(allBreakpoints(doc)).toEqual([
      { fileId: id, lines: [1] },
      { fileId: second, lines: [1] },
    ]);
    clearBreakpoints(doc, id);
    expect(allBreakpoints(doc)).toEqual([{ fileId: second, lines: [1] }]);
    clearBreakpoints(doc);
    expect(allBreakpoints(doc)).toEqual([]);
  });
});
