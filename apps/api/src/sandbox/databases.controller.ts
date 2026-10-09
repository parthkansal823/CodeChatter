import type { AuthSession } from "@codechatter/auth";
import {
  can,
  DATABASE_KINDS,
  QueryInput,
  RoomCode,
  TablePreviewInput,
  type DatabaseKind,
  type DatabaseStatus,
  type DatabaseTable,
  type QueryResult,
  type RoomRole,
} from "@codechatter/contracts";
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, PayloadTooLargeException, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";

/** The biggest file a database loads in one go (the runner has the same limit). */
const MAX_LOAD_BYTES = 64 * 1024 * 1024;

/**
 * The room's one-click databases (apps/runner/src/databases.ts). Everyone in
 * the room sees which are running; their connections (with the password) go
 * only to people who can run code, and starting, stopping and deleting them
 * needs terminal rights, like everything else that changes the sandbox. Each
 * change is recorded in the audit log.
 */
@Controller("rooms/:roomId/databases")
export class DatabasesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string): Promise<DatabaseStatus[]> {
    const { room, role } = await this.rooms.require(this.room(roomId), session.user.id, "room.view");
    return visibleTo(role, await this.runner.databases(room.id, session.user));
  }

  /** Starts in the background; the list says how it's going. */
  @Post(":kind")
  @HttpCode(202)
  start(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "start", request);
  }

  /** Keeps its data. */
  @Post(":kind/stop")
  @HttpCode(200)
  stop(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "stop", request);
  }

  /** Deletes its data. */
  @Delete(":kind")
  remove(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "delete", request);
  }

  /** The query console. Queries can change data, so it needs terminal rights. */
  @Post(":kind/query")
  @HttpCode(200)
  async query(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Body(new ZodPipe(QueryInput)) input: z.infer<typeof QueryInput>) {
    const database = this.kind(kind);
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    return this.runner.databaseTool<QueryResult>(room.id, session.user, database, "query", input);
  }

  /** The table browser: anyone in the room may look. */
  @Get(":kind/tables")
  async tables(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string) {
    const database = this.kind(kind);
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "room.view");
    return this.runner.databaseTool<DatabaseTable[]>(room.id, session.user, database, "tables");
  }

  @Post(":kind/preview")
  @HttpCode(200)
  async preview(
    @CurrentSession() session: AuthSession,
    @Param("roomId") roomId: string,
    @Param("kind") kind: string,
    @Body(new ZodPipe(TablePreviewInput)) input: z.infer<typeof TablePreviewInput>,
  ) {
    const database = this.kind(kind);
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "room.view");
    return this.runner.databaseTool<QueryResult>(room.id, session.user, database, "preview", input);
  }

  /** Deletes its data and starts it again, empty. */
  @Post(":kind/reset")
  @HttpCode(202)
  reset(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "reset", request);
  }

  /**
   * A backup to download, streamed from the database's own dump tool. It needs
   * the right to run code: that's who could read all of it anyway.
   */
  @Get(":kind/dump")
  async dump(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request, @Res() res: Response) {
    const database = this.kind(kind);
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "code.run");
    const upstream = await this.runner.databaseStream(room.id, session.user, database, "dump", { method: "GET" });
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "database.dump", targetType: "room", targetId: room.id, data: { kind: database } }, request);
    res.status(200).set({
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    });
    Readable.fromWeb(upstream.body as WebReadableStream).pipe(res);
  }

  /**
   * Run a file through the database (a seed, or a backup to restore): one of
   * the room's files (?path=), or the request's body, streamed on as it comes.
   */
  @Post(":kind/load")
  @HttpCode(200)
  async load(
    @CurrentSession() session: AuthSession,
    @Param("roomId") roomId: string,
    @Param("kind") kind: string,
    @Query("path") path: string | undefined,
    @Req() request: Request,
  ): Promise<QueryResult> {
    const database = this.kind(kind);
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    let upstream: globalThis.Response;
    let data: Record<string, unknown>;
    if (path) {
      upstream = await this.runner.databaseStream(room.id, session.user, database, `load?path=${encodeURIComponent(path)}`, { method: "POST" });
      data = { kind: database, path };
    } else {
      const bytes = Number(request.headers["content-length"]);
      if (!Number.isInteger(bytes) || bytes <= 0) throw new BadRequestException("Send a file to load.");
      if (bytes > MAX_LOAD_BYTES) throw new PayloadTooLargeException(`Files up to ${MAX_LOAD_BYTES / 1024 / 1024} MB can be loaded.`);
      upstream = await this.runner.databaseStream(room.id, session.user, database, `load?bytes=${bytes}`, {
        method: "POST",
        body: Readable.toWeb(request) as ReadableStream,
        duplex: "half",
        headers: { "content-type": "application/octet-stream" },
      });
      data = { kind: database, bytes };
    }
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "database.load", targetType: "room", targetId: room.id, data }, request);
    return (await upstream.json()) as QueryResult;
  }

  private async change(session: AuthSession, roomId: string, name: string, change: "start" | "stop" | "reset" | "delete", request: Request): Promise<DatabaseStatus[]> {
    const kind = this.kind(name);
    const { room, role } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    const list = await this.runner.changeDatabase(room.id, session.user, kind, change);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: `database.${change}`, targetType: "room", targetId: room.id, data: { kind } }, request);
    return visibleTo(role, list);
  }

  private kind(name: string): DatabaseKind {
    const kind = DATABASE_KINDS.find((k) => k === name);
    if (!kind) throw new BadRequestException("Unknown database.");
    return kind;
  }

  private room(roomId: string): string {
    const parsed = RoomCode.safeParse(roomId);
    if (!parsed.success) throw new BadRequestException("Unknown room.");
    return parsed.data;
  }
}

/** Connections (with the password) only for people who can run code, which could read them anyway. */
function visibleTo(role: RoomRole, list: DatabaseStatus[]): DatabaseStatus[] {
  return can(role, "code.run") ? list : list.map(({ connection: _, ...rest }) => rest);
}
