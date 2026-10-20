import type { AuthSession } from "@codechatter/auth";
import { RoomCode } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, HttpCode, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

const FileId = z.string().regex(/^[a-zA-Z0-9-]{8,64}$/);
const RunCellsInput = z.object({
  cellIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
  /** The caller's Yjs state vector (base64): the kernel runs the cells as they see them. */
  stateVector: z.string().max(4_000_000).optional(),
});

/**
 * A notebook's kernel in the room's sandbox (apps/runner/src/notebooks.ts). Running
 * cells is running code, so every action needs Run rights. The answer is the kernel's
 * status; outputs arrive for everyone in the room's files document.
 */
@Controller("rooms/:roomId/notebooks/:fileId")
export class NotebooksController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
  ) {}

  @Post("run")
  @HttpCode(202)
  async run(
    @CurrentSession() session: AuthSession,
    @Param("roomId") roomId: string,
    @Param("fileId") fileId: string,
    @Body(new ZodPipe(RunCellsInput)) input: z.infer<typeof RunCellsInput>,
  ) {
    return this.call(session, roomId, fileId, "run", input);
  }

  @Post(":action")
  @HttpCode(200)
  async control(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("fileId") fileId: string, @Param("action") action: string) {
    if (action !== "interrupt" && action !== "restart" && action !== "shutdown") throw new BadRequestException("Unknown kernel action.");
    return this.call(session, roomId, fileId, action);
  }

  private async call(session: AuthSession, roomId: string, fileId: string, action: "run" | "interrupt" | "restart" | "shutdown", body?: object) {
    const room = RoomCode.safeParse(roomId);
    if (!room.success) throw new BadRequestException("Unknown room.");
    if (!FileId.safeParse(fileId).success) throw new BadRequestException("Unknown notebook.");
    await this.rooms.require(room.data, session.user.id, "code.run");
    try {
      return await this.runner.notebook(room.data, session.user, fileId, action, body);
    } catch (error) {
      if (error instanceof RunnerUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
