// One-click databases (roadmap §14 D): all five start, hardened, on the room's network only; code in the
// sandbox writes and reads them by name with the connection from its environment; their data survives a
// stop and a sleep (the sandbox restarting), and deleting one wipes it.
//   node --env-file=../../.env test/databases.e2e.mjs      (from apps/runner, with `pnpm dev` running)
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = new Docker();
const container = (kind) => docker.getContainer(`cc-${NAMESPACE}-${kind}-${ROOM.toLowerCase()}`);
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

  // Hardened like the sandbox, and on the room's network only, under their own names.
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
  record("databasesAreHardenedAndPrivate", problems.length === 0, problems.join("; "));

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
  const exec = await container("mongo").exec({ Cmd: ["mongosh", "--quiet", url, "--eval", "db.notes.insertOne({ n: 42 }); print(db.notes.countDocuments())"], AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({});
  let shell = "";
  stream.on("data", (chunk) => (shell += chunk.toString("latin1")));
  await new Promise((resolve) => stream.on("end", resolve));
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
  await container("redis").stop({ t: 5 });
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
