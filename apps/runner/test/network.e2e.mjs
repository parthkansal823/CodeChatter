// The room network (ADR 0007): a program in the sandbox reaches the room's own services, and nothing
// else: not another room, the app's database, the host, the cluster, cloud metadata, the internet or its DNS.
//   node --env-file=../../.env test/network.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Against either driver: RUNNER_URL picks the runner, and the runner says which driver it runs.
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as k8s from "@kubernetes/client-node";
import Docker from "dockerode";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
const IMAGE = process.env.SANDBOX_IMAGE ?? "codechatter-sandbox:dev";
const SUBNET = process.env.SANDBOX_SUBNET ?? "10.213.0.0/16";
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const health = await fetch(`${RUNNER}/healthz`).then((r) => r.json());
const KUBE = health.driver === "kubernetes";
const NAMESPACE = health.namespace ?? process.env.SANDBOX_NAMESPACE ?? "dev";
console.log(`runner ${RUNNER}: ${health.driver ?? "docker"}, namespace ${NAMESPACE}`);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now().toString(36);
const dir = `net-${stamp}`;
const cleanups = [];
// Stands in for a room service: answers on port 7000.
const LISTEN = ["node", "-e", 'require("net").createServer((s) => s.end("hi")).listen(7000)'];

/** Docker: the room's internal network, a service on it, and another room's network. Returns the probe's targets. */
async function dockerRoom() {
  const docker = new Docker();
  const roomNetwork = `cc-${NAMESPACE}-net-${ROOM.toLowerCase()}`;
  const otherNetwork = `cc-e2e-other-${stamp}`;
  const ipOf = (info) => Object.values(info.NetworkSettings.Networks).map((n) => n.IPAddress).find(Boolean);
  async function listener(name, network, aliases = []) {
    const container = await docker.createContainer({
      name,
      Image: IMAGE,
      Entrypoint: LISTEN,
      Labels: { "codechatter.e2e": "1" },
      HostConfig: { NetworkMode: network },
      NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: aliases } } },
    });
    cleanups.push(() => container.remove({ force: true }));
    await container.start();
    return ipOf(await container.inspect());
  }

  const net = await docker.getNetwork(roomNetwork).inspect();
  const subnet = net.IPAM.Config?.[0]?.Subnet ?? "";
  const [base, bits] = SUBNET.split("/");
  const octets = (ip) => ip.split(".").slice(0, Math.floor(Number(bits) / 8)).join(".");
  record(
    "roomNetworkIsInternalWithNoHostAddress",
    net.Internal === true && net.Options["com.docker.network.bridge.gateway_mode_ipv4"] === "isolated" && !net.IPAM.Config?.[0]?.Gateway && subnet.endsWith("/26") && octets(subnet) === octets(base),
    `${roomNetwork} ${subnet} internal=${net.Internal} gateway=${net.IPAM.Config?.[0]?.Gateway ?? "none"}`,
  );
  const sandbox = await docker.getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).inspect();
  const joined = Object.keys(sandbox.NetworkSettings.Networks);
  record("sandboxIsOnlyOnItsRoomNetwork", joined.length === 1 && joined[0] === roomNetwork, joined.join(","));

  await listener(`cc-e2e-service-${stamp}`, roomNetwork, ["e2e-service"]);
  await docker.createNetwork({ Name: otherNetwork, Internal: true, Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" }, Labels: { "codechatter.e2e": "1" } });
  cleanups.push(() => docker.getNetwork(otherNetwork).remove());
  const otherIp = await listener(`cc-e2e-other-${stamp}`, otherNetwork);
  // The app's own database (dev compose), if this Docker runs it.
  const [postgres] = await docker.listContainers({ filters: { label: ["com.docker.compose.service=postgres"] } });
  const postgresIp = postgres && Object.values(postgres.NetworkSettings.Networks).map((n) => n.IPAddress).find(Boolean);
  return [
    ["roomService", "e2e-service", 7000],
    ["otherRoom", otherIp, 7000],
    ...(postgresIp ? [["appDatabase", postgresIp, 5432]] : []),
    ["hostBridgeGateway", "172.17.0.1", 15432],
    ["hostByName", "host.docker.internal", 4200],
    ["dockerDesktopHost", "192.168.65.254", 8080],
  ];
}

/** Kubernetes: the room namespace's policy, a service in it, and another room's namespace. Returns the probe's targets. */
async function kubernetesRoom() {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  const core = config.makeApiClient(k8s.CoreV1Api);
  const networking = config.makeApiClient(k8s.NetworkingV1Api);
  const roomNamespace = `cc-${NAMESPACE}-${ROOM.toLowerCase()}`;
  const otherNamespace = `cc-e2e-other-${stamp}`;

  const policy = await networking.readNamespacedNetworkPolicy({ name: "room", namespace: roomNamespace });
  const { spec } = policy;
  // The client sets every field of its models, unset ones to undefined.
  const everyPod = (selector) => Boolean(selector) && !selector.matchLabels && !selector.matchExpressions?.length;
  const onlyOwnPods = (peers) => peers?.length === 1 && everyPod(peers[0].podSelector) && !peers[0].namespaceSelector && !peers[0].ipBlock;
  record(
    "roomPolicyLetsOnlyItsOwnPodsInAndOut",
    everyPod(spec.podSelector) &&
      spec.policyTypes.includes("Ingress") &&
      spec.policyTypes.includes("Egress") &&
      spec.ingress?.length === 1 &&
      onlyOwnPods(spec.ingress[0]._from) &&
      spec.egress?.length === 1 &&
      onlyOwnPods(spec.egress[0].to),
    JSON.stringify(spec),
  );
  const pod = await core.readNamespacedPod({ name: "sandbox", namespace: roomNamespace });
  record("sandboxHasNoDnsServer", pod.spec.dnsPolicy === "None" && pod.spec.dnsConfig?.nameservers?.join() === "127.0.0.1", `${pod.spec.dnsPolicy} ${pod.spec.dnsConfig?.nameservers}`);

  async function listener(namespace, name) {
    await core.createNamespacedPod({
      namespace,
      body: {
        metadata: { name, labels: { "codechatter.e2e": "1", app: name } },
        spec: { automountServiceAccountToken: false, terminationGracePeriodSeconds: 0, containers: [{ name, image: IMAGE, imagePullPolicy: "IfNotPresent", command: LISTEN }] },
      },
    });
    for (let i = 0; i < 120; i++) {
      const status = (await core.readNamespacedPod({ name, namespace })).status;
      if (status?.phase === "Running" && status.podIP) return status.podIP;
      await sleep(500);
    }
    throw new Error(`${namespace}/${name} didn't start`);
  }

  // A service in this room, reached through its Service address (names come with the room's databases).
  const service = `e2e-service-${stamp}`;
  cleanups.push(() => core.deleteNamespacedPod({ name: service, namespace: roomNamespace, gracePeriodSeconds: 0 }));
  await listener(roomNamespace, service);
  cleanups.push(() => core.deleteNamespacedService({ name: service, namespace: roomNamespace }));
  const { spec: serviceSpec } = await core.createNamespacedService({
    namespace: roomNamespace,
    body: { metadata: { name: service, labels: { "codechatter.e2e": "1" } }, spec: { selector: { app: service }, ports: [{ port: 7000 }] } },
  });

  // Another room: a namespace with the same policy, and a service in it.
  cleanups.push(() => core.deleteNamespace({ name: otherNamespace }));
  await core.createNamespace({ body: { metadata: { name: otherNamespace, labels: { "codechatter.e2e": "1" } } } });
  await networking.createNamespacedNetworkPolicy({ namespace: otherNamespace, body: { metadata: { name: "room" }, spec: policy.spec } });
  const otherIp = await listener(otherNamespace, "other");

  const apiServer = (await core.readNamespacedService({ name: "kubernetes", namespace: "default" })).spec.clusterIP;
  const node = (await core.listNode()).items[0]?.status?.addresses?.find((a) => a.type === "InternalIP")?.address;
  // Policies take a moment to reach the network after they're made.
  await sleep(2000);
  return [
    ["roomService", serviceSpec.clusterIP, 7000],
    ["otherRoom", otherIp, 7000],
    ["appDatabase", "192.168.65.254", 5432], // dev compose's Postgres, on the Docker Desktop host
    ["dockerDesktopHost", "192.168.65.254", 8080],
    ["kubernetesApi", apiServer, 443],
    ["kubelet", node, 10250],
  ];
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
const started = Date.now();
out.dns = await dns.lookup("example.com").then((a) => "RESOLVED " + a.address, (e) => e.code);
out.dnsMs = Date.now() - started;
console.log("RESULT " + JSON.stringify(out));
`;

try {
  // A sandbox made before room networks (or from an older image) is recreated on its restart.
  const restarted = await fetch(`${RUNNER}/rooms/${ROOM}/sandbox/restart`, { method: "POST", headers: { authorization: token() } });
  record("sandboxRestarts", restarted.ok, String(restarted.status));

  const targets = [
    ...(KUBE ? await kubernetesRoom() : await dockerRoom()),
    ["cloudMetadata", "169.254.169.254", 80],
    ["internet", "1.1.1.1", 443],
    ["publicDns", "8.8.8.8", 53],
  ];
  createFileAtPath(doc, `${dir}/probe.mjs`, `const TARGETS = ${JSON.stringify(targets)};\n${PROBE}`, null);
  const output = await run(`${dir}/probe.mjs`);
  const result = JSON.parse(/RESULT (\{.*\})/.exec(output)?.[1] ?? "{}");
  const blocked = (name) => result[name] !== undefined && result[name] !== "OPEN";
  const all = (...names) => names.filter((name) => targets.some(([n]) => n === name));

  record(KUBE ? "reachesItsRoomService" : "reachesItsRoomServiceByName", result.roomService === "OPEN", JSON.stringify(result));
  record("cannotReachAnotherRoom", blocked("otherRoom"), result.otherRoom);
  if (result.appDatabase !== undefined) record("cannotReachTheAppDatabase", blocked("appDatabase"), result.appDatabase);
  const host = all("hostBridgeGateway", "hostByName", "dockerDesktopHost");
  record("cannotReachTheHost", host.every(blocked), host.map((name) => result[name]).join(" "));
  if (KUBE) record("cannotReachTheCluster", blocked("kubernetesApi") && blocked("kubelet"), `${result.kubernetesApi} ${result.kubelet}`);
  record("cannotReachCloudMetadata", blocked("cloudMetadata"), result.cloudMetadata);
  record("cannotReachTheInternet", blocked("internet") && blocked("publicDns"), `${result.internet} ${result.publicDns}`);
  // And says so at once: a program that looks a name up isn't left waiting on timeouts.
  record("noOutsideDns", result.dns !== undefined && !String(result.dns).startsWith("RESOLVED") && result.dnsMs < 3000, `${result.dns} in ${result.dnsMs}ms`);
} finally {
  for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => {});
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(800);
  provider.destroy();
  socket.destroy();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
