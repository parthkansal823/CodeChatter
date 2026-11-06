import type { AuthSession } from "@codechatter/auth";
import { RoomCode, type CallJoin } from "@codechatter/contracts";
import { Controller, HttpCode, Param, Post } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { CallsService } from "./calls.service.js";

/**
 * A room's call (video, voice, screen share), on LiveKit: the address and a token to join
 * it with. Anyone who can talk in the room can join and send their camera, microphone and
 * screen; the token is for this room's call only.
 */
@Controller("rooms/:roomId/call")
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  @HttpCode(200)
  async join(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<CallJoin> {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.calls.join(roomId, session.user);
  }
}
