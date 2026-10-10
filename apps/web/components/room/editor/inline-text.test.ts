import { AI_COMPLETE_LIMITS } from "@codechatter/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completionWindow, languageId, windowRange, worthAsking } from "./inline-text";

const lines = (count: number, width = 39) => Array.from({ length: count }, (_, i) => `${String(i).padStart(4, "0")}${"x".repeat(width - 4)}`).join("\n");

describe("completionWindow", () => {
  it("sends a short file whole", () => {
    const text = "def add(a, b):\n    \n\nprint(add(1, 2))\n";
    const offset = text.indexOf("    ") + 4;
    assert.deepEqual(completionWindow(text, offset), { prefix: "def add(a, b):\n    ", suffix: "\n\nprint(add(1, 2))\n" });
  });

  it("cuts a long prefix at a line start, within the limit", () => {
    const text = `${lines(300)}\nlast = `;
    const { prefix } = completionWindow(text, text.length);
    assert.ok(prefix.length <= AI_COMPLETE_LIMITS.prefixChars, String(prefix.length));
    assert.ok(prefix.length > AI_COMPLETE_LIMITS.prefixChars - 1_100, String(prefix.length));
    assert.ok(text.slice(0, text.length - prefix.length).endsWith("\n"), "starts at a line start");
    assert.ok(prefix.endsWith("\nlast = "));
  });

  it("keeps the start of a long prefix still while you type (the prompt cache keeps matching)", () => {
    let text = `${lines(300)}\nlast = `;
    const start = (t: string) => t.length - completionWindow(t, t.length).prefix.length;
    const first = start(text);
    for (const key of "compute(values)") {
      text += key;
      assert.equal(start(text), first);
    }
  });

  it("cuts a long suffix at a line end, keeping the rest of the current line", () => {
    const text = `x = (\n${lines(100)}`;
    const { suffix } = completionWindow(text, 4);
    assert.ok(suffix.length <= AI_COMPLETE_LIMITS.suffixChars);
    assert.ok(suffix.startsWith("(\n"));
    assert.ok(text.slice(4 + suffix.length).startsWith("\n"), "ends at a line end");
    // A current line longer than the limit is cut where the limit falls.
    const long = `x = ${"y".repeat(5_000)}`;
    assert.equal(completionWindow(long, 4).suffix.length, AI_COMPLETE_LIMITS.suffixChars);
  });
});

describe("windowRange", () => {
  it("gives the same window from a slice as from the whole file", () => {
    const text = `${lines(400)}\n${"z".repeat(3_000)}\n${lines(50)}`;
    for (const offset of [0, 17, 3_999, 4_000, 4_001, 5_432, 9_000, 9_001, 15_999, 16_050, 19_100, text.length]) {
      const { start, end } = windowRange(offset);
      assert.equal(start % 1_000, 0);
      assert.deepEqual(completionWindow(text.slice(start, end), offset - start), completionWindow(text, offset), `at ${offset}`);
    }
  });
});

describe("worthAsking", () => {
  it("asks at the end of a line or before closing punctuation", () => {
    assert.equal(worthAsking("def add(a, b):\n    ", ""), true);
    assert.equal(worthAsking("print(", ")"), true);
    assert.equal(worthAsking('print("', '");'), true);
  });

  it("doesn't ask in the middle of a word or an expression, or in an empty file", () => {
    assert.equal(worthAsking("total = fo", "o + bar"), false);
    assert.equal(worthAsking("x = ", "y"), false);
    assert.equal(worthAsking("  \n", ""), false);
  });
});

describe("languageId", () => {
  it("passes the editor's language id when the API accepts it", () => {
    assert.equal(languageId("python"), "python");
    assert.equal(languageId("objective-c"), "objective-c");
    assert.equal(languageId("freemarker2.tag-auto.interpolation-bracket"), "");
    assert.equal(languageId("a b"), "");
  });
});
