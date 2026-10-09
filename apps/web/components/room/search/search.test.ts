// Run with tsx from apps/runner: pnpm exec tsx --test <absolute path to this file>
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEdits,
  buildPattern,
  globToRegExp,
  MAX_FILE_CHARS,
  pathFilter,
  planReplace,
  replacements,
  replaceText,
  searchFiles,
  searchText,
} from "./search";

const pattern = (
  query: string,
  options: Partial<{ matchCase: boolean; wholeWord: boolean; regex: boolean }> = {},
) => {
  const built = buildPattern({ query, matchCase: false, wholeWord: false, regex: false, ...options });
  assert.ok(built instanceof RegExp, `no pattern for ${query}`);
  return built;
};

describe("buildPattern", () => {
  it("takes the query literally unless regex is on", () => {
    assert.equal(searchText("a.b axb", pattern("a.b")).length, 1);
    assert.equal(searchText("a.b axb", pattern("a.b", { regex: true })).length, 2);
  });

  it("ignores case unless asked", () => {
    assert.equal(searchText("Foo foo FOO", pattern("foo")).length, 3);
    assert.equal(searchText("Foo foo FOO", pattern("foo", { matchCase: true })).length, 1);
  });

  it("finds whole words only when asked", () => {
    assert.equal(searchText("cat concat cat_x cat.", pattern("cat")).length, 4);
    assert.equal(searchText("cat concat cat_x cat.", pattern("cat", { wholeWord: true })).length, 2);
  });

  it("only checks a whole word's edges where the match has a letter, as VS Code does", () => {
    const call = pattern("foo(", { wholeWord: true });
    assert.equal(searchText("foo(x) barfoo(y)", call).length, 1);
    assert.equal(searchText("a (b) c", pattern("(", { wholeWord: true })).length, 1);
    assert.deepEqual(
      searchText("one two three", pattern("\\w+", { wholeWord: true, regex: true })).map((m) => m.text),
      ["one", "two", "three"],
    );
  });

  it("explains a regex that doesn't parse, and finds nothing for an empty query", () => {
    assert.deepEqual(buildPattern({ query: "(", matchCase: false, wholeWord: false, regex: true }), {
      error: "Unterminated group",
    });
    assert.equal(buildPattern({ query: "", matchCase: false, wholeWord: false, regex: false }), null);
  });

  it("doesn't let whole word mend a broken regex", () => {
    // Wrapped in a group, "a)(b" would parse; on its own it doesn't, so it's an error.
    const built = buildPattern({ query: "a)(b", matchCase: false, wholeWord: true, regex: true });
    assert.ok(built && "error" in built, "expected an error");
  });
});

describe("searchText", () => {
  it("gives 1-based lines and columns, and the text around each match", () => {
    const [first, second] = searchText("one\n  two needle three\nneedle", pattern("needle"));
    assert.deepEqual(first, {
      line: 2,
      column: 7,
      length: 6,
      endLine: 2,
      endColumn: 13,
      before: "two ",
      text: "needle",
      after: " three",
    });
    assert.deepEqual(second, {
      line: 3,
      column: 1,
      length: 6,
      endLine: 3,
      endColumn: 7,
      before: "",
      text: "needle",
      after: "",
    });
  });

  it("shows a match across lines up to the line's end, and ends the selection on the last line", () => {
    const [match] = searchText("ab\ncd", pattern("b\\nc", { regex: true }));
    assert.deepEqual(
      { line: match!.line, column: match!.column, length: match!.length, text: match!.text },
      { line: 1, column: 2, length: 1, text: "b" },
    );
    assert.deepEqual({ endLine: match!.endLine, endColumn: match!.endColumn }, { endLine: 2, endColumn: 2 });
  });

  it("treats ^ and $ per line, and skips empty matches", () => {
    assert.deepEqual(
      searchText("a\nab\nb", pattern("^a", { regex: true })).map((m) => m.line),
      [1, 2],
    );
    assert.equal(searchText("abc", pattern("x*", { regex: true })).length, 0);
  });

  it("stops at the limit", () => {
    assert.equal(searchText("x ".repeat(50), pattern("x"), 10).length, 10);
  });

  it("shortens long text before a match, and a long match", () => {
    const [match] = searchText(`${"y".repeat(100)}needle`, pattern("needle"));
    assert.ok(match!.before.startsWith("…") && match!.before.length <= 40);
    const [long] = searchText("z".repeat(1000), pattern("z+", { regex: true }));
    assert.ok(long!.text.length < 300 && long!.text.endsWith("…"));
    assert.equal(long!.endColumn, 1001);
  });

  it("leaves a Windows line ending out of the text after a match", () => {
    const [match] = searchText("one needle two\r\nnext", pattern("needle"));
    assert.equal(match!.after, " two");
  });

  it("previews what each match becomes, groups and lookbehinds included", () => {
    const [match] = searchText("let x = 1", pattern("(\\w) = (\\d)", { regex: true }), 10, {
      text: "$2 = $1",
      regex: true,
    });
    assert.equal(match!.replacement, "1 = x");
    const [behind] = searchText("barfoo", pattern("(?<=bar)foo", { regex: true }), 10, {
      text: "[$&]",
      regex: true,
    });
    assert.equal(behind!.replacement, "[foo]");
    const [literal] = searchText("cost 5", pattern("5"), 10, { text: "$1", regex: false });
    assert.equal(literal!.replacement, "$1");
  });
});

describe("searchFiles", () => {
  const files = [
    { id: "a", path: "src/a.ts" },
    { id: "b", path: "src/b.ts" },
    { id: "c", path: "notes.md" },
  ];
  const texts: Record<string, string> = { a: "needle needle", b: "nothing here", c: "needle" };
  const read = (id: string) => texts[id];

  it("groups matches by file, in the files' order", () => {
    const results = searchFiles(files, read, pattern("needle"));
    assert.deepEqual(
      results.files.map((file) => [file.path, file.matches.length]),
      [
        ["src/a.ts", 2],
        ["notes.md", 1],
      ],
    );
    assert.deepEqual(
      { count: results.count, capped: results.capped, skipped: results.skipped },
      {
        count: 3,
        capped: false,
        skipped: 0,
      },
    );
  });

  it("stops at the limit, and says so only when there are more", () => {
    const capped = searchFiles(files, read, pattern("needle"), { limit: 2 });
    assert.deepEqual(
      { count: capped.count, capped: capped.capped, files: capped.files.length },
      {
        count: 2,
        capped: true,
        files: 1,
      },
    );
    assert.equal(searchFiles(files, read, pattern("needle"), { limit: 3 }).capped, false);
  });

  it("reads only the files the filter lets through, skips big ones, and ignores files with no text", () => {
    const filtered = searchFiles(files, read, pattern("needle"), { filter: pathFilter("*.md", "") });
    assert.deepEqual(
      filtered.files.map((file) => file.path),
      ["notes.md"],
    );
    const big = { length: MAX_FILE_CHARS + 1, toString: () => assert.fail("a big file was read") };
    const skipped = searchFiles(
      files,
      (id) => (id === "a" ? big : id === "b" ? undefined : texts[id]),
      pattern("needle"),
    );
    assert.deepEqual({ count: skipped.count, skipped: skipped.skipped }, { count: 1, skipped: 1 });
  });
});

describe("pathFilter", () => {
  it("lets everything through when both fields are empty", () => {
    assert.ok(pathFilter("", "")("src/a.ts"));
  });

  it("matches a pattern without a folder at any depth, and a folder with what's in it", () => {
    const md = pathFilter("*.md", "");
    assert.ok(md("README.md") && md("docs/guide.md") && !md("src/a.ts"));
    const src = pathFilter("src", "");
    assert.ok(src("src/a.ts") && src("src/deep/b.ts") && !src("lib/src.ts"));
    const slash = pathFilter("src/", "");
    assert.ok(slash("src/a.ts") && slash("app/src/b.ts"));
  });

  it("anchors ./ at the top", () => {
    const top = pathFilter("./src", "");
    assert.ok(top("src/a.ts") && !top("app/src/a.ts"));
  });

  it("excludes after including, and reads comma lists with braces", () => {
    const filter = pathFilter("src/**/*.{ts,tsx}, *.md", "**/*.test.ts");
    assert.ok(filter("src/a.ts") && filter("src/ui/b.tsx") && filter("notes.md"));
    assert.ok(!filter("src/a.test.ts") && !filter("src/a.js"));
  });

  it("turns globs into anchored patterns", () => {
    assert.ok(globToRegExp("src/*.ts").test("src/a.ts") && !globToRegExp("src/*.ts").test("src/x/a.ts"));
    assert.ok(
      globToRegExp("src/**/a.ts").test("src/a.ts") && globToRegExp("src/**/a.ts").test("src/x/y/a.ts"),
    );
    assert.ok(globToRegExp("**/a,b.ts").test("x/a,b.ts"));
  });

  it("copes with a glob still being typed", () => {
    assert.doesNotThrow(() => pathFilter("*.{ts", "src/{a"));
    assert.ok(pathFilter("*.{ts", "")("a.ts"));
    assert.ok(globToRegExp("a}.ts").test("a}.ts"));
  });
});

describe("replaceText", () => {
  it("replaces literally without regex, $ included", () => {
    assert.deepEqual(replaceText("cost: 5", pattern("5"), "$1 or $&", false), {
      text: "cost: $1 or $&",
      count: 1,
    });
  });

  it("uses groups with regex, names too", () => {
    assert.deepEqual(
      replaceText("x = 1; y = 2", pattern("(\\w) = (\\d)", { regex: true }), "$2 = $1", true),
      {
        text: "1 = x; 2 = y",
        count: 2,
      },
    );
    assert.deepEqual(
      replaceText("2026-10-09", pattern("(?<y>\\d+)-(?<m>\\d+)", { regex: true }), "$<m>/$<y>", true),
      { text: "10/2026-09", count: 1 },
    );
  });

  it("keeps the context a lookbehind or a whole word needs", () => {
    assert.deepEqual(replaceText("barfoo foo", pattern("(?<=bar)foo", { regex: true }), "X", true), {
      text: "barX foo",
      count: 1,
    });
    assert.deepEqual(replaceText("cat concat", pattern("cat", { wholeWord: true }), "dog", false), {
      text: "dog concat",
      count: 1,
    });
  });

  it("reads $0, $12 with one group, \\n and \\t as VS Code and String.replace do", () => {
    const re = pattern("(a)b", { regex: true });
    assert.equal(replaceText("ab", re, "[$0]", true).text, "[ab]");
    assert.equal(replaceText("ab", re, "$12", true).text, "a2");
    assert.equal(replaceText("ab", re, "$1\\n\\t$$", true).text, "a\n\t$");
    assert.equal(replaceText("ab", re, "$<none>", true).text, "$<none>");
  });
});

describe("replacements", () => {
  it("lists each match as its own edit, so the rest of the file is left alone", () => {
    const edits = replacements("a needle b needle", pattern("needle"), { text: "pin", regex: false });
    assert.deepEqual(edits, [
      { index: 2, length: 6, text: "pin" },
      { index: 11, length: 6, text: "pin" },
    ]);
    assert.equal(applyEdits("a needle b needle", edits), "a pin b pin");
  });

  it("plans a Replace all over every match in the files the search covers", () => {
    const files = [
      { id: "a", path: "a.ts" },
      { id: "b", path: "b.md" },
      { id: "c", path: "c.ts" },
    ];
    const texts: Record<string, string> = { a: "x".repeat(3), b: "x", c: "none" };
    const plan = planReplace(
      files,
      (id) => texts[id],
      pattern("x"),
      { text: "y", regex: false },
      pathFilter("", "*.md"),
    );
    assert.deepEqual(
      plan.map((file) => [file.id, file.edits.length]),
      [["a", 3]],
    );
  });
});
