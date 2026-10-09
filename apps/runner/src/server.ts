import { verifyServiceToken, type ServiceClaims } from "@codechatter/auth/service-token";
import {
  DATABASE_KINDS,
  INSTALLS_MINUTES,
  JudgeInput,
  RoomCode,
  RunInput,
  RunStartInput,
  type JudgeEvent,
  type RunnerEvent,
  type SandboxStatus,
} from "@codechatter/contracts";
import { findByPath } from "@codechatter/workspace-model";
import type Docker from "dockerode";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";

import type { Env } from "./env.js";
import { judge } from "./judge.js";
import { log } from "./log.js";
import { PREVIEW_PATH, proxyPreviewHttp, proxyPreviewUpgrade } from "./preview.js";
import type { RoomRegistry } from "./room-session.js";
import { RunError } from "./runs.js";
import { SandboxUnavailableError } from "./sandbox.js";
import { openTerminal } from "./terminal.js";

/**
 * Internal HTTP API, called only by apps/api (never by browsers). Every call
 * carries a service token minted for exactly one room and one person
 * (aud "runner", sub = room id, uid = user); the API has already checked the
 * person's room permissions.
 *
 *   GET  /healthz
 *   POST /rooms/:id/runs            start; streams NDJSON RunnerEvents
 *   POST /rooms/:id/runs/stop
 *   POST /rooms/:id/runs/input      { runId, data }
 *   GET  /rooms/:id/runs/current    RunSnapshot
 *   POST /rooms/:id/judge           run test cases against a file; streams NDJSON JudgeEvents
 *   GET  /rooms/:id/sandbox         SandboxStatus (ports, CPU, memory, processes, installs)
 *   POST /rooms/:id/sandbox/restart
 *   PUT  /rooms/:id/sandbox/installs  { minutes } allow package installs (ADR 0007)
 *   DELETE /rooms/:id/sandbox/installs
 *   GET  /rooms/:id/databases       DatabaseStatus[] (with connections; the API filters them)
 *   POST /rooms/:id/databases/:kind start one (returns at once; the list follows it)
 *   POST /rooms/:id/databases/:kind/stop    keeps its data
 *   DELETE /rooms/:id/databases/:kind       deletes its data
 *   ANY  /rooms/:id/preview/:port/* dev-server preview (HTTP and WebSocket)
 *   WS   /rooms/:id/terminal?session=&cols=&rows=
 */
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
    if (req.method === "GET" && url.pathname === "/healthz") {
      const docker = await deps.docker.ping().then(() => true, () => false);
      return json(res, docker ? 200 : 503, { status: docker ? "ok" : "docker unavailable" });
    }

    const preview = PREVIEW_PATH.exec(url.pathname);
    if (preview) {
      const port = Number(preview[2]);
      if (!authorize(req, preview[1]!) || port < 1 || port > 65535) return json(res, 401, { error: "Not allowed." });
      return proxyPreviewHttp(rooms.get(preview[1]!), port, `${preview[3] ?? "/"}${url.search}`, req, res);
    }

    const database = /^\/rooms\/([A-Z0-9]{6})\/databases(?:\/([a-z]+)(\/stop)?)?$/.exec(url.pathname);
    if (database) return handleDatabases(req, res, database[1]!, database[2], Boolean(database[3]));

    const match = /^\/rooms\/([A-Z0-9]{6})\/(runs|runs\/stop|runs\/input|runs\/current|sandbox|sandbox\/restart|sandbox\/installs|judge)$/.exec(url.pathname);
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
  async function handleDatabases(req: IncomingMessage, res: ServerResponse, roomId: string, name: string | undefined, stop: boolean): Promise<void> {
    if (!RoomCode.safeParse(roomId).success || !authorize(req, roomId)) return json(res, 401, { error: "Not allowed." });
    const kind = DATABASE_KINDS.find((k) => k === name);
    if (name !== undefined && !kind) return json(res, 404, { error: "Not found." });
    const route = `${req.method} ${kind ? (stop ? "stop" : "one") : "all"}`;
    if (route === "GET all") return json(res, 200, await rooms.databases.list(roomId));
    if (!kind) return json(res, 405, { error: "Method not allowed." });
    if (route === "POST one") {
      const session = rooms.get(roomId);
      session.touch();
      rooms.databases.start(session.sandbox, kind);
      return json(res, 202, await rooms.databases.list(roomId));
    }
    if (route === "POST stop") await rooms.databases.stop(roomId, kind);
    else if (route === "DELETE one") await rooms.databases.remove(roomId, kind);
    else return json(res, 405, { error: "Method not allowed." });
    return json(res, 200, await rooms.databases.list(roomId));
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
          : `The sandbox could not run this: ${error instanceof Error ? error.message : String(error)}`;
      if (!(error instanceof RunError)) log.error(`run in ${roomId}`, error);
      emit({ type: "error", message });
    }
    res.end();
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://runner");
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
