import { mentionedIn, notificationText, type MarkReadInput, type NotificationItem, type NotificationPayload, type NotificationType } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { notificationDigestEmail } from "@codechatter/emails";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";

import type { Env } from "../config/env.js";
import { GUEST_DOMAIN } from "../demo/guest-domain.js";
import { DB, ENV } from "../infra/tokens.js";
import { MailService } from "../mail/mail.service.js";

const PAGE = 30;
const DIGEST_ITEMS = 20;

/**
 * Notifications: written for the people they're for (never the one who caused them),
 * pushed live to wherever those people are signed in (their own Socket.IO channel; the
 * gateway gives this service its way to send), listed in the inbox, and, left unread for
 * an hour, emailed in a digest at most once a day to those who haven't turned it off.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private push: ((userId: string, item: NotificationItem) => void) | null = null;
  private digestTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.digestTimer = setInterval(
      () => void this.sendDigests().catch((error) => this.logger.warn(`digest failed: ${String(error)}`)),
      this.env.NOTIFICATION_DIGEST_CHECK_MS,
    );
    this.digestTimer.unref();
  }

  onModuleDestroy() {
    if (this.digestTimer) clearInterval(this.digestTimer);
  }

  /** The events gateway's way to reach a person live. */
  setPush(push: (userId: string, item: NotificationItem) => void) {
    this.push = push;
  }

  async notify(input: { userIds: string[]; type: NotificationType; actorId: string | null; roomId: string | null; payload: NotificationPayload }): Promise<void> {
    const userIds = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
    if (!userIds.length) return;
    const rows = await this.handle.db
      .insert(schema.notifications)
      .values(userIds.map((userId) => ({ userId, type: input.type, actorId: input.actorId, roomId: input.roomId, payload: input.payload })))
      .returning({ id: schema.notifications.id });
    const items = await this.items(inArray(schema.notifications.id, rows.map((row) => row.id)));
    for (const { userId, item } of items) this.push?.(userId, item);
  }

  /** Everyone in the room a chat message mentions by name ("@Ana"). */
  async notifyMentions(roomId: string, actorId: string, body: string): Promise<void> {
    if (!body.includes("@")) return;
    const members = await this.members(roomId);
    const mentioned = mentionedIn(body, members);
    if (!mentioned.length) return;
    await this.notify({ userIds: mentioned.map((m) => m.id), type: "mention", actorId, roomId, payload: { excerpt: body.slice(0, 140) } });
  }

  /** The room's owners hear who joined, or asked to. */
  async notifyOwners(roomId: string, actorId: string, type: "room.joined" | "room.requested", role: string): Promise<void> {
    const owners = (await this.members(roomId)).filter((member) => member.role === "owner");
    await this.notify({ userIds: owners.map((owner) => owner.id), type, actorId, roomId, payload: { role } });
  }

  private members(roomId: string) {
    return this.handle.db
      .select({ id: schema.roomMembers.userId, name: schema.user.name, role: schema.roomMembers.role })
      .from(schema.roomMembers)
      .innerJoin(schema.user, eq(schema.roomMembers.userId, schema.user.id))
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.status, "active")));
  }

  /** Newest first, a page at a time (`before` is the oldest id already shown), and how many are unread. */
  async list(userId: string, before?: string): Promise<{ items: NotificationItem[]; unread: number }> {
    const where = and(eq(schema.notifications.userId, userId), before ? lt(schema.notifications.id, before) : undefined)!;
    const [items, unread] = await Promise.all([this.items(where, PAGE), this.unread(userId)]);
    return { items: items.map(({ item }) => item), unread };
  }

  async unread(userId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
    return row?.n ?? 0;
  }

  async markRead(userId: string, input: MarkReadInput): Promise<void> {
    await this.handle.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
          "ids" in input ? inArray(schema.notifications.id, input.ids) : undefined,
        ),
      );
  }

  async settings(userId: string): Promise<{ emailDigest: boolean }> {
    const [row] = await this.handle.db.select({ emailDigest: schema.userSettings.emailDigest }).from(schema.userSettings).where(eq(schema.userSettings.userId, userId));
    return { emailDigest: row?.emailDigest ?? true };
  }

  async setSettings(userId: string, emailDigest: boolean): Promise<{ emailDigest: boolean }> {
    await this.handle.db
      .insert(schema.userSettings)
      .values({ userId, emailDigest })
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: { emailDigest, updatedAt: new Date() } });
    return { emailDigest };
  }

  private async items(where: SQL, limit = 200): Promise<Array<{ userId: string; item: NotificationItem }>> {
    const { notifications, user, rooms } = schema;
    const rows = await this.handle.db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorId: user.id,
        actorName: user.name,
        actorImage: user.image,
        roomId: rooms.id,
        roomName: rooms.name,
      })
      .from(notifications)
      .leftJoin(user, eq(notifications.actorId, user.id))
      .leftJoin(rooms, eq(notifications.roomId, rooms.id))
      .where(where)
      .orderBy(desc(notifications.id))
      .limit(limit);
    return rows.map((row) => ({
      userId: row.userId,
      item: {
        id: row.id,
        type: row.type as NotificationType,
        actor: row.actorId && row.actorName ? { id: row.actorId, name: row.actorName, image: row.actorImage ?? null } : null,
        room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
        payload: row.payload as NotificationPayload,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      },
    }));
  }

  /**
   * Email what people left unread: one digest each, for those who want it and haven't had
   * one in a day. One API instance at a time (a lock in Postgres); each notification goes once.
   */
  async sendDigests(now = new Date()): Promise<number> {
    const { notifications, user, userSettings } = schema;
    return this.handle.db.transaction(async (tx) => {
      // Held until the transaction ends, on its one connection.
      const [{ locked } = { locked: false }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('notification-digest')) as locked`);
      if (!locked) return 0;
      let sent = 0;
      const due = await tx
        .select({ userId: notifications.userId, email: user.email, name: user.name })
        .from(notifications)
        .innerJoin(user, eq(notifications.userId, user.id))
        .leftJoin(userSettings, eq(userSettings.userId, notifications.userId))
        .where(
          and(
            isNull(notifications.readAt),
            isNull(notifications.emailedAt),
            // Unread this long (an hour), so one seen in the app isn't emailed.
            lt(notifications.createdAt, new Date(now.getTime() - this.env.NOTIFICATION_DIGEST_AFTER_MS)),
            sql`coalesce(${userSettings.emailDigest}, true)`,
            sql`${user.email} not like ${`%${GUEST_DOMAIN}`}`,
            // No digest in the last day (a raw fragment's date goes in as text: only columns map Dates).
            sql`not exists (select 1 from ${notifications} n2 where n2.user_id = ${notifications.userId} and n2.emailed_at > ${new Date(now.getTime() - this.env.NOTIFICATION_DIGEST_EVERY_MS).toISOString()}::timestamptz)`,
          ),
        )
        .groupBy(notifications.userId, user.email, user.name)
        .limit(50);
      // Addresses that can't exist (test accounts) only go to a local mail catcher, never a real server.
      const localSmtp = /^(localhost|127\.0\.0\.1|::1|mailpit)$/i.test(this.env.SMTP_HOST);
      for (const person of due) {
        if (!localSmtp && /\.(local|test|invalid|example)$/i.test(person.email.split("@")[1] ?? "")) continue;
        const pending = and(eq(notifications.userId, person.userId), isNull(notifications.readAt), isNull(notifications.emailedAt))!;
        const items = (await this.items(pending, 500)).map(({ item }) => item);
        if (!items.length) continue;
        const shown = items.slice(0, DIGEST_ITEMS);
        try {
          await this.mail.send(
            person.email,
            await notificationDigestEmail({
              name: person.name,
              items: shown.map((item) => ({ text: notificationText(item), url: `${this.env.APP_URL}/rooms/${item.room?.id ?? ""}` })),
              more: items.length - shown.length,
              inboxUrl: `${this.env.APP_URL}/rooms`,
            }),
          );
        } catch (error) {
          this.logger.warn(`digest to ${person.userId} failed: ${String(error)}`);
          continue;
        }
        await tx.update(notifications).set({ emailedAt: now }).where(inArray(notifications.id, items.map((item) => item.id)));
        sent += 1;
      }
      return sent;
    });
  }
}
