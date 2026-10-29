import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import WebSocket from "ws";

import { log, messageOf } from "./log.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";

type LanguageServer = {
  name: string;
  command: string[];
  /** Added to the client's `initialize` (the server's own options). */
  initializationOptions?: Record<string, unknown>;
  /** Only the full sandbox image has it. */
  fullImage?: boolean;
};

/**
 * clangd, without a compile_commands.json: gcc's own headers (bits/stdc++.h too), and no
 * background index, which would write .cache/ into the room's files.
 */
const CLANGD = ["clangd", "--query-driver=/usr/bin/gcc*,/usr/bin/g++*,/usr/bin/cc,/usr/bin/c++", "--background-index=false", "--header-insertion=never", "--log=error"];

/** The language servers in the sandbox image, by the editor's language id. */
export const LANGUAGE_SERVERS: Record<string, LanguageServer> = {
  python: { name: "Pyright", command: ["pyright-langserver", "--stdio"] },
  c: { name: "clangd", command: CLANGD, initializationOptions: { fallbackFlags: ["-std=c17"] } },
  cpp: { name: "clangd", command: CLANGD, initializationOptions: { fallbackFlags: ["-std=c++20"] } },
  go: { name: "gopls", command: ["gopls"], fullImage: true },
  rust: {
    name: "rust-analyzer",
    command: ["rust-analyzer"],
    // The sandbox has no network: cargo stays offline, and the standard library is read from
    // its sources (rust-src) instead of asking cargo about them, which would wait on the network.
    initializationOptions: { cargo: { extraEnv: { CARGO_NET_OFFLINE: "true" }, sysrootQueryMetadata: "none" } },
    fullImage: true,
  },
  // Eclipse JDT LS (sandbox/image/jdtls): a .java file outside a Maven or Gradle project is
  // still understood, as the folder's own project. It takes several seconds to start. It runs
  // on Java 25, but rooms compile with Java 21, so that's the library it completes from.
  java: {
    name: "Eclipse JDT LS",
    command: ["jdtls"],
    initializationOptions: { settings: { java: { configuration: { runtimes: [{ name: "JavaSE-21", path: "/usr/lib/jvm/java-21-openjdk-amd64", default: true }] } } } },
    fullImage: true,
  },
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
 * nothing (a client that doesn't offer it works). The server's own options (clangd's
 * compiler flags) go in too. Every other message passes untouched.
 */
export function forServer(json: string, language: string): string {
  if (!json.includes('"initialize"')) return json;
  let message: {
    method?: string;
    params?: { capabilities?: { workspace?: Record<string, unknown> }; workspaceFolders?: unknown; rootUri?: unknown; initializationOptions?: unknown };
  };
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
  const own = LANGUAGE_SERVERS[language]?.initializationOptions;
  if (own) params.initializationOptions = { ...(params.initializationOptions as Record<string, unknown> | undefined), ...own };
  return JSON.stringify(message);
}

/** What a server does that the room does another way, left out of its capabilities. */
const NOT_FROM_SERVER = ["documentFormattingProvider", "documentRangeFormattingProvider", "documentOnTypeFormattingProvider"];

/**
 * The server's answer to `initialize`, adjusted for the room: formatting is Format
 * document's job in the room (format.ts runs the same tools: clang-format, gofmt,
 * rustfmt), and two formatters for one file make the editor ask which to use. Every
 * other message passes untouched.
 */
export function forClient(json: string): string {
  if (!json.includes('"capabilities"') || !NOT_FROM_SERVER.some((name) => json.includes(name))) return json;
  let message: { result?: { capabilities?: Record<string, unknown> } };
  try {
    message = JSON.parse(json) as typeof message;
  } catch {
    return json;
  }
  const capabilities = message.result?.capabilities;
  if (!capabilities) return json;
  for (const name of NOT_FROM_SERVER) delete capabilities[name];
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
    const script = `umask 002; command -v "$1" >/dev/null || { echo "cc-lsp: missing" >&2; exit 127; }; echo $$ > ${pidFile}; exec "$@"`;
    handle = await session.sandbox.exec([JAIL, "sh", "-c", script, "cc-lsp", ...server.command], { tty: false, stdin: true });
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
    if (ws.readyState === WebSocket.OPEN) ws.send(forClient(json));
  });
  stdout.on("data", (chunk: Buffer) => frames.push(chunk));
  // Its stderr is its own chatter (it logs to the client over LSP), except our note that it isn't installed.
  let missing = false;
  stderr.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("cc-lsp: missing")) missing = true;
  });

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    session.languageServers -= 1;
    // 4404: the client stops asking (a close reason the browser can show).
    if (ws.readyState === WebSocket.OPEN) {
      if (missing) ws.close(4404, `${server.name} isn't in this room's sandbox${server.fullImage ? " (it comes with the full image)" : ""}.`);
      else ws.close(1000);
    }
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
    if (!stream.destroyed) stream.write(frame(forServer(json, language)));
  };
  for (const json of early.splice(0)) deliver(json);
  ws.on("close", stop);
}
