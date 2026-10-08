/**
 * Development seed: verified test accounts and a shared room, ready to sign
 * in with no email step. Safe to re-run (idempotent). Refuses to touch a
 * production database.
 *
 *   pnpm --filter @codechatter/api seed:dev
 */
import { createAuth, ensurePersonalOrg, hashPassword } from "@codechatter/auth";
import { createDb, schema } from "@codechatter/db";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";

import { loadEnv } from "../config/env.js";

const PASSWORD = "codechatter123";
const USERS = [
  { name: "test1", email: "test1@codechatter.local" },
  { name: "test2", email: "test2@codechatter.local" },
] as const;
// The playground is for trying things by hand. Automated tests (apps/*/test)
// use their own room, so they never leave files in it.
const ROOMS = [
  { id: "TEAM22", name: "Team playground", description: "Shared by the dev seed", templateId: "node" },
  { id: "E2ETST", name: "Automated tests", description: "Used by the end-to-end tests", templateId: "blank" },
] as const;

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

const handle = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.VALKEY_URL);
const silentMail = {
  sendVerificationEmail: async () => {},
  sendPasswordResetEmail: async () => {},
  sendOrgInvitationEmail: async () => {},
};
const auth = createAuth({
  db: handle.db,
  redis,
  mail: silentMail,
  appUrl: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  production: false,
});
const ctx = await auth.$context;

const ids: string[] = [];
for (const u of USERS) {
  let user = (await ctx.internalAdapter.findUserByEmail(u.email))?.user;
  if (!user) {
    // Created through Better Auth's own adapter, so ids, hooks and the
    // credential account match what sign-up produces — minus the email step.
    user = await ctx.internalAdapter.createUser({ name: u.name, email: u.email, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await hashPassword(PASSWORD),
    });
    console.log(`created  ${u.email}`);
  } else {
    await handle.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
    console.log(`exists   ${u.email}`);
  }
  await ensurePersonalOrg(handle.db, user);
  ids.push(user.id);
}

// Rooms test1 owns with test2 as an editor: two browsers, two accounts,
// one file — the quickest way to see collaboration work.
const [ownerId, editorId] = [ids[0]!, ids[1]!];
const orgId = await ensurePersonalOrg(handle.db, { id: ownerId, name: USERS[0].name });
console.log("");
for (const room of ROOMS) {
  const inviteToken = randomBytes(24).toString("base64url");
  const inserted = await handle.db
    .insert(schema.rooms)
    .values({
      id: room.id,
      orgId,
      name: room.name,
      description: room.description,
      templateId: room.templateId,
      inviteTokenHash: createHash("sha256").update(inviteToken).digest("hex"),
      createdBy: ownerId,
    })
    .onConflictDoNothing()
    .returning({ id: schema.rooms.id });
  await handle.db
    .insert(schema.roomMembers)
    .values([
      { roomId: room.id, userId: ownerId, role: "owner" },
      { roomId: room.id, userId: editorId, role: "editor" },
    ])
    .onConflictDoNothing();
  console.log(`room     ${room.name} (${room.id}) ${inserted.length ? "created" : "exists"}`);
  if (inserted.length) console.log(`invite   ${env.APP_URL}/rooms/${room.id}?invite=${inviteToken}`);
}
console.log(`\nSign in at ${env.APP_URL}/sign-in with any of the emails above.`);
console.log(`Password: ${PASSWORD}`);

await Promise.all([handle.close(), redis.quit()]);
