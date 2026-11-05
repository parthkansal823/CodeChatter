import { describe, expect, it } from "vitest";

import { GitBranchName, GitPath, GitRequest } from "./git.js";

describe("git requests", () => {
  it("take branch names git accepts and refuse the rest", () => {
    for (const ok of ["main", "feature/login", "fix-1.2", "release_2026"]) expect(GitBranchName.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["-x", "a..b", "a//b", "end/", "end.", "x.lock", "has space", "a~1", "a^", "a:b", "@{u}", ""]) {
      expect(GitBranchName.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("take room paths and refuse ones that leave the room", () => {
    expect(GitPath.safeParse("src/app.py").success).toBe(true);
    expect(GitPath.safeParse(":(exclude)x").success).toBe(true); // literal: the runner turns pathspec magic off
    for (const bad of ["/etc/passwd", "../x", "a/../b", "a//b", "./a", "a\nb"]) expect(GitPath.safeParse(bad).success, bad).toBe(false);
  });

  it("fill defaults and refuse unknown operations", () => {
    expect(GitRequest.parse({ op: "init" })).toEqual({ op: "init", branch: "main" });
    expect(GitRequest.parse({ op: "commit", message: " Fix it " })).toEqual({ op: "commit", message: "Fix it", all: false });
    expect(GitRequest.safeParse({ op: "commit", message: "   " }).success).toBe(false);
    expect(GitRequest.safeParse({ op: "push" }).success).toBe(false);
    expect(GitRequest.safeParse({ op: "stage", paths: [] }).success).toBe(false);
  });
});
