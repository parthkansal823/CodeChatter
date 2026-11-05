/**
 * Load-test live editing through Caddy with real, independent Yjs clients.
 * From apps/collab: node --env-file=../../.env test/load.mjs
 * Defaults: 50 rooms, 10 people each, 60 seconds of edits after a 20-second ramp.
 * Creates only disposable rooms, then closes clients and deletes those rooms.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { writeFile } from "node:fs/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const reportPath = new URL("./load-report.json", import.meta.url);
const runId = randomUUID();
const startedAt = new Date().toISOString();
const stop = new AbortController();
// Hundreds of pending syncs legitimately listen for the same cancellation.
setMaxListeners(0, stop.signal);
const rooms = [];
const clients = [];
const errors = [];
const cleanupErrors = [];
const latency = histogram();
let config;
let cookie;
let phase = "setup";
let interrupted = null;
let measuring = false;
let sent = 0;
let received = 0;
let editingMs = 0;
let lagSummary = null;
let progressTimer;
const lag = monitorEventLoopDelay({ resolution: 10 });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = signal;
    console.log(`\n${signal}: stopping edits and cleaning up disposable rooms...`);
    stop.abort();
  });
}

function option(name, fallback, { min = 0, integer = false } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${name} must be ${integer ? "an integer" : "a number"} >= ${min}`);
  }
  return value;
}

function readConfig() {
  const url = new URL(process.env.APP_URL || "http://localhost:8080");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("APP_URL must be an http(s) origin without credentials, path, query or fragment");
  }
  return {
    appUrl: url.origin,
    websocketUrl: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/collab`,
    rooms: option("ROOMS", 50, { min: 1, integer: true }),
    people: option("PEOPLE", 10, { min: 2, integer: true }),
    seconds: option("SECONDS", 60, { min: 0.1 }),
    rate: option("RATE", 2, { min: 0.001 }),
    targetP95Ms: option("TARGET_P95_MS", 150, { min: 0.001 }),
    rampSeconds: option("RAMP_SECONDS", 20),
    syncTimeoutMs: option("SYNC_TIMEOUT_MS", 15_000, { min: 1, integer: true }),
    drainSeconds: option("DRAIN_SECONDS", 5),
  };
}

// Exact integer-millisecond bins avoid retaining millions of delivery samples.
function histogram() { return { bins: new Map(), samples: 0, max: 0, over1000: 0 }; }
function record(h, ms) {
  h.bins.set(ms, (h.bins.get(ms) ?? 0) + 1);
  h.samples++;
  h.max = Math.max(h.max, ms);
  if (ms > 1000) h.over1000++;
}
function percentile(h, p) {
  if (!h.samples) return null;
  const rank = Math.ceil(h.samples * p);
  let count = 0;
  for (const [ms, n] of [...h.bins].sort((a, b) => a[0] - b[0])) {
    count += n;
    if (count >= rank) return ms;
  }
  return null;
}
function summary(h) {
  return {
    samples: h.samples, p50Ms: percentile(h, 0.5), p90Ms: percentile(h, 0.9),
    p95Ms: percentile(h, 0.95), p99Ms: percentile(h, 0.99),
    maxMs: h.samples ? h.max : null, over1000Ms: h.over1000,
  };
}
const msText = (ms) => ms === null ? "n/a" : `${ms.toFixed(1)} ms`;

async function pause(ms) {
  try { await sleep(Math.max(0, ms), undefined, { signal: stop.signal }); }
  catch (error) { if (error.name !== "AbortError") throw error; }
}

async function request(path, init = {}) {
  return fetch(`${config.appUrl}${path}`, {
    ...init,
    headers: { origin: config.appUrl, "content-type": "application/json", ...(cookie && { cookie }) },
    // Let an in-flight create finish on Ctrl+C so its returned ID is not lost.
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
}

async function signIn() {
  const res = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({
      email: process.env.LOAD_EMAIL || "test1@codechatter.local",
      password: process.env.LOAD_PASSWORD || "codechatter123",
    }),
  });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`Sign-in returned HTTP ${res.status}`);
  cookie = res.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Sign-in returned no session cookie");
}

async function makeRooms() {
  let next = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(5, config.rooms) }, async () => {
    while (!stop.signal.aborted && next < config.rooms) {
      const index = next++;
      try {
        const res = await request("/api/rooms", {
          method: "POST", body: JSON.stringify({ name: `Load ${runId.slice(0, 8)} ${index + 1}` }),
        });
        if (!res.ok) {
          await res.arrayBuffer();
          throw new Error(`Create room ${index + 1}: HTTP ${res.status}`);
        }
        const room = await res.json();
        if (!/^[A-Z0-9]{6}$/.test(room.id) || ["E2ETST", "TEAM22"].includes(room.id)) {
          throw new Error("Create room returned an unexpected room ID; refusing to use it");
        }
        rooms.push({ id: room.id, clients: [], sent: 0, received: 0, initiallySynced: 0, latency: histogram() });
      } catch (error) {
        stop.abort();
        throw error;
      }
    }
  }));
  // Wait for all creates, including those already in flight, before cleanup.
  const failure = outcomes.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

function closeClient(client) {
  if (client.closed) return;
  client.closed = true;
  clearTimeout(client.editTimer);
  client.finishSync?.(false);
  // Keep trying the remaining disposals if any one of them throws.
  for (const dispose of [
    () => client.provider?.destroy(), () => client.socket?.destroy(),
    () => client.rawSocket?.terminate(), () => client.doc?.destroy(),
  ]) {
    try { dispose(); }
    catch (error) { cleanupErrors.push(`Close ${client.id}: ${error.message}`); }
  }
}

function connect(room, person) {
  const client = { id: `${room.id}-${person}`, room, seq: 0, synced: false, failure: null, closed: false };
  clients.push(client);
  room.clients.push(client);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const abort = () => fail("Run stopped before sync");
    client.finishSync = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop.signal.removeEventListener("abort", abort);
      resolve(ok);
    };
    const fail = (reason) => {
      if (client.closed || client.failure) return;
      client.failure = reason;
      client.finishSync(false);
      // maxAttempts alone does not stop reconnects after an established socket closes.
      client.socket?.disconnect();
      queueMicrotask(() => closeClient(client));
    };
    try {
      class CookieSocket extends WebSocket {
        constructor(url, protocols) {
          super(url, protocols, { headers: { cookie, origin: config.appUrl } });
          client.rawSocket = this;
          // A cancelled upgrade can emit an error after the provider detaches.
          this.on("error", () => {});
        }
      }
      client.doc = new Y.Doc();
      client.map = client.doc.getMap("load");
      const seen = new Map();
      client.map.observe((event) => {
        if (!measuring || event.transaction.local || client.closed) return;
        for (const id of event.keysChanged) {
          if (id === client.id) continue;
          const value = client.map.get(id);
          if (!value || !Number.isSafeInteger(value.seq) || !Number.isFinite(value.at) ||
              value.seq <= (seen.get(id) ?? 0)) continue;
          seen.set(id, value.seq);
          // Never invent observations for skipped sequences in merged Yjs updates.
          const ms = Math.max(0, Date.now() - value.at);
          record(latency, ms);
          record(room.latency, ms);
          received++;
          room.received++;
        }
      });
      client.socket = new HocuspocusProviderWebsocket({
        url: config.websocketUrl, WebSocketPolyfill: CookieSocket, maxAttempts: 1, autoConnect: false,
      });
      client.provider = new HocuspocusProvider({
        websocketProvider: client.socket, name: `room:${room.id}:files`, document: client.doc, token: "cookie",
      });
      client.provider.on("synced", ({ state }) => {
        if (!state || client.closed || client.failure || client.synced) return;
        client.synced = true;
        client.finishSync(true);
      });
      client.provider.on("authenticationFailed", ({ reason }) => fail(`Authentication failed: ${reason}`));
      client.socket.on("maxAttemptsFailed", () => fail("WebSocket connection attempt failed"));
      client.socket.on("disconnect", ({ event }) => fail(`WebSocket disconnected (${event?.code ?? "unknown"})`));
      timer = setTimeout(() => fail(`Sync timeout after ${config.syncTimeoutMs} ms`), config.syncTimeoutMs);
      stop.signal.addEventListener("abort", abort, { once: true });
      client.provider.attach();
      void client.socket.connect().catch(() => fail("WebSocket connect failed"));
    } catch (error) { fail(error.message); }
  });
}

async function ramp() {
  phase = "connecting";
  const total = config.rooms * config.people;
  const began = performance.now();
  const pending = [];
  for (let i = 0; i < total && !stop.signal.aborted; i++) {
    await pause((i / Math.max(1, total - 1)) * config.rampSeconds * 1000 - (performance.now() - began));
    if (!stop.signal.aborted) pending.push(connect(rooms[i % rooms.length], Math.floor(i / rooms.length)));
  }
  await Promise.all(pending);
  for (const room of rooms) room.initiallySynced = room.clients.filter((client) => client.synced && !client.closed).length;
}

async function edit() {
  phase = "editing";
  measuring = true;
  lag.reset();
  lag.enable();
  const began = performance.now();
  const end = began + config.seconds * 1000;
  const interval = 1000 / config.rate;
  for (const client of clients.filter((client) => client.synced && !client.closed)) {
    const tick = () => {
      if (stop.signal.aborted || client.closed || performance.now() >= end) return;
      try {
        client.map.set(client.id, { at: Date.now(), seq: ++client.seq });
        sent++;
        client.room.sent++;
        client.editTimer = setTimeout(tick, interval * (0.8 + Math.random() * 0.4));
      } catch (error) {
        errors.push(`Edit failed: ${error.message}`);
        stop.abort();
      }
    };
    client.editTimer = setTimeout(tick, Math.random() * interval);
  }
  await pause(config.seconds * 1000);
  for (const client of clients) clearTimeout(client.editTimer);
  editingMs = performance.now() - began;
  lag.disable();
  lagSummary = {
    p99Ms: lag.count ? lag.percentile(99) / 1e6 : null,
    maxMs: lag.count ? lag.max / 1e6 : null,
    samples: lag.count,
  };
  phase = "draining";
  await pause(config.drainSeconds * 1000);
}

async function cleanup() {
  phase = "cleanup";
  measuring = false;
  for (const client of clients) closeClient(client);
  if (!rooms.length) return;
  // Collab debounces storage up to five seconds. Let close/unload writes settle
  // before deleting DB rows; otherwise a pending store can recreate a document.
  await sleep(5500);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, rooms.length) }, async () => {
    while (next < rooms.length) {
      const room = rooms[next++];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await request(`/api/rooms/${room.id}`, { method: "DELETE" });
          await res.arrayBuffer();
          if (res.status !== 204 && res.status !== 404) throw new Error(`HTTP ${res.status}`);
          room.deleted = true;
          break;
        } catch (error) {
          if (attempt === 3) cleanupErrors.push(`Delete ${room.id}: ${error.message}`);
          else await sleep(attempt * 500);
        }
      }
    }
  }));
}

function buildReport() {
  const failed = clients.filter((client) => client.failure).length;
  const expected = sent * ((config?.people ?? 1) - 1);
  const stats = summary(latency);
  const perRoom = rooms.map((room) => ({
    id: room.id, attempted: room.clients.length,
    synced: room.clients.filter((client) => client.synced).length,
    failed: room.clients.filter((client) => client.failure).length,
    sent: room.sent, received: room.received, expected: room.sent * (config.people - 1),
    expectedFromSyncedPeers: room.sent * Math.max(0, room.initiallySynced - 1),
    missing: Math.max(0, room.sent * (config.people - 1) - room.received),
    latency: summary(room.latency), deleted: room.deleted === true,
  }));
  const worstRoom = perRoom.filter((room) => room.latency.samples)
    .sort((a, b) => b.latency.p95Ms - a.latency.p95Ms)[0];
  const reasons = [...errors, ...cleanupErrors];
  if (interrupted) reasons.push(`Interrupted by ${interrupted}`);
  if (!stats.samples) reasons.push("No peer updates were observed");
  if (config && stats.p95Ms !== null && stats.p95Ms >= config.targetP95Ms) reasons.push(`p95 must be under ${config.targetP95Ms} ms`);
  if (clients.length && failed / clients.length > 0.01) reasons.push("More than 1% of attempted connections failed");
  if (received !== expected) reasons.push(`${Math.max(0, expected - received)} missing peer deliveries (received ${received}, expected ${expected})`);
  const warnings = [];
  if (lagSummary?.p99Ms > 50) warnings.push("Client event-loop p99 exceeds 50 ms: client scheduling can dominate these results. Reduce load per process or use more machines.");
  return {
    runId, startedAt, finishedAt: new Date().toISOString(), config: config ?? null,
    result: reasons.length ? "FAIL" : "PASS", reasons, warnings,
    connections: {
      planned: config ? config.rooms * config.people : 0, attempted: clients.length,
      synced: clients.filter((client) => client.synced).length, failed,
      failedPercent: clients.length ? failed / clients.length * 100 : 0,
      failures: clients.filter((client) => client.failure).map((client) => ({ id: client.id, reason: client.failure })),
    },
    edits: { sent, editingSeconds: editingMs / 1000, sentPerSecond: editingMs ? sent / (editingMs / 1000) : 0 },
    updates: { received, expected, missing: Math.max(0, expected - received) },
    latency: stats, latencyHistogramMs: Object.fromEntries([...latency.bins].sort((a, b) => a[0] - b[0])),
    worstRoom: worstRoom ? { id: worstRoom.id, p95Ms: worstRoom.latency.p95Ms } : null,
    eventLoop: lagSummary, rooms: perRoom, cleanupErrors,
  };
}

function printReport(report) {
  const c = report.connections;
  const l = report.latency;
  console.log(`\n${report.result}: ${config?.rooms ?? 0} rooms x ${config?.people ?? 0} people`);
  console.log(`Connections: ${c.attempted}/${c.planned} attempted, ${c.synced} synced, ${c.failed} failed (${c.failedPercent.toFixed(2)}%)`);
  console.log(`Edits sent: ${sent}; peer updates received: ${received}/${report.updates.expected} expected; missing: ${report.updates.missing}`);
  console.log(`Latency: p50 ${msText(l.p50Ms)}, p90 ${msText(l.p90Ms)}, p95 ${msText(l.p95Ms)}, p99 ${msText(l.p99Ms)}, max ${msText(l.maxMs)}; >1 second: ${l.over1000Ms}`);
  console.log(`Worst room p95: ${report.worstRoom ? `${report.worstRoom.id} ${msText(report.worstRoom.p95Ms)}` : "n/a"}`);
  console.log(`Client event-loop lag: p99 ${msText(lagSummary?.p99Ms ?? null)}, max ${msText(lagSummary?.maxMs ?? null)}`);
  console.log(`Cleanup: ${rooms.filter((room) => room.deleted).length}/${rooms.length} rooms deleted`);
  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
  for (const reason of report.reasons) console.error(`FAIL: ${reason}`);
}

try {
  config = readConfig();
  console.log(`Load ${runId}: ${config.rooms} rooms x ${config.people} people, ${config.seconds}s at ~${config.rate} edits/person/s; p95 < ${config.targetP95Ms} ms`);
  let lastReceived = 0;
  let lastTime = performance.now();
  progressTimer = setInterval(() => {
    const now = performance.now();
    const active = clients.filter((client) => client.synced && !client.closed).length;
    console.log(`[${phase}] connections ${active}/${clients.length}, updates/s ${((received - lastReceived) * 1000 / (now - lastTime)).toFixed(0)}, running p95 ${msText(percentile(latency, 0.95))}`);
    lastReceived = received;
    lastTime = now;
  }, 5000);
  await signIn();
  if (!stop.signal.aborted) await makeRooms();
  if (!stop.signal.aborted) await ramp();
  if (!stop.signal.aborted) await edit();
} catch (error) {
  errors.push(error.message);
  stop.abort();
} finally {
  lag.disable();
  await cleanup();
  clearInterval(progressTimer);
}
const report = buildReport();
try { await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
catch (error) {
  report.result = "FAIL";
  report.reasons.push(`Cannot write report: ${error.message}`);
}
printReport(report);
console.log(`JSON report: ${fileURLToPath(reportPath)}`);
process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : report.result === "PASS" ? 0 : 1;
