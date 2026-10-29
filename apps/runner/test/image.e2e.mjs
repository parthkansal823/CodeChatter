// The room's sandbox image (room-session.ts): a runner of its own (port 4203, namespace "imgtest", so the dev
// runner's sandboxes are untouched) with a base and a full image. Without a pick the room runs SANDBOX_IMAGE and
// the status offers the choice; a call naming "full" (as the API does once the owner picks it) restarts the
// sandbox into the full image, "base" back into the base one, and "default" to SANDBOX_IMAGE. The test's
// sandbox, volumes and network are removed with the room at the end, in that namespace only.
//   node --env-file=../../.env test/image.e2e.mjs        (from apps/runner, with the dev stack running and both images built)
import { spawn } from "node:child_process";

import { signServiceToken } from "@codechatter/auth/service-token";
import Docker from "dockerode";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const PORT = 4203;
const RUNNER = `http://127.0.0.1:${PORT}`;
const NAMESPACE = "imgtest";
const BASE = "codechatter-sandbox:dev";
const FULL = "codechatter-sandbox:full";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = (img) => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E", ...(img && { img }) })}`;
const call = (method, path, img) =>
  fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: token(img), "content-type": "application/json" }, ...(method !== "GET" && { body: "{}" }) });
const docker = new Docker();
const imageOfSandbox = async () => (await docker.getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).inspect().catch(() => null))?.Config.Image ?? null;

const runner = spawn("pnpm exec tsx --env-file-if-exists=../../.env src/main.ts", {
  env: { ...process.env, RUNNER_PORT: String(PORT), SANDBOX_NAMESPACE: NAMESPACE, SANDBOX_IMAGE: BASE, SANDBOX_IMAGE_BASE: BASE, SANDBOX_IMAGE_FULL: FULL },
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});
let log = "";
runner.stdout.on("data", (chunk) => (log += chunk));
runner.stderr.on("data", (chunk) => (log += chunk));

try {
  for (let i = 0; i < 60 && !(await fetch(`${RUNNER}/healthz`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 500));
  check("ownRunnerUp", await fetch(`${RUNNER}/healthz`).then((r) => r.ok, () => false), log.slice(-200));

  const before = await (await call("GET", "sandbox")).json();
  check("choiceOffered", before.image?.offered === true && before.image.choice === null, JSON.stringify(before.image));
  await call("POST", "sandbox/restart");
  check("defaultIsSandboxImage", (await imageOfSandbox()) === BASE, await imageOfSandbox());

  await call("POST", "sandbox/restart", "full");
  check("fullPicked", (await imageOfSandbox()) === FULL, await imageOfSandbox());
  const picked = await (await call("GET", "sandbox")).json();
  check("statusSaysFull", picked.image?.choice === "full", JSON.stringify(picked.image));
  // A call without a pick (the runner's own tests, say) leaves it as it was.
  await call("POST", "sandbox/restart");
  check("pickRemembered", (await imageOfSandbox()) === FULL, await imageOfSandbox());

  await call("POST", "sandbox/restart", "base");
  check("basePicked", (await imageOfSandbox()) === BASE, await imageOfSandbox());
  await call("POST", "sandbox/restart", "default");
  const reset = await (await call("GET", "sandbox")).json();
  check("defaultAgain", reset.image?.choice === null && (await imageOfSandbox()) === BASE, JSON.stringify(reset.image));
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  // The room's sandbox, volumes and network in this namespace only.
  await fetch(`${RUNNER}/rooms/${ROOM}`, { method: "DELETE", headers: { authorization: token() } }).catch(() => {});
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(runner.pid), "/t", "/f"]);
  else runner.kill();
  // The namespace's warm-cache volume, which every sandbox there mounts (empty here).
  await new Promise((r) => setTimeout(r, 1500));
  await docker.getVolume(`cc-${NAMESPACE}-warm`).remove().catch(() => {});
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
setTimeout(() => process.exit(passed === results.length ? 0 : 1), 1000);
