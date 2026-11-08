/**
 * Example automations for coding, written here for this tool (collections found online don't show terms that allow copying them). Each is a flow in Activepieces' format.
 * Those marked `runsHere` need no outside service, and test/automation-examples.e2e.ts runs each on the real engine and checks its answer. The rest need a service and its
 * connection, so that test only checks each step against what the piece really has, and the gallery says which is which.
 */
import type { PieceInfo } from "@codechatter/contracts";

import { SCHEMA_VERSION, type Flow, type FlowStep } from "./model";

export type Example = {
  id: string;
  title: string;
  about: string;
  category: string;
  runsHere: boolean;
  /** What to send when trying it, and what its `check` step should answer. */
  sample?: unknown;
  expect?: { step: string; output: unknown };
  /** For a router: another sample, the step it should take, and the one it shouldn't. */
  alsoTry?: { sample: unknown; step: string; notStep: string };
  flow: () => { trigger: FlowStep };
};

const NO_FAILURE = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
const piecePrefix = "@activepieces/piece-";

function chain(trigger: FlowStep, steps: FlowStep[]): { trigger: FlowStep } {
  let last = trigger;
  for (const step of steps) {
    last.nextAction = step;
    last = step;
  }
  return { trigger };
}
const webhook = (name = "When called"): FlowStep => ({ name: "trigger", type: "PIECE_TRIGGER", displayName: name, valid: true, settings: { pieceName: `${piecePrefix}webhook`, pieceVersion: "", triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: null });
const pieceTrigger = (piece: string, triggerName: string, name: string, input: Record<string, unknown> = {}, connected = true): FlowStep => ({ name: "trigger", type: "PIECE_TRIGGER", displayName: name, valid: false, settings: { pieceName: `${piecePrefix}${piece}`, pieceVersion: "", triggerName, input: { ...(connected ? { auth: `{{connections['${piece}']}}` } : {}), ...input }, propertySettings: {} }, nextAction: null });
const code = (name: string, displayName: string, source: string, input: Record<string, unknown> = { data: "{{trigger.output.body}}" }): FlowStep => ({ name, type: "CODE", displayName, valid: true, skip: false, settings: { sourceCode: { code: `export const code = async (inputs) => {\n  const data = inputs.data ?? {};\n${source}\n};\n`, packageJson: "{}" }, input, errorHandlingOptions: NO_FAILURE }, nextAction: null });
const action = (name: string, piece: string, actionName: string, displayName: string, input: Record<string, unknown>, connected = true): FlowStep => ({ name, type: "PIECE", displayName, valid: !connected, skip: false, settings: { pieceName: `${piecePrefix}${piece}`, pieceVersion: "", actionName, input: { ...(connected ? { auth: `{{connections['${piece}']}}` } : {}), ...input }, propertySettings: {}, errorHandlingOptions: NO_FAILURE }, nextAction: null });
function branch(name: string, displayName: string, value: string, operator: string, second: string, yes: FlowStep, no: FlowStep | null, yesName = "Yes", noName = "Otherwise"): FlowStep {
  return { name, type: "ROUTER", displayName, valid: true, skip: false, settings: { executionType: "EXECUTE_FIRST_MATCH", branches: [{ branchName: yesName, branchType: "CONDITION", conditions: [[{ operator, firstValue: value, secondValue: second, caseSensitive: false }]] }, { branchName: noName, branchType: "FALLBACK" }] }, children: [yes, no], nextAction: null };
}
function each(name: string, displayName: string, items: string, inside: FlowStep): FlowStep {
  return { name, type: "LOOP_ON_ITEMS", displayName, valid: true, skip: false, settings: { items }, firstLoopAction: inside, nextAction: null };
}

/** An example that runs anywhere: a webhook, then one code step called check. Most of the examples that run here are this shape. */
function logic(category: string, id: string, title: string, about: string, source: string, sample: unknown, output: unknown): Example {
  return { id, title, about, category, runsHere: true, sample, expect: { step: "check", output }, flow: () => chain(webhook(), [code("check", title, source)]) };
}

const RELEASES = "Releases";
const REVIEW = "Pull requests";
const QUALITY = "Code quality";
const TESTS = "Tests and CI";
const SECURITY = "Security and dependencies";
const ISSUES = "Issues";
const OPS = "Deploys and on-call";
const DOCS = "Docs and data";
const NOTIFY = "Notifications";
const TICKETS = "Tickets";
const AI = "With AI";
const DIGESTS = "Digests";

const RUNS_HERE: Example[] = [
  logic(RELEASES, "release-notes", "Write release notes from commits", "Groups conventional commits into features, fixes and the rest.", `  const groups = { feat: [], fix: [], other: [] };
  for (const message of data.commits ?? []) {
    const match = /^(feat|fix)(\\(.+\\))?!?:\\s*(.+)/.exec(message);
    if (match) groups[match[1]].push(match[3]);
    else groups.other.push(message);
  }
  const section = (name, list) => (list.length ? "## " + name + "\\n" + list.map((item) => "- " + item).join("\\n") + "\\n" : "");
  return { features: groups.feat.length, fixes: groups.fix.length, notes: section("Features", groups.feat) + section("Fixes", groups.fix) + section("Other", groups.other) };`, { commits: ["feat: add search", "fix(api): handle nulls", "chore: bump deps"] }, { features: 1, fixes: 1 }),
  logic(RELEASES, "next-version", "Work out the next version", "Reads commits since the last tag, and bumps major, minor or patch as semantic versioning says.", `  const [major, minor, patch] = String(data.current ?? "0.0.0").split(".").map(Number);
  const commits = data.commits ?? [];
  const breaking = commits.some((message) => /^[a-z]+(\\(.+\\))?!:/.test(message) || message.includes("BREAKING CHANGE"));
  const feature = commits.some((message) => message.startsWith("feat"));
  const next = breaking ? [major + 1, 0, 0] : feature ? [major, minor + 1, 0] : [major, minor, patch + 1];
  return { next: next.join("."), kind: breaking ? "major" : feature ? "minor" : "patch" };`, { current: "1.4.2", commits: ["feat: search", "fix: typo"] }, { next: "1.5.0", kind: "minor" }),
  logic(RELEASES, "changelog-entry", "Add a dated changelog entry", "Turns a version and its commits into a Keep a Changelog entry.", `  const lines = (data.commits ?? []).map((message) => "- " + message);
  return { entry: "## [" + data.version + "] - " + data.date + "\\n" + lines.join("\\n") };`, { version: "2.0.0", date: "2026-11-07", commits: ["Add search"] }, { entry: "## [2.0.0] - 2026-11-07\n- Add search" }),
  logic(RELEASES, "tag-is-release", "Tell a release tag from any other", "Checks a tag against semantic versioning, and says whether it's a pre-release.", `  const match = /^v?(\\d+)\\.(\\d+)\\.(\\d+)(-[\\w.]+)?$/.exec(data.tag ?? "");
  return { release: Boolean(match), prerelease: Boolean(match && match[4]) };`, { tag: "v1.2.3-rc.1" }, { release: true, prerelease: true }),
  logic(RELEASES, "contributors-in-release", "Thank who contributed", "Lists each author in a release, most commits first.", `  const counts = {};
  for (const commit of data.commits ?? []) counts[commit.author] = (counts[commit.author] ?? 0) + 1;
  const authors = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { authors, top: authors[0] ?? null };`, { commits: [{ author: "Asha" }, { author: "Ben" }, { author: "Asha" }] }, { top: "Asha" }),
  logic(RELEASES, "release-readiness", "Is this release ready?", "Checks that tests pass, nothing blocks it, and its notes are written.", `  const blockers = [];
  if (!data.testsPassed) blockers.push("tests are failing");
  if ((data.openBlockers ?? 0) > 0) blockers.push(data.openBlockers + " blocking issues");
  if (!data.notes) blockers.push("no release notes");
  return { ready: blockers.length === 0, blockers };`, { testsPassed: true, openBlockers: 2, notes: "x" }, { ready: false, blockers: ["2 blocking issues"] }),

  logic(REVIEW, "pr-size", "Label a pull request by size", "XS to XL, from the lines it changes, as big changes get worse reviews.", `  const lines = (data.additions ?? 0) + (data.deletions ?? 0);
  const size = lines < 10 ? "XS" : lines < 100 ? "S" : lines < 500 ? "M" : lines < 1000 ? "L" : "XL";
  return { lines, size, tooBig: lines >= 1000 };`, { additions: 420, deletions: 30 }, { lines: 450, size: "M", tooBig: false }),
  logic(REVIEW, "pr-title", "Check a pull request's title", "Conventional commit form, with a scope if it has one, and not too long.", `  const title = data.title ?? "";
  const shape = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\([\\w-]+\\))?!?: .+/.test(title);
  const short = title.length <= 72;
  return { ok: shape && short, shape, short };`, { title: "fix(api): handle nulls" }, { ok: true }),
  logic(REVIEW, "changed-areas", "Say which parts a change touches", "Sorts changed files into frontend, backend, docs and the rest.", `  const areas = new Set();
  for (const file of data.files ?? []) {
    if (/^(web|client|frontend)\\//.test(file) || /\\.(tsx|css)$/.test(file)) areas.add("frontend");
    else if (/^(api|server|backend)\\//.test(file)) areas.add("backend");
    else if (/\\.md$/.test(file) || file.startsWith("docs/")) areas.add("docs");
    else areas.add("other");
  }
  return { areas: [...areas].sort() };`, { files: ["web/a.tsx", "api/b.ts", "README.md"] }, { areas: ["backend", "docs", "frontend"] }),
  logic(REVIEW, "reviewers-from-owners", "Choose reviewers from code owners", "Matches changed files against a CODEOWNERS-style list.", `  const reviewers = new Set();
  for (const file of data.files ?? []) for (const [prefix, owner] of Object.entries(data.owners ?? {})) if (file.startsWith(prefix)) reviewers.add(owner);
  reviewers.delete(data.author);
  return { reviewers: [...reviewers].sort() };`, { author: "asha", files: ["api/a.ts", "web/b.tsx"], owners: { "api/": "ben", "web/": "asha" } }, { reviewers: ["ben"] }),
  logic(REVIEW, "stale-prs", "Find pull requests nobody's touched", "Those not updated for a number of days, oldest first.", `  const cutoff = Date.parse(data.today) - (data.days ?? 14) * 86400000;
  const stale = (data.pulls ?? []).filter((pull) => Date.parse(pull.updated) < cutoff).sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated));
  return { count: stale.length, oldest: stale[0]?.number ?? null };`, { today: "2026-11-07", days: 14, pulls: [{ number: 1, updated: "2026-10-01" }, { number: 2, updated: "2026-11-05" }, { number: 3, updated: "2026-09-01" }] }, { count: 2, oldest: 3 }),
  logic(REVIEW, "conflict-risk", "Warn when two pull requests touch the same files", "The files both change, as they're the ones likely to conflict.", `  const other = new Set(data.b ?? []);
  const both = (data.a ?? []).filter((file) => other.has(file));
  return { both, risky: both.length > 0 };`, { a: ["x.ts", "y.ts"], b: ["y.ts", "z.ts"] }, { both: ["y.ts"], risky: true }),
  logic(REVIEW, "draft-or-ready", "Hold back drafts", "Says whether a pull request wants a review yet.", `  const wip = /^(wip|draft)\\b/i.test(data.title ?? "") || data.draft === true;
  return { wantsReview: !wip };`, { title: "WIP: try something", draft: false }, { wantsReview: false }),
  logic(REVIEW, "tests-with-code", "Ask for tests with new code", "Flags a change to code that doesn't change any tests.", `  const files = data.files ?? [];
  const isTest = (file) => /(^|\\/)(test|tests|__tests__)\\/|\\.(test|spec)\\.[a-z]+$/.test(file);
  const changesCode = files.some((file) => /\\.(ts|tsx|js|py|go|rs|java)$/.test(file) && !isTest(file));
  return { needsTests: changesCode && !files.some(isTest) };`, { files: ["src/a.ts"] }, { needsTests: true }),

  logic(QUALITY, "commit-lint", "Check commit messages", "Finds commits that aren't in conventional form.", `  const bad = (data.commits ?? []).filter((message) => !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\(.+\\))?!?: .+/.test(message));
  return { ok: bad.length === 0, bad };`, { commits: ["feat: a", "oops"] }, { ok: false, bad: ["oops"] }),
  logic(QUALITY, "branch-name", "Check a branch's name", "feature/, fix/ or release/, in lower case.", `  const ok = /^(feature|fix|release|hotfix)\\/[a-z0-9._-]+$/.test(data.branch ?? "");
  return { ok, hotfix: (data.branch ?? "").startsWith("hotfix/") };`, { branch: "hotfix/login" }, { ok: true, hotfix: true }),
  logic(QUALITY, "todos-in-diff", "List the TODOs a change adds", "Reads a diff's added lines.", `  const added = String(data.diff ?? "").split("\\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const todos = added.filter((line) => /\\b(TODO|FIXME|HACK)\\b/.test(line)).map((line) => line.slice(1).trim());
  return { count: todos.length, todos };`, { diff: "+++ b/a.ts\n+// TODO: fix\n-old\n+code" }, { count: 1, todos: ["// TODO: fix"] }),
  logic(QUALITY, "big-files", "Stop big files getting in", "Finds files over a size limit.", `  const limit = (data.limitKb ?? 500) * 1024;
  const big = (data.files ?? []).filter((file) => file.bytes > limit).map((file) => file.path);
  return { big, ok: big.length === 0 };`, { limitKb: 1, files: [{ path: "a.bin", bytes: 4096 }, { path: "b.txt", bytes: 10 }] }, { big: ["a.bin"], ok: false }),
  logic(QUALITY, "complexity-budget", "Keep functions small", "Flags functions over a line limit.", `  const over = (data.functions ?? []).filter((item) => item.lines > (data.limit ?? 60)).map((item) => item.name);
  return { over, ok: over.length === 0 };`, { limit: 10, functions: [{ name: "a", lines: 40 }, { name: "b", lines: 5 }] }, { over: ["a"], ok: false }),
  logic(QUALITY, "sql-migration-lint", "Check a database migration", "Flags what locks or loses data.", `  const sql = String(data.sql ?? "");
  const rules = [[/drop\\s+table/i, "drops a table"], [/drop\\s+column/i, "drops a column"], [/alter\\s+table[^;]+not\\s+null/i, "adds NOT NULL"], [/create\\s+index\\s+(?!concurrently)/i, "builds an index with a lock"]];
  const problems = rules.filter(([rule]) => rule.test(sql)).map(([, words]) => words);
  return { safe: problems.length === 0, problems };`, { sql: "CREATE INDEX a ON t(x); DROP TABLE old;" }, { safe: false, problems: ["drops a table", "builds an index with a lock"] }),
  logic(QUALITY, "dockerfile-lint", "Check a Dockerfile", "A few rules that catch the usual problems.", `  const text = String(data.dockerfile ?? "");
  const problems = [];
  if (/^FROM\\s+\\S+:latest/m.test(text) || /^FROM\\s+[^:\\s]+\\s*$/m.test(text)) problems.push("base image isn't pinned");
  if (!/^USER\\s+/m.test(text)) problems.push("runs as root");
  if (/apt-get install(?!.*--no-install-recommends)/.test(text)) problems.push("installs recommended packages");
  return { problems };`, { dockerfile: "FROM node:latest\nRUN apt-get install curl" }, { problems: ["base image isn't pinned", "runs as root", "installs recommended packages"] }),
  logic(QUALITY, "api-breaking", "Find breaking API changes", "Endpoints in the old list that the new one doesn't have.", `  const now = new Set(data.after ?? []);
  const removed = (data.before ?? []).filter((route) => !now.has(route));
  return { breaking: removed.length > 0, removed };`, { before: ["GET /a", "POST /b"], after: ["GET /a"] }, { breaking: true, removed: ["POST /b"] }),
  logic(QUALITY, "env-diff", "Compare two environments' settings", "Names set in one and missing from the other. Only names, never values.", `  const a = new Set(data.staging ?? []);
  const b = new Set(data.production ?? []);
  return { missingInProduction: [...a].filter((name) => !b.has(name)), missingInStaging: [...b].filter((name) => !a.has(name)) };`, { staging: ["A", "B"], production: ["B", "C"] }, { missingInProduction: ["A"], missingInStaging: ["C"] }),

  logic(TESTS, "test-summary", "Sum up a test run", "Passed, failed and how much of it passed.", `  const results = data.results ?? [];
  const failed = results.filter((item) => item.status === "failed");
  const rate = results.length ? Math.round(((results.length - failed.length) / results.length) * 100) : 0;
  return { total: results.length, failed: failed.length, passRate: rate, names: failed.map((item) => item.name) };`, { results: [{ name: "a", status: "passed" }, { name: "b", status: "failed" }, { name: "c", status: "passed" }, { name: "d", status: "passed" }] }, { total: 4, failed: 1, passRate: 75 }),
  logic(TESTS, "flaky-tests", "Find flaky tests", "A test that both passed and failed on the same code.", `  const seen = {};
  for (const run of data.runs ?? []) (seen[run.test + "@" + run.commit] ??= new Set()).add(run.passed);
  const flaky = new Set(Object.entries(seen).filter(([, outcomes]) => outcomes.size > 1).map(([key]) => key.split("@")[0]));
  return { flaky: [...flaky].sort() };`, { runs: [{ test: "a", commit: "1", passed: true }, { test: "a", commit: "1", passed: false }, { test: "b", commit: "1", passed: true }] }, { flaky: ["a"] }),
  logic(TESTS, "junit-summary", "Read a JUnit report", "Takes the totals out of the XML that test tools write.", `  const match = /<testsuite[^>]*\\btests="(\\d+)"[^>]*\\bfailures="(\\d+)"/.exec(String(data.xml ?? ""));
  const tests = match ? Number(match[1]) : 0;
  const failures = match ? Number(match[2]) : 0;
  return { tests, failures, passed: failures === 0 };`, { xml: '<testsuite name="x" tests="12" failures="2"></testsuite>' }, { tests: 12, failures: 2, passed: false }),
  logic(TESTS, "slowest-tests", "Find the slowest tests", "The ones to speed up first.", `  const sorted = [...(data.tests ?? [])].sort((a, b) => b.ms - a.ms).slice(0, data.top ?? 3);
  return { slowest: sorted.map((item) => item.name) };`, { top: 2, tests: [{ name: "a", ms: 10 }, { name: "b", ms: 500 }, { name: "c", ms: 90 }] }, { slowest: ["b", "c"] }),
  logic(TESTS, "build-regression", "Notice builds getting slower", "Compares the latest build with the average of the ones before.", `  const times = data.seconds ?? [];
  const latest = times.at(-1) ?? 0;
  const before = times.slice(0, -1);
  const average = before.length ? before.reduce((sum, value) => sum + value, 0) / before.length : latest;
  return { average: Math.round(average), slower: latest > average * 1.2 };`, { seconds: [100, 100, 100, 150] }, { average: 100, slower: true }),
  logic(TESTS, "explain-exit-code", "Say what an exit code means", "The usual meanings, for a failed step's message.", `  const known = { 0: "succeeded", 1: "a general failure", 2: "misused a command", 126: "couldn't execute", 127: "command not found", 137: "killed, often out of memory", 143: "stopped" };
  return { meaning: known[data.code] ?? "exit code " + data.code };`, { code: 137 }, { meaning: "killed, often out of memory" }),
  logic(TESTS, "stack-top", "Find where it failed", "The first frame of a stack trace that's in your code.", `  const frames = String(data.trace ?? "").split("\\n").filter((line) => line.trim().startsWith("at "));
  const mine = frames.find((line) => !line.includes("node_modules") && !line.includes("node:"));
  return { frame: mine?.trim() ?? null, frames: frames.length };`, { trace: "Error: x\n    at f (node:internal/a:1:1)\n    at g (/app/src/g.ts:4:2)\n    at h (/app/node_modules/z.js:1:1)" }, { frame: "at g (/app/src/g.ts:4:2)", frames: 3 }),
  logic(TESTS, "retry-or-fail", "Decide whether to retry a failed job", "Retries what looks like the network, not what looks like the code.", `  const log = String(data.log ?? "");
  const transient = /(ETIMEDOUT|ECONNRESET|503|rate limit|temporary failure)/i.test(log);
  const attempts = data.attempts ?? 0;
  return { retry: transient && attempts < 3, transient };`, { log: "npm ERR! network ETIMEDOUT", attempts: 1 }, { retry: true, transient: true }),

  logic(SECURITY, "secrets-in-diff", "Catch secrets in a change", "Looks for key shapes in added lines. Says where, and never repeats the key.", `  const rules = [[/AKIA[0-9A-Z]{16}/, "AWS key"], [/ghp_[A-Za-z0-9]{36}/, "GitHub token"], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"], [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"]];
  const found = [];
  String(data.diff ?? "").split("\\n").forEach((line, index) => {
    if (!line.startsWith("+")) return;
    for (const [rule, kind] of rules) if (rule.test(line)) found.push({ line: index + 1, kind });
  });
  return { clean: found.length === 0, found };`, { diff: "+const a = 1\n+key = AKIAABCDEFGHIJKLMNOP" }, { clean: false, found: [{ line: 2, kind: "AWS key" }] }),
  logic(SECURITY, "dep-bumps", "Sort dependency updates by risk", "Major, minor and patch, from old and new versions.", `  const kinds = { major: [], minor: [], patch: [] };
  for (const item of data.updates ?? []) {
    const [a, b] = [item.from, item.to].map((version) => version.replace(/^[^0-9]*/, "").split(".").map(Number));
    kinds[a[0] !== b[0] ? "major" : a[1] !== b[1] ? "minor" : "patch"].push(item.name);
  }
  return kinds;`, { updates: [{ name: "a", from: "^1.0.0", to: "2.0.0" }, { name: "b", from: "1.1.0", to: "1.2.0" }, { name: "c", from: "1.1.0", to: "1.1.1" }] }, { major: ["a"], minor: ["b"], patch: ["c"] }),
  logic(SECURITY, "vuln-gate", "Hold a build for serious vulnerabilities", "Critical and high stop it. The rest are counted.", `  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const item of data.findings ?? []) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
  return { ...counts, block: counts.critical + counts.high > 0 };`, { findings: [{ severity: "low" }, { severity: "high" }] }, { high: 1, low: 1, block: true }),
  logic(SECURITY, "license-check", "Check dependencies' licences", "Those not on your allowed list.", `  const allowed = new Set(data.allowed ?? []);
  const bad = (data.packages ?? []).filter((item) => !allowed.has(item.license)).map((item) => item.name + " (" + item.license + ")");
  return { ok: bad.length === 0, bad };`, { allowed: ["MIT", "Apache-2.0"], packages: [{ name: "a", license: "MIT" }, { name: "b", license: "GPL-3.0" }] }, { ok: false, bad: ["b (GPL-3.0)"] }),
  logic(SECURITY, "verify-signature", "Check a webhook's signature", "HMAC-SHA256, compared in constant time, as services sign what they send.", `  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const made = createHmac("sha256", data.secret).update(data.body).digest("hex");
  const given = String(data.signature ?? "").replace(/^sha256=/, "");
  const same = made.length === given.length && timingSafeEqual(Buffer.from(made), Buffer.from(given));
  return { valid: same };`, { secret: "s", body: "{}", signature: "sha256=wrong" }, { valid: false }),
  logic(SECURITY, "expiring-certs", "Warn about certificates about to expire", "Those due within a number of days.", `  const limit = Date.parse(data.today) + (data.days ?? 30) * 86400000;
  const soon = (data.certs ?? []).filter((cert) => Date.parse(cert.expires) < limit).map((cert) => cert.host);
  return { soon };`, { today: "2026-11-07", days: 30, certs: [{ host: "a.test", expires: "2026-11-20" }, { host: "b.test", expires: "2027-11-20" }] }, { soon: ["a.test"] }),

  logic(ISSUES, "triage-issue", "Label an issue from its words", "Bug, feature or question.", `  const text = ((data.title ?? "") + " " + (data.body ?? "")).toLowerCase();
  const label = /(crash|error|broken|fails|bug|exception)/.test(text) ? "bug" : /(add|feature|support|would be nice|request)/.test(text) ? "feature" : /(how|why|what|\\?)/.test(text) ? "question" : "needs-triage";
  return { label };`, { title: "App crashes on save", body: "" }, { label: "bug" }),
  logic(ISSUES, "issue-priority", "Set an issue's priority", "From what it says it affects.", `  const text = (data.body ?? "").toLowerCase();
  const priority = /(data loss|security|production down|outage)/.test(text) ? "P1" : /(all users|blocks|cannot)/.test(text) ? "P2" : "P3";
  return { priority };`, { body: "Production down since noon" }, { priority: "P1" }),
  logic(ISSUES, "similar-issues", "Find issues that may be the same", "By the words their titles share.", `  const words = (text) => new Set(text.toLowerCase().split(/\\W+/).filter((word) => word.length > 3));
  const mine = words(data.title ?? "");
  const scored = (data.others ?? []).map((other) => ({ other, shared: [...words(other)].filter((word) => mine.has(word)).length })).filter((item) => item.shared >= 2).sort((a, b) => b.shared - a.shared);
  return { similar: scored.map((item) => item.other) };`, { title: "Login button broken on mobile", others: ["Mobile login button overlaps", "Fix typo in docs"] }, { similar: ["Mobile login button overlaps"] }),
  logic(ISSUES, "missing-details", "Ask for what a bug report leaves out", "Steps, expected and actual.", `  const body = (data.body ?? "").toLowerCase();
  const missing = ["steps", "expected", "actual"].filter((word) => !body.includes(word));
  return { complete: missing.length === 0, missing };`, { body: "Steps: click save. Actual: crash." }, { complete: false, missing: ["expected"] }),
  logic(ISSUES, "stale-issues", "Find issues gone quiet", "With no activity for a number of days, leaving those labelled to keep.", `  const cutoff = Date.parse(data.today) - (data.days ?? 60) * 86400000;
  const stale = (data.issues ?? []).filter((issue) => Date.parse(issue.updated) < cutoff && !(issue.labels ?? []).includes("keep")).map((issue) => issue.number);
  return { stale };`, { today: "2026-11-07", days: 30, issues: [{ number: 1, updated: "2026-01-01", labels: [] }, { number: 2, updated: "2026-01-01", labels: ["keep"] }, { number: 3, updated: "2026-11-01", labels: [] }] }, { stale: [1] }),
  logic(ISSUES, "branch-from-title", "Make a branch name from an issue", "Lower case and only what git allows, with the issue's number in front.", `  const words = String(data.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return { branch: "issue-" + data.number + "-" + words };`, { number: 12, title: "Fix: Login Button!" }, { branch: "issue-12-fix-login-button" }),
  logic(ISSUES, "good-first-issue", "Spot a good first issue", "Small, clear, and with a place to start.", `  const body = data.body ?? "";
  const small = body.length < 800;
  const pointed = /\\b[\\w/.-]+\\.(ts|js|py|go|md)\\b/.test(body);
  return { good: small && pointed && !(data.labels ?? []).includes("bug-critical") };`, { body: "Fix the typo in docs/intro.md", labels: [] }, { good: true }),

  logic(OPS, "deploy-window", "Allow deploys only at safe times", "Not on Fridays, and only in working hours.", `  const at = new Date(data.at);
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  const allowed = day >= 1 && day <= 4 && hour >= 9 && hour < 17;
  return { allowed };`, { at: "2026-11-06T11:00:00Z" }, { allowed: false }),
  logic(OPS, "canary-check", "Promote or roll back a canary", "Compares its error rate with the stable version's.", `  const worse = data.canaryErrorRate > data.stableErrorRate * 1.5 && data.canaryErrorRate > 0.01;
  return { decision: worse ? "rollback" : "promote" };`, { canaryErrorRate: 0.05, stableErrorRate: 0.01 }, { decision: "rollback" }),
  logic(OPS, "uptime", "Work out uptime", "From a list of checks.", `  const checks = data.checks ?? [];
  const up = checks.filter((check) => check.ok).length;
  return { percent: checks.length ? Math.round((up / checks.length) * 10000) / 100 : 100, incidents: checks.length - up };`, { checks: [{ ok: true }, { ok: true }, { ok: true }, { ok: false }] }, { percent: 75, incidents: 1 }),
  logic(OPS, "error-budget", "Track an error budget", "How much of the month's allowance has gone.", `  const allowed = data.requests * (1 - data.slo);
  const used = allowed ? data.errors / allowed : 0;
  return { usedPercent: Math.round(used * 100), exhausted: used >= 1 };`, { requests: 100000, errors: 50, slo: 0.999 }, { usedPercent: 50, exhausted: false }),
  logic(OPS, "group-log-errors", "Group errors in a log", "The same message, however often, most common first.", `  const counts = {};
  for (const line of String(data.log ?? "").split("\\n")) {
    const match = /ERROR\\s+(.+)/.exec(line);
    if (match) counts[match[1].replace(/\\d+/g, "N")] = (counts[match[1].replace(/\\d+/g, "N")] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { kinds: top.length, top: top[0]?.[0] ?? null };`, { log: "ERROR timeout 12\nINFO ok\nERROR timeout 99\nERROR disk full" }, { kinds: 2, top: "timeout N" }),
  logic(OPS, "who-is-on-call", "Say who's on call", "A weekly rota from a list of names.", `  const week = Math.floor(Date.parse(data.date) / 604800000);
  const people = data.people ?? [];
  return { onCall: people[week % people.length] ?? null };`, { date: "2026-11-07", people: ["Asha"] }, { onCall: "Asha" }),
  logic(OPS, "dedupe-alerts", "Don't alert twice about one thing", "Keeps the first of each.", `  const seen = new Set();
  const kept = (data.alerts ?? []).filter((alert) => (seen.has(alert.key) ? false : seen.add(alert.key)));
  return { kept: kept.length, dropped: (data.alerts ?? []).length - kept.length };`, { alerts: [{ key: "a" }, { key: "a" }, { key: "b" }] }, { kept: 2, dropped: 1 }),
  logic(OPS, "image-tags-to-remove", "Tidy old image tags", "Keeps the newest few, and whatever's in use.", `  const used = new Set(data.inUse ?? []);
  const sorted = [...(data.tags ?? [])].sort((a, b) => Date.parse(b.pushed) - Date.parse(a.pushed));
  const remove = sorted.slice(data.keep ?? 3).filter((tag) => !used.has(tag.name)).map((tag) => tag.name);
  return { remove };`, { keep: 1, inUse: ["v1"], tags: [{ name: "v3", pushed: "2026-03-01" }, { name: "v2", pushed: "2026-02-01" }, { name: "v1", pushed: "2026-01-01" }] }, { remove: ["v2"] }),
  logic(OPS, "stale-branches", "Find branches to delete", "Merged, or untouched for a long time.", `  const cutoff = Date.parse(data.today) - (data.days ?? 90) * 86400000;
  const stale = (data.branches ?? []).filter((branch) => branch.name !== "main" && (branch.merged || Date.parse(branch.lastCommit) < cutoff)).map((branch) => branch.name);
  return { stale };`, { today: "2026-11-07", days: 30, branches: [{ name: "main", lastCommit: "2020-01-01" }, { name: "a", merged: true, lastCommit: "2026-11-01" }, { name: "b", lastCommit: "2026-11-01" }] }, { stale: ["a"] }),

  logic(DOCS, "csv-to-json", "Turn CSV into JSON", "With the first line as the names.", `  const [head, ...rows] = String(data.csv ?? "").trim().split("\\n").map((line) => line.split(","));
  return { rows: rows.map((row) => Object.fromEntries(head.map((name, index) => [name, row[index]]))) };`, { csv: "a,b\n1,2" }, { rows: [{ a: "1", b: "2" }] }),
  logic(DOCS, "links-in-markdown", "List the links in a document", "To check them, or find what's missing.", `  const links = [...String(data.markdown ?? "").matchAll(/\\[[^\\]]*\\]\\(([^)\\s]+)\\)/g)].map((match) => match[1]);
  return { links, external: links.filter((link) => /^https?:/.test(link)).length };`, { markdown: "[a](https://a.test) and [b](./b.md)" }, { external: 1 }),
  logic(DOCS, "docs-with-code", "Ask for docs with a public change", "A change to the public API that doesn't touch the docs.", `  const files = data.files ?? [];
  const publicChange = files.some((file) => /(^|\\/)(api|public)\\//.test(file));
  const docs = files.some((file) => file.endsWith(".md") || file.startsWith("docs/"));
  return { needsDocs: publicChange && !docs };`, { files: ["src/api/users.ts"] }, { needsDocs: true }),
  logic(DOCS, "required-fields", "Check a config has what it needs", "The keys that are missing.", `  const missing = (data.required ?? []).filter((key) => !(key in (data.config ?? {})));
  return { ok: missing.length === 0, missing };`, { required: ["name", "port"], config: { name: "x" } }, { ok: false, missing: ["port"] }),
  logic(DIGESTS, "standup", "Sum up yesterday's commits", "Who did what, for a stand-up.", `  const byAuthor = {};
  for (const commit of data.commits ?? []) (byAuthor[commit.author] ??= []).push(commit.message);
  return { people: Object.keys(byAuthor).length, summary: Object.entries(byAuthor).map(([name, list]) => name + ": " + list.length + " commits").join("; ") };`, { commits: [{ author: "Asha", message: "a" }, { author: "Asha", message: "b" }] }, { people: 1, summary: "Asha: 2 commits" }),
  logic(DIGESTS, "contributor-stats", "Count contributions", "Commits and lines for each person.", `  const stats = {};
  for (const commit of data.commits ?? []) {
    const item = (stats[commit.author] ??= { commits: 0, lines: 0 });
    item.commits += 1;
    item.lines += commit.lines ?? 0;
  }
  return { stats };`, { commits: [{ author: "Ben", lines: 5 }, { author: "Ben", lines: 7 }] }, { stats: { Ben: { commits: 2, lines: 12 } } }),
  // With branches and loops, so the chart has something to show.
  {
    id: "route-by-size",
    title: "Send big changes for a second review",
    about: "A router: a change over a limit goes one way, the rest another.",
    category: REVIEW,
    runsHere: true,
    sample: { additions: 900, deletions: 200 },
    expect: { step: "second_review", output: { review: "second reviewer" } },
    alsoTry: { sample: { additions: 1, deletions: 2 }, step: "one_review", notStep: "second_review" },
    flow: () => chain(webhook(), [code("measure", "Measure it", "  return { lines: (data.additions ?? 0) + (data.deletions ?? 0) };"), branch("route", "Big?", "{{measure.output.lines}}", "NUMBER_IS_GREATER_THAN", "500", code("second_review", "Ask for a second review", '  return { review: "second reviewer" };', {}), code("one_review", "One review is enough", '  return { review: "one reviewer" };', {}), "Big", "Small")]),
  },
  {
    id: "each-failed-test",
    title: "Write a message for each failed test",
    about: "A loop: goes through the failures and writes something for each.",
    category: TESTS,
    runsHere: true,
    sample: { results: [{ name: "a", status: "failed" }, { name: "b", status: "passed" }, { name: "c", status: "failed" }] },
    expect: { step: "failures", output: { count: 2 } },
    flow: () => chain(webhook(), [code("failures", "Find the failures", '  const list = (data.results ?? []).filter((item) => item.status === "failed");\n  return { list, count: list.length };'), each("each", "Each failure", "{{failures.output.list}}", code("message", "Write its message", '  return { text: data.name + " failed" };', { data: "{{each.output.item}}" }))]),
  },
  {
    id: "coverage-gate",
    title: "Fail a build when coverage drops",
    about: "A router on the difference from the last build.",
    category: TESTS,
    runsHere: true,
    sample: { before: 82, now: 79 },
    expect: { step: "fail_it", output: { pass: false } },
    alsoTry: { sample: { before: 82, now: 82 }, step: "pass_it", notStep: "fail_it" },
    flow: () => chain(webhook(), [code("compare", "Compare", "  return { drop: Math.round((data.before - data.now) * 100) / 100 };"), branch("route", "Dropped?", "{{compare.output.drop}}", "NUMBER_IS_GREATER_THAN", "1", code("fail_it", "Fail it", "  return { pass: false };", {}), code("pass_it", "Pass it", "  return { pass: true };", {}), "Dropped", "Fine")]),
  },
  {
    id: "hotfix-path",
    title: "Fast-track hotfixes",
    about: "A branch named hotfix/ skips the slow checks.",
    category: OPS,
    runsHere: true,
    sample: { branch: "hotfix/payments" },
    expect: { step: "fast", output: { checks: "quick" } },
    alsoTry: { sample: { branch: "main" }, step: "full", notStep: "fast" },
    flow: () => chain(webhook(), [branch("route", "A hotfix?", "{{trigger.output.body.branch}}", "TEXT_START_WITH", "hotfix/", code("fast", "Quick checks", '  return { checks: "quick" };', {}), code("full", "All the checks", '  return { checks: "all" };', {}), "Hotfix", "Anything else")]),
  },
];

// Real pieces that need no account, so they run here too.
function withPieces(category: string, id: string, title: string, about: string, steps: () => FlowStep[], sample: unknown, step: string, output: unknown): Example {
  return { id, title, about, category, runsHere: true, sample, expect: { step, output }, flow: () => chain(webhook(), steps()) };
}
const body = (name: string) => `{{trigger.output.body.${name}}}`;
const CSV = "name,status,ms\nlogin,failed,120\nsearch,passed,900\nsave,failed,40\nsearch,passed,900";
const WHEN = "YYYY-MM-DDTHH:mm:ss";
const WITH_PIECES: Example[] = [
  withPieces(RELEASES, "notes-to-html", "Turn release notes into HTML", "Markdown to HTML with a real piece, ready for a mail or a page.", () => [action("html", "text-helper", "markdown_to_html", "Markdown to HTML", { markdown: body("notes"), flavor: "github", headerLevelStart: 1, tables: true, noHeaderId: true, simpleLineBreaks: false, openLinksInNewWindow: false }, false)], { notes: "# Hello" }, "html", "<h1>Hello</h1>"),
  withPieces(DOCS, "count-runs", "Remember something between runs", "A real piece keeps a value in this room, for the next run to read.", () => [action("write", "store", "put", "Keep it", { key: "last-value", value: body("value"), store_scope: "COLLECTION" }, false), action("read", "store", "get", "Read it back", { key: "last-value", store_scope: "COLLECTION" }, false)], { value: "kept" }, "read", "kept"),
  withPieces(TESTS, "csv-report-to-json", "Read a test report in CSV", "A real CSV parser turns each row into data, for the steps after it.", () => [action("rows", "csv", "convert_csv_to_json", "Read the CSV", { csv_text: body("csv"), has_headers: true, delimiter_type: "," }, false)], { csv: "name,status\nlogin,failed" }, "rows", [{ name: "login", status: "failed" }]),
  withPieces(TESTS, "failed-from-csv", "Keep only the failed tests", "A real piece filters a CSV report down to what failed.", () => [action("failed", "csv", "filter_csv_rows", "Only the failures", { csv_text: body("csv"), column: "status", condition: "equals", value: "failed" }, false)], { csv: CSV }, "failed", { row_count: 2, csv: "name,status,ms\nlogin,failed,120\nsave,failed,40\n" }),
  withPieces(TESTS, "slowest-from-csv", "Sort a benchmark's results", "A real piece puts the slowest first, comparing them as numbers.", () => [action("sorted", "csv", "sort_csv_rows", "Slowest first", { csv_text: body("csv"), column: "ms", direction: "desc", compare_as: "number" }, false)], { csv: "name,ms\na,9\nb,100" }, "sorted", { rows: [{ name: "b", ms: "100" }, { name: "a", ms: "9" }] }),
  withPieces(TESTS, "dedupe-csv", "Remove repeated rows from a report", "A real piece keeps the first of each.", () => [action("unique", "csv", "remove_duplicate_csv_rows", "Remove repeats", { csv_text: body("csv"), keep: "first" }, false)], { csv: CSV }, "unique", { row_count: 3 }),
  withPieces(DOCS, "json-to-csv", "Turn results into a CSV", "A real piece writes rows of data as CSV, for a spreadsheet.", () => [action("csv", "csv", "convert_json_to_csv", "Write the CSV", { json_array: body("rows"), delimiter_type: "," }, false)], { rows: [{ name: "a", ms: 1 }] }, "csv", "name,ms\na,1\n"),
  withPieces(TESTS, "junit-to-json", "Read a JUnit report with a real parser", "XML to data, so each test can be looked at.", () => [action("report", "xml", "convert-xml-to-json", "Read the XML", { xml: body("xml"), ignoreAttributes: false }, false)], { xml: '<testsuite name="x"><testcase name="a"/></testsuite>' }, "report", { testsuite: { testcase: {} } }),
  withPieces(REVIEW, "jsonata-big-files", "Count the big files in a change", "A real JSONata query over what a webhook sent.", () => [action("count", "json", "run_jsonata_query", "Query it", { json: "{{trigger.output.body}}", query: "$count(files[lines > 100])" }, false)], { files: [{ lines: 500 }, { lines: 5 }, { lines: 200 }] }, "count", 2),
  withPieces(TESTS, "csv-then-query", "Count the failures in a CSV report", "Two real pieces: one reads the CSV, and a JSONata query counts.", () => [action("rows", "csv", "convert_csv_to_json", "Read the CSV", { csv_text: body("csv"), has_headers: true, delimiter_type: "," }, false), action("count", "json", "run_jsonata_query", "Count the failures", { json: "{{rows.output}}", query: '$count($[status="failed"])' }, false)], { csv: CSV }, "count", 2),
  withPieces(SECURITY, "hash-artifact", "Fingerprint a build", "A SHA-256 of what you give it, to compare with later.", () => [action("hash", "crypto", "hash-text", "Hash it", { method: "sha256", text: body("text") }, false)], { text: "hello" }, "hash", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
  withPieces(SECURITY, "sign-webhook", "Sign what you send to a webhook", "An HMAC-SHA256, as services expect, with a key you give it.", () => [action("signature", "crypto", "hmac-signature", "Sign it", { secretKey: body("key"), secretKeyEncoding: "utf-8", method: "sha256", text: body("text"), outputEncoding: "hex" }, false)], { key: "key", text: "hello" }, "signature", "9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b"),
  withPieces(DOCS, "base64-config", "Encode a config for a variable", "Base64, as CI variables often want it.", () => [action("encoded", "crypto", "base64-encode", "Encode it", { text: body("text") }, false)], { text: "hello" }, "encoded", "aGVsbG8="),
  withPieces(REVIEW, "pr-age", "Say how long a pull request has been open", "A real date piece works out the days.", () => [action("age", "date-helper", "date_difference", "Days open", { startDate: body("opened"), startDateFormat: WHEN, endDate: body("now"), endDateFormat: WHEN, unitDifference: ["day"] }, false)], { opened: "2026-11-01T00:00:00", now: "2026-11-07T00:00:00" }, "age", { day: 6 }),
  withPieces(TESTS, "share-passed", "Work out the share that passed", "A real piece does the division.", () => [action("share", "math-helper", "division_math", "Divide", { first_number: body("passed"), second_number: body("total") }, false)], { passed: 3, total: 4 }, "share", 0.75),
  withPieces(DOCS, "reshape-webhook", "Keep only what you need from a webhook", "A real piece reshapes what arrived.", () => [action("shape", "data-mapper", "advanced_mapping", "Reshape it", { mapping: { title: "{{trigger.output.body.pull.title}}", author: "{{trigger.output.body.pull.user.login}}" } }, false)], { pull: { title: "Add search", user: { login: "asha" }, extra: "not needed" } }, "shape", { title: "Add search", author: "asha" }),
  withPieces(SECURITY, "hide-emails", "Hide email addresses in a log", "A real piece replaces what a pattern finds.", () => [action("clean", "text-helper", "replace", "Hide them", { text: body("log"), searchValue: "[\\w.]+@[\\w.]+", replaceValue: "[hidden]", replaceOnlyFirst: false }, false)], { log: "login by a.b@c.test ok" }, "clean", "login by [hidden] ok"),
];

// ---- The same few things for each service. Each needs its service's connection, and its dropdowns chosen. ----

type Destination = { key: string; label: string; step: (message: string) => FlowStep };
const DESTINATIONS: Destination[] = [
  { key: "slack", label: "Slack", step: (message) => action("send", "slack", "send_channel_message", "Post to Slack", { channel: "", text: message, sendAsBot: true }) },
  { key: "discord", label: "Discord", step: (message) => action("send", "discord", "send_message_webhook", "Post to Discord", { webhook_url: "", content: message }) },
  { key: "telegram", label: "Telegram", step: (message) => action("send", "telegram-bot", "send_text_message", "Send on Telegram", { chat_id: "", format: "None", message }) },
  { key: "teams", label: "Microsoft Teams", step: (message) => action("send", "microsoft-teams", "microsoft_teams_send_channel_message", "Post to Teams", { teamId: "", channelId: "", contentType: "text", content: message }) },
  { key: "email", label: "email", step: (message) => action("send", "smtp", "send-email", "Send an email", { from: "", to: [], subject: "From your automation", body_type: "plain_text", body: message }) },
];

type EventSource = { key: string; title: string; about: string; trigger: () => FlowStep; message: string };
const EVENTS: EventSource[] = [
  { key: "pr-opened", title: "a pull request changes", about: "GitHub says a pull request was opened, closed or changed.", trigger: () => pieceTrigger("github", "trigger_pull_request", "A pull request", { repository: "" }), message: "Pull request: {{trigger.output.pull_request.title}} {{trigger.output.pull_request.html_url}}" },
  { key: "issue-opened", title: "an issue changes", about: "GitHub says an issue was opened or changed.", trigger: () => pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), message: "Issue: {{trigger.output.issue.title}} {{trigger.output.issue.html_url}}" },
  { key: "push", title: "code is pushed", about: "GitHub says commits arrived.", trigger: () => pieceTrigger("github", "trigger_push", "A push", { repository: "" }), message: "{{trigger.output.pusher.name}} pushed to {{trigger.output.ref}}" },
  { key: "release", title: "a release is published", about: "GitHub says there's a new release.", trigger: () => pieceTrigger("github", "new_release", "A release", { repository: "" }), message: "Released: {{trigger.output.name}} {{trigger.output.html_url}}" },
  { key: "ci-failed", title: "a build fails", about: "Your CI calls this flow's webhook when a build fails.", trigger: () => webhook("A failed build"), message: "Build failed on {{trigger.output.body.branch}}: {{trigger.output.body.url}}" },
  { key: "deploy", title: "a deploy finishes", about: "Your deploy script calls this flow's webhook.", trigger: () => webhook("A deploy finished"), message: "Deployed {{trigger.output.body.version}} to {{trigger.output.body.environment}}" },
  { key: "gitlab-issue", title: "a GitLab issue changes", about: "GitLab says an issue changed.", trigger: () => pieceTrigger("gitlab", "project_issue_event", "A GitLab issue", { projectId: "", actiontype: "open" }), message: "GitLab issue: {{trigger.output.object_attributes.title}} {{trigger.output.object_attributes.url}}" },
];

const NOTIFICATIONS: Example[] = EVENTS.flatMap((event) =>
  DESTINATIONS.map((destination) => ({
    id: `${event.key}-to-${destination.key}`,
    title: `Tell ${destination.label} when ${event.title}`,
    about: event.about,
    category: NOTIFY,
    runsHere: false,
    flow: () => chain(event.trigger(), [destination.step(event.message)]),
  })),
);

type Tracker = { key: string; label: string; step: (title: string, body: string) => FlowStep };
const TRACKERS: Tracker[] = [
  { key: "github", label: "GitHub", step: (title, body) => action("ticket", "github", "github_create_issue", "Open a GitHub issue", { repository: "", title, description: body }) },
  { key: "gitlab", label: "GitLab", step: (title, body) => action("ticket", "gitlab", "create_issue", "Open a GitLab issue", { projectId: "", title, description: body }) },
  { key: "linear", label: "Linear", step: (title, body) => action("ticket", "linear", "linear_create_issue", "Open a Linear issue", { team_id: "", title, description: body }) },
  { key: "trello", label: "Trello", step: (title, body) => action("ticket", "trello", "create_card", "Add a Trello card", { board_id: "", list_id: "", name: title, description: body }) },
];

const TICKET_EVENTS: Array<{ key: string; title: string; about: string; ticket: [string, string] }> = [
  { key: "ci-failed", title: "a build fails", about: "So a failed build doesn't get forgotten.", ticket: ["Build failed on {{trigger.output.body.branch}}", "{{trigger.output.body.url}}"] },
  { key: "flaky", title: "a test turns flaky", about: "Your tests call this with the test's name.", ticket: ["Flaky test: {{trigger.output.body.test}}", "Failing on {{trigger.output.body.branch}}"] },
  { key: "alert", title: "monitoring raises an alert", about: "Your monitoring calls this flow's webhook.", ticket: ["Alert: {{trigger.output.body.title}}", "{{trigger.output.body.details}}"] },
  { key: "vuln", title: "a vulnerability is found", about: "Your security scan calls this flow's webhook.", ticket: ["Vulnerability in {{trigger.output.body.package}}", "{{trigger.output.body.advisory}}"] },
  { key: "feedback", title: "someone sends feedback", about: "A form on your site calls this flow's webhook.", ticket: ["Feedback: {{trigger.output.body.subject}}", "{{trigger.output.body.message}}"] },
];

const TICKET_EXAMPLES: Example[] = TICKET_EVENTS.flatMap((event) =>
  TRACKERS.map((tracker) => ({
    id: `${event.key}-to-${tracker.key}`,
    title: `Open a ${tracker.label} ticket when ${event.title}`,
    about: event.about,
    category: TICKETS,
    runsHere: false,
    flow: () => chain(webhook(), [tracker.step(event.ticket[0], event.ticket[1])]),
  })),
);

const SYNCS: Example[] = TRACKERS.filter((tracker) => tracker.key !== "github").map((tracker) => ({
  id: `github-issue-to-${tracker.key}`,
  title: `Copy GitHub issues to ${tracker.label}`,
  about: "Each new GitHub issue gets a ticket where your team works.",
  category: TICKETS,
  runsHere: false,
  flow: () => chain(pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), [tracker.step("{{trigger.output.issue.title}}", "{{trigger.output.issue.html_url}}")]),
}));

const askAi = (prompt: string): FlowStep => action("ai", "openai", "ask_chatgpt", "Ask the AI", { model: "", prompt, maxTokens: 800 });
const AI_JOBS: Array<{ key: string; title: string; about: string; trigger: () => FlowStep; prompt: string }> = [
  { key: "review-pr", title: "Review a pull request with AI", about: "Asks a model to review a pull request's description and changes.", trigger: () => pieceTrigger("github", "trigger_pull_request", "A pull request", { repository: "" }), prompt: "Review this pull request. Point out bugs and risks, briefly.\n\nTitle: {{trigger.output.pull_request.title}}\n\n{{trigger.output.pull_request.body}}" },
  { key: "triage-issue-ai", title: "Triage an issue with AI", about: "Asks a model what kind of issue this is and how urgent.", trigger: () => pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), prompt: "Say whether this is a bug, a feature or a question, and how urgent, in one line.\n\n{{trigger.output.issue.title}}\n\n{{trigger.output.issue.body}}" },
  { key: "explain-failure", title: "Explain a failed build with AI", about: "Your CI sends its log, and a model says what went wrong.", trigger: () => webhook("A failed build"), prompt: "Explain why this build failed, and what to try, briefly.\n\n{{trigger.output.body.log}}" },
  { key: "release-notes-ai", title: "Write release notes with AI", about: "Turns commits into notes people want to read.", trigger: () => webhook("A new release"), prompt: "Write short, friendly release notes from these commits.\n\n{{trigger.output.body.commits}}" },
  { key: "commit-summary", title: "Sum up a push with AI", about: "What a push changed, in a sentence.", trigger: () => pieceTrigger("github", "trigger_push", "A push", { repository: "" }), prompt: "Sum up these commits in one sentence.\n\n{{trigger.output.commits}}" },
  { key: "incident-summary", title: "Sum up an incident with AI", about: "Your monitoring sends what it saw, and a model writes the update.", trigger: () => webhook("An incident"), prompt: "Write a calm status update about this incident.\n\n{{trigger.output.body.details}}" },
];
const AI_EXAMPLES: Example[] = AI_JOBS.flatMap((job) =>
  DESTINATIONS.slice(0, 3).map((destination) => ({
    id: `${job.key}-to-${destination.key}`,
    title: `${job.title}, on ${destination.label}`,
    about: job.about,
    category: AI,
    runsHere: false,
    flow: () => chain(job.trigger(), [askAi(job.prompt), destination.step("{{ai.output}}")]),
  })),
);

const everyDay = () => pieceTrigger("schedule", "every_day", "Every morning", { hour_of_the_day: 9, timezone: "UTC", run_on_weekends: false }, false);
const everyWeek = () => pieceTrigger("schedule", "every_week", "Every Monday", { day_of_the_week: 1, hour_of_the_day: 9, timezone: "UTC" }, false);
const fetchJson = (url: string): FlowStep => action("fetch", "http", "send_request", "Fetch it", { method: "GET", url, headers: { accept: "application/json" }, queryParams: {}, authType: "NONE", authFields: {}, use_proxy: false, proxy_settings: {}, response_is_binary: false, failureMode: "continue_none" }, false);
const DIGEST_JOBS: Array<{ key: string; title: string; about: string; trigger: () => FlowStep; steps: () => FlowStep[]; message: string }> = [
  { key: "open-prs", title: "List open pull requests each morning", about: "So none are forgotten. Set your repository in the URL.", trigger: everyDay, steps: () => [fetchJson("https://api.github.com/repos/OWNER/REPO/pulls?state=open")], message: "Open pull requests: {{fetch.output.body}}" },
  { key: "open-issues", title: "List open issues each Monday", about: "A start to the week. Set your repository in the URL.", trigger: everyWeek, steps: () => [fetchJson("https://api.github.com/repos/OWNER/REPO/issues?state=open")], message: "Open issues: {{fetch.output.body}}" },
  { key: "hacker-news", title: "Top Hacker News stories each morning", about: "What programmers are reading.", trigger: everyDay, steps: () => [action("stories", "hackernews", "fetch_top_stories", "Top stories", { number_of_stories: 5 }, false)], message: "Top stories: {{stories.output}}" },
  { key: "security-feed", title: "Security advisories each morning", about: "From a feed you choose.", trigger: everyDay, steps: () => [action("feed", "rss", "rss_read_feed", "Read the feed", { rss_feed_url: "https://github.com/advisories.atom", limit: 5 }, false)], message: "Advisories: {{feed.output}}" },
  { key: "release-watch", title: "Watch a project's releases", about: "Its releases feed, each Monday.", trigger: everyWeek, steps: () => [action("feed", "rss", "rss_read_feed", "Read the feed", { rss_feed_url: "https://github.com/OWNER/REPO/releases.atom", limit: 3 }, false)], message: "New releases: {{feed.output}}" },
];
const DIGEST_EXAMPLES: Example[] = DIGEST_JOBS.flatMap((job) =>
  DESTINATIONS.slice(0, 3).map((destination) => ({
    id: `${job.key}-to-${destination.key}`,
    title: `${job.title}, on ${destination.label}`,
    about: job.about,
    category: DIGESTS,
    runsHere: false,
    flow: () => chain(job.trigger(), [...job.steps(), destination.step(job.message)]),
  })),
);

const ONE_OFFS: Example[] = [
  { id: "page-on-outage", title: "Page someone when production is down", about: "Your monitoring calls this, and PagerDuty does the rest.", category: OPS, runsHere: false, flow: () => chain(webhook("An outage"), [action("page", "pagerduty", "create_incident", "Open an incident", { fromEmail: "", serviceId: "", title: "{{trigger.output.body.title}}", urgency: "high" })]) },
  { id: "deploy-on-release", title: "Deploy to Netlify on a release", about: "A release on GitHub starts a deploy.", category: OPS, runsHere: false, flow: () => chain(pieceTrigger("github", "new_release", "A release", { repository: "" }), [action("deploy", "netlify", "start_deploy", "Start a deploy", { siteId: "", clearCache: false })]) },
  { id: "comment-on-issue", title: "Thank whoever opens an issue", about: "A friendly first reply, on GitHub.", category: ISSUES, runsHere: false, flow: () => chain(pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), [action("reply", "github", "createCommentOnAIssue", "Reply", { repository: "", issue_number: "{{trigger.output.issue.number}}", comment: "Thanks for opening this. We'll take a look soon." })]) },
  { id: "branch-for-issue", title: "Make a branch for each new issue", about: "With a name made from the issue's title.", category: ISSUES, runsHere: false, flow: () => chain(pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), [code("name", "Make a name", '  const words = String(data.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);\n  return { branch: "issue-" + data.number + "-" + words };', { data: "{{trigger.output.issue}}" }), action("branch", "github", "create_branch", "Make the branch", { repository: "", source_branch: "main", new_branch_name: "{{name.output.branch}}" })]) },
  { id: "label-by-words", title: "Label GitHub issues from their words", about: "Works out the label in code, then sets it.", category: ISSUES, runsHere: false, flow: () => chain(pieceTrigger("github", "trigger_issues", "An issue", { repository: "" }), [code("label", "Choose a label", '  const text = String(data.title ?? "").toLowerCase();\n  return { label: /(crash|error|bug)/.test(text) ? "bug" : "needs-triage" };', { data: "{{trigger.output.issue}}" }), action("apply", "github", "add_labels_to_issue", "Set it", { repository: "", issue_number: "{{trigger.output.issue.number}}", labels: ["{{label.output.label}}"] })]) },
  { id: "close-stale-reminder", title: "Remind about stale issues each Monday", about: "Asks whoever opened them if they still matter.", category: ISSUES, runsHere: false, flow: () => chain(everyWeek(), [fetchJson("https://api.github.com/repos/OWNER/REPO/issues?state=open&sort=updated&direction=asc"), each("each", "Each issue", "{{fetch.output.body}}", action("nudge", "github", "createCommentOnAIssue", "Ask", { repository: "", issue_number: "{{each.output.item.number}}", comment: "Is this still needed?" }))]) },
  { id: "backup-reminder", title: "Remind about backups each week", about: "A nudge, on Slack, to check last week's backups restored.", category: OPS, runsHere: false, flow: () => chain(everyWeek(), [DESTINATIONS[0]!.step("Time to check last week's backups restore.")]) },
  { id: "mail-release-notes", title: "Mail release notes as HTML", about: "Markdown to HTML with one piece, and mailed with another.", category: RELEASES, runsHere: false, flow: () => chain(webhook("A new release"), [action("html", "text-helper", "markdown_to_html", "To HTML", { markdown: "{{trigger.output.body.notes}}", flavor: "github", headerLevelStart: 1, tables: true, noHeaderId: true, simpleLineBreaks: false, openLinksInNewWindow: false }, false), action("mail", "smtp", "send-email", "Mail it", { from: "", to: [], subject: "Release notes", body_type: "html", body: "{{html.output}}" })]) },
];

export const EXAMPLES: Example[] = [...RUNS_HERE, ...WITH_PIECES, ...NOTIFICATIONS, ...TICKET_EXAMPLES, ...SYNCS, ...AI_EXAMPLES, ...DIGEST_EXAMPLES, ...ONE_OFFS];
export const EXAMPLE_CATEGORIES = [...new Set(EXAMPLES.map((example) => example.category))].sort();

/** A flow ready for a room: each piece at the version this room's image has. */
export function flowOfExample(example: Pick<Example, "title" | "flow">, pieces: Record<string, PieceInfo>): Flow {
  const { trigger } = example.flow();
  const pin = (step: FlowStep | null | undefined) => {
    for (let current = step; current; current = current.nextAction) {
      const settings = current.settings as { pieceName?: string; pieceVersion?: string };
      if (settings.pieceName) settings.pieceVersion = pieces[settings.pieceName]?.version ?? settings.pieceVersion;
      pin(current.firstLoopAction);
      for (const child of current.children ?? []) pin(child);
    }
  };
  pin(trigger);
  return { displayName: example.title, schemaVersion: SCHEMA_VERSION, trigger };
}

/** What an example needs that isn't in a room: the services with a connection. */
export function servicesOf(example: Pick<Example, "flow">, pieces: Record<string, PieceInfo>): string[] {
  const found = new Set<string>();
  const walk = (step: FlowStep | null | undefined) => {
    for (let current = step; current; current = current.nextAction) {
      const input = (current.settings as { input?: { auth?: unknown }; pieceName?: string }).input;
      const name = (current.settings as { pieceName?: string }).pieceName;
      if (input?.auth && name) found.add(pieces[name]?.label ?? name.replace(piecePrefix, ""));
      walk(current.firstLoopAction);
      for (const child of current.children ?? []) walk(child);
    }
  };
  walk(example.flow().trigger);
  return [...found].sort();
}

export function matchesExample(example: Pick<Example, "title" | "about" | "category">, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${example.title} ${example.about} ${example.category}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
