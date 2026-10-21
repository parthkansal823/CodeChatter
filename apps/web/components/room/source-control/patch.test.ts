// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PullComment } from "@codechatter/contracts";

import { anchorOf, parsePatch, threadsAt, threadsOf } from "./patch";

const patch = [
  "@@ -1,4 +1,5 @@ def main():",
  " keep",
  "-old",
  "+new",
  "+more",
  " ",
  " end",
  "\\ No newline at end of file",
  "@@ -20,2 +21,2 @@",
  " a",
  "-b",
  "+B",
].join("\n");

describe("parsePatch", () => {
  it("numbers each line in the old and new file, hunk by hunk", () => {
    const rows = parsePatch(patch);
    assert.deepEqual(
      rows.map((r) =>
        r.kind === "hunk" ? "hunk" : `${r.kind} ${r.oldLine ?? "-"} ${r.newLine ?? "-"} ${r.text}`,
      ),
      [
        "hunk",
        "context 1 1 keep",
        "del 2 - old",
        "add - 2 new",
        "add - 3 more",
        "context 3 4 ",
        "context 4 5 end",
        "hunk",
        "context 20 21 a",
        "del 21 - b",
        "add - 22 B",
      ],
    );
  });

  it("anchors comments as GitHub does: removed lines on the left, the rest on the right", () => {
    const rows = parsePatch(patch);
    assert.equal(anchorOf(rows[0]!), null);
    assert.deepEqual(anchorOf(rows[2]!), { side: "LEFT", line: 2 });
    assert.deepEqual(anchorOf(rows[3]!), { side: "RIGHT", line: 2 });
    assert.deepEqual(anchorOf(rows[1]!), { side: "RIGHT", line: 1 });
  });
});

describe("threadsOf", () => {
  const comment = (
    id: number,
    line: number | null,
    inReplyTo: number | null,
    path = "a.py",
  ): PullComment => ({
    id,
    path,
    line,
    side: "RIGHT",
    body: `c${id}`,
    author: "x",
    createdAt: "",
    inReplyTo,
    url: "",
  });

  it("puts replies under the comment they answer, and finds a row's threads", () => {
    const threads = threadsOf([
      comment(1, 2, null),
      comment(2, 2, 1),
      comment(3, 5, null),
      comment(4, 2, null, "b.py"),
      comment(5, 2, 99),
    ]);
    assert.deepEqual(
      threads.map((t) => [t.root.id, t.replies.map((r) => r.id)]),
      [
        [1, [2]],
        [3, []],
        [4, []],
        [5, []],
      ],
    );
    assert.deepEqual(
      threadsAt(threads, "a.py", { side: "RIGHT", line: 2 }).map((t) => t.root.id),
      [1, 5],
    );
    assert.deepEqual(threadsAt(threads, "a.py", { side: "LEFT", line: 2 }), []);
  });
});
