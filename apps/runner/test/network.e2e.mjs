// The room network (ADR 0007): a program in the sandbox reaches the room's own services by name, and
// nothing else: not another room, the app's database, the host, cloud metadata, the internet or its DNS.
//   node --env-file=../../.env test/network.e2e.mjs      (from apps/runner, with `pnpm dev` running)
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
const IMAGE = process.env.SANDBOX_IMAGE ?? "codechatter-sandbox:dev";
const SUBNET = process.env.SANDBOX_SUBNET ?? "10.213.0.0/16";
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const docker = new Docker();
const roomNetwork = `cc-${NAMESPACE}-net-${ROOM.toLowerCase()}`;
const stamp = Date.now().toString(36);
const dir = `net-${stamp}`;
const otherNetwork = `cc-e2e-other-${stamp}`;
const made = [];
const ipOf = (info) => Object.values(info.NetworkSettings.Networks).map((n) => n.IPAddress).find(Boolean);
/** A container from the sandbox image that answers on port 7000, standing in for a room service. */
async function listener(name, network, aliases = []) {
  const container = await docker.createContainer({
    name,
    Image: IMAGE,
    Entrypoint: ["node", "-e", 'require("net").createServer((s) => s.end("hi")).listen(7000)'],
    Labels: { "codechatter.e2e": "1" },
    HostConfig: { NetworkMode: network },
    NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: aliases } } },
  });
  made.push(container);
  await container.start();
  return ipOf(await container.inspect());
}

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
    signal: AbortSignal.timeout(120_000),
  });
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data;
    }
  }
  return output;
}

// Runs in the sandbox: tries each address, and looks names up through the sandbox's DNS.
const PROBE = `import dns from "node:dns/promises";
import net from "node:net";
const tcp = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  const done = (r) => { s.destroy(); resolve(r); };
  s.setTimeout(2500, () => done("timeout"));
  s.on("connect", () => done("OPEN"));
  s.on("error", (e) => done(e.code));
});
const out = {};
for (const [name, host, port] of TARGETS) out[name] = await tcp(host, port);
out.dns = await dns.lookup("example.com").then((a) => "RESOLVED " + a.address, (e) => e.code);
console.log("RESULT " + JSON.stringify(out));
`;

try {
  // A sandbox made before room networks (or from an older image) is recreated on its restart.
  const restarted = await fetch(`${RUNNER}/rooms/${ROOM}/sandbox/restart`, { method: "POST", headers: { authorization: token() } });
  record("sandboxRestarts", restarted.ok, String(restarted.status));

  const net = await docker.getNetwork(roomNetwork).inspect();
  const subnet = net.IPAM.Config?.[0]?.Subnet ?? "";
  const [base, bits] = SUBNET.split("/");
  const inBase = subnet.endsWith("/26") && subnet.split(".").slice(0, Math.floor(Number(bits) / 8)).join(".") === base.split(".").slice(0, Math.floor(Number(bits) / 8)).join(".");
  record(
    "roomNetworkIsInternalWithNoHostAddress",
    net.Internal === true && net.Options["com.docker.network.bridge.gateway_mode_ipv4"] === "isolated" && !net.IPAM.Config?.[0]?.Gateway && inBase,
    `${roomNetwork} ${subnet} internal=${net.Internal} gateway=${net.IPAM.Config?.[0]?.Gateway ?? "none"}`,
  );
  const sandbox = await docker.getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).inspect();
  const joined = Object.keys(sandbox.NetworkSettings.Networks);
  record("sandboxIsOnlyOnItsRoomNetwork", joined.length === 1 && joined[0] === roomNetwork, joined.join(","));

  // A service in this room, and one in another room's network (made the same way).
  await listener(`cc-e2e-service-${stamp}`, roomNetwork, ["e2e-service"]);
  await docker.createNetwork({
    Name: otherNetwork,
    Internal: true,
    Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
    Labels: { "codechatter.e2e": "1" },
  });
  const otherIp = await listener(`cc-e2e-other-${stamp}`, otherNetwork);
  // The app's own database (dev compose), if this Docker runs it.
  const [postgres] = await docker.listContainers({ filters: { label: ["com.docker.compose.service=postgres"] } });
  const postgresIp = postgres && Object.values(postgres.NetworkSettings.Networks).map((n) => n.IPAddress).find(Boolean);

  const targets = [
    ["roomService", "e2e-service", 7000],
    ["otherRoom", otherIp, 7000],
    ...(postgresIp ? [["appDatabase", postgresIp, 5432]] : []),
    ["hostBridgeGateway", "172.17.0.1", 15432],
    ["hostByName", "host.docker.internal", 4200],
    ["dockerDesktopHost", "192.168.65.254", 8080],
    ["cloudMetadata", "169.254.169.254", 80],
    ["internet", "1.1.1.1", 443],
    ["publicDns", "8.8.8.8", 53],
  ];
  createFileAtPath(doc, `${dir}/probe.mjs`, `const TARGETS = ${JSON.stringify(targets)};\n${PROBE}`, null);
  const output = await run(`${dir}/probe.mjs`);
  const result = JSON.parse(/RESULT (\{.*\})/.exec(output)?.[1] ?? "{}");
  const blocked = (name) => result[name] !== undefined && result[name] !== "OPEN";

  record("reachesItsRoomServiceByName", result.roomService === "OPEN", JSON.stringify(result));
  record("cannotReachAnotherRoom", blocked("otherRoom"), result.otherRoom);
  if (postgresIp) record("cannotReachTheAppDatabase", blocked("appDatabase"), result.appDatabase);
  record("cannotReachTheHost", blocked("hostBridgeGateway") && blocked("hostByName") && blocked("dockerDesktopHost"), `${result.hostBridgeGateway} ${result.hostByName} ${result.dockerDesktopHost}`);
  record("cannotReachCloudMetadata", blocked("cloudMetadata"), result.cloudMetadata);
  record("cannotReachTheInternet", blocked("internet") && blocked("publicDns"), `${result.internet} ${result.publicDns}`);
  record("noOutsideDns", result.dns !== undefined && !String(result.dns).startsWith("RESOLVED"), result.dns);
} finally {
  for (const container of made) await container.remove({ force: true }).catch(() => {});
  await docker.getNetwork(otherNetwork).remove().catch(() => {});
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
