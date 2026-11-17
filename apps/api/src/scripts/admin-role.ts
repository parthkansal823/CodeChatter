/** Grant or revoke instance authority from the server console, sharing the API's serialized last-admin check and strict audit write. */
import { createAuth } from "@codechatter/auth";
import { ROOM_ACCESS_CHANNEL, SESSION_ENDED_CHANNEL, roomAccessMessage } from "@codechatter/contracts";
import { createDb, schema } from "@codechatter/db";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { userInfo } from "node:os";

import { mutateInstanceUser } from "../admin/admin-policy.js";
import { loadEnv } from "../config/env.js";

export async function runAdminRole(role: "admin" | "user"): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || process.argv.length !== 3 || !email.includes("@")) {
    console.error(`Usage: admin:${role === "admin" ? "grant" : "revoke"} <email>`);
    process.exitCode = 1;
    return;
  }
  let handle: ReturnType<typeof createDb> | undefined;
  let redis: Redis | undefined;
  try {
    const env = loadEnv();
    handle = createDb(env.DATABASE_URL, { max: 2 });
    const [target] = await handle.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
    if (!target) { console.error("Account not found. Create and verify the account first."); process.exitCode = 1; return; }
    const result = await mutateInstanceUser(handle.db, { actorId: null, targetId: target.id, change: { kind: "role", role }, source: role === "admin" ? "admin:grant" : "admin:revoke", operator: `console:${userInfo().username}` });
    if (result.changed) {
      redis = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 2 });
      redis.on("error", () => {});
      const connection = redis;
      const auth = createAuth({ db: handle.db, redis: connection, appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET, production: env.NODE_ENV === "production", mail: { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendOrgInvitationEmail: async () => {} }, onSessionEnded: async (id) => { await connection.publish(SESSION_ENDED_CHANNEL, id); } });
      await (await auth.$context).internalAdapter.deleteUserSessions(target.id);
      const memberships = await handle.db.select({ roomId: schema.roomMembers.roomId }).from(schema.roomMembers).where(eq(schema.roomMembers.userId, target.id));
      await Promise.all(memberships.map((m) => connection.publish(ROOM_ACCESS_CHANNEL, roomAccessMessage({ roomId: m.roomId, userId: target.id }))));
    }
    console.log(role === "admin" ? "Instance admin granted. Sign in again to use /admin." : "Instance admin revoked. Existing sessions ended.");
  } catch (error) {
    // Print only our known policy messages; never database/Redis exceptions.
    const status = error as { getStatus?: () => number; message?: string };
    console.error(status.getStatus?.() === 409 ? "Keep at least one active instance admin." : "Could not complete the admin change. Check service health and the audit log, then retry.");
    process.exitCode = 1;
  } finally {
    if (redis) await redis.quit().catch(() => redis?.disconnect());
    await handle?.close();
  }
}
