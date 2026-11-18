/** Serialize instance-user mutations and their audit records, preserving the last usable administrator across API and console operations. */
import type { Db } from "@codechatter/db";
import { schema } from "@codechatter/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { count, eq, sql } from "drizzle-orm";

export const isInstanceAdmin = (role: unknown): boolean => typeof role === "string" && role.split(",").includes("admin");
export const isBanned = (person: { banned: boolean | null; banExpires: Date | null }, now = new Date()): boolean => Boolean(person.banned && (!person.banExpires || person.banExpires > now));
export type InstanceMutation = { kind: "role"; role: "admin" | "user" } | { kind: "ban"; reason: string; expiresAt: Date | null } | { kind: "unban" } | { kind: "sessions" };

/** A row lock alone cannot protect two concurrent demotions of different administrators. */
export function assertRoleChange(input: { actorId: string | null; targetId: string; targetIsAdmin: boolean; targetIsUsable: boolean; nextRole: "admin" | "user"; usableAdmins: number; totalAdmins: number }): void {
  if (input.nextRole !== "user") return;
  if (input.targetIsAdmin && (input.totalAdmins <= 1 || (input.targetIsUsable && input.usableAdmins <= 1))) throw new ConflictException("Keep at least one active instance admin.");
  if (input.actorId === input.targetId) throw new BadRequestException("You can't remove your own instance admin rights.");
}

export async function mutateInstanceUser(db: Db, input: {
  actorId: string | null; targetId: string; change: InstanceMutation; source: string;
  operator?: string; ip?: string | null; userAgent?: string | null;
}): Promise<{ id: string; changed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(170117, 8)`);
    if (input.actorId) {
      const [actor] = await tx.select().from(schema.user).where(eq(schema.user.id, input.actorId));
      if (!actor || !isInstanceAdmin(actor.role) || isBanned(actor)) throw new NotFoundException();
    }
    const [target] = await tx.select().from(schema.user).where(eq(schema.user.id, input.targetId));
    if (!target) throw new NotFoundException("User not found.");
    const change = input.change;
    let values: Partial<typeof schema.user.$inferInsert> | undefined;
    let action: string;
    let data: Record<string, unknown> = { source: input.source, ...(input.operator && { operator: input.operator }) };
    switch (change.kind) {
      case "role": {
        const [admins] = await tx.select({ n: count(), usable: sql<number>`count(*) filter (where coalesce(${schema.user.banned}, false) = false or ${schema.user.banExpires} <= now())`.mapWith(Number) }).from(schema.user).where(sql`
          'admin' = any(string_to_array(coalesce(${schema.user.role}, 'user'), ','))
        `);
        assertRoleChange({ actorId: input.actorId, targetId: target.id, targetIsAdmin: isInstanceAdmin(target.role), targetIsUsable: !isBanned(target), nextRole: change.role, usableAdmins: admins?.usable ?? 0, totalAdmins: admins?.n ?? 0 });
        // A console/API retry must finish session revocation even if the role
        // committed before a previous revocation failed. Seeding alone stays
        // idempotent so it never signs out shared test accounts on a repeat run.
        if (target.role === change.role && input.source === "seed:dev") return { id: target.id, changed: false };
        values = target.role === change.role ? undefined : { role: change.role };
        action = "instance.user.role";
        data = { ...data, before: target.role ?? "user", role: change.role, unchanged: target.role === change.role };
        break;
      }
      case "ban":
        if (input.actorId === target.id) throw new BadRequestException("You can't ban yourself.");
        if (change.expiresAt && change.expiresAt <= new Date()) throw new BadRequestException("Choose a ban end in the future.");
        values = { banned: true, banReason: change.reason, banExpires: change.expiresAt };
        action = "instance.user.ban";
        data = { ...data, reason: change.reason, expiresAt: change.expiresAt?.toISOString() ?? null };
        break;
      case "unban":
        values = { banned: false, banReason: null, banExpires: null };
        action = "instance.user.unban";
        break;
      case "sessions":
        action = "instance.sessions.revoke";
        data = { ...data, operation: "requested" };
        break;
    }
    if (values) await tx.update(schema.user).set(values).where(eq(schema.user.id, target.id));
    // Null org scope keeps instance events out of every organisation's audit feed.
    // A failed audit insert rolls back user state, unlike best-effort AuditService.
    await tx.insert(schema.auditEvents).values({ orgId: null, actorId: input.actorId, action, targetType: "user", targetId: target.id, data, ip: input.ip ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null });
    return { id: target.id, changed: true };
  });
}
