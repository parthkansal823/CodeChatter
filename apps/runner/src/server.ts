import { verifyServiceToken, type ServiceClaims } from "@codechatter/auth/service-token";
import {
  DATABASE_KINDS,
  INSTALLS_MINUTES,
  JudgeInput,
  KubeRequest,
  QueryInput,
  RoomCode,
  RunInput,
  RunStartInput,
  TablePreviewInput,
  type JudgeEvent,
  type RunnerEvent,
  type SandboxStatus,
} from "@codechatter/contracts";
import { findByPath, textOf } from "@codechatter/workspace-model";
import type Docker from "dockerode";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { z } from "zod";

import { devStatus, startDev, stopDev } from "./dev-server.js";
import type { Env } from "./env.js";
import { judge } from "./judge.js";
import { log, messageOf } from "./log.js";
import { PREVIEW_PATH, proxyPreviewHttp, proxyPreviewUpgrade } from "./preview.js";
import type { RoomRegistry } from "./room-session.js";
import { RunError } from "./runs.js";
import { FormatError, formatText, MAX_FORMAT_BYTES } from "./format.js";
import { KubeError, kubeApply, kubeDelete, kubeObject, kubePower, kubeResources, kubeStatus } from "./kube.js";
import { LANGUAGE_SERVERS, MAX_LSP_MESSAGE, openLanguageServer } from "./lsp.js";
import { NotebookError } from "./notebooks.js";
import { SandboxUnavailableError } from "./sandbox.js";
import { openTerminal } from "./terminal.js";

/**
 * Internal HTTP API, called only by apps/api (never by browsers). Every call
 * carries a service token minted for exactly one room and one person
 * (aud "runner", sub = room id, uid = user); the API has already checked the
 * person's room permissions.
 *
 *   GET  /healthz                   { status, driver, namespace }
 *   DELETE /rooms/:id               the room was deleted: its containers, volumes and network go
 *   POST /maintenance/prune         { rooms } the rooms that exist (a "maintenance" token); the rest are removed
 *   POST /rooms/:id/runs            start; streams NDJSON RunnerEvents
 *   POST /rooms/:id/runs/stop
 *   POST /rooms/:id/runs/input      { runId, data }
 *   GET  /rooms/:id/runs/current    RunSnapshot
 *   POST /rooms/:id/judge           run test cases against a file; streams NDJSON JudgeEvents
 *   GET  /rooms/:id/sandbox         SandboxStatus (ports, CPU, memory, processes, installs)
 *   POST /rooms/:id/sandbox/restart
 *   PUT  /rooms/:id/sandbox/installs  { minutes } allow package installs (ADR 0007)
 *   DELETE /rooms/:id/sandbox/installs
 *   GET|POST|DELETE /rooms/:id/dev  the dev server from .codechatter/room.json: status, (re)start, stop
 *   GET  /rooms/:id/databases       DatabaseStatus[] (with connections; the API filters them)
 *   POST /rooms/:id/databases/:kind start one (returns at once; the list follows it)
 *   POST /rooms/:id/databases/:kind/stop    keeps its data
 *   DELETE /rooms/:id/databases/:kind       deletes its data
 *   POST /rooms/:id/databases/:kind/query   { query } QueryResult (the console)
 *   GET  /rooms/:id/databases/:kind/tables  DatabaseTable[] (the table browser)
 *   POST /rooms/:id/databases/:kind/preview { name, schema? } QueryResult
 *   GET  /rooms/:id/databases/:kind/dump    a backup, streamed
 *   POST /rooms/:id/databases/:kind/load    a file (the body, or ?path= one of the room's) run through its client
 *   POST /rooms/:id/databases/:kind/reset   delete its data and start it again
 *   POST /rooms/:id/notebooks/:fileId/run   { cellIds, stateVector? } run cells in the notebook's kernel (outputs go into the room's files document)
 *   POST /rooms/:id/notebooks/:fileId/interrupt|restart|shutdown
 *   POST /rooms/:id/format                { path, language, text, tabSize, insertSpaces } the text through the language's formatter (format.ts)
 *   POST /rooms/:id/kube                  { op, … } the Kubernetes playground: status, up, down, resources, object, apply, delete (kube.ts)
 *   ANY  /rooms/:id/preview/:port/* dev-server preview (HTTP and WebSocket)
 *   WS   /rooms/:id/terminal?session=&cols=&rows=
 *   WS   /rooms/:id/lsp?language=           a language server for one editor (lsp.ts)
 *   WS   /rooms/:id/debug?mode=drive|watch    the room's shared debug session (debug.ts)
 */

/** Biggest file a database loads in one go. */
const MAX_LOAD_BYTES = 64 * 1024 * 1024;

export function createRunnerServer(deps: { env: Env; docker: Docker; rooms: RoomRegistry }) {
  const { env, rooms } = deps;

  const authorize = (req: IncomingMessage, roomId: string): ServiceClaims | null => {
    const header = req.headers.authorization ?? "";
    const claims = verifyServiceToken(env.SERVICE_SECRET, header.replace(/^Bearer /, ""), "runner");
    return claims && claims.sub === roomId && claims.uid ? claims : null;
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log.error(`${req.method} ${req.url}`, error);
      if (!res.headersSent) json(res, 500, { error: "The runner hit an unexpected error." });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://runner");
    // Housekeeping from the API: the rooms that exist, so what's left of the others can go.
    if (req.method === "POST" && url.pathname === "/maintenance/prune") {
      const claims = verifyServiceToken(env.SERVICE_SECRET, (req.headers.authorization ?? "").replace(/^Bearer /, ""), "runner");
      if (claims?.sub !== "maintenance") return json(res, 401, { error: "Not allowed." });
      const body = z.object({ rooms: z.array(RoomCode) }).safeParse(await readJson(req, 16 * 1024 * 1024));
      if (!body.success) return json(res, 400, { error: "Send the rooms that exist." });
      return json(res, 200, { removed: await rooms.prune(body.data.rooms) });
    }
    // A room was deleted: its containers, volumes and network go too.
    const deleted = /^\/rooms\/([A-Z0-9]{6})$/.exec(url.pathname);
    if (deleted && req.method === "DELETE") {
      if (!authorize(req, deleted[1]!)) return json(res, 401, { error: "Not allowed." });
      await rooms.destroy(deleted[1]!);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      // What the driver runs rooms on: Docker, or the cluster (which then needs no Docker at all).
      const up = rooms.kube ? await rooms.kube.core.listNamespace({ limit: 1 }).then(() => true, () => false) : await deps.docker.ping().then(() => true, () => false);
      const status = up ? "ok" : rooms.kube ? "kubernetes unavailable" : "docker unavailable";
      return json(res, status === "ok" ? 200 : 503, { status, driver: env.RUNNER_DRIVER, namespace: env.SANDBOX_NAMESPACE });
    }

    const preview = PREVIEW_PATH.exec(url.pathname);
    if (preview) {
      const port = Number(preview[2]);
      if (!authorize(req, preview[1]!) || port < 1 || port > 65535) return json(res, 401, { error: "Not allowed." });
      return proxyPreviewHttp(rooms.get(preview[1]!), port, `${preview[3] ?? "/"}${url.search}`, req, res);
    }

    const database = /^\/rooms\/([A-Z0-9]{6})\/databases(?:\/([a-z]+)(?:\/(stop|query|tables|preview|dump|load|reset))?)?$/.exec(url.pathname);
    if (database) return handleDatabases(req, res, url, database[1]!, database[2], database[3]);

    const notebook = /^\/rooms\/([A-Z0-9]{6})\/notebooks\/([a-zA-Z0-9-]{8,64})\/(run|interrupt|restart|shutdown)$/.exec(url.pathname);
    if (notebook && req.method === "POST") return handleNotebook(req, res, notebook[1]!, notebook[2]!, notebook[3]!);

    const format = /^\/rooms\/([A-Z0-9]{6})\/format$/.exec(url.pathname);
    if (format && req.method === "POST") return handleFormat(req, res, format[1]!);
    const kube = /^\/rooms\/([A-Z0-9]{6})\/kube$/.exec(url.pathname);
    if (kube && req.method === "POST") return handleKube(req, res, kube[1]!);

    const match = /^\/rooms\/([A-Z0-9]{6})\/(runs|runs\/stop|runs\/input|runs\/current|sandbox|sandbox\/restart|sandbox\/installs|judge|dev)$/.exec(url.pathname);
    if (!match || !RoomCode.safeParse(match[1]).success) return json(res, 404, { error: "Not found." });
    const roomId = match[1]!;
    const claims = authorize(req, roomId);
    if (!claims) return json(res, 401, { error: "Not allowed." });
    const user = { id: claims.uid!, name: claims.name ?? "Someone" };
    const route = `${req.method} ${match[2]}`;

    if (route === "POST judge") {
      const body = JudgeInput.safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: body.error.issues[0]?.message ?? "Invalid request." });
      const session = rooms.get(roomId);
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      res.flushHeaders();
      const emit = (event: JudgeEvent) => res.writableEnded || res.write(`${JSON.stringify(event)}
`);
      try {
        await session.ready();
        await session.sync.waitFor(body.data.stateVector);
        await session.sync.flush();
        if (findByPath(session.sync.doc, body.data.path)?.kind !== "file") emit({ type: "error", message: `${body.data.path} doesn't exist any more.` });
        else for await (const event of judge(session.sandbox, body.data.path, body.data.cases, body.data.timeLimitMs)) {
          if (res.destroyed) break;
          session.touch();
          emit(event);
        }
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : "The tests couldn't run." });
      }
      res.end();
      return;
    }
    if (route === "GET sandbox") {
      const session = rooms.peek(roomId);
      const status = session ? await session.status() : { running: false, ports: [], cpuPercent: null, memory: null, processes: null };
      return json(res, 200, { ...status, installs: await rooms.egress.status(roomId) } satisfies SandboxStatus);
    }
    // The API has checked that the caller may switch the room's network (the owner).
    if (route === "PUT sandbox/installs") {
      const body = z.object({ minutes: z.number().positive().max(INSTALLS_MINUTES) }).safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: `minutes must be more than 0 and at most ${INSTALLS_MINUTES}.` });
      try {
        return json(res, 200, await rooms.egress.allow(rooms.get(roomId).sandbox, body.data.minutes, user.name));
      } catch (error) {
        if (error instanceof SandboxUnavailableError) return json(res, 503, { error: error.message });
        throw error;
      }
    }
    // The dev server from room.json (dev-server.ts). The API has checked who may start and stop it.
    if (route === "GET dev") return json(res, 200, await devStatus(rooms.get(roomId)));
    if (route === "POST dev") {
      const session = rooms.get(roomId);
      session.touch();
      const failed = await startDev(session, rooms.databases);
      return failed ? json(res, 409, failed) : json(res, 200, await devStatus(session));
    }
    if (route === "DELETE dev") {
      const session = rooms.get(roomId);
      await stopDev(session);
      return json(res, 200, await devStatus(session));
    }
    if (route === "DELETE sandbox/installs") {
      await rooms.egress.stop(roomId);
      return json(res, 200, { ok: true });
    }
    if (route === "POST sandbox/restart") {
      const session = rooms.get(roomId);
      await session.runs.stop("stopped").catch(() => {});
      await session.sandbox.reset();
      await session.ready();
      return json(res, 200, { ok: true });
    }
    if (route === "GET runs/current") {
      return json(res, 200, rooms.peek(roomId)?.runs.snapshot() ?? { run: null, output: "", exit: null });
    }
    if (route === "POST runs/stop") {
      await rooms.peek(roomId)?.runs.stop("stopped");
      return json(res, 200, { ok: true });
    }
    if (route === "POST runs/input") {
      const input = RunInput.pick({ runId: true, data: true }).safeParse(await readJson(req));
      if (!input.success) return json(res, 400, { error: "Invalid input." });
      const accepted = rooms.peek(roomId)?.runs.input(input.data.runId, user.id, input.data.data) ?? false;
      return json(res, accepted ? 200 : 409, { ok: accepted });
    }
    if (route === "POST runs") {
      const body = RunStartInput.omit({ roomId: true }).safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: body.error.issues[0]?.message ?? "Invalid request." });
      return startRun(res, req, roomId, user, body.data);
    }
    return json(res, 405, { error: "Method not allowed." });
  }

  /** The room's databases (databases.ts). The API has checked who may see and change them. */
  async function handleDatabases(req: IncomingMessage, res: ServerResponse, url: URL, roomId: string, name: string | undefined, action: string | undefined): Promise<void> {
    if (!RoomCode.safeParse(roomId).success || !authorize(req, roomId)) return json(res, 401, { error: "Not allowed." });
    const kind = DATABASE_KINDS.find((k) => k === name);
    if (name !== undefined && !kind) return json(res, 404, { error: "Not found." });
    const route = `${req.method} ${kind ? (action ?? "one") : "all"}`;
    if (route === "GET all") return json(res, 200, await rooms.databases.list(roomId));
    if (!kind) return json(res, 405, { error: "Method not allowed." });
    if (route === "POST one") {
      const session = rooms.get(roomId);
      session.touch();
      rooms.databases.start(session.sandbox, kind);
      return json(res, 202, await rooms.databases.list(roomId));
    }
    // The console and the table browser: rooms.peek, so looking doesn't keep a room awake.
    if (route === "POST query") {
      const body = QueryInput.safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: body.error.issues[0]?.message ?? "Invalid query." });
      rooms.peek(roomId)?.touch();
      return json(res, 200, await rooms.databases.query(roomId, kind, body.data.query));
    }
    if (route === "GET tables") {
      try {
        return json(res, 200, await rooms.databases.tables(roomId, kind));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : "Couldn't list its tables." });
      }
    }
    if (route === "POST preview") {
      const body = TablePreviewInput.safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: "Invalid table." });
      return json(res, 200, await rooms.databases.preview(roomId, kind, body.data));
    }
    // Backups, seeds and resets.
    if (route === "GET dump") {
      const dump = await rooms.databases.openDump(roomId, kind);
      if ("down" in dump) return json(res, 409, { error: dump.down });
      res.writeHead(200, { "content-type": dump.contentType, "content-disposition": `attachment; filename="${dump.file}"`, "cache-control": "no-store" });
      dump.body.pipe(res, { end: false });
      const { exitCode, stderr } = await dump.done;
      if (!dump.body.readableEnded) await once(dump.body, "end");
      // The headers are long gone, so a SQL dump that stopped early says so in a comment.
      if (exitCode !== 0 && dump.contentType === "application/sql") res.write(`\n-- CodeChatter: the dump stopped early: ${stderr.replace(/\s+/g, " ")}\n`);
      res.end();
      return;
    }
    if (route === "POST load") {
      const path = url.searchParams.get("path");
      if (path) {
        // A file from the room, as everyone sees it now.
        const session = rooms.get(roomId);
        await session.sync.synced();
        const node = findByPath(session.sync.doc, path);
        const text = node?.kind === "file" ? textOf(session.sync.doc, node.id)?.toString() : undefined;
        if (text === undefined) return json(res, 404, { error: `${path} isn't a file in this room.` });
        const bytes = Buffer.from(text);
        return json(res, 200, await rooms.databases.load(roomId, kind, Readable.from([bytes]), bytes.length));
      }
      const length = Number(url.searchParams.get("bytes") ?? req.headers["content-length"]);
      if (!Number.isInteger(length) || length <= 0) return json(res, 411, { error: "Send the file with its length." });
      if (length > MAX_LOAD_BYTES) return json(res, 413, { error: `Files up to ${MAX_LOAD_BYTES / 1024 / 1024} MB can be loaded.` });
      return json(res, 200, await rooms.databases.load(roomId, kind, req, length));
    }
    if (route === "POST reset") {
      const session = rooms.get(roomId);
      session.touch();
      await rooms.databases.reset(session.sandbox, kind);
      return json(res, 202, await rooms.databases.list(roomId));
    }
    if (route === "POST stop") await rooms.databases.stop(roomId, kind);
    else if (route === "DELETE one") await rooms.databases.remove(roomId, kind);
    else return json(res, 405, { error: "Method not allowed." });
    return json(res, 200, await rooms.databases.list(roomId));
  }

  /** A notebook's kernel: run cells (their outputs arrive in the room's files document), interrupt, restart, shut down. */
  async function handleNotebook(req: IncomingMessage, res: ServerResponse, roomId: string, fileId: string, action: string): Promise<void> {
    if (!authorize(req, roomId)) return json(res, 401, { error: "Not allowed." });
    const session = rooms.get(roomId);
    try {
      if (action === "run") {
        const body = z
          .object({ cellIds: z.array(z.string().min(1).max(64)).min(1).max(1000), stateVector: z.string().max(4_000_000).optional() })
          .safeParse(await readJson(req, 8 * 1024 * 1024));
        if (!body.success) return json(res, 400, { error: "Send the cells to run." });
        session.touch();
        await session.ready();
        // The cells as the caller sees them: their latest edits first, as for a run.
        if (body.data.stateVector) await session.sync.waitFor(body.data.stateVector);
        return json(res, 202, await session.notebooks.run(fileId, body.data.cellIds));
      }
      if (action === "interrupt") return json(res, 200, session.notebooks.interrupt(fileId));
      if (action === "restart") {
        await session.ready();
        return json(res, 200, await session.notebooks.restart(fileId));
      }
      return json(res, 200, session.notebooks.shutdown(fileId));
    } catch (error) {
      if (error instanceof NotebookError || error instanceof SandboxUnavailableError) return json(res, 409, { error: error.message });
      throw error;
    }
  }

  /** Format document for Python, C, C++, shell, Go and Rust: the text back, formatted, or why not. */
  async function handleFormat(req: IncomingMessage, res: ServerResponse, roomId: string): Promise<void> {
    if (!authorize(req, roomId)) return json(res, 401, { error: "Not allowed." });
    const body = z
      .object({
        path: z.string().min(1).max(1024),
        language: z.string().min(1).max(40),
        text: z.string().max(MAX_FORMAT_BYTES),
        tabSize: z.number().int().min(1).max(8).default(4),
        insertSpaces: z.boolean().default(true),
      })
      .safeParse(await readJson(req, MAX_FORMAT_BYTES * 2));
    if (!body.success) return json(res, 400, { error: "Send the file's path, language and text." });
    const session = rooms.get(roomId);
    try {
      session.touch();
      await session.ready();
      const { path, language, text, tabSize, insertSpaces } = body.data;
      return json(res, 200, { text: await formatText(session.sandbox, language, path, text, { tabSize, insertSpaces }) });
    } catch (error) {
      if (error instanceof FormatError || error instanceof SandboxUnavailableError) return json(res, 409, { error: error.message });
      throw error;
    }
  }

  /** The room's Kubernetes panel: kubectl against the playground in the sandbox, or why it couldn't. */
  async function handleKube(req: IncomingMessage, res: ServerResponse, roomId: string): Promise<void> {
    if (!authorize(req, roomId)) return json(res, 401, { error: "Not allowed." });
    const body = KubeRequest.safeParse(await readJson(req, 2 * 1024 * 1024));
    if (!body.success) return json(res, 400, { error: body.error.issues[0]?.message ?? "Not a request the panel makes." });
    const session = rooms.get(roomId);
    try {
      session.touch();
      await session.ready();
      const request = body.data;
      const { sandbox } = session;
      switch (request.op) {
        case "status":
          return json(res, 200, await kubeStatus(sandbox));
        case "up":
        case "down":
          return json(res, 200, { output: await kubePower(sandbox, request.op === "up") });
        case "resources":
          return json(res, 200, await kubeResources(sandbox));
        case "object":
          return json(res, 200, { output: await kubeObject(sandbox, request.ref, request.view) });
        case "apply":
          return json(res, 200, { output: await kubeApply(sandbox, request.text) });
        case "delete":
          return json(res, 200, { output: await kubeDelete(sandbox, request.ref) });
      }
    } catch (error) {
      if (error instanceof KubeError || error instanceof SandboxUnavailableError) return json(res, 409, { error: error.message });
      throw error;
    }
  }

  /** Streams the run as newline-delimited JSON until it exits. Closing the request stops the run. */
  async function startRun(
    res: ServerResponse,
    req: IncomingMessage,
    roomId: string,
    user: { id: string; name: string },
    body: { path: string; stateVector: string },
  ): Promise<void> {
    const session = rooms.get(roomId);
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    res.flushHeaders();
    const emit = (event: RunnerEvent) => res.writableEnded || res.write(`${JSON.stringify(event)}\n`);
    let runId: string | null = null;
    res.on("close", () => {
      // The API went away mid-run: nobody would see the output, so stop it.
      if (runId && session.runs.snapshot().run?.id === runId && !session.runs.snapshot().exit) void session.runs.stop("stopped");
    });
    try {
      await session.runs.start(
        { roomId, path: body.path, user },
        async () => {
          await session.ready();
          const upToDate = await session.sync.waitFor(body.stateVector);
          await session.sync.flush();
          if (!upToDate) {
            emit({ type: "output", runId: "", data: "\x1b[2m[CodeChatter] Some of your latest edits hadn't reached the server; running what it has.\x1b[0m\r\n" });
          }
          return { fileExists: findByPath(session.sync.doc, body.path)?.kind === "file" };
        },
        (event) => {
          if (event.type === "started") runId = event.run.id;
          emit(event);
        },
      );
    } catch (error) {
      const message =
        error instanceof RunError || error instanceof SandboxUnavailableError
          ? error.message
          : `The sandbox could not run this: ${messageOf(error)}`;
      if (!(error instanceof RunError)) log.error(`run in ${roomId}`, error);
      emit({ type: "error", message });
    }
    res.end();
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  // Language servers send and take whole files: their own server, with room for that.
  const lspWss = new WebSocketServer({ noServer: true, maxPayload: MAX_LSP_MESSAGE });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://runner");
    const lsp = /^\/rooms\/([A-Z0-9]{6})\/lsp$/.exec(url.pathname);
    if (lsp) {
      const language = url.searchParams.get("language") ?? "";
      if (!authorize(req, lsp[1]!) || !LANGUAGE_SERVERS[language]) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      lspWss.handleUpgrade(req, socket, head, (ws) => void openLanguageServer(ws, rooms.get(lsp[1]!), language));
      return;
    }
    const debug = /^\/rooms\/([A-Z0-9]{6})\/debug$/.exec(url.pathname);
    if (debug) {
      const claims = authorize(req, debug[1]!);
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const session = rooms.get(debug[1]!);
      // The API says who may drive (Run rights); everyone else in the room watches.
      const drive = url.searchParams.get("mode") === "drive";
      lspWss.handleUpgrade(req, socket, head, (ws) => session.debugger.join(ws, { name: claims.name ?? "Someone", drive }));
      return;
    }
    const preview = PREVIEW_PATH.exec(url.pathname);
    if (preview) {
      if (!authorize(req, preview[1]!)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      void proxyPreviewUpgrade(rooms.get(preview[1]!), Number(preview[2]), `${preview[3] ?? "/"}${url.search}`, req, socket, head).catch(() => socket.destroy());
      return;
    }
    const match = /^\/rooms\/([A-Z0-9]{6})\/terminal$/.exec(url.pathname);
    const name = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).safeParse(url.searchParams.get("session"));
    if (!match || !name.success || !authorize(req, match[1]!)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const roomId = match[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      void openTerminal(ws, rooms.get(roomId), {
        name: name.data,
        cols: Number(url.searchParams.get("cols")) || 80,
        rows: Number(url.searchParams.get("rows")) || 24,
      });
    });
  });

  return server;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return {};
  }
}
