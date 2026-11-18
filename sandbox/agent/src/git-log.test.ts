import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@codechatter/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { branchOf, commitsOf, ReflogWatcher } from "./git-log.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const ZERO = "0".repeat(40);
const line = (from: string, to: string, said: string, at = 1763460000) => `${from} ${to} Asha Rao <asha@example.com> ${at} +0530\t${said}\n`;

describe("commitsOf", () => {
  it("reads each kind of commit, with its author, time and message", () => {
    const commits = commitsOf(
      line(ZERO, A, "commit (initial): First") +
        line(A, B, "commit: Add the parser") +
        line(B, C, "commit (amend): Add the parser, tested") +
        line(C, A, "cherry-pick: Fix the date") +
        line(A, B, "revert: Revert \"Fix the date\"") +
        line(B, C, "commit (merge): Merge branch 'feature'"),
    );
    expect(commits.map((each) => [each.kind, each.message])).toEqual([
      ["initial", "First"],
      ["commit", "Add the parser"],
      ["amend", "Add the parser, tested"],
      ["cherry-pick", "Fix the date"],
      ["revert", 'Revert "Fix the date"'],
      ["merge", "Merge branch 'feature'"],
    ]);
    expect(commits[0]).toEqual({ commit: A, parent: null, kind: "initial", message: "First", author: { name: "Asha Rao", email: "asha@example.com" }, at: "2025-11-18T10:00:00.000Z" });
    expect(commits[1]!.parent).toBe(A);
  });

  it("leaves out what isn't a new commit", () => {
    const text =
      line(A, B, "checkout: moving from main to feature") +
      line(B, A, "reset: moving to HEAD~1") +
      line(A, C, "rebase (pick): Something") +
      line(A, C, "merge feature: Fast-forward") +
      line(C, B, "pull: Fast-forward") +
      "not a reflog line\n";
    expect(commitsOf(text)).toEqual([]);
  });

  it("counts a merge git made, named after what was merged", () => {
    expect(commitsOf(line(A, B, "merge feature: Merge made by the 'ort' strategy.")).map((each) => [each.kind, each.message])).toEqual([["merge", "Merge feature"]]);
  });

  it("keeps the last twenty", () => {
    const text = Array.from({ length: 30 }, (_, index) => line(A, B, `commit: Number ${index}`)).join("");
    const commits = commitsOf(text);
    expect(commits).toHaveLength(20);
    expect(commits[0]!.message).toBe("Number 10");
  });
});

describe("branchOf", () => {
  it("reads the branch, or none when detached", () => {
    expect(branchOf("ref: refs/heads/feature/login\n")).toBe("feature/login");
    expect(branchOf(`${A}\n`)).toBeNull();
    expect(branchOf("")).toBeNull();
  });
});

describe("ReflogWatcher", () => {
  let root = "";
  let watcher: ReflogWatcher | null = null;
  afterEach(() => {
    watcher?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
  });
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it("says only what's added after it starts, and a new repository's first commit", async () => {
    root = mkdtempSync(join(tmpdir(), "reflog-"));
    mkdirSync(join(root, ".git/logs"), { recursive: true });
    writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(root, ".git/logs/HEAD"), line(ZERO, A, "commit (initial): Before it started"));
    const events: AgentEvent[] = [];
    watcher = new ReflogWatcher(root, (event) => events.push(event), 50);
    watcher.start();
    appendFileSync(join(root, ".git/logs/HEAD"), line(A, B, "commit: Made now"));
    await until(() => events.length > 0);
    expect(events).toEqual([{ ev: "git", branch: "main", commits: [expect.objectContaining({ commit: B, message: "Made now" })] }]);

    // A line being written isn't read until it's whole.
    appendFileSync(join(root, ".git/logs/HEAD"), line(B, C, "commit: Half").slice(0, 50));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toHaveLength(1);
    appendFileSync(join(root, ".git/logs/HEAD"), line(B, C, "commit: Half").slice(50));
    await until(() => events.length > 1);
    expect((events[1] as { commits: Array<{ message: string }> }).commits.map((each) => each.message)).toEqual(["Half"]);

    // The repository deleted and made again: its first commit counts.
    rmSync(join(root, ".git"), { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    mkdirSync(join(root, ".git/logs"), { recursive: true });
    writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/trunk\n");
    writeFileSync(join(root, ".git/logs/HEAD"), line(ZERO, C, "commit (initial): Again"));
    await until(() => events.length > 2);
    expect(events[2]).toEqual({ ev: "git", branch: "trunk", commits: [expect.objectContaining({ kind: "initial", message: "Again" })] });
  });
});
