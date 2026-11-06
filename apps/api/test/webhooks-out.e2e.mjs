/**
 * Exercise outgoing webhooks through an API instance owned by this test on 4013.
 * Needs the migrated dev DB, Valkey, shared API and built API; from apps/api:
 *   node test/webhooks-out.e2e.mjs
 * Its local HTTP receiver is allowed only by that instance's dev-only switch.
 * Every created webhook and room, the receiver and the child API are cleaned up.
 */
import { spawn } from "node:child_process";
import { createDb, schema } from "@codechatter/db";
import { and, eq, sql } from "drizzle-orm";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const ORIGIN = "http://localhost:8080";
const API = "http://127.0.0.1:4013";
const results = [];
const received = [];
const heldResponses = new Map();
const hooks = new Set();
const rooms = new Set();
const lastDeliveryStates = new Map();
const stop = new AbortController();
let child;
let childExit;
let childError;
let orgId;
let base;
let interrupted = false;
let database;

function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}
function requireCheck(name, ok, detail = "") {
  check(name, ok, detail);
  if (!ok) throw new Error(name);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  stop.abort();
});

function person() {
  const jar = new Map();
  return async (path, { method = "GET", body, origin = API } = {}) => {
    const res = await fetch(`${origin}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: {
        origin: ORIGIN,
        ...(jar.size && { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      const split = pair.indexOf("=");
      if (split > 0) jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* Empty responses are normal for DELETE. */ }
    return { status: res.status, json, headers: res.headers };
  };
}
const one = person();
const two = person();

async function waitFor(read, label, timeoutMs = 25_000) {
  const until = Date.now() + timeoutMs;
  while (!stop.signal.aborted && Date.now() < until) {
    const value = await read();
    if (value) return value;
    await sleep(250, undefined, { signal: stop.signal }).catch(() => {});
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function verified(message, secret) {
  const timestamp = message.headers["x-codechatter-timestamp"];
  const signature = message.headers["x-codechatter-signature"];
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp) ||
      typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(message.raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

const receiver = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { /* Recorded below for a useful failure. */ }
  received.push({ path: req.url, method: req.method, headers: req.headers, raw, payload });
  if (req.url === "/slow") {
    heldResponses.set(req.headers["x-codechatter-delivery"], res);
  } else if (req.url === "/fail") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Please try again");
  } else {
    res.writeHead(204);
    res.end();
  }
});

async function createHook(path, events) {
  const res = await one(base, {
    method: "POST",
    body: { url: `${receiverUrl}${path}`, events, description: `Outgoing e2e ${randomUUID()}` },
  });
  if (res.json?.webhook?.id) hooks.add(res.json.webhook.id);
  requireCheck(`create ${path}`, res.status === 201 && typeof res.json?.secret === "string", `HTTP ${res.status}`);
  return res.json;
}
let receiverUrl;

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile("../../.env");
  database = createDb(process.env.DATABASE_URL, { max: 2 });
  // Refuse to start if the fixed test port already belongs to another process.
  const probe = createTcpServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(4013, "127.0.0.1", resolve); });
  await new Promise((resolve) => probe.close(resolve));
  await new Promise((resolve, reject) => { receiver.once("error", reject); receiver.listen(0, "127.0.0.1", resolve); });
  receiverUrl = `http://127.0.0.1:${receiver.address().port}`;
  child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
    env: { ...process.env, API_PORT: "4013", LOG_LEVEL: "warn", NODE_ENV: "test", APP_URL: ORIGIN, WEBHOOKS_ALLOW_PRIVATE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drain child output without printing request data or credentials.
  child.stdout.resume();
  child.stderr.resume();
  child.on("error", (error) => { childError = error.code ?? "spawn failed"; });
  childExit = new Promise((resolve) => child.once("exit", resolve));
  await waitFor(async () => {
    if (childError || child.exitCode !== null) throw new Error("The test API did not start; build the API and check port 4013.");
    return fetch(`${API}/api/healthz`, { signal: AbortSignal.timeout(1000) }).then((res) => res.ok, () => false);
  }, "test API health", 30_000);
  check("own API is healthy", true);
  for (const [call, email] of [[one, "test1@codechatter.local"], [two, "test2@codechatter.local"]]) {
    const res = await call("/api/auth/sign-in/email", { method: "POST", body: { email, password: "codechatter123" } });
    requireCheck(`sign in ${email}`, res.status === 200, `HTTP ${res.status}`);
  }
  const me = await one("/api/me");
  orgId = me.json?.session?.activeOrganizationId;
  requireCheck("active organisation is available", typeof orgId === "string");
  base = `/api/orgs/${encodeURIComponent(orgId)}/webhooks`;

  const added = await createHook("/ok", ["room.create"]);
  const id = added.webhook.id;
  const secret = added.secret;
  check("secret is 32 random bytes", /^[A-Za-z0-9_-]{43}$/.test(secret));
  const list = await one(base);
  check("list excludes secrets", list.status === 200 && list.json?.items?.some((item) => item.id === id) &&
    !JSON.stringify(list.json).includes(secret) && !JSON.stringify(list.json).includes("secretSealed"));
  check("responses are not cached", /no-store/.test(list.headers.get("cache-control") ?? ""));
  check("signed-out callers are refused", (await person()(base)).status === 401);
  check("test2 is refused", (await two(base)).status === 403);
  check("test2 cannot rotate", (await two(`${base}/${id}/rotate-secret`, { method: "POST" })).status === 403);

  const blocked = await one(base, { origin: ORIGIN, method: "POST", body: { url: `${receiverUrl}/blocked`, events: ["*"] } });
  if (blocked.json?.webhook?.id) hooks.add(blocked.json.webhook.id);
  check("shared API refuses a private URL", blocked.status === 400, `HTTP ${blocked.status}`);

  const created = await one("/api/rooms", { method: "POST", body: { name: `Outgoing e2e ${randomUUID()}` } });
  if (created.json?.id) rooms.add(created.json.id);
  requireCheck("create disposable room", created.status === 201 && Boolean(created.json?.id), `HTTP ${created.status}`);
  const roomId = created.json.id;
  const event = await waitFor(() => received.find((item) => item.payload?.event === "room.create" && item.payload?.target?.id === roomId), "signed room.create");
  check("room.create signature verifies", verified(event, secret));
  check("required headers and payload", event.method === "POST" && event.headers["content-type"] === "application/json" &&
    event.headers["user-agent"] === "CodeChatter-Webhooks/1" && event.headers["x-codechatter-event"] === "room.create" &&
    typeof event.headers["x-codechatter-delivery"] === "string" && event.payload.org.id === orgId &&
    event.payload.actor?.id === me.json.user.id && event.payload.target.type === "room" && Boolean(event.payload.createdAt));
  const deliveryId = event.headers["x-codechatter-delivery"];
  const readLog = async (hookId) => {
    const result = await one(`${base}/${hookId}/deliveries`);
    if (result.status !== 200 || !Array.isArray(result.json?.items)) {
      throw new Error(`Delivery log returned HTTP ${result.status}`);
    }
    for (const item of result.json.items) lastDeliveryStates.set(item.id, {
      id: item.id, status: item.status, attempts: item.attempts,
      nextAttemptAt: item.nextAttemptAt, lastStatusCode: item.lastStatusCode,
      hasError: Boolean(item.lastError), attemptHistory: item.attemptLog.length,
    });
    return result.json;
  };
  const delivered = await waitFor(async () => (await readLog(id))?.items?.find((item) => item.id === deliveryId && item.status === "delivered"), "delivered log");
  check("successful attempt is logged", delivered.attempts === 1 && delivered.lastStatusCode === 204 && delivered.attemptLog.length === 1);
  const removed = await one(`/api/rooms/${roomId}`, { method: "DELETE" });
  if (removed.status === 204) rooms.delete(roomId);
  check("delete disposable room", removed.status === 204);
  check("one subscribed room event", received.filter((item) => item.payload?.event === "room.create" && item.payload?.target?.id === roomId).length === 1 &&
    !received.some((item) => item.payload?.event === "room.delete" && item.payload?.target?.id === roomId));

  const slow = await createHook("/slow", ["room.update"]);
  const slowPing = await one(`${base}/${slow.webhook.id}/test`, { method: "POST" });
  requireCheck("slow receiver ping is queued", slowPing.status === 202 && Boolean(slowPing.json?.id));
  await waitFor(() => heldResponses.has(slowPing.json.id), "slow receiver request");
  const sending = await readLog(slow.webhook.id);
  check("delivery exposes sending state without lease identifiers", sending.items.some((item) => item.id === slowPing.json.id && item.inFlight) &&
    !JSON.stringify(sending).includes("lockedBy") && !JSON.stringify(sending).includes("lockedUntil"));
  const leasedRetry = await one(`${base}/${slow.webhook.id}/deliveries/${slowPing.json.id}/redeliver`, { method: "POST" });
  check("manual redelivery cannot race an active lease", leasedRetry.status === 409);
  const lockStarted = Date.now();
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '1s'`);
    await tx.select({ id: schema.webhookDeliveries.id }).from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, slowPing.json.id)).for("update", { noWait: true });
  });
  check("HTTP send holds no delivery row lock or transaction", Date.now() - lockStarted < 2000);
  heldResponses.get(slowPing.json.id).writeHead(204);
  heldResponses.get(slowPing.json.id).end();
  heldResponses.delete(slowPing.json.id);
  const slowDelivered = await waitFor(async () => (await readLog(slow.webhook.id)).items.find((item) => item.id === slowPing.json.id && item.status === "delivered"), "slow delivery completion");
  check("completed attempt releases its lease", !slowDelivered.inFlight && slowDelivered.attempts === 1);

  const ping = await one(`${base}/${id}/test`, { method: "POST" });
  requireCheck("ping is queued", [200, 201, 202].includes(ping.status) && ping.json?.event === "ping", `HTTP ${ping.status}`);
  const pingPost = await waitFor(() => received.find((item) => item.headers["x-codechatter-delivery"] === ping.json.id), "ping POST");
  check("ping is signed", pingPost.payload?.event === "ping" && verified(pingPost, secret));

  const failing = await createHook("/fail", ["room.update"]);
  const failedPing = await one(`${base}/${failing.webhook.id}/test`, { method: "POST" });
  requireCheck("failing ping is queued", Boolean(failedPing.json?.id));
  const scheduled = await waitFor(async () => (await readLog(failing.webhook.id))?.items?.find((item) => item.id === failedPing.json.id && item.attempts > 0), "retry schedule");
  const retryDelay = Date.parse(scheduled.nextAttemptAt) - Date.parse(scheduled.attemptLog[0].at);
  check("500 schedules a one-minute retry", scheduled.status === "pending" && scheduled.attempts === 1 && scheduled.lastStatusCode === 500 && retryDelay >= 60_000 && retryDelay < 75_000);
  check("failed response and attempt are logged", scheduled.lastResponse === "Please try again" && scheduled.attemptLog[0].statusCode === 500 && Boolean(scheduled.lastError));

  const retryNow = await one(`${base}/${failing.webhook.id}/deliveries/${failedPing.json.id}/redeliver`, { method: "POST" });
  requireCheck("pending delivery can be retried immediately", retryNow.status === 202 && retryNow.json?.attempts === 0 && retryNow.json.status === "pending");
  const retried = await waitFor(async () => (await readLog(failing.webhook.id))?.items?.find((item) => item.id === failedPing.json.id && item.attemptLog.length === 2), "immediate retry");
  check("immediate retry preserves previous failure history", retried.status === "pending" && retried.attempts === 1 && retried.attemptLog.every((attempt) => attempt.statusCode === 500));

  await one(`${base}/${failing.webhook.id}`, { method: "PATCH", body: { active: false } });
  await database.db.update(schema.webhookDeliveries).set({ createdAt: sql`now() - interval '25 hours'` })
    .where(and(eq(schema.webhookDeliveries.id, failedPing.json.id), eq(schema.webhookDeliveries.webhookId, failing.webhook.id)));
  const resume = await one(`${base}/${failing.webhook.id}`, { method: "PATCH", body: { active: true } });
  const expired = (await readLog(failing.webhook.id)).items.find((item) => item.id === failedPing.json.id);
  check("resuming expires old pending deliveries", resume.status === 200 && expired?.status === "failed" && expired.lastError === "Expired while the webhook was paused" && expired.nextAttemptAt === null && !expired.inFlight);
  check("expiry preserves all previous attempt history", expired?.attemptLog.length === retried.attemptLog.length && expired.attempts === retried.attempts);

  const rotated = await one(`${base}/${id}/rotate-secret`, { method: "POST" });
  requireCheck("rotate returns a fresh secret once", typeof rotated.json?.secret === "string" && rotated.json.secret !== secret);
  const afterRotate = await one(`${base}/${id}/test`, { method: "POST" });
  const newPost = await waitFor(() => received.find((item) => item.headers["x-codechatter-delivery"] === afterRotate.json?.id), "rotated signature");
  check("rotated signature replaces the old secret", verified(newPost, rotated.json.secret) && !verified(newPost, secret));

  const redelivered = await one(`${base}/${id}/deliveries/${deliveryId}/redeliver`, { method: "POST" });
  requireCheck("redeliver queues the same delivery", redelivered.json?.id === deliveryId && redelivered.json.status === "pending");
  const replay = await waitFor(() => received.filter((item) => item.headers["x-codechatter-delivery"] === deliveryId).at(1), "manual redelivery");
  check("redelivery preserves the event and uses the current secret", replay.payload.id === event.payload.id && verified(replay, rotated.json.secret));
  const replayLog = await waitFor(async () => (await readLog(id))?.items?.find((item) => item.id === deliveryId && item.status === "delivered"), "redelivery history");
  check("manual redelivery preserves attempt history", replayLog.attemptLog.length === 2);
  const patch = await one(`${base}/${id}`, { method: "PATCH", body: { active: false, description: "Paused by outgoing e2e" } });
  check("update can pause and edit a webhook", patch.status === 200 && patch.json?.active === false && patch.json.description === "Paused by outgoing e2e");
  const cursor = await one(`${base}/${id}/deliveries?before=${afterRotate.json.id}`);
  check("delivery cursor is scoped and ordered", cursor.status === 200 && cursor.json.items.length <= 50 && !cursor.json.items.some((item) => item.id === afterRotate.json.id));

} catch (error) {
  check("flow completes", false, interrupted ? "Interrupted" : error.message);
  // Only delivery metadata is printed: no signing secrets, payloads or responses.
  for (const state of lastDeliveryStates.values()) console.log(`Delivery state: ${JSON.stringify(state)}`);
} finally {
  for (const response of heldResponses.values()) { response.writeHead(503); response.end(); }
  heldResponses.clear();
  for (const roomId of rooms) {
    const res = await one(`/api/rooms/${roomId}`, { method: "DELETE" }).catch(() => null);
    check(`cleanup room ${roomId}`, res?.status === 204 || res?.status === 404);
  }
  for (const id of hooks) {
    const res = await one(`${base}/${id}`, { method: "DELETE" }).catch(() => null);
    check(`cleanup webhook ${id}`, res?.status === 204 || res?.status === 404);
  }
  if (child && child.exitCode === null && !childError) {
    child.kill();
    await Promise.race([childExit, sleep(5000)]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await childExit; }
  }
  receiver.closeAllConnections();
  await new Promise((resolve) => receiver.close(resolve));
  await database?.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = interrupted ? 130 : passed === results.length ? 0 : 1;
