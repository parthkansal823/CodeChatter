import { describe, expect, it } from "vitest";

import { CommitInput, GithubTokenInput, parseRepo, PullCommentInput } from "./github.js";

describe("parseRepo", () => {
  it("reads owner/name, with a branch after @", () => {
    expect(parseRepo("octocat/Spoon-Knife")).toEqual({ owner: "octocat", name: "Spoon-Knife" });
    expect(parseRepo("  vercel/next.js@canary ")).toEqual({ owner: "vercel", name: "next.js", ref: "canary" });
  });

  it("reads links, .git clones and tree links with slashes in the branch", () => {
    expect(parseRepo("https://github.com/octocat/Hello-World")).toEqual({ owner: "octocat", name: "Hello-World" });
    expect(parseRepo("github.com/octocat/Hello-World.git")).toEqual({ owner: "octocat", name: "Hello-World" });
    expect(parseRepo("https://www.github.com/a/b/")).toEqual({ owner: "a", name: "b" });
    expect(parseRepo("https://github.com/a/b/tree/feature/login?tab=readme")).toEqual({ owner: "a", name: "b", ref: "feature/login" });
  });

  it("refuses what isn't a repository", () => {
    for (const text of ["", "octocat", "a/b/c", "-bad/name", "a--/b", "a/..", "https://gitlab.com/a/b", "a/b@bad..ref", "a/b@has space", "a/b@x:y"]) {
      expect(parseRepo(text), text).toBeNull();
    }
  });
});

describe("CommitInput", () => {
  const since = "a".repeat(40);
  const commit = (path: string) => CommitInput.safeParse({ since, message: "Fix", changes: [{ path, content: "x" }] }).success;

  it("takes repository paths, and null for a deleted file", () => {
    expect(commit("src/app.ts")).toBe(true);
    expect(commit(".github/workflows/ci.yml")).toBe(true);
    expect(CommitInput.safeParse({ since, message: "Remove", changes: [{ path: "old.txt", content: null }] }).success).toBe(true);
  });

  it("refuses paths that leave the repository or aren't files", () => {
    for (const path of ["/etc/passwd", "../x", "a/../b", "a/./b", "a/", "a\\b", "a\u0000b", "."]) expect(commit(path), path).toBe(false);
  });

  it("needs a message, something to commit and a real commit id", () => {
    expect(CommitInput.safeParse({ since, message: "  ", changes: [{ path: "a", content: "" }] }).success).toBe(false);
    expect(CommitInput.safeParse({ since, message: "Fix", changes: [] }).success).toBe(false);
    expect(CommitInput.safeParse({ since: "abc", message: "Fix", changes: [{ path: "a", content: "" }] }).success).toBe(false);
  });
});

describe("PullCommentInput", () => {
  const line = { body: "Why?", path: "src/app.ts", line: 3, side: "RIGHT", commitId: "b".repeat(40) };

  it("takes a comment on a line, or a reply", () => {
    expect(PullCommentInput.safeParse(line).success).toBe(true);
    expect(PullCommentInput.safeParse({ body: "Agreed", inReplyTo: 12 }).success).toBe(true);
  });

  it("refuses a comment with nowhere to go, or nothing to say", () => {
    expect(PullCommentInput.safeParse({ body: "Lost" }).success).toBe(false);
    expect(PullCommentInput.safeParse({ ...line, line: undefined }).success).toBe(false);
    expect(PullCommentInput.safeParse({ ...line, body: "  " }).success).toBe(false);
  });
});

describe("GithubTokenInput", () => {
  it("takes classic and fine-grained tokens, trimmed", () => {
    expect(GithubTokenInput.parse({ token: " ghp_abcdefghijklmnopqrstuvwxyz0123456789 " }).token).toBe("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(GithubTokenInput.safeParse({ token: "github_pat_11ABCDEFG0123456789_abcdefghijklmnop" }).success).toBe(true);
  });

  it("refuses text that can't be a token", () => {
    expect(GithubTokenInput.safeParse({ token: "short" }).success).toBe(false);
    expect(GithubTokenInput.safeParse({ token: "Bearer ghp_abcdefghijklmnopqrstuvwxyz" }).success).toBe(false);
  });
});
