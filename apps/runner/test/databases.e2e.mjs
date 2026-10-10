// One-click databases (roadmap §14 D): all five start, hardened, on the room's network only; code in the
// sandbox writes and reads them by name with the connection from its environment; their data survives a
// stop and a sleep (the sandbox restarting), and deleting one wipes it.
//   node --env-file=../../.env test/databases.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Against either driver: RUNNER_URL picks the runner, and the runner says which driver it runs.
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as k8s from "@kubernetes/client-node";
import Docker from "dockerode";
import { PassThrough } from "node:stream";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
const health = await fetch(`${RUNNER}/healthz`).then((r) => r.json());
const KUBE = health.driver === "kubernetes";
const NAMESPACE = health.namespace ?? process.env.SANDBOX_NAMESPACE ?? "dev";
console.log(`runner ${RUNNER}: ${health.driver ?? "docker"}, namespace ${NAMESPACE}`);
const KINDS = ["postgres", "mysql", "mariadb", "mongo", "redis"];
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const call = async (method, path) => {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: token(), "content-type": "application/json" } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (path, body) => {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = new Docker();
const container = (kind) => docker.getContainer(`cc-${NAMESPACE}-${kind}-${ROOM.toLowerCase()}`);
const kubeConfig = new k8s.KubeConfig();
if (KUBE) kubeConfig.loadFromDefault();
const core = KUBE ? kubeConfig.makeApiClient(k8s.CoreV1Api) : null;
const apps = KUBE ? kubeConfig.makeApiClient(k8s.AppsV1Api) : null;
const roomNamespace = `cc-${NAMESPACE}-${ROOM.toLowerCase()}`;

/** Docker: each container hardened, and on the room's network only, under its kind's name. */
async function dockerProblems() {
  const network = `cc-${NAMESPACE}-net-${ROOM.toLowerCase()}`;
  const problems = [];
  for (const kind of KINDS) {
    const info = await container(kind).inspect();
    const nets = Object.keys(info.NetworkSettings.Networks);
    const user = info.Config.User ?? "";
    if (!user || user.startsWith("0") || user === "root") problems.push(`${kind} runs as root`);
    if (!info.HostConfig.ReadonlyRootfs) problems.push(`${kind} root is writable`);
    if (!info.HostConfig.CapDrop?.includes("ALL")) problems.push(`${kind} keeps capabilities`);
    if (!info.HostConfig.SecurityOpt?.includes("no-new-privileges")) problems.push(`${kind} may gain privileges`);
    if (!(info.HostConfig.Memory > 0)) problems.push(`${kind} has no memory limit`);
    if (Object.keys(info.HostConfig.PortBindings ?? {}).length) problems.push(`${kind} publishes ports`);
    if (nets.length !== 1 || nets[0] !== network || !info.NetworkSettings.Networks[network]?.Aliases?.includes(kind)) problems.push(`${kind} networks ${nets.join("+")}`);
  }
  return problems;
}

/**
 * Kubernetes: each pod hardened, with no Kubernetes token, behind a Service of its kind's name that
 * the sandbox's /etc/hosts has; and the password in neither the pods' specs nor the sandbox's.
 */
async function kubernetesProblems(password) {
  const problems = [];
  const sandbox = await core.readNamespacedPod({ name: "sandbox", namespace: roomNamespace });
  if (JSON.stringify(sandbox.spec).includes(password)) problems.push("the sandbox's spec holds the password");
  for (const kind of KINDS) {
    const { spec } = await core.readNamespacedPod({ name: `${kind}-0`, namespace: roomNamespace });
    const [c] = spec.containers;
    if (!(c.securityContext?.runAsUser ?? spec.securityContext?.runAsUser) || spec.securityContext?.runAsNonRoot !== true) problems.push(`${kind} runs as root`);
    if (!c.securityContext?.readOnlyRootFilesystem) problems.push(`${kind} root is writable`);
    if (!c.securityContext?.capabilities?.drop?.includes("ALL")) problems.push(`${kind} keeps capabilities`);
    if (c.securityContext?.allowPrivilegeEscalation !== false) problems.push(`${kind} may gain privileges`);
    if (!c.resources?.limits?.memory) problems.push(`${kind} has no memory limit`);
    if (spec.hostNetwork || c.ports?.some((port) => port.hostPort)) problems.push(`${kind} publishes ports`);
    if (spec.automountServiceAccountToken !== false) problems.push(`${kind} gets a Kubernetes token`);
    if (JSON.stringify(spec).includes(password)) problems.push(`${kind}'s spec holds the password`);
    const service = await core.readNamespacedService({ name: kind, namespace: roomNamespace });
    if (service.spec?.selector?.["codechatter.database"] !== kind) problems.push(`${kind} has no Service`);
    if (!sandbox.spec?.hostAliases?.some((alias) => alias.ip === service.spec?.clusterIP && alias.hostnames?.includes(kind))) problems.push(`the sandbox has no name for ${kind}`);
  }
  return problems;
}

/** MongoDB's own shell inside its container (the sandbox doesn't have it). Returns what it printed. */
async function mongoShell(url, script) {
  const cmd = ["mongosh", "--quiet", url, "--eval", script];
  let text = "";
  if (KUBE) {
    const out = new PassThrough().on("data", (chunk) => (text += chunk.toString("latin1")));
    await new Promise((resolve, reject) => {
      new k8s.Exec(kubeConfig).exec(roomNamespace, "mongo-0", "mongo", cmd, out, out, null, false, () => resolve()).catch(reject);
    });
    return text;
  }
  const exec = await container("mongo").exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({});
  stream.on("data", (chunk) => (text += chunk.toString("latin1")));
  await new Promise((resolve) => stream.on("end", resolve));
  return text;
}

/** As when the room idles: the database stops (Docker) or scales to nothing (Kubernetes), its data kept. */
async function putToSleep(kind) {
  if (!KUBE) return container(kind).stop({ t: 5 });
  await apps.replaceNamespacedStatefulSetScale({ name: kind, namespace: roomNamespace, body: { metadata: { name: kind, namespace: roomNamespace }, spec: { replicas: 0 } } });
  for (let i = 0; i < 60; i++) {
    if (await core.readNamespacedPod({ name: `${kind}-0`, namespace: roomNamespace }).then(() => false, () => true)) return;
    await sleep(500);
  }
}
const dir = `db-${Date.now().toString(36)}`;

/** Polls until every listed database is in `state` (or the time runs out); returns the last list. */
async function waitFor(kinds, state, ms = 240_000) {
  const until = Date.now() + ms;
  let list = [];
  while (Date.now() < until) {
    list = (await call("GET", "databases")).body ?? [];
    if (kinds.every((kind) => list.find((d) => d.kind === kind)?.state === state)) break;
    if (list.some((d) => kinds.includes(d.kind) && d.state === "failed")) break;
    await sleep(2000);
  }
  return list;
}
const states = (list, kinds = KINDS) => kinds.map((kind) => `${kind}=${list.find((d) => d.kind === kind)?.state}${list.find((d) => d.kind === kind)?.detail ? `(${list.find((d) => d.kind === kind).detail})` : ""}`).join(" ");

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
    signal: AbortSignal.timeout(180_000),
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
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    }
  }
  return output;
}
const line = (output, name) => new RegExp(`^${name}: (.*)$`, "m").exec(output)?.[1]?.trim() ?? "(missing)";

// Runs in the sandbox: each database through its client and the environment's connection settings.
const WRITE = `echo "postgres: $(psql -tAc 'create table if not exists notes(n int); insert into notes values (42); select sum(n) from notes' 2>&1 | tail -n 1)"
echo "mysql: $(mysql -h mysql -u app app -NBe 'create table if not exists notes(n int); insert into notes values (42); select sum(n) from notes' 2>&1 | tail -n 1)"
echo "mariadb: $(mariadb -h mariadb -u app app -NBe 'create table if not exists notes(n int); insert into notes values (42); select sum(n) from notes' 2>&1 | tail -n 1)"
echo "redis: $(redis-cli -u "$REDIS_URL" --no-auth-warning set answer 42 >/dev/null; redis-cli -u "$REDIS_URL" --no-auth-warning get answer 2>&1)"
echo "env: $(env | grep -cE '^(DATABASE_URL|POSTGRES_URL|MYSQL_URL|MARIADB_URL|MONGODB_URL|REDIS_URL)=')"
`;
const READ = `echo "postgres: $(psql -tAc 'select coalesce(sum(n), 0) from notes' 2>&1 | tail -n 1)"
echo "fresh: $(psql -tAc "select to_regclass('notes') is null" 2>&1 | tail -n 1)"
echo "redis: $(redis-cli -u "$REDIS_URL" --no-auth-warning get answer 2>&1)"
`;
// MongoDB has no client in the sandbox: ask it "hello" over its wire protocol (OP_MSG with a hand-made BSON document).
const MONGO = `import net from "node:net";
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const elements = Buffer.concat([Buffer.from([0x10]), Buffer.from("hello\\0"), int32(1), Buffer.from([0x02]), Buffer.from("$db\\0"), int32(6), Buffer.from("admin\\0"), Buffer.from([0])]);
const body = Buffer.concat([int32(0), Buffer.from([0]), int32(elements.length + 4), elements]);
const s = net.connect(27017, "mongo");
let reply = Buffer.alloc(0);
s.setTimeout(8000, () => { console.log("mongo: timeout"); s.destroy(); });
s.on("connect", () => s.write(Buffer.concat([int32(16 + body.length), int32(1), int32(0), int32(2013), body])));
s.on("data", (c) => { reply = Buffer.concat([reply, c]); if (reply.length >= 4 && reply.length >= reply.readInt32LE(0)) { console.log("mongo: " + (reply.includes("isWritablePrimary") ? "hello answered" : "odd reply")); s.destroy(); } });
s.on("error", (e) => console.log("mongo: " + e.code));
`;

try {
  for (const kind of KINDS) await call("DELETE", `databases/${kind}`);
  const restarted = await call("POST", "sandbox/restart");
  record("sandboxRestarts", restarted.status === 200, String(restarted.status));
  const off = (await call("GET", "databases")).body ?? [];
  record("allOffAtFirst", KINDS.every((kind) => off.find((d) => d.kind === kind)?.state === "off"), states(off));
  record("connectionsAreListed", off.find((d) => d.kind === "postgres")?.connection?.url?.startsWith("postgresql://app:") === true);

  // Start all five; each comes up on its own.
  const t0 = Date.now();
  const started = await Promise.all(KINDS.map((kind) => call("POST", `databases/${kind}`)));
  record("startAnswersAtOnce", started.every((r) => r.status === 202), started.map((r) => r.status).join(","));
  const up = await waitFor(KINDS, "running");
  record("allFiveRun", KINDS.every((kind) => up.find((d) => d.kind === kind)?.state === "running"), `${Date.now() - t0}ms ${states(up)}`);

  // Hardened like the sandbox, and in the room only, under their own names.
  const password = off.find((d) => d.kind === "postgres")?.connection?.password ?? "";
  const problems = KUBE ? await kubernetesProblems(password) : await dockerProblems();
  record("databasesAreHardenedAndPrivate", password.length > 0 && problems.length === 0, problems.join("; "));

  // The console: each database's own client, inside its container, read into results.
  const ask = async (kind, query) => (await post(`databases/${kind}/query`, { query })).body ?? {};
  const rowsOf = (result) => result.results?.filter((set) => set.type === "rows").map((set) => set.rows) ?? [];
  const sql = "create table people(id int, name text); insert into people values (1, 'Ada'), (2, null); select id, name from people order by id";
  for (const kind of ["postgres", "mysql", "mariadb"]) {
    const result = await ask(kind, sql);
    const rows = rowsOf(result).at(-1);
    const statuses = result.results?.filter((set) => set.type === "message").map((set) => set.text) ?? [];
    record(`${kind}Console`, !result.error && JSON.stringify(rows) === JSON.stringify([["1", "Ada"], ["2", null]]) && statuses.length >= 2, `${result.error ?? ""} ${statuses.join(" | ")} ${JSON.stringify(rows)}`);
  }
  await ask("mongo", 'db.people.insertMany([{ name: "Linus" }, { name: "Ada", tags: ["math"] }])');
  const docs = await ask("mongo", "db.people.find({}, { _id: 0 }).sort({ name: 1 })");
  record("mongoConsole", !docs.error && JSON.stringify(rowsOf(docs)[0]) === JSON.stringify([["Ada", '["math"]'], ["Linus", null]]), docs.error ?? JSON.stringify(docs.results));
  const replies = await ask("redis", 'SET greeting "hello there"\nGET greeting\nHSET h a 1 b 2\nNOPE');
  record(
    "redisConsole",
    JSON.stringify(rowsOf(replies)[0]?.map((row) => row[1])) === JSON.stringify(["OK", "hello there", "2", "(error) ERR unknown command 'NOPE', with args beginning with: "]),
    JSON.stringify(rowsOf(replies)[0]),
  );
  const broken = await ask("postgres", "selec 1");
  record("consoleShowsErrors", /syntax error/.test(broken.error ?? ""), broken.error);

  // The table browser: what each holds, and a first look.
  const listed = {};
  for (const kind of KINDS) listed[kind] = ((await call("GET", `databases/${kind}/tables`)).body ?? []).map((t) => t.name);
  record("tablesAreListed", ["postgres", "mysql", "mariadb", "mongo"].every((kind) => listed[kind].includes("people")) && listed.redis.includes("greeting") && listed.redis.includes("h"), JSON.stringify(listed));
  const preview = await post("databases/postgres/preview", { name: "people" });
  const hash = await post("databases/redis/preview", { name: "h" });
  record(
    "previewShowsRows",
    JSON.stringify(rowsOf(preview.body)[0]) === JSON.stringify([["1", "Ada"], ["2", null]]) && JSON.stringify(rowsOf(hash.body)[0]) === JSON.stringify([["a", "1"], ["b", "2"]]),
    `${JSON.stringify(rowsOf(preview.body))} ${JSON.stringify(rowsOf(hash.body))}`,
  );

  // Seed from a file in the room, back up, reset, and restore the backup.
  const raw = async (method, path, body) => {
    const res = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: token() }, ...(body && { body }) });
    return { status: res.status, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", bytes: Buffer.from(await res.arrayBuffer()) };
  };
  const total = async () => rowsOf(await ask("postgres", "select coalesce(sum(n), 0) from seeded"))[0]?.[0]?.[0];
  createFileAtPath(doc, `${dir}/seed.sql`, "create table seeded(n int);\ninsert into seeded values (7), (8);\n", null);
  await sleep(1000); // the runner's copy of the room catches up
  const seeded = (await post(`databases/postgres/load?path=${encodeURIComponent(`${dir}/seed.sql`)}`, {})).body ?? {};
  record("seedsFromARoomFile", !seeded.error && (await total()) === "15", `${seeded.error ?? JSON.stringify(seeded.results?.at(-1))}`);
  const backup = await raw("GET", "databases/postgres/dump");
  const sqlText = backup.bytes.toString();
  record(
    "backsUpAsSql",
    backup.status === 200 && backup.type === "application/sql" && /filename="e2etst-postgres-\d{4}-\d\d-\d\d\.sql"/.test(backup.disposition) && sqlText.includes("DROP TABLE IF EXISTS public.seeded") && /COPY public\.seeded/.test(sqlText),
    `${backup.status} ${backup.type} ${backup.disposition} ${backup.bytes.length} bytes`,
  );
  await call("POST", "databases/postgres/reset");
  await waitFor(["postgres"], "running");
  const emptied = rowsOf(await ask("postgres", "select to_regclass('seeded') is null"))[0]?.[0]?.[0];
  const restored = await raw("POST", "databases/postgres/load", backup.bytes);
  record("resetThenRestore", emptied === "t" && restored.status === 200 && (await total()) === "15", `emptied ${emptied}, restore ${restored.status} ${restored.bytes.toString().slice(0, 120)}`);

  // MongoDB backs up as a mongodump archive, and restores it.
  const mongoBackup = await raw("GET", "databases/mongo/dump");
  record("mongoBacksUpAsAnArchive", mongoBackup.status === 200 && mongoBackup.bytes[0] === 0x1f && mongoBackup.bytes[1] === 0x8b, `${mongoBackup.status} ${mongoBackup.bytes.length} bytes`);
  await ask("mongo", "db.people.deleteMany({})");
  const mongoRestore = JSON.parse((await raw("POST", "databases/mongo/load", mongoBackup.bytes)).bytes.toString());
  const counted = (await ask("mongo", "db.people.countDocuments()")).results?.[0]?.text;
  record("mongoRestoresTheArchive", !mongoRestore.error && counted === "2", `${mongoRestore.error ?? ""} count ${counted}`);

  // MySQL's dump replaces its tables when loaded; Redis gives its snapshot, which can't be loaded back yet.
  const mysqlBackup = (await raw("GET", "databases/mysql/dump")).bytes.toString();
  record("mysqlBacksUpAsSql", mysqlBackup.includes("DROP TABLE IF EXISTS `people`") && mysqlBackup.includes("INSERT INTO `people`"), mysqlBackup.slice(0, 80));
  const snapshot = await raw("GET", "databases/redis/dump");
  const reload = JSON.parse((await raw("POST", "databases/redis/load", snapshot.bytes)).bytes.toString());
  record("redisSnapshotDownloadsButDoesntLoad", snapshot.bytes.subarray(0, 5).toString() === "REDIS" && /isn't supported yet/.test(reload.error ?? ""), `${snapshot.bytes.length} bytes; ${reload.error}`);

  // Code in the sandbox reaches each by name, with the connection from its environment.
  createFileAtPath(doc, `${dir}/write.sh`, WRITE, null);
  createFileAtPath(doc, `${dir}/read.sh`, READ, null);
  createFileAtPath(doc, `${dir}/mongo.mjs`, MONGO, null);
  const written = await run(`${dir}/write.sh`);
  for (const kind of ["postgres", "mysql", "mariadb", "redis"]) record(`${kind}FromTheSandbox`, line(written, kind) === "42", line(written, kind));
  record("connectionsInTheEnvironment", line(written, "env") === "6", line(written, "env"));
  const mongo = await run(`${dir}/mongo.mjs`);
  record("mongoFromTheSandbox", line(mongo, "mongo") === "hello answered", line(mongo, "mongo"));
  // The room's credentials let you in (checked with MongoDB's own shell, which the sandbox doesn't have).
  const url = up.find((d) => d.kind === "mongo").connection.url.replace("@mongo:", "@127.0.0.1:");
  const shell = await mongoShell(url, "db.notes.insertOne({ n: 42 }); print(db.notes.countDocuments())");
  record("mongoCredentialsWork", /\b1\s*$/.test(shell.replace(/[^\x20-\x7e\n]/g, "").trim()), shell.replace(/[^\x20-\x7e]/g, " ").trim().slice(-80));

  // Stop keeps the data; starting again brings it back.
  await call("POST", "databases/postgres/stop");
  const stopped = (await call("GET", "databases")).body ?? [];
  record("stopKeepsTheData", stopped.find((d) => d.kind === "postgres")?.state === "stopped", states(stopped, ["postgres"]));
  await call("POST", "databases/postgres");
  await waitFor(["postgres"], "running");
  const again = await run(`${dir}/read.sh`);
  record("dataSurvivesStopAndStart", line(again, "postgres") === "42", line(again, "postgres"));

  // Asleep with an idle room (stopped, not removed), awake when its sandbox starts.
  await putToSleep("redis");
  await call("POST", "sandbox/restart");
  const woke = await waitFor(["redis"], "running", 60_000);
  const awake = await run(`${dir}/read.sh`);
  record("wakesWithTheSandbox", woke.find((d) => d.kind === "redis")?.state === "running" && line(awake, "redis") === "42", `${states(woke, ["redis"])} ${line(awake, "redis")}`);

  // Delete wipes it: started again, it's empty.
  const removed = await call("DELETE", "databases/postgres");
  record("deleteRemovesIt", removed.body?.find((d) => d.kind === "postgres")?.state === "off", states(removed.body ?? [], ["postgres"]));
  await call("POST", "databases/postgres");
  await waitFor(["postgres"], "running");
  const fresh = await run(`${dir}/read.sh`);
  record("deleteWipesTheData", line(fresh, "fresh") === "t", line(fresh, "fresh"));
} finally {
  for (const kind of KINDS) await call("DELETE", `databases/${kind}`).catch(() => {});
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
