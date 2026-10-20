import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import WebSocket from "ws";

import { log, messageOf } from "./log.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";

/** The language servers in the sandbox image, by the editor's language id. */
export const LANGUAGE_SERVERS: Record<string, { name: string; command: string[] }> = {
  python: { name: "Pyright", command: ["pyright-langserver", "--stdio"] },
};

/** Biggest message either way (a file's whole text, a long completion list). */
export const MAX_LSP_MESSAGE = 8 * 1024 * 1024;

/**
 * LSP over stdio frames each message with headers (`Content-Length: N`, a blank line)
 * and then N bytes of JSON. Feed it the server's output as it comes; it hands back each
 * whole message.
 */
export class LspFrames {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (json: string) => void) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headers = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1]);
      if (!Number.isFinite(length) || length > MAX_LSP_MESSAGE) {
        // Not a frame (a stray log line): skip past it.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      this.onMessage(this.buffer.subarray(start, start + length).toString("utf8"));
      this.buffer = this.buffer.subarray(start + length);
    }
  }
}

/**
 * The client's `initialize`, adjusted for the room: its one workspace folder is
 * /workspace, and it never changes, so the client doesn't offer to tell the server about
 * folder changes. Pyright 1.1.400, offered that, stops after `initialized` and answers
 * nothing (a client that doesn't offer it works). Every other message passes untouched.
 */
export function forServer(json: string): string {
  if (!json.includes('"initialize"')) return json;
  let message: { method?: string; params?: { capabilities?: { workspace?: Record<string, unknown> }; workspaceFolders?: unknown; rootUri?: unknown } };
  try {
    message = JSON.parse(json) as typeof message;
  } catch {
    return json;
  }
  if (message.method !== "initialize" || !message.params) return json;
  const params = message.params;
  params.capabilities ??= {};
  params.capabilities.workspace = { ...params.capabilities.workspace, workspaceFolders: false };
  params.workspaceFolders = [{ uri: "file:///workspace", name: "workspace" }];
  params.rootUri = "file:///workspace";
  return JSON.stringify(message);
}

/** A message as LSP over stdio wants it. */
export const frame = (json: string): Buffer => {
  const body = Buffer.from(json, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
};

/**
 * IntelliSense (roadmap §14 A): one language server in the room's sandbox, inside the
 * jail like a terminal, for one editor's connection. The browser's language client
 * sends JSON-RPC messages as WebSocket text frames (vscode-ws-jsonrpc); the server
 * speaks LSP on stdio. The server reads the room's files from /workspace, where the
 * editor's file:///workspace/... addresses point, and the editor's open files from
 * the client. Closing the socket ends the server.
 */
export async function openLanguageServer(ws: WebSocket, session: RoomSession, language: string): Promise<void> {
  const server = LANGUAGE_SERVERS[language];
  if (!server) {
    ws.close(1008, "No language server for this language.");
    return;
  }
  let closed = false;
  ws.once("close", () => {
    closed = true;
  });
  // The client says `initialize` as soon as the socket opens: keep what comes before the server is up.
  const early: string[] = [];
  let deliver: ((json: string) => void) | null = null;
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    session.touch();
    if (deliver) deliver(data.toString());
    else early.push(data.toString());
  });
  const id = randomUUID().slice(0, 8);
  const pidFile = `/tmp/cc-lsp-${id}.pid`;
  let handle;
  try {
    await session.ready();
    if (closed) return;
    handle = await session.sandbox.exec([JAIL, "sh", "-c", `umask 002; echo $$ > ${pidFile}; exec "$@"`, "cc-lsp", ...server.command], { tty: false, stdin: true });
  } catch (error) {
    ws.close(1011, messageOf(error).slice(0, 120));
    return;
  }
  session.languageServers += 1;
  const { stream } = handle;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  handle.demux(stdout, stderr);
  const frames = new LspFrames((json) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  });
  stdout.on("data", (chunk: Buffer) => frames.push(chunk));
  // Its stderr is its own chatter (it logs to the client over LSP).
  stderr.resume();

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    session.languageServers -= 1;
    if (ws.readyState === WebSocket.OPEN) ws.close(1000);
  };
  stream.on("end", end);
  stream.on("close", end);
  stream.on("error", end);

  // Ask it to exit, then make sure: stdin can't be closed on its own on every Docker.
  const stop = () => {
    if (!stream.destroyed) stream.write(frame(JSON.stringify({ jsonrpc: "2.0", method: "exit" })));
    void session.sandbox
      .exec(["sh", "-c", `sleep 1; kill "$(cat ${pidFile})" 2>/dev/null; rm -f ${pidFile}; true`], { tty: false })
      .then((killer) => killer.stream.resume())
      .catch((error: unknown) => log.warn(`${server.name}: stopping it failed: ${messageOf(error)}`))
      .finally(() => {
        stream.destroy();
        end();
      });
  };
  // The editor went away while the server started.
  if (closed) return stop();
  deliver = (json) => {
    if (!stream.destroyed) stream.write(frame(forServer(json)));
  };
  for (const json of early.splice(0)) deliver(json);
  ws.on("close", stop);
}
