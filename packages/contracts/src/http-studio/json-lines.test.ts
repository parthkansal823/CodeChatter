import { describe, expect, it } from "vitest";

import { findMatches, foldRegions, foldsHiding, prettyJson, splitTokens, tokenizeJsonLine, visibleLines } from "./json-lines.js";

const pretty = prettyJson('{"a":[1,2,{"b":null}],"c":{},"d":"x{"}')!;
const lines = pretty.split("\n");

describe("prettyJson", () => {
  it("formats JSON and refuses everything else", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("[1]")).toBe("[\n  1\n]");
    expect(prettyJson("42")).toBe("42");
    expect(prettyJson("<html>")).toBeNull();
    expect(prettyJson("  ")).toBeNull();
  });
});

describe("folding", () => {
  it("finds each block's closing line", () => {
    // 0 {  1 "a": [  2 1,  3 2,  4 {  5 "b": null  6 }  7 ],  8 "c": {},  9 "d": "x{"  10 }
    expect([...foldRegions(lines)]).toEqual([
      [4, 6],
      [1, 7],
      [0, 10],
    ]);
  });

  it("hides the inside of folded blocks and keeps their first line", () => {
    const regions = foldRegions(lines);
    expect(visibleLines(lines.length, regions, new Set())).toHaveLength(11);
    expect(visibleLines(lines.length, regions, new Set([1]))).toEqual([0, 1, 8, 9, 10]);
    expect(visibleLines(lines.length, regions, new Set([0]))).toEqual([0]);
    expect(visibleLines(lines.length, regions, new Set([4, 1]))).toEqual([0, 1, 8, 9, 10]);
  });

  it("says which folds hide a line", () => {
    const regions = foldRegions(lines);
    expect(foldsHiding(5, regions, new Set([1, 4])).sort()).toEqual([1, 4]);
    expect(foldsHiding(1, regions, new Set([1]))).toEqual([]);
    expect(foldsHiding(8, regions, new Set([1]))).toEqual([]);
  });
});

describe("tokenizeJsonLine", () => {
  const kinds = (line: string) => tokenizeJsonLine(line).map((t) => `${t.kind}:${t.text}`);

  it("splits keys, values and punctuation", () => {
    expect(kinds('  "name": "Ada: Lovelace",')).toEqual(["plain:  ", 'key:"name"', "punct:: ", 'string:"Ada: Lovelace"', "punct:,"]);
    expect(kinds('  "n": -1.5e3')).toEqual(["plain:  ", 'key:"n"', "punct:: ", "number:-1.5e3"]);
    expect(kinds('"ok": true,')).toEqual(['key:"ok"', "punct:: ", "keyword:true", "punct:,"]);
    expect(kinds('    "x": {')).toEqual(["plain:    ", 'key:"x"', "punct:: ", "punct:{"]);
    expect(kinds("  ],")).toEqual(["plain:  ", "punct:]", "punct:,"]);
    expect(kinds('  "a \\"quoted\\" key": 1')).toEqual(["plain:  ", 'key:"a \\"quoted\\" key"', "punct:: ", "number:1"]);
  });

  it("treats array items as values", () => {
    expect(kinds('  "item",')).toEqual(["plain:  ", 'string:"item"', "punct:,"]);
    expect(kinds("  null")).toEqual(["plain:  ", "keyword:null"]);
  });
});

describe("search", () => {
  it("finds every occurrence, ignoring case", () => {
    expect(findMatches(['{"Name": "name"}', "none", "NAME name"], "name")).toEqual([
      { line: 0, start: 2, end: 6 },
      { line: 0, start: 10, end: 14 },
      { line: 2, start: 0, end: 4 },
      { line: 2, start: 5, end: 9 },
    ]);
    expect(findMatches(["aaa"], "aa")).toEqual([{ line: 0, start: 0, end: 2 }]);
    expect(findMatches(["abc"], "")).toEqual([]);
  });

  it("stops at the cap", () => {
    expect(findMatches(["a".repeat(100)], "a", 10)).toHaveLength(10);
  });

  it("cuts tokens at match boundaries", () => {
    const tokens = [
      { text: "  ", kind: "plain" },
      { text: '"hello"', kind: "string" },
    ];
    expect(splitTokens(tokens, [{ start: 3, end: 6 }])).toEqual([
      { text: "  ", kind: "plain", hit: -1 },
      { text: '"', kind: "string", hit: -1 },
      { text: "hel", kind: "string", hit: 0 },
      { text: 'lo"', kind: "string", hit: -1 },
    ]);
    expect(splitTokens(tokens, [{ start: 1, end: 4 }]).map((t) => `${t.hit}:${t.text}`)).toEqual(["-1: ", "0: ", '0:"h', '-1:ello"']);
  });
});
