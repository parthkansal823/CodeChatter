import { createHmac, timingSafeEqual } from "node:crypto";

/** GitHub's X-Hub-Signature-256: "sha256=" and the HMAC of the raw body under the room's secret. */
export function signatureOk(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Payload = {
  repository?: { full_name?: string };
  sender?: { login?: string };
  pusher?: { name?: string };
  ref?: string;
  created?: boolean;
  deleted?: boolean;
  compare?: string;
  commits?: Array<{ id: string; message: string }>;
  action?: string;
  pull_request?: { number: number; title: string; html_url: string; merged?: boolean; head?: { ref: string }; base?: { ref: string } };
  workflow_run?: { name: string; conclusion: string | null; head_branch: string; head_sha: string; html_url: string };
};

const MAX_COMMITS = 5;
const RESULT: Record<string, string> = { success: "passed", failure: "failed", cancelled: "was cancelled", timed_out: "timed out", action_required: "needs approval", skipped: "was skipped" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What a GitHub event says in the room's chat: pushes, pull requests opened, merged,
 * closed or reopened, and Actions runs when they finish. Null for anything else (a
 * label added, a commit pushed to an open pull request's branch is its push, and so on).
 */
export function webhookMessage(event: string, payload: Payload): string | null {
  const who = payload.pusher?.name ?? payload.sender?.login ?? "Someone";
  if (event === "ping") return `GitHub is connected: pushes, pull requests and Actions results for ${payload.repository?.full_name ?? "the repository"} will show here.`;

  if (event === "push" && payload.ref) {
    const tag = payload.ref.startsWith("refs/tags/");
    const name = payload.ref.replace(/^refs\/(heads|tags)\//, "");
    if (payload.deleted) return `${who} deleted ${tag ? "tag" : "branch"} ${name}.`;
    if (tag) return `${who} pushed tag ${name}.`;
    const commits = payload.commits ?? [];
    if (!commits.length) return payload.created ? `${who} created branch ${name}.` : null;
    const lines = commits.slice(-MAX_COMMITS).map((c) => `\`${c.id.slice(0, 7)}\` ${c.message.split("\n")[0]}`);
    const more = commits.length > MAX_COMMITS ? [`…and ${plural(commits.length - MAX_COMMITS, "earlier commit")}`] : [];
    return [`${who} pushed ${plural(commits.length, "commit")} to ${name}:`, ...more, ...lines, ...(payload.compare ? [payload.compare] : [])].join("\n");
  }

  if (event === "pull_request" && payload.pull_request) {
    const pull = payload.pull_request;
    const did =
      payload.action === "opened"
        ? `opened by ${who} (${pull.head?.ref ?? "?"} → ${pull.base?.ref ?? "?"})`
        : payload.action === "closed"
          ? `${pull.merged ? "merged" : "closed"} by ${who}`
          : payload.action === "reopened"
            ? `reopened by ${who}`
            : payload.action === "ready_for_review"
              ? `ready for review (${who})`
              : null;
    return did ? `Pull request #${pull.number} ${pull.title}: ${did}\n${pull.html_url}` : null;
  }

  if (event === "workflow_run" && payload.action === "completed" && payload.workflow_run) {
    const run = payload.workflow_run;
    const result = RESULT[run.conclusion ?? ""] ?? `finished (${run.conclusion ?? "no result"})`;
    return `${run.name} ${result} on ${run.head_branch} (\`${run.head_sha.slice(0, 7)}\`)\n${run.html_url}`;
  }
  return null;
}
