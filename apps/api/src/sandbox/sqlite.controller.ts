import type { AuthSession } from "@codechatter/auth";
import { RoomCode, SqlitePreviewInput, SqliteQueryInput, SqliteTarget, type DatabaseTable, type QueryResult, type SqliteFile } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, Get, HttpCode, Param, PayloadTooLargeException, Post, Query, Req, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

/** The biggest file loaded in one go (the runner has the same limit, as for the servers). */
const MAX_LOAD_BYTES = 64 * 1024 * 1024;

/**
 * The room's SQLite files in the Databases tool (runner: sqlite.ts). As with the
 * server databases, anyone in the room may look at the tables (they can read the
 * room's files anyway); the query console and loading a file, which change data,
 * need terminal rights; a backup needs the right to run code. Backups and loads go
 * in the audit log.
 */
@Controller("rooms/:roomId/sqlite")
export class SqliteController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async files(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<SqliteFile[]> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<SqliteFile[]>("sqlite", roomId, session.user, "files"));
  }

  @Post("tables")
  @HttpCode(200)
  async tables(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(SqliteTarget)) input: z.infer<typeof SqliteTarget>,
  ): Promise<DatabaseTable[]> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<DatabaseTable[]>("sqlite", roomId, session.user, "tables", input));
  }

  @Post("preview")
  @HttpCode(200)
  async preview(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(SqlitePreviewInput)) input: z.infer<typeof SqlitePreviewInput>,
  ): Promise<QueryResult> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<QueryResult>("sqlite", roomId, session.user, "preview", input));
  }

  @Post("query")
  @HttpCode(200)
  async query(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(SqliteQueryInput)) input: z.infer<typeof SqliteQueryInput>,
  ): Promise<QueryResult> {
    await this.rooms.require(roomId, session.user.id, "terminal.open");
    return this.ask(() => this.runner.fileDatabase<QueryResult>("sqlite", roomId, session.user, "query", input));
  }

  /** A backup as SQL to download, streamed from the sandbox. */
  @Get("dump")
  async dump(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(SqliteTarget)) target: z.infer<typeof SqliteTarget>,
    @Req() request: Request,
    @Res() res: Response,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "code.run");
    const upstream = await this.ask(() => this.runner.sqliteStream(roomId, session.user, `dump?path=${encodeURIComponent(target.path)}`, { method: "GET" }));
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "sqlite.dump", targetType: "room", targetId: roomId, data: { path: target.path } }, request);
    res.status(200).set({
      "content-type": upstream.headers.get("content-type") ?? "application/sql",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    });
    Readable.fromWeb(upstream.body as WebReadableStream).pipe(res);
  }

  /** Run SQL into the file (a seed, or a backup to restore): one of the room's files (?file=), or the request's body. */
  @Post("load")
  @HttpCode(200)
  async load(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(SqliteTarget.extend({ file: SqliteTarget.shape.path.optional() }))) target: { path: string; file?: string },
    @Req() request: Request,
  ): Promise<QueryResult> {
    const { room } = await this.rooms.require(roomId, session.user.id, "terminal.open");
    const into = `path=${encodeURIComponent(target.path)}`;
    let upstream: globalThis.Response;
    let data: Record<string, unknown>;
    if (target.file) {
      upstream = await this.ask(() => this.runner.sqliteStream(roomId, session.user, `load?${into}&file=${encodeURIComponent(target.file!)}`, { method: "POST" }));
      data = { path: target.path, file: target.file };
    } else {
      const bytes = Number(request.headers["content-length"]);
      if (!Number.isInteger(bytes) || bytes <= 0) throw new BadRequestException("Send a file to load.");
      if (bytes > MAX_LOAD_BYTES) throw new PayloadTooLargeException(`Files up to ${MAX_LOAD_BYTES / 1024 / 1024} MB can be loaded.`);
      upstream = await this.ask(() =>
        this.runner.sqliteStream(roomId, session.user, `load?${into}&bytes=${bytes}`, {
          method: "POST",
          body: Readable.toWeb(request) as ReadableStream,
          duplex: "half",
          headers: { "content-type": "application/octet-stream" },
        }),
      );
      data = { path: target.path, bytes };
    }
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "sqlite.load", targetType: "room", targetId: roomId, data }, request);
    return (await upstream.json()) as QueryResult;
  }

  private async ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof RunnerUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
