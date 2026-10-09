// Package installs (ADR 0007). Off: the sandbox's proxy relay says why. On: npm and pip (and Go, Cargo and
// RubyGems on the full image) install through the room's egress proxy, which reaches package registries and
// nothing else; the home folder, and so the caches, survive a restart; and the proxy stops by itself on time.
//   node --env-file=../../.env test/egress.e2e.mjs      (from apps/runner, with `pnpm dev` running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import Docker from "dockerode";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
const NAMESPACE = process.env.SANDBOX_NAMESPACE ?? "dev";
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const call = (method, path, body) =>
  fetch(`${RUNNER}/rooms/${ROOM}/${path}`, {
    method,
    headers: { authorization: token(), "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = new Docker();
const proxyName = `cc-${NAMESPACE}-egress-${ROOM.toLowerCase()}`;
const dir = `egress-${Date.now().toString(36)}`;

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function run(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(400_000),
  });
  let output = "";
  let exit = null;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      if (event.type === "exit") exit = event.exit;
    }
  }
  return { output, exit };
}

// Runs in the sandbox: asks the relay (HTTPS_PROXY) for tunnels and plain requests, and tries a direct route.
const PROBE = `import net from "node:net";
const ask = (request) => new Promise((resolve) => {
  const s = net.connect(3128, "127.0.0.1");
  let data = "";
  s.setTimeout(15000, () => { s.destroy(); resolve("timeout"); });
  s.on("connect", () => s.write(request));
  s.on("data", (c) => { data += c; if (data.includes("\\r\\n")) { s.destroy(); resolve(data.split("\\r\\n")[0]); } });
  s.on("error", (e) => resolve(e.code));
});
const tunnel = (to) => ask("CONNECT " + to + " HTTP/1.1\\r\\nHost: " + to + "\\r\\n\\r\\n");
const direct = () => new Promise((resolve) => {
  const s = net.connect(443, "1.1.1.1");
  s.setTimeout(2500, () => { s.destroy(); resolve("timeout"); });
  s.on("connect", () => { s.destroy(); resolve("OPEN"); });
  s.on("error", (e) => resolve(e.code));
});
const out = {
  npm: await tunnel("registry.npmjs.org:443"),
  pypi: await tunnel("files.pythonhosted.org:443"),
  otherHost: await tunnel("example.com:443"),
  otherPort: await tunnel("registry.npmjs.org:22"),
  address: await tunnel("1.1.1.1:443"),
  inside: await tunnel("localhost:443"),
  plainHttp: await ask("GET http://registry.npmjs.org/ HTTP/1.1\\r\\nHost: registry.npmjs.org\\r\\n\\r\\n"),
  direct: await direct(),
};
console.log("RESULT " + JSON.stringify(out));
`;
const probe = async () => JSON.parse(/RESULT (\{.*\})/.exec((await run(`${dir}/probe.mjs`)).output)?.[1] ?? "{}");
const status = async () => (await (await call("GET", "sandbox")).json()).installs;

const INSTALLS = `cd /tmp
echo "npm view: $(npm view is-number@7.0.0 version 2>&1 | tail -n 1)"
pip install --quiet --no-input six==1.16.0 >/tmp/pip.log 2>&1; echo "pip: $(python3 -c 'import six; print(six.__version__)' 2>&1 | tail -n 1)"
if command -v go >/dev/null; then
  rm -rf /tmp/gm && mkdir /tmp/gm && cd /tmp/gm && go mod init example.com/gm >/dev/null 2>&1
  go get rsc.io/quote@v1.5.2 >/tmp/go.log 2>&1 && echo "go: ok" || echo "go: $(tail -n 2 /tmp/go.log)"
  cd /tmp
fi
if command -v cargo >/dev/null; then
  rm -rf /tmp/cr && cargo new --vcs none --quiet /tmp/cr && cd /tmp/cr
  (cargo add --quiet itoa@1 && cargo fetch --quiet) >/tmp/cargo.log 2>&1 && echo "cargo: ok" || echo "cargo: $(tail -n 2 /tmp/cargo.log)"
  cd /tmp
fi
if command -v gem >/dev/null; then
  gem fetch rake -v 13.2.1 >/tmp/gem.log 2>&1 && test -f rake-13.2.1.gem && echo "gem: ok" || echo "gem: $(tail -n 2 /tmp/gem.log)"
fi
`;

try {
  // A sandbox from an older image, or of an older shape, is recreated on its restart.
  const restarted = await call("POST", "sandbox/restart");
  record("sandboxRestarts", restarted.ok, String(restarted.status));
  await call("DELETE", "sandbox/installs");
  createFileAtPath(doc, `${dir}/probe.mjs`, PROBE, null);
  createFileAtPath(doc, `${dir}/installs.sh`, INSTALLS, null);
  createFileAtPath(doc, `${dir}/six.sh`, "python3 -c 'import six; print(\"six\", six.__version__)'; du -sh ~/.npm 2>/dev/null | cut -f1\n", null);
  createFileAtPath(
    doc,
    `${dir}/off.sh`,
    // pip shows the proxy's reason only in its retry warnings, so it gets one retry.
    [
      'echo "npm: $(npm view is-number@7.0.0 version --fetch-retries=0 2>&1 | grep -m1 -o \'403 This room has no internet\')"',
      'echo "pip: $(pip download --no-deps --no-input --retries 1 -d /tmp/x six==1.16.0 2>&1 | grep -m1 -o \'403 This room has no internet\')"',
      "",
    ].join("\n"),
    null,
  );

  // Off: no proxy, and the relay says why, which the package managers pass on.
  const off = await probe();
  record("offStatusIsNull", (await status()) === null);
  record("offRelayExplains", /^HTTP\/1\.1 403 This room has no internet/.test(off.npm ?? "") && off.direct !== "OPEN", `${off.npm} | direct ${off.direct}`);
  const failing = await run(`${dir}/off.sh`);
  record("offInstallsSayWhy", /^npm: 403 This room has no internet/m.test(failing.output) && /^pip: 403 This room has no internet/m.test(failing.output), failing.output.trim());

  // On, for a few minutes.
  const allowed = await call("PUT", "sandbox/installs", { minutes: 5 });
  const body = await allowed.json();
  const on = await status();
  record("allowReturnsUntil", allowed.ok && Date.parse(body.until) > Date.now() + 4 * 60_000 && body.by === "E2E", JSON.stringify(body));
  record("statusShowsInstalls", on?.until === body.until && on?.by === "E2E", JSON.stringify(on));

  const proxy = await docker.getContainer(proxyName).inspect();
  const networks = proxy.NetworkSettings.Networks;
  const roomNetwork = `cc-${NAMESPACE}-net-${ROOM.toLowerCase()}`;
  record(
    "proxyIsLockedDown",
    proxy.HostConfig.ReadonlyRootfs && proxy.HostConfig.CapDrop?.includes("ALL") && proxy.Config.User === "10002" && Object.keys(proxy.HostConfig.PortBindings ?? {}).length === 0,
    `user ${proxy.Config.User}, readonly ${proxy.HostConfig.ReadonlyRootfs}, caps ${proxy.HostConfig.CapDrop}`,
  );
  record(
    "proxyJoinsTheRoomAsEgress",
    Object.keys(networks).sort().join(",") === [`cc-${NAMESPACE}-egress`, roomNetwork].sort().join(",") && networks[roomNetwork]?.Aliases?.includes("egress"),
    Object.keys(networks).join(","),
  );

  const opened = await probe();
  record("registriesTunnel", /^HTTP\/1\.1 200/.test(opened.npm ?? "") && /^HTTP\/1\.1 200/.test(opened.pypi ?? ""), `${opened.npm} | ${opened.pypi}`);
  record("otherHostsRefused", /403 example\.com isn't a package registry/.test(opened.otherHost ?? "") && /403/.test(opened.inside ?? ""), `${opened.otherHost} | ${opened.inside}`);
  record("otherPortsRefused", /403 Only HTTPS/.test(opened.otherPort ?? ""), opened.otherPort);
  record("addressesRefused", /403 1\.1\.1\.1 isn't a package registry/.test(opened.address ?? ""), opened.address);
  record("plainHttpRefused", /403 Only HTTPS/.test(opened.plainHttp ?? ""), opened.plainHttp);
  record("stillNoDirectRoute", opened.direct !== "OPEN" && opened.direct !== undefined, opened.direct);

  const t0 = Date.now();
  const installs = await run(`${dir}/installs.sh`);
  const line = (name) => new RegExp(`^${name}: (.*)$`, "m").exec(installs.output)?.[1]?.trim() ?? "(not run)";
  record("npmInstalls", line("npm view") === "7.0.0", line("npm view"));
  record("pipInstalls", line("pip") === "1.16.0", line("pip"));
  const fullImage = /^go: /m.test(installs.output);
  if (fullImage) {
    record("goModulesInstall", line("go") === "ok", line("go"));
    record("cargoInstalls", line("cargo") === "ok", line("cargo"));
    record("rubyGemsInstall", line("gem") === "ok", line("gem"));
  }
  console.log(`      (installs took ${Date.now() - t0}ms${fullImage ? "" : "; base image, so Go, Cargo and RubyGems were skipped"})`);

  // Terminals see the same: the proxy, and the folders where pip, npm -g, cargo and go put programs.
  const ws = new WebSocket(`${RUNNER.replace("http", "ws")}/rooms/${ROOM}/terminal?session=egress-${Date.now().toString(36)}&cols=200&rows=30`, { headers: { authorization: token() } });
  let screen = "";
  ws.on("message", (data, isBinary) => isBinary && (screen += data.toString()));
  await new Promise((resolve) => ws.once("open", resolve));
  await sleep(2500);
  ws.send(JSON.stringify({ t: "in", d: 'echo "path=$PATH proxy=$HTTPS_PROXY"; python3 -c "import six; print(\'six-in-terminal\')"\r' }));
  await sleep(2500);
  ws.close();
  // The output line, not the echoed command (whose "path=" is followed by a literal $PATH).
  const path = [...screen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").matchAll(/path=(\S+) proxy=(\S+)/g)].find((m) => !m[1].startsWith("$"));
  record(
    "terminalsGetProxyAndPath",
    path?.[2] === "http://127.0.0.1:3128" && path[1].includes("/home/ccuser/.local/bin") && path[1].includes("/home/ccuser/.cargo/bin") && screen.includes("six-in-terminal"),
    path ? `${path[1]} ${path[2]}` : screen.slice(-200),
  );

  // The home folder is a volume: what pip installed, and npm's cache, survive a restart.
  await call("POST", "sandbox/restart");
  const after = await run(`${dir}/six.sh`);
  record("homeSurvivesRestart", /six 1\.16\.0/.test(after.output) && /\dM|\dK/.test(after.output), after.output.trim());
  record("installsOutliveASandboxRestart", (await status())?.until === body.until);

  // Off again, by hand.
  const stopped = await call("DELETE", "sandbox/installs");
  const closed = await probe();
  record("turnOffStopsInstalls", stopped.ok && (await status()) === null && /403 This room has no internet/.test(closed.npm ?? ""), closed.npm);

  // And by itself: the proxy exits when its time is up, even with nobody watching.
  await call("PUT", "sandbox/installs", { minutes: 0.1 });
  const brief = await status();
  await sleep(9000);
  const expired = await docker.getContainer(proxyName).inspect().catch(() => null);
  record("expiresOnTime", brief !== null && (await status()) === null && expired?.State.Running !== true, `state ${expired?.State.Status ?? "removed"}`);
} finally {
  await call("DELETE", "sandbox/installs").catch(() => {});
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
