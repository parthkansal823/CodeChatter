import { gzipSync } from "node:zlib";

import type { AuthSession } from "@codechatter/auth";
import { RenameCheckpointInput, RoomCode } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { CheckpointsService } from "./checkpoints.service.js";

const CheckpointId = z.uuid();

/**
 * A room's checkpoints (web: the History view). Anyone who can read the room can look back
 * at its files; naming and deleting need edit rights. Collab makes them (a browser asks it
 * over its connection), so there's no route to make one here.
 */
@Controller("rooms/:roomId/checkpoints")
export class CheckpointsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly checkpoints: CheckpointsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return { checkpoints: await this.checkpoints.list(roomId) };
  }

  /** The files document's Yjs state at the checkpoint, gzipped; it never changes, so it's cached. */
  @Get(":id/state")
  async state(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("id", new ZodPipe(CheckpointId)) id: string,
    @Res() response: Response,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    const state = await this.checkpoints.state(roomId, id);
    response
      .set({
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
        "cache-control": "private, max-age=31536000, immutable",
      })
      .end(gzipSync(state));
  }

  @Patch(":id")
  async rename(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("id", new ZodPipe(CheckpointId)) id: string,
    @Body(new ZodPipe(RenameCheckpointInput)) input: RenameCheckpointInput,
  ) {
    await this.rooms.require(roomId, session.user.id, "files.edit");
    return this.checkpoints.rename(roomId, id, input.label);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("id", new ZodPipe(CheckpointId)) id: string,
    @Req() request: Request,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "files.edit");
    await this.checkpoints.remove(roomId, id);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "checkpoint.delete", targetType: "room", targetId: roomId, data: { checkpoint: id } }, request);
  }
}
