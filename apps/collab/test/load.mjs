/**
 * Load-test live editing through Caddy with real, independent Yjs clients.
 * From apps/collab: node --env-file=../../.env test/load.mjs
 * Defaults: 50 rooms, 10 people each, 60 seconds of edits after a 20-second ramp.
 * Creates only disposable rooms, then closes clients and deletes those rooms.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import WebSocket from "ws";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const reportPath = new URL("./load-report.json", import.meta.url);
const worker = process.argv.includes("--load-worker");
let runId = randomUUID();
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
let coordinator = false;
let uncertainCreate = false;
const roomNames = new Set();
const children = [];
const lag = monitorEventLoopDelay({ resolution: 10 });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = signal;
    if (!worker) console.log(`\n${signal}: stopping edits and cleaning up disposable rooms...`);
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
    workers: option("WORKERS", Math.min(8, Math.max(1, availableParallelism() - 1)), { min: 1, integer: true }),
    people: option("PEOPLE", 10, { min: 2, integer: true }),
    seconds: option("SECONDS", 60, { min: 0.1 }),
    rate: option("RATE", 2, { min: 0.001 }),
    targetP95Ms: option("TARGET_P95_MS", 150, { min: 0.001 }),
    rampSeconds: option("RAMP_SECONDS", 20),
    syncTimeoutMs: option("SYNC_TIMEOUT_MS", 15_000, { min: 1, integer: true }),
    drainSeconds: option("DRAIN_SECONDS", 5),
  };
}

// One-millisecond bins through two seconds, then coarser upper bounds keep IPC compact.
function histogram() { return { bins: new Map(), samples: 0, max: 0, over1000: 0 }; }
function record(h, ms) {
  const bucket = ms <= 2000 ? ms : ms <= 10_000 ? Math.ceil(ms / 10) * 10 : ms <= 60_000 ? Math.ceil(ms / 100) * 100 : Math.ceil(ms / 1000) * 1000;
  h.bins.set(bucket, (h.bins.get(bucket) ?? 0) + 1);
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
        const name = `Load ${runId} ${index + 1}`;
        roomNames.add(name);
        const res = await request("/api/rooms", {
          method: "POST", body: JSON.stringify({ name }),
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
        uncertainCreate = true;
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
      client.provider.on("authenticationFailed", () => fail("Authentication failed"));
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
  if (uncertainCreate) await recoverRoomIds();
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

function roomRecords() {
  return rooms.map((room) => ({
    ...(room.snapshot ?? {
      id: room.id, attempted: room.clients.length,
      synced: room.clients.filter((client) => client.synced).length,
      failed: room.clients.filter((client) => client.failure).length,
      sent: room.sent, received: room.received, expected: room.sent * (config.people - 1),
      expectedFromSyncedPeers: room.sent * Math.max(0, room.initiallySynced - 1),
      missing: Math.max(0, room.sent * (config.people - 1) - room.received),
      latency: summary(room.latency),
    }),
    deleted: room.deleted === true,
  }));
}

function connectionStats() {
  const snapshots = children.flatMap((child) => child.snapshot ? [child.snapshot] : []);
  const failures = coordinator ? snapshots.flatMap((snapshot) => snapshot.connections.failures)
    : clients.filter((client) => client.failure).map((client) => ({ id: client.id, reason: client.failure }));
  const attempted = coordinator ? snapshots.reduce((sum, snapshot) => sum + snapshot.connections.attempted, 0) : clients.length;
  return {
    planned: config ? config.rooms * config.people : 0, attempted,
    active: coordinator ? snapshots.reduce((sum, snapshot) => sum + snapshot.connections.active, 0) : clients.filter((client) => client.synced && !client.closed).length,
    synced: coordinator ? snapshots.reduce((sum, snapshot) => sum + snapshot.connections.synced, 0) : clients.filter((client) => client.synced).length,
    failed: failures.length, failedPercent: attempted ? failures.length / attempted * 100 : 0, failures,
  };
}

function buildReport() {
  const connections = connectionStats();
  const expected = sent * ((config?.people ?? 1) - 1);
  const stats = summary(latency);
  const perRoom = roomRecords();
  const worstRoom = perRoom.filter((room) => room.latency.samples)
    .sort((a, b) => b.latency.p95Ms - a.latency.p95Ms)[0];
  const reasons = [...errors, ...cleanupErrors];
  if (interrupted) reasons.push(`Interrupted by ${interrupted}`);
  if (!stats.samples) reasons.push("No peer updates were observed");
  if (config && stats.p95Ms !== null && stats.p95Ms >= config.targetP95Ms) reasons.push(`p95 must be under ${config.targetP95Ms} ms`);
  if (connections.attempted && connections.failed / connections.attempted > 0.01) reasons.push("More than 1% of attempted connections failed");
  if (config && connections.attempted !== config.rooms * config.people) reasons.push("Not every planned connection was attempted");
  if (received !== expected) reasons.push(`${Math.max(0, expected - received)} missing peer deliveries (received ${received}, expected ${expected})`);
  const warnings = [];
  if (lagSummary?.p99Ms > 50) warnings.push("Client event-loop p99 exceeds 50 ms: client scheduling can dominate these results. Increase WORKERS or use more machines.");
  return {
    runId, startedAt, finishedAt: new Date().toISOString(), config: config ?? null,
    result: reasons.length ? "FAIL" : "PASS", reasons, warnings, connections,
    edits: { sent, editingSeconds: editingMs / 1000, sentPerSecond: editingMs ? sent / (editingMs / 1000) : 0 },
    updates: { received, expected, missing: Math.max(0, expected - received) },
    latency: stats, latencyHistogramMs: Object.fromEntries([...latency.bins].sort((a, b) => a[0] - b[0])),
    worstRoom: worstRoom ? { id: worstRoom.id, p95Ms: worstRoom.latency.p95Ms } : null,
    eventLoop: lagSummary, workers: children.map((child) => ({
      id: child.id, rooms: child.roomIds, phase: child.snapshot?.phase ?? "starting",
      eventLoop: child.snapshot?.eventLoop ?? null, completed: child.final === true,
      exitCode: child.exitCode ?? null, signal: child.signal ?? null,
    })), rooms: perRoom, cleanupErrors,
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

/** Recover creates whose HTTP response was lost, without touching unrelated account rooms. */
async function recoverRoomIds() {
  try {
    const response = await request("/api/rooms");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const found = await response.json();
    if (!Array.isArray(found)) throw new Error("Unexpected room list");
    for (const room of found) {
      if (roomNames.has(room.name) && /^[A-Z0-9]{6}$/.test(room.id) && !["E2ETST", "TEAM22"].includes(room.id) && !rooms.some((known) => known.id === room.id)) {
        rooms.push({ id: room.id, clients: [], sent: 0, received: 0, initiallySynced: 0, latency: histogram() });
      }
    }
  } catch {
    cleanupErrors.push("Could not reconcile room creation responses; check rooms named with this run ID");
  }
}

function startProgress() {
  let lastReceived = 0;
  let lastTime = performance.now();
  progressTimer = setInterval(() => {
    const now = performance.now();
    const connections = connectionStats();
    console.log(`[${phase}] connections ${connections.active}/${connections.attempted}, updates/s ${((received - lastReceived) * 1000 / (now - lastTime)).toFixed(0)}, running p95 ${msText(percentile(latency, 0.95))}`);
    lastReceived = received;
    lastTime = now;
  }, 5000);
}

/** Cumulative snapshots replace earlier IPC data, avoiding duplicate counts. */
function snapshot() {
  return {
    phase, connections: connectionStats(), sent, received, editingMs,
    histogram: { bins: [...latency.bins], samples: latency.samples, max: latency.max, over1000: latency.over1000 },
    eventLoop: lagSummary ?? (measuring && lag.count ? { p99Ms: lag.percentile(99) / 1e6, maxMs: lag.max / 1e6, samples: lag.count } : null),
    rooms: roomRecords(), errors: [...errors], cleanupErrors: [...cleanupErrors],
  };
}

function send(message) {
  return new Promise((resolve) => {
    if (!process.connected) return resolve(false);
    process.send(message, (error) => { if (error) stop.abort(); resolve(!error); });
  });
}

function waitForParent(type) {
  return new Promise((resolve) => {
    const finish = (value) => {
      process.off("message", onMessage);
      stop.signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const onMessage = (message) => { if (message?.type === type) finish(message); };
    process.on("message", onMessage);
    stop.signal.addEventListener("abort", onAbort, { once: true });
    if (stop.signal.aborted) finish(null);
  });
}

async function runWorker() {
  if (typeof process.send !== "function") throw new Error("Load workers must be forked by the parent");
  process.on("disconnect", () => stop.abort());
  process.on("message", (message) => {
    if (message?.type === "stop") { interrupted = message.signal ?? null; stop.abort(); }
  });
  const start = await waitForParent("start");
  if (!start) return;
  config = start.config;
  cookie = start.cookie;
  runId = start.runId;
  for (const id of start.rooms) rooms.push({ id, clients: [], sent: 0, received: 0, initiallySynced: 0, latency: histogram() });
  let sending = false;
  const updates = setInterval(() => {
    if (sending) return;
    sending = true;
    void send({ type: "stats", snapshot: snapshot() }).finally(() => { sending = false; });
  }, 1000);
  try {
    await ramp();
    // Register first so a fast parent cannot race the ready message.
    const editing = waitForParent("edit");
    await send({ type: "ready", snapshot: snapshot() });
    if (await editing && !stop.signal.aborted) await edit();
  } catch (error) {
    errors.push(error.message);
    stop.abort();
  } finally {
    lag.disable();
    phase = "cleanup";
    measuring = false;
    for (const client of clients) closeClient(client);
    clearInterval(updates);
    await send({ type: "final", snapshot: snapshot() });
    if (process.connected) process.disconnect();
  }
  process.exitCode = errors.length || cleanupErrors.length || interrupted ? 1 : 0;
}

function mergeWorkers() {
  latency.bins.clear();
  latency.samples = latency.max = latency.over1000 = 0;
  sent = received = editingMs = 0;
  const loops = [];
  for (const child of children) {
    const data = child.snapshot;
    if (!data) continue;
    sent += data.sent;
    received += data.received;
    editingMs = Math.max(editingMs, data.editingMs);
    latency.samples += data.histogram.samples;
    latency.max = Math.max(latency.max, data.histogram.max);
    latency.over1000 += data.histogram.over1000;
    for (const [ms, n] of data.histogram.bins) latency.bins.set(ms, (latency.bins.get(ms) ?? 0) + n);
    if (data.eventLoop) loops.push(data.eventLoop);
    for (const entry of data.rooms) {
      const room = rooms.find((room) => room.id === entry.id);
      if (room) room.snapshot = entry;
    }
  }
  lagSummary = loops.length ? {
    // p99 values cannot be averaged: retain the worst worker and its own values.
    p99Ms: Math.max(...loops.map((loop) => loop.p99Ms ?? 0)),
    maxMs: Math.max(...loops.map((loop) => loop.maxMs ?? 0)),
    samples: loops.reduce((sum, loop) => sum + loop.samples, 0), aggregation: "worst-worker",
  } : null;
}

function messageChild(child, message) {
  if (child.process.connected) child.process.send(message, () => {});
}

async function runCoordinator() {
  coordinator = true;
  let shutdownTimer;
  let deadline;
  const stopChildren = () => {
    for (const child of children) messageChild(child, { type: "stop", signal: interrupted });
    shutdownTimer ??= setTimeout(() => {
      for (const child of children) if (!child.exited) child.process.kill("SIGKILL");
    }, 10_000);
    shutdownTimer.unref();
  };
  stop.signal.addEventListener("abort", stopChildren, { once: true });
  try {
    await signIn();
    if (!stop.signal.aborted) await makeRooms();
    if (stop.signal.aborted) return;
    phase = "connecting";
    // Parent owns room creation and knows every ID before any worker can crash.
    for (let i = 0; i < config.workers; i++) {
      const assigned = rooms.filter((_room, index) => index % config.workers === i).map((room) => room.id);
      const child = { id: i + 1, roomIds: assigned, ready: false, final: false, exited: false };
      child.process = fork(fileURLToPath(import.meta.url), ["--load-worker"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      children.push(child);
      child.done = new Promise((resolve) => {
        child.process.on("message", (message) => {
          if (message?.snapshot) { child.snapshot = message.snapshot; mergeWorkers(); }
          if (message?.type === "ready") {
            child.ready = true;
            if (children.length === config.workers && children.every((item) => item.ready) && !stop.signal.aborted) {
              phase = "editing";
              for (const item of children) messageChild(item, { type: "edit" });
            }
          }
          if (message?.type === "final") child.final = true;
        });
        child.process.on("error", (error) => {
          errors.push(`Worker ${child.id} could not run (${error.code ?? error.name})`);
          stop.abort();
        });
        const exited = (code, signal) => {
          if (child.exited) return;
          child.exited = true;
          child.exitCode = code;
          child.signal = signal;
          if (code !== 0 || !child.final) {
            errors.push(`Worker ${child.id} exited ${signal ?? code ?? "unexpectedly"}; its latest snapshot may be incomplete`);
            stop.abort();
          }
          resolve();
        };
        child.process.on("exit", exited);
        // A failed spawn emits error/close without exit; it still must settle cleanup.
        child.process.on("close", exited);
      });
      messageChild(child, { type: "start", runId, cookie, rooms: assigned, config: { ...config, rooms: assigned.length, workers: 1 } });
    }
    deadline = setTimeout(() => {
      errors.push("Load workers exceeded their setup/edit/drain deadline");
      stop.abort();
    }, (config.rampSeconds + config.syncTimeoutMs / 1000 + config.seconds + config.drainSeconds + 60) * 1000);
    deadline.unref();
    await Promise.all(children.map((child) => child.done));
  } finally {
    if (children.some((child) => !child.exited)) {
      stop.abort();
      stopChildren();
      await Promise.all(children.map((child) => child.done));
    }
    clearTimeout(deadline);
    clearTimeout(shutdownTimer);
    stop.signal.removeEventListener("abort", stopChildren);
    mergeWorkers();
    for (const child of children) {
      for (const error of child.snapshot?.errors ?? []) errors.push(`Worker ${child.id}: ${error}`);
      for (const error of child.snapshot?.cleanupErrors ?? []) cleanupErrors.push(`Worker ${child.id}: ${error}`);
    }
  }
}

async function main() {
  try {
    config = readConfig();
    console.log(`Load ${runId}: ${config.rooms} rooms x ${config.people} people, ${config.seconds}s at ~${config.rate} edits/person/s; ${config.workers} worker(s); p95 < ${config.targetP95Ms} ms`);
    startProgress();
    if (config.workers > 1) await runCoordinator();
    else {
      await signIn();
      if (!stop.signal.aborted) await makeRooms();
      if (!stop.signal.aborted) await ramp();
      if (!stop.signal.aborted) await edit();
    }
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
}

if (worker) {
  try { await runWorker(); }
  catch { process.exitCode = 1; }
} else await main();
