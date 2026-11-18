/** List safe instance metadata and coordinate audited user changes with Better Auth session revocation and existing live-access notifications. */
import type { Auth } from "@codechatter/auth";
import type { AdminPageQuery, AdminRoomsPage, AdminUsersPage, AdminRoom } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { Request } from "express";

import type { Env } from "../config/env.js";
import { AUTH, DB, ENV } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";
import { isBanned, isInstanceAdmin, mutateInstanceUser, type InstanceMutation } from "./admin-policy.js";

const literal = (value: string) => value.replace(/[\\%_]/g, "\\$&");

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly handle: DbHandle, @Inject(AUTH) private readonly auth: Auth, @Inject(ENV) private readonly env: Env, private readonly modules: ModuleRef) {}

  async users(query: AdminPageQuery): Promise<AdminUsersPage> {
    const { user } = schema;
    const search = `%${literal(query.search)}%`;
    const where = query.search ? or(ilike(user.name, search), ilike(user.email, search)) : undefined;
    const [[total], people] = await Promise.all([
      this.handle.db.select({ n: count() }).from(user).where(where),
      this.handle.db.select({ id: user.id, name: user.name, email: user.email, image: user.image, createdAt: user.createdAt, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled, role: user.role, banned: user.banned, banReason: user.banReason, banExpires: user.banExpires }).from(user).where(where).orderBy(desc(user.createdAt), asc(user.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
    ]);
    const memberships = people.length ? await this.handle.db.select({ userId: schema.member.userId, id: schema.organization.id, name: schema.organization.name, role: schema.member.role }).from(schema.member).innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id)).where(inArray(schema.member.userId, people.map((p) => p.id))).orderBy(asc(schema.organization.name)) : [];
    return { items: people.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), twoFactorEnabled: Boolean(p.twoFactorEnabled), role: isInstanceAdmin(p.role) ? "admin" : "user", banned: isBanned(p), banExpires: p.banExpires?.toISOString() ?? null, organizations: memberships.filter((m) => m.userId === p.id).map(({ id, name, role }) => ({ id, name, role })) })), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async rooms(query: AdminPageQuery, actorId: string): Promise<AdminRoomsPage> {
    const { rooms, organization, roomMembers, user } = schema;
    const search = `%${literal(query.search)}%`;
    const where = query.search ? or(ilike(rooms.name, search), ilike(rooms.id, search)) : undefined;
    const [[total], found] = await Promise.all([
      this.handle.db.select({ n: count() }).from(rooms).where(where),
      this.handle.db.select({ id: rooms.id, name: rooms.name, kind: rooms.kind, visibility: rooms.visibility, lastActiveAt: rooms.lastActiveAt, orgId: organization.id, orgName: organization.name }).from(rooms).innerJoin(organization, eq(rooms.orgId, organization.id)).where(where).orderBy(desc(rooms.lastActiveAt), asc(rooms.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
    ]);
    const ids = found.map((r) => r.id);
    const members = ids.length ? await this.handle.db.select({ roomId: roomMembers.roomId, id: user.id, name: user.name, role: roomMembers.role }).from(roomMembers).innerJoin(user, eq(roomMembers.userId, user.id)).where(and(inArray(roomMembers.roomId, ids), eq(roomMembers.status, "active"))) : [];
    const status = new Map<string, AdminRoom["sandbox"]>();
    // Bound fanout: metadata inspection must not create containers or flood a runner.
    const runner = new RunnerClient(this.env);
    let cursor = 0;
    const until = Date.now() + 3_000;
    await Promise.all(Array.from({ length: Math.min(4, found.length) }, async () => {
      while (cursor < found.length) {
        const row = found[cursor++]!;
        if (Date.now() >= until) { status.set(row.id, "unknown"); continue; }
        try {
          const response = await fetch(new URL(`/rooms/${row.id}/sandbox`, this.env.RUNNER_URL), { headers: runner.headers(row.id, { id: actorId, name: "Instance admin" }), signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, until - Date.now()))), redirect: "error" });
          if (!response.ok) throw new Error("SandboxStatusUnavailable");
          const body = await response.json() as { running?: unknown };
          status.set(row.id, body.running === true ? "running" : body.running === false ? "stopped" : "unknown");
        }
        catch { status.set(row.id, "unknown"); }
      }
    }));
    return { items: found.map((r) => ({ id: r.id, name: r.name, kind: r.kind, visibility: r.visibility, organization: { id: r.orgId, name: r.orgName }, lastActiveAt: r.lastActiveAt.toISOString(), members: members.filter((m) => m.roomId === r.id).length, owners: members.filter((m) => m.roomId === r.id && m.role === "owner").map(({ id, name }) => ({ id, name })), sandbox: status.get(r.id) ?? "unknown" })), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async change(actorId: string, targetId: string, change: InstanceMutation, request: Request): Promise<{ ok: true }> {
    const result = await mutateInstanceUser(this.handle.db, { actorId, targetId, change, source: "api", ip: request.ip, userAgent: request.get("user-agent") });
    if (result.changed) {
      try {
        // This installed plugin endpoint runs deleteUserSessions and the existing
        // session.delete.after callbacks; it returns no session tokens.
        await this.auth.api.revokeUserSessions({ headers: fromNodeHeaders(request.headers), body: { userId: targetId } });
      } catch {
        // The acting admin may have been demoted immediately after the audited
        // commit. Complete the already-authorised revocation via the same adapter.
        try { await (await this.auth.$context).internalAdapter.deleteUserSessions(targetId); }
        catch { throw new ServiceUnavailableException("The change was saved, but sessions couldn't all be ended. Try again."); }
      }
      const memberships = await this.handle.db.select({ roomId: schema.roomMembers.roomId }).from(schema.roomMembers).where(eq(schema.roomMembers.userId, targetId));
      const rooms = this.modules.get(RoomsService, { strict: false });
      await Promise.all(memberships.map((m) => rooms.accessChanged(m.roomId, targetId)));
    }
    return { ok: true };
  }
}
