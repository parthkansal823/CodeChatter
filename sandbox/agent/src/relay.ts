import { connect, createServer, type Server, type Socket } from "node:net";

/** Where package managers find their proxy: HTTPS_PROXY in every terminal and Run (apps/runner/src/sandbox.ts). */
export const RELAY_PORT = 3128;
const OFF = "This room has no internet. Package registries open while the room's owner allows installs (Ports panel)";

/**
 * Package managers in the sandbox use http://127.0.0.1:3128 as their proxy:
 * this relay. While the owner allows installs, the room's network has an
 * egress proxy named "egress" (ADR 0007), and each connection passes through
 * to it. Otherwise every request gets a 403 that says why, which pip, npm and
 * curl show, instead of a puzzling DNS error.
 */
export function startRelay(): Server {
  const server = createServer((client) => {
    client.on("error", () => {});
    let open = false;
    const upstream = connect({ host: "egress", port: RELAY_PORT });
    upstream.once("connect", () => {
      open = true;
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => (open ? client.destroy() : refuse(client)));
    upstream.on("close", () => open && client.destroy());
    client.on("close", () => upstream.destroy());
  });
  server.maxConnections = 128;
  // If the port is taken, installs fail the way they would without the relay.
  server.on("error", () => {});
  server.listen(RELAY_PORT, "127.0.0.1");
  return server;
}

/** Answer once the request has arrived: closing on unread bytes would reset the connection before the client reads why. */
function refuse(client: Socket): void {
  let seen = "";
  let answered = false;
  client.setTimeout(5000, () => client.destroy());
  client.on("data", (chunk: Buffer) => {
    if (answered) return;
    seen += chunk.toString("latin1");
    if (!seen.includes("\r\n\r\n") && seen.length < 16_384) return;
    answered = true;
    client.end(`HTTP/1.1 403 ${OFF}\r\nContent-Type: text/plain\r\nContent-Length: ${OFF.length + 1}\r\nConnection: close\r\n\r\n${OFF}\n`);
  });
}
