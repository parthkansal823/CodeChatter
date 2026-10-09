import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fuzzyMatch, rankFiles } from "./fuzzy";

const file = (path: string, id = path) => ({ id, path, name: path.slice(path.lastIndexOf("/") + 1) });

describe("fuzzyMatch", () => {
  it("returns null unless every character appears in order", () => {
    assert.equal(fuzzyMatch("zx", "main.py"), null);
    assert.equal(fuzzyMatch("pm", "main.py"), null);
    assert.deepEqual(fuzzyMatch("", "main.py"), { score: 0, indices: [] });
  });

  it("aligns on word starts, not the first letters it finds", () => {
    const text = "components/search.ts";
    // The s of "components" comes first, but the s of "search" starts a word.
    assert.deepEqual(fuzzyMatch("sh", text)!.indices, [text.indexOf("search"), text.indexOf("h")]);
    assert.deepEqual(fuzzyMatch("cs", text)!.indices, [0, text.indexOf("search")]);
  });

  it("prefers adjacent runs", () => {
    assert.ok(fuzzyMatch("main", "main.py")!.score > fuzzyMatch("main", "m_a_i_n.py")!.score);
  });

  it("treats a camelCase hump as a word start", () => {
    const match = fuzzyMatch("fb", "fooBar.ts")!;
    assert.deepEqual(match.indices, [0, 3]);
  });
});

describe("rankFiles", () => {
  const files = [
    file("domain.py"),
    file("src/main.py"),
    file("main.py"),
    file("docs/readme.md"),
    file("a/b/mainframe.ts"),
  ];

  it("lists recent files first when nothing is typed, then the rest by path", () => {
    const ranked = rankFiles(files, "", ["docs/readme.md", "main.py"]).map((r) => r.file.path);
    assert.deepEqual(ranked.slice(0, 2), ["docs/readme.md", "main.py"]);
    assert.deepEqual(ranked.slice(2), ["a/b/mainframe.ts", "domain.py", "src/main.py"]);
  });

  it("puts a file-name match ahead of a path match, and shorter before longer", () => {
    const ranked = rankFiles(files, "main", []).map((r) => r.file.path);
    assert.equal(ranked[0], "main.py");
    assert.ok(ranked.indexOf("src/main.py") < ranked.indexOf("domain.py"));
  });

  it("breaks ties with recency", () => {
    const two = [file("x/util.ts", "1"), file("y/util.ts", "2")];
    assert.equal(rankFiles(two, "util", ["2"])[0]!.file.id, "2");
  });

  it("reports match positions in the full path", () => {
    const [top] = rankFiles([file("src/main.py")], "mp");
    assert.deepEqual(
      top!.indices.map((i) => "src/main.py"[i]),
      ["m", "p"],
    );
  });

  it("drops files that don't match", () => {
    assert.deepEqual(rankFiles(files, "zzz", []), []);
  });
});
