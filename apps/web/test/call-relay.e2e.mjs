/**
 * Prove real call media uses a selected TURN relay, and cannot connect without it.
 * Run from apps/web with the dev stack and development TURN listener running:
 * node test/call-relay.e2e.mjs
 * The only hook is injected into this browser by Playwright. It returns policy,
 * candidate types and counters; it never returns addresses, tokens or ICE secrets.
 */
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

let browser;
let errors = [];
const pages = [];
let stage = "launch";

function verify(name, value) {
  check(name, value);
  if (!value) throw new Error("CheckFailed");
}

async function until(operation, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await operation()) return true;
    await sleep(300);
  }
  return false;
}

// This wraps the public browser API rather than depending on LiveKit internals.
// Removing ICE servers only in the negative test proves direct fallback cannot
// make that test pass. The actual relay policy must still come from call-store.
async function instrument(context, withoutTurn = false) {
  await context.addInitScript(({ withoutTurn }) => {
    const Native = window.RTCPeerConnection;
    const connections = new Set();
    const connectedOnce = new WeakMap();
    const cleanConfiguration = (configuration) => withoutTurn ? { ...configuration, iceServers: [] } : configuration;
    class ObservedPeerConnection extends Native {
      constructor(configuration, constraints) {
        super(cleanConfiguration(configuration), constraints);
        connections.add(this);
        connectedOnce.set(this, false);
        this.addEventListener("connectionstatechange", () => { if (this.connectionState === "connected") connectedOnce.set(this, true); });
      }
      setConfiguration(configuration) { return super.setConfiguration(cleanConfiguration(configuration)); }
    }
    window.RTCPeerConnection = ObservedPeerConnection;
    Object.defineProperty(window, "__codechatterRelayStats", {
      value: async () => Promise.all([...connections].map(async (connection) => {
        const reports = await connection.getStats().catch(() => new Map());
        const selectedIds = new Set([...reports.values()].filter((report) => report.type === "transport" && report.selectedCandidatePairId).map((report) => report.selectedCandidatePairId));
        const selected = [...reports.values()].filter((report) => report.type === "candidate-pair" && (selectedIds.has(report.id) || (!selectedIds.size && report.nominated && report.state === "succeeded")));
        return {
          policy: connection.getConfiguration().iceTransportPolicy,
          state: connection.connectionState,
          connectedOnce: connectedOnce.get(connection),
          pairs: selected.map((pair) => ({
            local: reports.get(pair.localCandidateId)?.candidateType,
            remote: reports.get(pair.remoteCandidateId)?.candidateType,
            sent: pair.bytesSent ?? 0,
            received: pair.bytesReceived ?? 0,
          })),
        };
      })),
    });
  }, { withoutTurn });
}

const dock = (page) => page.getByRole("region", { name: "Call", exact: true });
const relayStats = (page) => page.evaluate(() => window.__codechatterRelayStats?.() ?? []);

async function leave(page) {
  await dock(page).getByRole("button", { name: "Leave", exact: true }).click({ timeout: 3000 }).catch(() => {});
}

async function run() {
  const launched = await launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  browser = launched.browser;
  errors = launched.errors;
  stage = "sign-in";
  const one = await launched.signIn("test1@codechatter.local");
  const two = await launched.signIn("test2@codechatter.local");
  for (const { context, page } of [one, two]) {
    pages.push(page);
    await context.grantPermissions(["camera", "microphone"]);
    await instrument(context);
    await page.goto(`${BASE}/rooms/${ROOM}?callRelay=1`);
    await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  }
  const a = one.page;
  const b = two.page;
  stage = "forced-relay call";
  await a.getByRole("button", { name: "Call", exact: true }).click();
  await dock(a).getByText("Just you in the call", { exact: true }).waitFor({ timeout: 30_000 });
  await b.getByRole("button", { name: "Join call (1)", exact: true }).click();
  await dock(b).getByText("2 in the call", { exact: true }).waitFor({ timeout: 30_000 });
  verify("two people joined with the relay query", await dock(a).getByText("2 in the call", { exact: true }).isVisible());
  await dock(a).getByRole("button", { name: "Turn your camera on", exact: true }).click();
  const video = dock(b).getByRole("list", { name: "People in the call" }).getByRole("group", { name: /^test1/ }).locator("video");
  await video.waitFor({ timeout: 30_000 });
  verify("remote camera receives decoded video frames", await video.evaluate(async (element) => {
    const frames = () => element.getVideoPlaybackQuality().totalVideoFrames;
    const before = frames();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (element.videoWidth > 0 && element.videoHeight > 0 && frames() > before + 1) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }));
  for (const [name, page] of [["sender", a], ["receiver", b]]) {
    verify(`${name} selected only relay local candidates with media bytes`, await until(async () => {
      const connections = await relayStats(page);
      const active = connections.filter((connection) => connection.pairs.length);
      return active.length > 0 && connections.every((connection) => connection.policy === "relay") && active.every((connection) => connection.pairs.every((pair) => pair.local === "relay" && pair.sent > 0 && pair.received > 0));
    }));
  }
  await leave(b);
  await leave(a);
  stage = "negative relay-only control without ICE servers";
  const negative = await launched.signIn("test1@codechatter.local");
  const blocked = negative.page;
  pages.push(blocked);
  await instrument(negative.context, true);
  await blocked.goto(`${BASE}/rooms/${ROOM}?callRelay=1`);
  await blocked.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await blocked.getByRole("button", { name: "Call", exact: true }).click();
  verify("removing TURN prevents a relay-only call from connecting", await until(async () => {
    const connections = await relayStats(blocked);
    return connections.length > 0 && connections.every((connection) => connection.policy === "relay") && connections.every((connection) => !connection.connectedOnce && connection.pairs.length === 0);
  }, 25_000) && await dock(blocked).count() === 0);
  // Wait for the actual failed join, rather than accepting a moment while ICE
  // is merely negotiating. The history also catches any temporary direct path.
  await blocked.getByRole("button", { name: "Call", exact: true }).waitFor({ timeout: 60_000 });
  verify("negative control has no late direct fallback", await dock(blocked).count() === 0 && (await relayStats(blocked)).every((connection) => !connection.connectedOnce && connection.pairs.length === 0));
}

try { await run(); }
catch (error) { check("relay flow completes", false, `${stage}: ${error?.name ?? "Error"}`); }
finally {
  for (const page of pages) await leave(page);
  await browser?.close();
}
check("no browser page errors", errors.length === 0);
finish();
