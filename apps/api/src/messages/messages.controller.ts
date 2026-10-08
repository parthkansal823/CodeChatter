import type { AuthSession } from "@codechatter/auth";
import { RoomCode } from "@codechatter/contracts";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { MessagesService } from "./messages.service.js";

const HistoryQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller("rooms/:id/messages")
export class MessagesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  async history(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(HistoryQuery)) query: z.infer<typeof HistoryQuery>,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.messages.list(roomId, query);
  }
}
