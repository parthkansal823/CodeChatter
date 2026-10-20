// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyEdits, lineEdits } from "./line-edits";

const roundTrip = (before: string, after: string) => {
  const edits = lineEdits(before, after);
  assert.equal(applyEdits(before, edits), after, JSON.stringify({ before, after, edits }));
  return edits;
};

describe("lineEdits", () => {
  it("nothing to do", () => {
    assert.deepEqual(lineEdits("a\nb\n", "a\nb\n"), []);
  });
  it("a changed line is one small edit", () => {
    const edits = roundTrip("x=1\ny =  2\nz=3\n", "x=1\ny = 2\nz=3\n");
    assert.deepEqual(edits, [{ start: 4, end: 10, text: "y = 2" }]);
  });
  it("separate changes stay separate", () => {
    assert.equal(roundTrip("a\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n").length, 2);
  });
  it("lines added, deleted, at the start and at the end", () => {
    roundTrip("b\nc\n", "a\nb\nc\n");
    roundTrip("a\nb\nc\n", "a\nc\n");
    roundTrip("a\nb", "a\nb\nc");
    roundTrip("a\nb\nc", "a");
    roundTrip("a\nb\n", "a\nb");
    roundTrip("a\nb", "a\nb\n");
    roundTrip("", "x\n");
    roundTrip("x\n", "");
  });
  it("a formatter's typical changes", () => {
    const before = 'def f(a,b):\n  return a+b\n\n\n\nprint( f(1,2) )';
    const after = 'def f(a, b):\n    return a + b\n\n\nprint(f(1, 2))\n';
    roundTrip(before, after);
  });
  it("random texts round-trip", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const text = () => Array.from({ length: rand(8) }, () => "abc"[rand(3)]!.repeat(rand(3))).join("\n") + (rand(2) ? "\n" : "");
    for (let k = 0; k < 400; k++) roundTrip(text(), text());
  });
});
