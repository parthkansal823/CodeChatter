import { ensurePersonalOrg, hashPassword, type Auth, type AuthSession } from "@codechatter/auth";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, inArray, like, lt } from "drizzle-orm";
import type { Redis } from "ioredis";
import { randomBytes, randomInt } from "node:crypto";

import type { Env } from "../config/env.js";
import { AUTH, DB, ENV, VALKEY } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";

/** Every guest's email ends with this, which is how cleanup finds them. */
export const GUEST_DOMAIN = "guest.codechatter.local";

const ANIMALS = ["Otter", "Falcon", "Lynx", "Heron", "Panda", "Koala", "Orca", "Fox", "Ibis", "Yak", "Gecko", "Puffin"];
const GUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * "Try the demo": a guest account and a guided-tour room in one click, no
 * email. Guests are ordinary users with a marked email domain, so every
 * permission check applies to them unchanged; they are deleted after a day.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(VALKEY) private readonly redis: Redis,
    private readonly rooms: RoomsService,
  ) {}

  get enabled(): boolean {
    return this.env.DEMO_ENABLED;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.sweeper = setInterval(() => void this.sweep(), 60 * 60 * 1000);
    void this.sweep();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /** At most `max` new guests per IP per hour (a demo, not free accounts). */
  async allow(ip: string, max = 5): Promise<boolean> {
    const key = `demo:ip:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    return count <= max;
  }

  /** Create a guest and their tour room; returns the credentials to sign in with. */
  async createGuest(): Promise<{ email: string; password: string; name: string; roomId: string }> {
    const ctx = await this.auth.$context;
    const name = `Guest ${ANIMALS[randomInt(ANIMALS.length)]}`;
    const email = `guest-${randomBytes(6).toString("hex")}@${GUEST_DOMAIN}`;
    const password = randomBytes(18).toString("base64url");
    // Through Better Auth's own adapter, like the dev seed: same ids, hooks
    // and credential account as a normal sign-up, minus the email step.
    const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(password) });
    const orgId = await ensurePersonalOrg(this.handle.db, user);

    const session = { user: { ...user, image: user.image ?? null }, session: { activeOrganizationId: orgId } } as unknown as AuthSession;
    const room = await this.rooms.create(session, {
      name: "Welcome to CodeChatter",
      description: "Your guided tour",
      templateId: "tour",
      visibility: "private",
      joinPolicy: "invite",
    });
    this.logger.log(`demo guest ${user.id} with room ${room.id}`);
    return { email, password, name, roomId: room.id };
  }

  /** Delete guests older than a day, with their personal workspace and rooms (cascade). */
  private async sweep(): Promise<void> {
    try {
      const db = this.handle.db;
      const stale = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(like(schema.user.email, `%@${GUEST_DOMAIN}`), lt(schema.user.createdAt, new Date(Date.now() - GUEST_LIFETIME_MS))));
      if (stale.length === 0) return;
      const ids = stale.map((u) => u.id);
      await db.delete(schema.organization).where(inArray(schema.organization.slug, ids.map((id) => `u-${id}`)));
      await db.delete(schema.user).where(inArray(schema.user.id, ids));
      this.logger.log(`removed ${ids.length} demo guest(s)`);
    } catch (error) {
      this.logger.warn(`demo cleanup failed: ${String(error)}`);
    }
  }
}
