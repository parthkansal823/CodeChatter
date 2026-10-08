import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignRects,
  distributeRects,
  mapRect,
  normalizePoints,
  outlinePoint,
  rectsIntersect,
  resizeBounds,
  scalePoints,
  snapAngle,
  unionRects,
} from "./geometry";
import { snapRect } from "./snap";
import { layoutText, type Measure } from "./text-layout";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("geometry", () => {
  it("unions and intersects rects", () => {
    assert.deepEqual(unionRects([box(0, 0, 10, 10), box(20, 5, 10, 10)]), box(0, 0, 30, 15));
    assert.equal(unionRects([]), null);
    assert.ok(rectsIntersect(box(0, 0, 10, 10), box(5, 5, 10, 10)));
    assert.ok(!rectsIntersect(box(0, 0, 10, 10), box(11, 0, 10, 10)));
  });

  it("resizes from each handle and flips past the opposite edge", () => {
    const start = box(0, 0, 100, 50);
    assert.deepEqual(resizeBounds(start, "se", 20, 10), box(0, 0, 120, 60));
    assert.deepEqual(resizeBounds(start, "nw", 10, 10), box(10, 10, 90, 40));
    assert.deepEqual(resizeBounds(start, "e", -150, 999), box(-50, 0, 50, 50));
    assert.deepEqual(resizeBounds(start, "n", 0, -20), box(0, -20, 100, 70));
  });

  it("keeps the ratio with Shift", () => {
    const start = box(0, 0, 100, 50);
    const corner = resizeBounds(start, "se", 100, 0, true);
    assert.deepEqual(corner, box(0, 0, 200, 100));
    const edge = resizeBounds(start, "e", 100, 0, true);
    assert.deepEqual(edge, box(0, -25, 200, 100));
  });

  it("maps a child rect into scaled bounds", () => {
    assert.deepEqual(mapRect(box(50, 0, 50, 50), box(0, 0, 100, 100), box(0, 0, 200, 50)), box(100, 0, 100, 25));
  });

  it("scales and normalises points", () => {
    assert.deepEqual(scalePoints([10, 10, 0.5, 20, 0, 0.7], 3, 2, 3), [20, 30, 0.5, 40, 0, 0.7]);
    const { rect, points } = normalizePoints([50, 60, 10, 20], 2);
    assert.deepEqual(rect, box(10, 20, 40, 40));
    assert.deepEqual(points, [40, 40, 0, 0]);
  });

  it("snaps line angles to 45 degrees", () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 5 });
    assert.ok(Math.abs(p.y) < 1e-9 && Math.abs(p.x - Math.hypot(100, 5)) < 1e-9);
  });

  it("aligns and distributes", () => {
    const rects = [box(0, 0, 10, 10), box(40, 20, 20, 10), box(100, 5, 10, 10)];
    assert.deepEqual(alignRects(rects, "left").map((p) => p.x), [0, 0, 0]);
    assert.deepEqual(alignRects(rects, "right").map((p) => p.x), [100, 90, 100]);
    assert.deepEqual(alignRects(rects, "vcenter").map((p) => p.y), [10, 10, 10]);
    // Span 0..110, sizes 40 → two gaps of 35.
    assert.deepEqual(distributeRects(rects, "x").map((p) => p.x), [0, 45, 100]);
  });

  it("attaches connectors to outlines", () => {
    const right = outlinePoint(box(0, 0, 100, 50), { x: 500, y: 25 }, false);
    assert.deepEqual(right, { x: 100, y: 25 });
    const top = outlinePoint(box(0, 0, 100, 100), { x: 50, y: -500 }, true, 5);
    assert.ok(Math.abs(top.x - 50) < 1e-9 && Math.abs(top.y + 5) < 1e-9);
  });
});

describe("snapping", () => {
  const others = [box(200, 0, 100, 100), box(0, 300, 50, 50)];

  it("snaps edges within the threshold and draws a guide", () => {
    const { dx, dy, guides } = snapRect(box(97, 150, 100, 40), others, 6);
    // Right edge 197 → the first box's left edge 200.
    assert.equal(dx, 3);
    assert.equal(dy, 0);
    assert.ok(guides.some((g) => g.axis === "x"));
  });

  it("snaps centres", () => {
    const { dx } = snapRect(box(223, 150, 50, 40), others, 6);
    // Centre 248 → the first box's centre 250.
    assert.equal(dx, 2);
  });

  it("leaves things alone outside the threshold", () => {
    const { dx, dy, guides } = snapRect(box(120, 150, 30, 30), others, 4);
    assert.equal(dx, 0);
    assert.equal(dy, 0);
    assert.equal(guides.length, 0);
  });
});

describe("text layout", () => {
  const measure: Measure = (text, font) => text.length * font.size * 0.5;
  const font = { size: 10, weight: 400, family: "sans" as const };

  it("wraps at the width and keeps newlines", () => {
    const layout = layoutText("aaa bbb ccc\nd", 30, font, measure);
    assert.deepEqual(layout.lines, ["aaa", "bbb", "ccc", "d"]);
    assert.equal(layout.height, 4 * 13);
  });

  it("grows to the longest line without a width", () => {
    const layout = layoutText("hello world\nhi", null, font, measure);
    assert.deepEqual(layout.lines, ["hello world", "hi"]);
    assert.equal(layout.width, 55);
  });

  it("breaks words longer than the width", () => {
    assert.deepEqual(layoutText("abcdefghij", 20, font, measure).lines, ["abcd", "efgh", "ij"]);
  });
});
