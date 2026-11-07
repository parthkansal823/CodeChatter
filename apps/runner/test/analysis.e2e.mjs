// The Analysis tool's tools, for real, in a sandbox, in E2ETST: scc measures a small project, lizard finds its most
// tangled function, gitleaks its secrets and bandit its unsafe Python. The secrets are made fresh for each run,
// and none of them may appear anywhere in the report. What's in node_modules doesn't count. The files are removed.
//   node --env-file=../../.env test/analysis.e2e.mjs        (from apps/runner, with the dev stack running)
import { randomBytes } from "node:crypto";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const analyse = () => fetch(`${RUNNER}/rooms/${ROOM}/analysis`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(280_000) });

// Random enough to be taken for real keys, and different every time.
const random = (alphabet, length) => Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MIXED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const AWS_KEY = `AKIA${random(UPPER, 16)}`;
const GITHUB_TOKEN = `ghp_${random(MIXED, 36)}`;
const HARDCODED = random(MIXED, 24);
const IN_NODE_MODULES = `ghp_${random(MIXED, 36)}`;

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const dir = `ana-${Date.now().toString(36)}`;
const TANGLED = [
  "def tangled(a, b, c, d):",
  ...Array.from({ length: 18 }, (_, index) => `    if a == ${index}:\n        b += ${index}`),
  "    return b",
  "",
].join("\n");
try {
  doc.transact(() => {
    createFileAtPath(doc, `${dir}/app/tangled.py`, TANGLED);
    createFileAtPath(doc, `${dir}/app/unsafe.py`, ["import pickle", "import subprocess", "", "def load(data, command):", '    subprocess.call(command, shell=True)', "    return pickle.loads(data)", "", `db_password = "${HARDCODED}"`, ""].join("\n"));
    createFileAtPath(doc, `${dir}/app/keys.py`, [`AWS = "${AWS_KEY}"`, `TOKEN = "${GITHUB_TOKEN}"`, ""].join("\n"));
    createFileAtPath(doc, `${dir}/web/util.ts`, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    createFileAtPath(doc, `${dir}/node_modules/thing/index.py`, `TOKEN = "${IN_NODE_MODULES}"\n\ndef not_ours(a):\n    return a\n`);
  });
  // The files reach the sandbox a moment after they're made here.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const started = Date.now();
  const response = await analyse();
  const raw = await response.text();
  check("answers", response.status === 200, `${response.status} ${raw.slice(0, 200)}`);
  const report = JSON.parse(raw);
  console.log(`      took ${Math.round((Date.now() - started) / 1000)} s; ${report.tools.map((tool) => `${tool.name} ${tool.ms} ms${tool.ran ? "" : " (didn't run)"}`).join(", ")}`);
  const ran = (name) => report.tools.find((tool) => tool.name === name);
  for (const name of ["scc", "lizard", "gitleaks", "bandit"]) check(`${name}Ran`, ran(name)?.ran === true, JSON.stringify(ran(name)));

  // scc
  check("sccCountsTheLanguages", report.size.languages.some((language) => language.name === "Python" && language.code > 0) && report.size.languages.some((language) => language.name === "TypeScript"), JSON.stringify(report.size.languages.map((language) => language.name)));
  check("sccLeavesOutNodeModules", !JSON.stringify(report.size).includes("node_modules"));

  // lizard
  const worst = report.functions.worst.find((fn) => fn.name === "tangled");
  check("lizardFindsTheTangledOne", worst?.path === `${dir}/app/tangled.py` && worst.line === 1 && worst.complexity === 19, JSON.stringify(worst));
  check("itCountsAsTooComplex", report.functions.tooComplex >= 1);
  check("lizardLeavesOutNodeModules", !report.functions.worst.some((fn) => fn.name === "not_ours"));

  // gitleaks
  const mine = report.secrets.items.filter((secret) => secret.path.startsWith(`${dir}/`));
  check("gitleaksFindsTheGitHubToken", mine.some((secret) => secret.path === `${dir}/app/keys.py` && secret.line === 2 && secret.rule === "github-pat"), JSON.stringify(mine));
  check("gitleaksFindsTheAwsKey", mine.some((secret) => secret.path === `${dir}/app/keys.py` && secret.line === 1 && secret.rule === "aws-access-token"), JSON.stringify(mine));
  check("gitleaksLeavesOutNodeModules", !mine.some((secret) => secret.path.includes("node_modules")));

  // bandit
  const issues = report.security.items.filter((issue) => issue.path === `${dir}/app/unsafe.py`);
  check("banditFindsShellInjection", issues.some((issue) => issue.code === "B602" && issue.severity === "high" && issue.line === 5), JSON.stringify(issues.map((issue) => issue.code)));
  check("banditFindsPickle", issues.some((issue) => issue.code === "B301"), JSON.stringify(issues.map((issue) => issue.code)));
  check("banditFindsTheHardcodedPassword", issues.some((issue) => issue.code === "B105" && issue.message === "Possible hardcoded password."), JSON.stringify(issues.map((issue) => issue.code)));
  check("banditWorstFirst", report.security.items[0]?.severity === "high");

  // The point of it all.
  for (const [name, value] of [["theAwsKey", AWS_KEY], ["theGitHubToken", GITHUB_TOKEN], ["theHardcodedPassword", HARDCODED], ["theOneInNodeModules", IN_NODE_MODULES]]) {
    check(`${name}IsNowhereInTheReport`, !raw.includes(value));
  }

  // Asked twice at once, it runs once.
  const [one, two] = await Promise.all([analyse().then((res) => res.json()), analyse().then((res) => res.json())]);
  check("twoAtOnceShareOneRun", one.at === two.at, `${one.at} ${two.at}`);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
