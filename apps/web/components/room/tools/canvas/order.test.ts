import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareOrder, isValidKey, keyBetween, keysBetween } from "./order";

describe("fractional order keys", () => {
  it("starts at a0 and appends in order", () => {
    const first = keyBetween(null, null);
    assert.equal(first, "a0");
    const keys = keysBetween(first, null, 200);
    let previous = first;
    for (const key of keys) {
      assert.ok(key > previous, `${key} > ${previous}`);
      previous = key;
    }
    // Appending keeps keys short (the integer part grows, not the fraction).
    assert.ok(keys.at(-1)!.length <= 4, keys.at(-1));
  });

  it("prepends below the first key", () => {
    let bottom = "a0";
    for (let i = 0; i < 100; i++) {
      const next = keyBetween(null, bottom);
      assert.ok(next < bottom);
      bottom = next;
    }
  });

  it("always fits a key between two neighbours", () => {
    let a = "a0";
    const b = "a1";
    for (let i = 0; i < 50; i++) {
      const mid = keyBetween(a, b);
      assert.ok(a < mid && mid < b, `${a} < ${mid} < ${b}`);
      assert.ok(isValidKey(mid));
      a = mid;
    }
  });

  it("keeps random insertions sorted", () => {
    const list: string[] = [keyBetween(null, null)];
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(random() * (list.length + 1));
      const key = keyBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, key);
    }
    const sorted = [...list].sort();
    assert.deepEqual(list, sorted);
    assert.equal(new Set(list).size, list.length);
  });

  it("rejects bad input", () => {
    assert.throws(() => keyBetween("a1", "a0"));
    assert.throws(() => keyBetween("a1", "a1"));
    assert.equal(isValidKey("a10"), false);
    assert.equal(isValidKey("??"), false);
  });

  it("breaks ties by id so everyone sees one order", () => {
    const shapes = [
      { z: "a1", id: "b" },
      { z: "a1", id: "a" },
      { z: "a0", id: "c" },
    ];
    assert.deepEqual(shapes.sort(compareOrder).map((s) => s.id), ["c", "a", "b"]);
  });
});
