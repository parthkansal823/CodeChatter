// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUTO_EVERY_MS, KEEP, needsCompare, prunable, shouldMake } from "./checkpoint-rules.js";

const now = 1_000_000_000;
const latest = (kind: "auto" | "manual" | "pre_ai", minutesAgo: number) => ({ kind, at: now - minutesAgo * 60_000 });

describe("shouldMake", () => {
  it("a room's first checkpoint, and every one saved by hand", () => {
    assert.equal(shouldMake("auto", null, { now, changed: false }), true);
    assert.equal(shouldMake("manual", latest("auto", 0), { now, changed: false }), true);
  });

  it("automatic: only when the files changed and the newest is ten minutes old", () => {
    assert.equal(shouldMake("auto", latest("auto", 11), { now, changed: true }), true);
    assert.equal(shouldMake("auto", latest("auto", 11), { now, changed: false }), false);
    assert.equal(shouldMake("auto", latest("manual", 9), { now, changed: true }), false);
    assert.equal(shouldMake("auto", latest("auto", 1), { now, changed: true, every: 30_000 }), true);
  });

  it("before a restore or an AI edit: unless nothing changed since the newest", () => {
    assert.equal(shouldMake("pre_ai", latest("auto", 0), { now, changed: true }), true);
    assert.equal(shouldMake("pre_ai", latest("pre_ai", 0), { now, changed: false }), false);
    assert.equal(shouldMake("pre_restore", latest("manual", 0), { now, changed: false }), false);
  });
});

describe("needsCompare", () => {
  it("compares the files only when the answer depends on it", () => {
    assert.equal(needsCompare("manual", latest("auto", 20), { now }), false);
    assert.equal(needsCompare("auto", null, { now }), false);
    assert.equal(needsCompare("auto", latest("auto", 5), { now }), false);
    assert.equal(needsCompare("auto", latest("auto", AUTO_EVERY_MS / 60_000), { now }), true);
    assert.equal(needsCompare("pre_restore", latest("auto", 0), { now }), true);
  });
});

describe("prunable", () => {
  it("lets go of the oldest unnamed ones of a kind past its limit, never saved or named ones", () => {
    const rows = [
      ...Array.from({ length: KEEP.auto + 2 }, (_, i) => ({ id: `a${i}`, kind: "auto" as const, label: i === KEEP.auto + 1 ? "Named" : null })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, kind: "manual" as const, label: null })),
      ...Array.from({ length: KEEP.pre_ai + 1 }, (_, i) => ({ id: `p${i}`, kind: "pre_ai" as const, label: null })),
    ];
    assert.deepEqual(prunable(rows), [`a${KEEP.auto}`, `p${KEEP.pre_ai}`]);
  });
});
