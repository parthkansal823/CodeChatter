import { describe, expect, it } from "vitest";

import { gitMessage, parseLog, parseStatus } from "./git.js";

const Z = "\0";

describe("parseStatus", () => {
  it("reads the branch, the head and each kind of change", () => {
    const raw = [
      "# branch.oid 4f2c1d0e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa src/app.py",
      "1 A. N... 000000 100644 100644 0000000 bbbbbbb new file.txt",
      "1 D. N... 100644 000000 000000 ccccccc 0000000 gone.md",
      "2 R. N... 100644 100644 100644 ddddddd ddddddd R100 docs/after.md",
      "docs/before.md",
      "u UU N... 100644 100644 100644 100644 e1 e2 e3 both.txt",
      "? notes/todo.txt",
      "",
    ].join(Z);
    const status = parseStatus(raw);
    expect(status.branch).toBe("main");
    expect(status.head).toBe("4f2c1d0");
    expect(status.changes).toEqual([
      { path: "src/app.py", from: null, staged: null, unstaged: "M", conflict: false },
      { path: "new file.txt", from: null, staged: "A", unstaged: null, conflict: false },
      { path: "gone.md", from: null, staged: "D", unstaged: null, conflict: false },
      { path: "docs/after.md", from: "docs/before.md", staged: "R", unstaged: null, conflict: false },
      { path: "both.txt", from: null, staged: null, unstaged: "M", conflict: true },
      { path: "notes/todo.txt", from: null, staged: null, unstaged: "?", conflict: false },
    ]);
  });

  it("knows a new repository and a detached head", () => {
    expect(parseStatus(["# branch.oid (initial)", "# branch.head main", ""].join(Z))).toEqual({ branch: "main", head: null, changes: [] });
    expect(parseStatus(["# branch.oid 1234567890", "# branch.head (detached)", ""].join(Z)).branch).toBeNull();
  });
});

describe("parseLog", () => {
  it("reads each commit's fields, subjects with spaces and all", () => {
    const raw = `aaaa1111\x1faaaa111\x1fAna Lee\x1fana@example.com\x1f2026-11-05T21:00:00+05:30\x1fFix the login, finally\x1e\nbbbb2222\x1fbbbb222\x1fBo\x1fbo@example.com\x1f2026-11-04T10:00:00+00:00\x1fFirst commit\x1e\n`;
    expect(parseLog(raw)).toEqual([
      { id: "aaaa1111", short: "aaaa111", author: "Ana Lee", email: "ana@example.com", at: "2026-11-05T21:00:00+05:30", subject: "Fix the login, finally" },
      { id: "bbbb2222", short: "bbbb222", author: "Bo", email: "bo@example.com", at: "2026-11-04T10:00:00+00:00", subject: "First commit" },
    ]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("gitMessage", () => {
  it("keeps git's words without its prefixes and hints", () => {
    expect(gitMessage("error: Your local changes to the following files would be overwritten by checkout:\n\tapp.py\nhint: commit them first\n")).toBe(
      "Your local changes to the following files would be overwritten by checkout: \tapp.py",
    );
    expect(gitMessage("fatal: invalid reference: nope\n")).toBe("invalid reference: nope");
  });
});
