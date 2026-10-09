import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";

import { isPublicAddress, parseTarget, refusal } from "./egress-policy.js";

/**
 * A room's egress proxy (ADR 0007), in a container of its own on the room's
 * network as "egress", while the room's owner allows package installs. It is
 * the room's only way out, and it only opens HTTPS tunnels (CONNECT) to the
 * registry hosts in EGRESS_ALLOW. A name that resolves into a private range is
 * refused, so DNS can't point it back inside. It exits at EGRESS_UNTIL by
 * itself, so installs stop on time even if the runner is down.
 */
const PORT = 3128;
const IDLE_MS = 5 * 60_000;
const allow = new Set((process.env.EGRESS_ALLOW ?? "").split(",").filter(Boolean));
const until = Number(process.env.EGRESS_UNTIL) || 0;

/** One JSON line per decision: the container's log is the record of what the room reached. */
function log(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
}

function reply(client: Socket, status: number, reason: string): void {
  client.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason) + 1}\r\nConnection: close\r\n\r\n${reason}\n`);
}

async function tunnel(authority: string, client: Socket, head: Buffer): Promise<void> {
  client.on("error", () => {});
  const why = refusal(authority, allow);
  if (why) {
    log({ to: authority.slice(0, 300), ok: false, why });
    return reply(client, 403, why);
  }
  const { host } = parseTarget(authority)!;
  const addresses = await lookup(host, { all: true, family: 4 }).catch(() => []);
  if (addresses.length === 0) {
    log({ to: authority, ok: false, why: "no address" });
    return reply(client, 502, `Couldn't look up ${host}`);
  }
  if (!addresses.every((a) => isPublicAddress(a.address))) {
    log({ to: authority, ok: false, why: "private address", addresses: addresses.map((a) => a.address) });
    return reply(client, 403, `${host} resolves to a private address`);
  }
  let open = false;
  const upstream = connect({ host: addresses[0]!.address, port: 443 });
  upstream.setTimeout(15_000, () => upstream.destroy(new Error("timed out")));
  upstream.once("connect", () => {
    open = true;
    upstream.setTimeout(IDLE_MS, () => upstream.destroy());
    client.setTimeout(IDLE_MS, () => client.destroy());
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    log({ to: authority, ok: true });
  });
  upstream.on("error", () => {
    if (open) client.destroy();
    else reply(client, 502, `Couldn't reach ${host}`);
  });
  upstream.on("close", () => open && client.destroy());
  client.on("close", () => upstream.destroy());
}

const server = createServer((req, res) => {
  // Plain HTTP (GET http://…) is never proxied: every registry speaks HTTPS.
  log({ to: String(req.headers.host ?? "").slice(0, 300), ok: false, why: "plain http" });
  const reason = "Only HTTPS to package registries";
  res.writeHead(403, reason, { "content-type": "text/plain", connection: "close" }).end(`${reason}\n`);
});
server.on("connect", (req, client: Socket, head: Buffer) => void tunnel(req.url ?? "", client, head));
server.maxConnections = 256;
server.listen(PORT, () => log({ listening: PORT, registries: allow.size, until: until ? new Date(until).toISOString() : null }));

if (until) {
  setTimeout(() => {
    log({ stopping: "the owner's time for installs is up" });
    process.exit(0);
  }, Math.max(0, until - Date.now()));
}
