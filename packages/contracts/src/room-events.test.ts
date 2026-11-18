import { describe, expect, it } from "vitest";

import { AutomationTriggerInput } from "./automations.js";
import { chatCommandOf, eventNamesOf, globsOf, globToRegExp, keptRoomEvent, matchesPaths, pathsProblem, roomEventOf, startsWithProblem } from "./room-events.js";

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

describe("Runs, tests, commits and the chat", () => {
  it("keeps files for a Run or tests, and a start for the chat, and only for them", () => {
    expect(roomEventOf({ room: { event: "run.failed", paths: "src/*.py" } })).toEqual({ event: "run.failed", paths: "src/*.py" });
    expect(roomEventOf({ room: { event: "tests.finished", paths: "a.cpp" } })).toEqual({ event: "tests.finished", paths: "a.cpp" });
    expect(roomEventOf({ room: { event: "chat.message", startsWith: "/deploy ", paths: "x" } })).toEqual({ event: "chat.message", startsWith: "/deploy " });
    expect(roomEventOf({ room: { event: "git.commit", startsWith: "/x", paths: "x" } })).toEqual({ event: "git.commit" });
    expect(keptRoomEvent({ event: "chat.message", startsWith: "  /deploy  " })).toEqual({ event: "chat.message", startsWith: "/deploy" });
    expect(keptRoomEvent({ event: "run.finished", paths: " src/** \n", startsWith: "/x" })).toEqual({ event: "run.finished", paths: "src/**" });
    expect(keptRoomEvent({ event: "chat.message", startsWith: "   " })).toEqual({ event: "chat.message" });
  });

  it("listens for a failed Run or failed tests as finished too", () => {
    expect(eventNamesOf({ event: "run.finished", data: { failed: true } })).toEqual(["run.finished", "run.failed"]);
    expect(eventNamesOf({ event: "run.finished", data: { failed: false } })).toEqual(["run.finished"]);
    expect(eventNamesOf({ event: "tests.finished", data: { failed: true } })).toEqual(["tests.finished", "tests.failed"]);
    expect(eventNamesOf({ event: "chat.message", data: { failed: true } })).toEqual(["chat.message"]);
  });

  it("takes a chat message that starts as asked, with what follows", () => {
    expect(chatCommandOf("  /deploy staging now", "/deploy")).toEqual({ args: "staging now" });
    expect(chatCommandOf("/DEPLOY", "/deploy")).toEqual({ args: "" });
    expect(chatCommandOf("/deployment is done", "/deploy")).toBeNull();
    expect(chatCommandOf("please /deploy", "/deploy")).toBeNull();
    expect(chatCommandOf("bot: run the tests", "bot:")).toEqual({ args: "run the tests" });
    expect(chatCommandOf("bot:run", "bot:")).toEqual({ args: "run" });
    expect(chatCommandOf("  hello there ", undefined)).toEqual({ args: "hello there" });
    expect(chatCommandOf("hello", "  ")).toEqual({ args: "hello" });
  });

  it("says when a start can't be used, and the API refuses it", () => {
    expect(startsWithProblem("/deploy")).toBeNull();
    expect(startsWithProblem(undefined)).toBeNull();
    expect(startsWithProblem("x".repeat(101))).toBe("Up to 100 characters.");
    expect(startsWithProblem("/a\n/b")).toMatch(/One line/);
    const input = { path: "automations/a.flow.json", flowId: "flow_1", kind: "event" };
    expect(AutomationTriggerInput.parse({ ...input, event: { event: "chat.message", startsWith: " /deploy " } }).event).toEqual({ event: "chat.message", startsWith: "/deploy" });
    expect(AutomationTriggerInput.safeParse({ ...input, event: { event: "chat.message", startsWith: "/a\n/b" } }).success).toBe(false);
    expect(AutomationTriggerInput.parse({ ...input, event: { event: "run.failed", paths: "src/**/*.py" } }).event).toEqual({ event: "run.failed", paths: "src/**/*.py" });
    expect(AutomationTriggerInput.safeParse({ ...input, event: { event: "tests.failed", paths: "/etc/passwd" } }).success).toBe(false);
  });
});
