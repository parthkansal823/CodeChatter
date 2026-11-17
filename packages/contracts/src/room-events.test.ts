import { describe, expect, it } from "vitest";

import { globsOf, globToRegExp, matchesPaths, pathsProblem, roomEventOf } from "./room-events.js";

describe("which files", () => {
  it("matches globs the usual way", () => {
    expect(globToRegExp("src/**/*.py").test("src/app.py")).toBe(true);
    expect(globToRegExp("src/**/*.py").test("src/deep/down/app.py")).toBe(true);
    expect(globToRegExp("src/**/*.py").test("src/app.pyc")).toBe(false);
    expect(globToRegExp("src/**/*.py").test("tests/app.py")).toBe(false);
    expect(globToRegExp("*.md").test("README.md")).toBe(true);
    expect(globToRegExp("*.md").test("docs/README.md")).toBe(false);
    expect(globToRegExp("**/*.md").test("docs/README.md")).toBe(true);
    expect(globToRegExp("**/*.{ts,tsx}").test("web/app/page.tsx")).toBe(true);
    expect(globToRegExp("**/*.{ts,tsx}").test("web/app/page.js")).toBe(false);
    expect(globToRegExp("file?.txt").test("file1.txt")).toBe(true);
    expect(globToRegExp("docs/**").test("docs/a/b.md")).toBe(true);
    expect(globToRegExp("./package.json").test("package.json")).toBe(true);
  });

  it("takes a dot or brackets as themselves", () => {
    expect(globToRegExp("a.b").test("axb")).toBe(false);
    expect(globToRegExp("[x].md").test("[x].md")).toBe(true);
    expect(globToRegExp("(x)+.md").test("(x)+.md")).toBe(true);
  });

  it("takes several, one a line or with commas, but not the commas in braces", () => {
    expect(globsOf("src/**/*.py, tests/**\n*.toml")).toEqual(["src/**/*.py", "tests/**", "*.toml"]);
    expect(globsOf("**/*.{ts,tsx},*.md")).toEqual(["**/*.{ts,tsx}", "*.md"]);
    expect(matchesPaths("pyproject.toml", "src/**/*.py, *.toml")).toBe(true);
    expect(matchesPaths("README.md", "src/**/*.py, *.toml")).toBe(false);
  });

  it("matches everything with no patterns", () => {
    expect(matchesPaths("anything/at/all.txt", undefined)).toBe(true);
    expect(matchesPaths("anything/at/all.txt", "  ")).toBe(true);
  });

  it("matches a folder whose files could match", () => {
    expect(matchesPaths("src/lib", "src/**/*.py", "folder")).toBe(true);
    expect(matchesPaths("src", "src/**/*.py", "folder")).toBe(true);
    expect(matchesPaths("docs", "src/**/*.py", "folder")).toBe(false);
    expect(matchesPaths("anything", "**/*.py", "folder")).toBe(true);
    expect(matchesPaths("src", "src/**/*.py", "file")).toBe(false);
  });

  it("says what's wrong with a setting", () => {
    expect(pathsProblem("src/**/*.py")).toBeNull();
    expect(pathsProblem("/etc/passwd")).toContain("inside the room");
    expect(pathsProblem("../up/*.py")).toContain("inside the room");
    expect(pathsProblem(Array.from({ length: 21 }, (_, i) => `a${i}`).join(","))).toBe("Up to 20 patterns.");
  });
});

describe("a flow's room event", () => {
  it("is read from its trigger's settings", () => {
    expect(roomEventOf({ pieceName: "@activepieces/piece-webhook", room: { event: "files.changed", paths: "src/**" } })).toEqual({ event: "files.changed", paths: "src/**" });
    expect(roomEventOf({ room: { event: "repo.commit", paths: "ignored" } })).toEqual({ event: "repo.commit" });
    expect(roomEventOf({ room: { event: "files.changed", paths: " " } })).toEqual({ event: "files.changed" });
    expect(roomEventOf({ room: { event: "made.up" } })).toBeNull();
    expect(roomEventOf({ pieceName: "@activepieces/piece-webhook" })).toBeNull();
    expect(roomEventOf(null)).toBeNull();
  });
});
