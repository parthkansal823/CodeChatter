import type { AuthSession } from "@codechatter/auth";
import { ChatSearchQuery, MarkChatReadInput, RoomCode } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { MessagesService } from "./messages.service.js";

const HistoryQuery = z
  .object({
    before: z.uuid().optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => !(query.before && query.after), "Choose older or newer messages, not both.");
const ContextQuery = z.object({ around: z.uuid() });
const MessageId = z.uuid();

@Controller("rooms")
export class MessagesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly messages: MessagesService,
  ) {}

  @Get("chat/unread")
  unread(@CurrentSession() session: AuthSession) {
    return this.messages.unread(session.user.id);
  }

  @Get(":id/messages/unread")
  async unreadInRoom(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.messages.unreadInRoom(roomId, session.user.id);
  }

  @Post(":id/messages/read")
  async markRead(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(MarkChatReadInput)) input: MarkChatReadInput,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.messages.markRead(roomId, session.user.id, input.messageId);
  }

  @Get(":id/messages/search")
  async search(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(ChatSearchQuery)) query: ChatSearchQuery,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.messages.search(roomId, query);
  }

  @Get(":id/messages/context")
  async context(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(ContextQuery)) query: z.infer<typeof ContextQuery>,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.messages.context(roomId, query.around);
  }

  @Delete(":id/messages/:messageId")
  async deleteOwn(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Param("messageId", new ZodPipe(MessageId)) messageId: string,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.messages.deleteOwn(roomId, session.user.id, messageId);
  }

  @Get(":id/messages")
  async history(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(HistoryQuery)) query: z.infer<typeof HistoryQuery>,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.messages.list(roomId, query);
  }
}
