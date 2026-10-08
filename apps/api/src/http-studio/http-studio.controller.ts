import type { AuthSession } from "@codechatter/auth";
import { HTTP_STUDIO_LIMITS, HttpSendInput, RoomCode, type HttpSendResult } from "@codechatter/contracts";
import { Body, Controller, HttpCode, HttpException, HttpStatus, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { HttpStudioService } from "./http-studio.service.js";

@Controller("rooms/:roomId/http")
export class HttpStudioController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly studio: HttpStudioService,
  ) {}

  /**
   * Sends one API Studio request and returns the response (or why there
   * was none). Needs code.run: it reaches the room's sandbox and spends
   * server time on the person's behalf.
   */
  @Post("send")
  @HttpCode(200)
  async send(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(HttpSendInput)) input: HttpSendInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HttpSendResult> {
    await this.rooms.require(roomId, session.user.id, "code.run");
    const limit = await this.studio.allow(session.user.id);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      throw new HttpException(
        `You've sent ${HTTP_STUDIO_LIMITS.sendsPerMinute} requests in the last minute. Wait ${limit.retryAfterSeconds} seconds and send again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.studio.send(roomId, { id: session.user.id, name: session.user.name }, input);
  }
}
