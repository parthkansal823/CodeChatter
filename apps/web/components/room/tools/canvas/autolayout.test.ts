import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeLayout, insertionIndex, type LayoutSpec } from "./autolayout";

const base: LayoutSpec = { direction: "row", gap: 10, padX: 20, padY: 10, justify: "start", alignItems: "start", hug: false };
const frame = { x: 100, y: 50, w: 300, h: 100 };
const sizes = [
  { w: 40, h: 20 },
  { w: 60, h: 40 },
  { w: 50, h: 30 },
];

describe("auto layout", () => {
  it("flows a row from the padding with gaps", () => {
    const { positions, frame: out } = computeLayout(frame, base, sizes);
    assert.deepEqual(positions, [
      { x: 120, y: 60 },
      { x: 170, y: 60 },
      { x: 240, y: 60 },
    ]);
    assert.deepEqual(out, frame);
  });

  it("flows a column", () => {
    const { positions } = computeLayout(frame, { ...base, direction: "column" }, sizes);
    assert.deepEqual(positions, [
      { x: 120, y: 60 },
      { x: 120, y: 90 },
      { x: 120, y: 140 },
    ]);
  });

  it("aligns on the cross axis", () => {
    const centre = computeLayout(frame, { ...base, alignItems: "center" }, sizes).positions.map((p) => p.y);
    // Inner height 80: centred offsets (80-20)/2, (80-40)/2, (80-30)/2 below the 10 padding.
    assert.deepEqual(centre, [90, 80, 85]);
    const end = computeLayout(frame, { ...base, alignItems: "end" }, sizes).positions.map((p) => p.y);
    assert.deepEqual(end, [120, 100, 110]);
  });

  it("distributes the main axis", () => {
    // Content 150 + 2 gaps of 10 = 170 of 260 inner: 90 free.
    assert.equal(computeLayout(frame, { ...base, justify: "center" }, sizes).positions[0]!.x, 165);
    assert.equal(computeLayout(frame, { ...base, justify: "end" }, sizes).positions[0]!.x, 210);
    const between = computeLayout(frame, { ...base, justify: "between" }, sizes).positions.map((p) => p.x);
    assert.deepEqual(between, [120, 120 + 40 + 55, 120 + 40 + 55 + 60 + 55]);
  });

  it("hugs its content", () => {
    const { frame: out } = computeLayout(frame, { ...base, hug: true }, sizes);
    assert.deepEqual(out, { x: 100, y: 50, w: 170 + 40, h: 40 + 20 });
    const col = computeLayout(frame, { ...base, direction: "column", hug: true }, sizes).frame;
    assert.deepEqual(col, { x: 100, y: 50, w: 60 + 40, h: 90 + 20 + 20 });
  });

  it("copes with no children", () => {
    const { positions, frame: out } = computeLayout(frame, { ...base, hug: true }, []);
    assert.deepEqual(positions, []);
    assert.deepEqual(out, { x: 100, y: 50, w: 40, h: 20 });
  });

  it("finds where a dragged child lands", () => {
    const row = [
      { x: 0, y: 0, w: 40, h: 20 },
      { x: 50, y: 0, w: 40, h: 20 },
      { x: 100, y: 0, w: 40, h: 20 },
    ];
    assert.equal(insertionIndex("row", row, { x: 10, y: 5 }), 0);
    assert.equal(insertionIndex("row", row, { x: 60, y: 5 }), 1);
    assert.equal(insertionIndex("row", row, { x: 400, y: 5 }), 3);
  });
});
