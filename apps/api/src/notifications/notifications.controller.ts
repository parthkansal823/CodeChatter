import type { AuthSession } from "@codechatter/auth";
import { CommentNotifyInput, MarkReadInput, NotificationSettingsInput, RoomCode, type NotificationSettings } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DB } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { ActivityService } from "./activity.service.js";
import { NotificationsService } from "./notifications.service.js";

const Before = z.uuid().optional();
/** Comment notifications one person may send a minute (each names up to 20 people). */
const COMMENT_NOTES_PER_MINUTE = 30;

/**
 * The inbox (your notifications, read or not, and whether to get the email digest), and
 * per room: telling people about a code comment, and the activity feed.
 */
@Controller()
export class NotificationsController {
  private readonly sent = new Map<string, number[]>();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly rooms: RoomsService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  @Get("me/notifications")
  list(@CurrentSession() session: AuthSession, @Query("before", new ZodPipe(Before)) before?: string) {
    return this.notifications.list(session.user.id, before);
  }

  @Post("me/notifications/read")
  @HttpCode(204)
  async read(@CurrentSession() session: AuthSession, @Body(new ZodPipe(MarkReadInput)) input: MarkReadInput) {
    await this.notifications.markRead(session.user.id, input);
  }

  @Get("me/notification-settings")
  settings(@CurrentSession() session: AuthSession) {
    return this.notifications.settings(session.user.id);
  }

  @Put("me/notification-settings")
  saveSettings(@CurrentSession() session: AuthSession, @Body(new ZodPipe(NotificationSettingsInput)) input: NotificationSettings) {
    return this.notifications.setSettings(session.user.id, input.emailDigest);
  }

  /**
   * Tell people about a comment you wrote on the code: the comments are a document the API
   * doesn't read, so your browser names them. Only people in the room are told, and not you.
   */
  @Post("rooms/:roomId/notifications/comment")
  @HttpCode(204)
  async comment(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(CommentNotifyInput)) input: CommentNotifyInput,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    const now = Date.now();
    const recent = (this.sent.get(session.user.id) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= COMMENT_NOTES_PER_MINUTE) throw new HttpException("Too many notifications at once. Wait a minute.", HttpStatus.TOO_MANY_REQUESTS);
    this.sent.set(session.user.id, [...recent, now]);
    const members = await this.handle.db
      .select({ userId: schema.roomMembers.userId })
      .from(schema.roomMembers)
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.status, "active"), inArray(schema.roomMembers.userId, input.recipients)));
    await this.notifications.notify({
      userIds: members.map((member) => member.userId),
      type: input.kind === "reply" ? "comment.reply" : "comment.new",
      actorId: session.user.id,
      roomId,
      payload: { threadId: input.threadId, path: input.path, line: input.line, excerpt: input.excerpt },
    });
  }

  @Get("rooms/:roomId/activity")
  async feed(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return { items: await this.activity.feed(roomId) };
  }
}
