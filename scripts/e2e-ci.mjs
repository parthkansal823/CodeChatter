#!/usr/bin/env node
/**
 * Run the end-to-end suites one after another against the running dev stack: what CI's
 * "End-to-end" workflow runs (.github/workflows/e2e.yml), and the same here.
 *   node scripts/e2e-ci.mjs              every suite
 *   node scripts/e2e-ci.mjs git files    only these
 *   node scripts/e2e-ci.mjs --list       their names
 *
 * Only suites that work on the base sandbox image, with no paid AI key and without real
 * GitHub (which allows 60 requests an hour without a token). Each suite's output goes to
 * e2e-logs/<name>.log; browser suites get one retry, since a slower machine can miss a
 * time limit. On GitHub each failure becomes an annotation, and the table goes on the
 * run's page.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LOGS = join(ROOT, "e2e-logs");
const LIMIT_MINUTES = 12;

const service = (cwd, names) => names.map(([name, file]) => ({ name, cwd, file: `test/${file}.e2e.mjs`, browser: false }));
const SUITES = [
  ...service("apps/runner", [
    ["runner", "runner"],
    ["judge", "judge"],
    ["judge-isolated", "judge-isolated"],
    ["isolation", "isolation"],
    ["network", "network"],
    ["sandbox-binary-files", "blobs"],
    ["sandbox-git-runner", "git"],
  ]),
  ...service("apps/collab", [
    ["collab", "collab"],
    ["checkpoints", "checkpoints"],
    ["notes-access", "notes-access"],
    ["interview-rules", "interviews"],
    ["room-people-access", "room-people"],
    ["interview-papers", "interview-papers"],
    ["interview-recording-rules", "interview-recording"],
  ]),
  ...service("apps/api", [
    ["api-binary-files", "blobs"],
    ["api-audit", "audit"],
    ["api-webhooks", "webhooks-out"],
    ["api-notifications", "notifications"],
    ["api-source-control", "source-control"],
    ["api-interview-ai-review", "interview-ai-review"],
  ]),
  ...[
    "new-room",
    "editor",
    "files",
    "binary-files",
    "sandbox-git",
    "interviews",
    "interview-modes",
    "interview-ai-batch",
    "org-members",
    "org-rules",
    "account-security",
    "sign-out-device",
    "interview-recording",
    "csp",
    "history",
    "code-comments",
    "notes",
    "notifications",
    "public-rooms",
    "present",
    "room-people",
    "room-members",
    "search",
    "shortcuts",
    "mermaid",
    "diagrams",
    "preview",
  ].map((name) => ({ name, cwd: "apps/web", file: `test/${name}.e2e.mjs`, browser: true })),
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const suite of SUITES) console.log(suite.name);
  process.exit(0);
}
const unknown = args.filter((name) => !SUITES.some((suite) => suite.name === name));
if (unknown.length) {
  console.error(`No such suite: ${unknown.join(", ")} (--list names them)`);
  process.exit(2);
}
const chosen = args.length ? SUITES.filter((suite) => args.includes(suite.name)) : SUITES;
mkdirSync(LOGS, { recursive: true });

const onGitHub = process.env.GITHUB_ACTIONS === "true";
/** An annotation's text, escaped as GitHub's workflow commands want it. */
const escapeCommand = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const clock = (ms) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/**
 * Forget recent sign-ins in the dev stack's Valkey. The auth rate limit (10 sign-ins a minute
 * per address) stays as it is, and a test checks it; but suites run back to back would hit
 * it together, so each one starts with a clean count.
 */
function forgetSignIns() {
  const script = `valkey-cli --scan --pattern 'ba:*|/sign-in/email' | while read -r key; do valkey-cli del "$key" > /dev/null; done`;
  spawnSync("docker", ["compose", "-f", "infra/compose.dev.yaml", "exec", "-T", "valkey", "sh", "-c", script], { cwd: ROOT, stdio: "ignore" });
}

/** One attempt: its output goes to the suite's log, and comes back to read its results. */
function attempt(suite, number) {
  forgetSignIns();
  const started = Date.now();
  const log = createWriteStream(join(LOGS, `${suite.name}.log`), { flags: number === 1 ? "w" : "a" });
  if (number > 1) log.write(`\n--- attempt ${number} ---\n`);
  const child = spawn(process.execPath, [...(suite.browser ? [] : ["--env-file-if-exists=../../.env"]), suite.file], {
    cwd: join(ROOT, suite.cwd),
    env: { ...process.env, SHOT_DIR: LOGS, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const keep = (chunk) => {
    output += chunk.toString("utf8");
    log.write(chunk);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, LIMIT_MINUTES * 60_000);
  return new Promise((done) => {
    const finish = (code) => {
      clearTimeout(timer);
      log.end();
      const failures = output.split("\n").filter((line) => line.startsWith("FAIL"));
      if (timedOut) failures.push(`FAIL  the suite took over ${LIMIT_MINUTES} minutes and was stopped`);
      else if (code !== 0 && failures.length === 0) failures.push(`FAIL  exited with code ${code}: ${output.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
      done({ passed: code === 0 && !timedOut, failures, tally: /(\d+)\/(\d+) passed/.exec(output)?.[0] ?? "", ms: Date.now() - started });
    };
    child.on("error", (error) => {
      output += `\n${error.message}`;
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

const rows = [];
for (const suite of chosen) {
  let result = await attempt(suite, 1);
  let note = "";
  if (!result.passed && suite.browser) {
    const first = result.failures;
    console.log(`again  ${suite.name}: ${first[0] ?? "failed"}`);
    result = await attempt(suite, 2);
    if (result.passed) note = `passed on the second try; first: ${first[0]?.slice(0, 120) ?? "failed"}`;
  }
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${suite.name}  ${result.tally}  (${clock(result.ms)})${note ? `  ${note}` : ""}`);
  for (const failure of result.failures.slice(0, result.passed ? 0 : 10)) {
    console.log(`        ${failure}`);
    if (onGitHub) console.log(`::error title=E2E ${suite.name}::${escapeCommand(failure)}`);
  }
  if (onGitHub && note) console.log(`::warning title=E2E ${suite.name}::${escapeCommand(note)}`);
  rows.push({ suite, ...result, note });
}

const passed = rows.filter((row) => row.passed).length;
console.log(`\n${passed}/${rows.length} suites passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const table = rows.map((row) => `| ${row.passed ? "✅" : "❌"} | ${row.suite.name} | ${row.tally} | ${clock(row.ms)} | ${row.note || (row.passed ? "" : (row.failures[0] ?? "").replaceAll("|", "\\|").slice(0, 160))} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### End-to-end: ${passed}/${rows.length} suites passed`, "", "| | Suite | Checks | Time | Note |", "|---|---|---|---|---|", ...table, ""].join("\n"));
}
process.exit(passed === rows.length ? 0 : 1);
