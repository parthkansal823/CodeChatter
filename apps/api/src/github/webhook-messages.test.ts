import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signatureOk, webhookMessage } from "./webhook-messages.js";

describe("signatureOk", () => {
  const raw = Buffer.from('{"zen":"Keep it logically awesome."}');
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  it("accepts GitHub's signature of the exact body, and nothing else", () => {
    expect(signatureOk("s3cret", raw, sign("s3cret"))).toBe(true);
    expect(signatureOk("s3cret", raw, sign("other"))).toBe(false);
    expect(signatureOk("s3cret", Buffer.from(`${raw} `), sign("s3cret"))).toBe(false);
    expect(signatureOk("s3cret", raw, undefined)).toBe(false);
    expect(signatureOk("s3cret", raw, "sha1=abc")).toBe(false);
    expect(signatureOk("s3cret", raw, "sha256=short")).toBe(false);
  });
});

describe("webhookMessage", () => {
  const commit = (n: number) => ({ id: `${n}`.repeat(40).slice(0, 40), message: `Change ${n}\n\nDetails` });

  it("says who pushed what, the last five commits by their first line", () => {
    const text = webhookMessage("push", { ref: "refs/heads/main", pusher: { name: "octo" }, commits: [1, 2, 3, 4, 5, 6, 7].map(commit), compare: "https://github.com/a/b/compare/x...y" });
    expect(text).toBe(
      ["octo pushed 7 commits to main:", "…and 2 earlier commits", "`3333333` Change 3", "`4444444` Change 4", "`5555555` Change 5", "`6666666` Change 6", "`7777777` Change 7", "https://github.com/a/b/compare/x...y"].join("\n"),
    );
    expect(webhookMessage("push", { ref: "refs/heads/fix", pusher: { name: "octo" }, commits: [commit(1)] })).toBe("octo pushed 1 commit to fix:\n`1111111` Change 1");
  });

  it("tells branches and tags made or deleted", () => {
    expect(webhookMessage("push", { ref: "refs/heads/new", created: true, commits: [], pusher: { name: "o" } })).toBe("o created branch new.");
    expect(webhookMessage("push", { ref: "refs/heads/old", deleted: true, pusher: { name: "o" } })).toBe("o deleted branch old.");
    expect(webhookMessage("push", { ref: "refs/tags/v1.0", created: true, pusher: { name: "o" } })).toBe("o pushed tag v1.0.");
  });

  it("follows a pull request's life, and skips the rest of what happens to it", () => {
    const pull_request = { number: 12, title: "Faster", html_url: "https://github.com/a/b/pull/12", head: { ref: "fast" }, base: { ref: "main" } };
    expect(webhookMessage("pull_request", { action: "opened", sender: { login: "ana" }, pull_request })).toBe("Pull request #12 Faster: opened by ana (fast → main)\nhttps://github.com/a/b/pull/12");
    expect(webhookMessage("pull_request", { action: "closed", sender: { login: "ana" }, pull_request: { ...pull_request, merged: true } })).toMatch(/: merged by ana/);
    expect(webhookMessage("pull_request", { action: "closed", sender: { login: "ana" }, pull_request })).toMatch(/: closed by ana/);
    expect(webhookMessage("pull_request", { action: "labeled", pull_request })).toBeNull();
  });

  it("reports finished Actions runs, and ignores the rest", () => {
    const workflow_run = { name: "CI", conclusion: "failure", head_branch: "main", head_sha: "abcdef0123456789", html_url: "https://github.com/a/b/actions/runs/1" };
    expect(webhookMessage("workflow_run", { action: "completed", workflow_run })).toBe("CI failed on main (`abcdef0`)\nhttps://github.com/a/b/actions/runs/1");
    expect(webhookMessage("workflow_run", { action: "completed", workflow_run: { ...workflow_run, conclusion: "success" } })).toMatch(/^CI passed/);
    expect(webhookMessage("workflow_run", { action: "requested", workflow_run })).toBeNull();
    expect(webhookMessage("star", { action: "created" })).toBeNull();
    expect(webhookMessage("ping", { repository: { full_name: "a/b" } })).toMatch(/^GitHub is connected/);
  });
});
