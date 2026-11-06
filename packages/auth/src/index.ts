import { schema, type Db } from "@codechatter/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import type { Redis } from "ioredis";

import { uuidv7 } from "./ids.js";
import type { OriginPolicy } from "./origins.js";
import { schemaShapingOptions } from "./options.js";
import { hashPassword, isLegacyHash, verifyPassword } from "./password.js";
import { valkeyStorage } from "./storage.js";

type Organisation = { slug: string; metadata?: unknown };
const isOwner = (role: unknown) => typeof role === "string" && role.split(",").some((value) => value.trim() === "owner");

/** Personal markers and slugs are reserved for ensurePersonalOrg, which writes directly to the database. */
function isPersonal(organisation: Organisation): boolean {
  let metadata = organisation.metadata;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata) as unknown; } catch { metadata = null; }
  }
  return organisation.slug.startsWith("u-") || Boolean(metadata && typeof metadata === "object" && "personal" in metadata && metadata.personal === true);
}

function requireSharedOrganisation(organisation: Organisation): void {
  if (isPersonal(organisation)) throw new APIError("FORBIDDEN", { message: "A personal workspace is just for its owner. Create an organisation to invite people." });
}

function validateOrganisationIdentity(organisation: { slug?: string; metadata?: unknown }): void {
  if (organisation.slug?.toLowerCase().startsWith("u-") || (organisation.metadata && typeof organisation.metadata === "object" && "personal" in organisation.metadata)) {
    throw new APIError("BAD_REQUEST", { message: "That slug or workspace type is reserved for personal workspaces." });
  }
}

/** Serialise membership changes and invitation creation without a schema change or a long-lived database transaction. */
function organisationSafeAdapter(db: Db): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const adapter = drizzleAdapter(db, { provider: "pg", schema })(options);
    const protect = async <T>(data: Parameters<typeof adapter.delete>[0], nextRole: unknown, mutate: (scoped: typeof adapter) => Promise<T>): Promise<T> => db.transaction(async (tx) => {
      const scoped = drizzleAdapter(tx, { provider: "pg", schema })(options);
      const initial = await scoped.findOne<typeof schema.member.$inferSelect>(data);
      if (!initial) return mutate(scoped);
      // The organisation row serialises changes to different owner rows across API instances.
      const [organisation] = await tx.select().from(schema.organization).where(eq(schema.organization.id, initial.organizationId)).for("update");
      const current = await scoped.findOne<typeof schema.member.$inferSelect>(data);
      if (current && isOwner(current.role) && !isOwner(nextRole)) {
        const members = await tx.select({ role: schema.member.role }).from(schema.member).where(eq(schema.member.organizationId, current.organizationId));
        if ((organisation && isPersonal(organisation)) || members.filter((member) => isOwner(member.role)).length <= 1) {
          throw new APIError("BAD_REQUEST", { message: "The last owner cannot leave, be removed or have their role changed. Make someone else an owner first." });
        }
      }
      return mutate(scoped);
    });
    const guarded: typeof adapter = {
      ...adapter,
      create: async <T extends Record<string, unknown>, R = T>(data: Parameters<typeof adapter.create<T, R>>[0]): Promise<R> => {
        if (data.model !== "member" && data.model !== "invitation") return adapter.create<T, R>(data);
        const { organizationId, userId, email } = data.data;
        if (typeof organizationId !== "string" || (data.model === "member" ? typeof userId !== "string" : typeof email !== "string")) {
          throw new APIError("BAD_REQUEST", { message: "Choose a valid organisation and person." });
        }
        return db.transaction(async (tx) => {
          const [organisation] = await tx.select().from(schema.organization).where(eq(schema.organization.id, organizationId)).for("update");
          if (!organisation) throw new APIError("BAD_REQUEST", { message: "That organisation no longer exists." });
          requireSharedOrganisation(organisation);
          const existing = data.model === "member"
            ? await tx.select({ id: schema.member.id }).from(schema.member).where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId as string))).limit(1)
            : await tx.select({ id: schema.member.id }).from(schema.member).innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
              .where(and(eq(schema.member.organizationId, organizationId), eq(schema.user.email, (email as string).toLowerCase()))).limit(1);
          if (existing.length) throw new APIError("BAD_REQUEST", { code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", message: "That person is already a member of this organisation." });
          if (data.model === "invitation") {
            const pending = await tx.select({ id: schema.invitation.id }).from(schema.invitation).where(and(
              eq(schema.invitation.organizationId, organizationId), eq(schema.invitation.email, (email as string).toLowerCase()),
              eq(schema.invitation.status, "pending"), gt(schema.invitation.expiresAt, new Date()),
            )).limit(1);
            if (pending.length) throw new APIError("BAD_REQUEST", { code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION", message: "That person has already been invited to this organisation." });
          }
          return drizzleAdapter(tx, { provider: "pg", schema })(options).create<T, R>(data);
        });
      },
      update: <T>(data: Parameters<typeof adapter.update>[0]) => data.model === "member" && Object.hasOwn(data.update, "role")
        ? protect(data, data.update.role, (scoped) => scoped.update<T>(data)) : adapter.update<T>(data),
      delete: (data) => data.model === "member" ? protect(data, undefined, (scoped) => scoped.delete(data)) : adapter.delete(data),
      // Preserve the configured autocommit fallback, but keep nested plugin operations on the guarded adapter.
      transaction: (callback) => callback(guarded),
    };
    return guarded;
  };
}

export { hashPassword, verifyPassword, isLegacyHash, legacyHashForTests } from "./password.js";
export { uuidv7 } from "./ids.js";
export { createOriginPolicy, type OriginPolicy } from "./origins.js";

export interface AuthMail {
  sendVerificationEmail(to: { email: string; name: string }, url: string): Promise<void>;
  sendPasswordResetEmail(to: { email: string; name: string }, url: string): Promise<void>;
  sendOrgInvitationEmail(input: { email: string; inviterName: string; orgName: string; url: string }): Promise<void>;
}

export interface CreateAuthOptions {
  db: Db;
  redis: Redis;
  mail: AuthMail;
  /** Public origin, e.g. http://localhost:8080 — cookies and callbacks use it. */
  appUrl: string;
  secret: string;
  production: boolean;
  /** Extra browser origins to trust (LAN devices in dev); APP_URL is always trusted. */
  origins?: OriginPolicy;
  /** A session ended, however it ended: whatever is still connected on it should stop. */
  onSessionEnded?: (sessionId: string) => void | Promise<void>;
  oauth?: {
    google?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
  };
}

/** Every user owns exactly one personal organization; rooms always have an org. */
export async function ensurePersonalOrg(db: Db, user: { id: string; name: string }): Promise<string> {
  const slug = `u-${user.id}`;
  const existing = await db.query.organization.findFirst({ where: eq(schema.organization.slug, slug) });
  if (existing) return existing.id;
  const orgId = uuidv7();
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.organization)
      .values({
        id: orgId,
        name: `${user.name || "My"} workspace`,
        slug,
        createdAt: new Date(),
        metadata: JSON.stringify({ personal: true }),
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.member)
      .values({ id: uuidv7(), organizationId: orgId, userId: user.id, role: "owner", createdAt: new Date() })
      .onConflictDoNothing();
  });
  return orgId;
}

/** http://localhost, 127.0.0.1 or [::1]: a secure context to browsers, so Secure cookies work over plain http. */
export function isLoopback(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function createAuth(options: CreateAuthOptions) {
  const { db, redis, mail, appUrl, secret, production, oauth, origins } = options;
  // Production cookies are Secure; over plain http the browser drops them and
  // every sign-in "succeeds" without a session. Refuse to boot instead, unless
  // it's this machine: browsers treat http://localhost as secure and keep the
  // cookies (a local demo, such as the Helm chart's on Docker Desktop).
  if (production && !appUrl.startsWith("https://") && !isLoopback(appUrl)) {
    throw new Error(`APP_URL must start with https:// in production, or be a localhost address (got ${appUrl}).`);
  }
  const shaping = schemaShapingOptions({
    sendInvitationEmail: async (data) => {
      // Resending an existing invitation bypasses beforeCreateInvitation in Better Auth 1.7.
      requireSharedOrganisation(data.organization);
      return mail.sendOrgInvitationEmail({
        email: data.email,
        inviterName: data.inviter.user.name,
        orgName: data.organization.name,
        url: `${appUrl}/invite/${data.id}`,
      });
    },
    organizationHooks: {
      beforeCreateOrganization: async ({ organization }) => { validateOrganisationIdentity(organization); },
      beforeUpdateOrganization: async ({ organization, member }) => {
        const current = await db.query.organization.findFirst({ where: eq(schema.organization.id, member.organizationId) });
        if (current && isPersonal(current) && (organization.slug !== undefined || organization.metadata !== undefined)) {
          throw new APIError("FORBIDDEN", { message: "A personal workspace's slug and type cannot be changed." });
        }
        validateOrganisationIdentity(organization);
      },
      beforeDeleteOrganization: async ({ organization }) => { requireSharedOrganisation(organization); },
      beforeCreateInvitation: async ({ organization }) => { requireSharedOrganisation(organization); },
      beforeAcceptInvitation: async ({ organization, invitation }) => {
        requireSharedOrganisation(organization);
        if (isOwner(invitation.role)) {
          const inviter = await db.query.member.findFirst({ where: and(eq(schema.member.organizationId, organization.id), eq(schema.member.userId, invitation.inviterId)) });
          if (!isOwner(inviter?.role)) throw new APIError("FORBIDDEN", { message: "That owner invitation is no longer valid. Ask an owner to send a new invitation." });
        }
      },
      beforeAddMember: async ({ organization }) => { requireSharedOrganisation(organization); },
      beforeUpdateMemberRole: async ({ organization }) => { requireSharedOrganisation(organization); },
    },
  });

  return betterAuth({
    ...shaping,
    baseURL: appUrl,
    secret,
    trustedOrigins: origins ? (request) => origins.trustedFor(request?.headers.get("origin")) : [appUrl],
    database: organisationSafeAdapter(db),
    secondaryStorage: valkeyStorage(redis),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => mail.sendPasswordResetEmail(user, url),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => mail.sendVerificationEmail(user, url),
    },

    socialProviders: {
      ...(oauth?.google && { google: { ...oauth.google, prompt: "select_account" as const } }),
      ...(oauth?.github && { github: { ...oauth.github, scope: ["read:user", "user:email"] } }),
    },
    account: {
      // v1 auto-linked OAuth accounts by email without checking verification,
      // an account-takeover path. Link only when the provider vouches.
      accountLinking: { enabled: true, trustedProviders: ["google"], allowDifferentEmails: false },
      encryptOAuthTokens: true,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      storeSessionInDatabase: true,
      // Off: a cached session goes on working for up to its age after being signed out, and each
      // check only reads Valkey anyway.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 3600, max: 10 },
        "/forget-password": { window: 600, max: 5 },
        "/send-verification-email": { window: 600, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: "cc",
      useSecureCookies: production,
      database: { generateId: () => uuidv7() },
      // Caddy is the only ingress and overwrites X-Forwarded-For.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalOrg(db, user);
          },
        },
      },
      session: {
        delete: {
          after: async (session) => {
            await options.onSessionEnded?.(session.id);
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The normal hook also protects new invitations; this covers the plugin's resend fast path.
        if (ctx.path !== "/organization/invite-member") return;
        const session = await getSessionFromCtx(ctx);
        if (!session) return;
        const body = ctx.body as { organizationId?: unknown } | undefined;
        const id = typeof body?.organizationId === "string" ? body.organizationId : session.session.activeOrganizationId;
        if (!id) return;
        const membership = await db.query.member.findFirst({ where: and(eq(schema.member.organizationId, id), eq(schema.member.userId, session.user.id)) });
        if (!membership) return;
        const organisation = await db.query.organization.findFirst({ where: eq(schema.organization.id, id) });
        if (organisation) requireSharedOrganisation(organisation);
      }),
      // Upgrade v1 PBKDF2 hashes to argon2id the first time the password is
      // proven correct; the plaintext exists only during this request.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const session = ctx.context.newSession;
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        if (!session || typeof password !== "string") return;
        const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
        const credential = accounts.find((a) => a.providerId === "credential");
        if (credential?.password && isLegacyHash(credential.password)) {
          await ctx.context.internalAdapter.updatePassword(session.user.id, await hashPassword(password));
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
