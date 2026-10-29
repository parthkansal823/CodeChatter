import type { AuthSession } from "@codechatter/auth";
import { DuckdbPreviewInput, DuckdbQueryInput, DuckdbTarget, RoomCode, type DatabaseTable, type DuckdbListing, type QueryResult } from "@codechatter/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import type { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

/**
 * DuckDB in the Databases tool (runner: duckdb.ts): the room's DuckDB files, and SQL
 * over its CSV, Parquet and JSON files. As for SQLite, anyone in the room may look
 * (they can read the room's files anyway), and the query console needs terminal
 * rights: it can change a file, or write one with COPY.
 */
@Controller("rooms/:roomId/duckdb")
export class DuckdbController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
  ) {}

  @Get()
  async files(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<DuckdbListing> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<DuckdbListing>("duckdb", roomId, session.user, "files"));
  }

  @Post("tables")
  @HttpCode(200)
  async tables(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(DuckdbTarget)) input: z.infer<typeof DuckdbTarget>,
  ): Promise<DatabaseTable[]> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<DatabaseTable[]>("duckdb", roomId, session.user, "tables", input));
  }

  @Post("preview")
  @HttpCode(200)
  async preview(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(DuckdbPreviewInput)) input: z.infer<typeof DuckdbPreviewInput>,
  ): Promise<QueryResult> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.ask(() => this.runner.fileDatabase<QueryResult>("duckdb", roomId, session.user, "preview", input));
  }

  @Post("query")
  @HttpCode(200)
  async query(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(DuckdbQueryInput)) input: z.infer<typeof DuckdbQueryInput>,
  ): Promise<QueryResult> {
    await this.rooms.require(roomId, session.user.id, "terminal.open");
    return this.ask(() => this.runner.fileDatabase<QueryResult>("duckdb", roomId, session.user, "query", input));
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
