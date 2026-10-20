// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAnsi, stripAnsi } from "./ansi";

test("plain text is one run", () => {
  assert.deepEqual(parseAnsi("hello"), [{ text: "hello", color: null, bold: false, dim: false }]);
});

test("colours and reset", () => {
  assert.deepEqual(parseAnsi("\x1b[31mred\x1b[0m plain"), [
    { text: "red", color: "red", bold: false, dim: false },
    { text: " plain", color: null, bold: false, dim: false },
  ]);
});

test("bright colours, bold, and combined codes", () => {
  const runs = parseAnsi("\x1b[1;92mok\x1b[90m dim\x1b[39m x");
  assert.deepEqual(runs[0], { text: "ok", color: "green", bold: true, dim: false });
  assert.deepEqual(runs[1], { text: " dim", color: "bright-black", bold: true, dim: false });
  assert.deepEqual(runs[2], { text: " x", color: null, bold: true, dim: false });
});

test("256-colour and true-colour codes don't leak into later codes", () => {
  const runs = parseAnsi("\x1b[38;5;196ma\x1b[38;2;1;2;3;1mb");
  assert.equal(runs.map((r) => r.text).join(""), "ab");
  assert.equal(runs.at(-1)!.bold, true);
});

test("other escapes are dropped", () => {
  assert.equal(stripAnsi("a\x1b[2Kb\x1b]0;title\x07c"), "abc");
  assert.equal(parseAnsi("a\x1b[2Kb").map((r) => r.text).join(""), "ab");
});

test("an IPython traceback line", () => {
  const line = "\x1b[0;31mZeroDivisionError\x1b[0m: division by zero";
  assert.equal(stripAnsi(line), "ZeroDivisionError: division by zero");
  assert.equal(parseAnsi(line)[0]!.color, "red");
});
