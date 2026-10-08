import { schema, type Db } from "@codechatter/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";

import { uuidv7 } from "./ids.js";
import type { OriginPolicy } from "./origins.js";
import { schemaShapingOptions } from "./options.js";
import { hashPassword, isLegacyHash, verifyPassword } from "./password.js";
import { valkeyStorage } from "./storage.js";

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

export function createAuth(options: CreateAuthOptions) {
  const { db, redis, mail, appUrl, secret, production, oauth, origins } = options;
  // Production cookies are Secure; over plain http the browser drops them and
  // every sign-in "succeeds" without a session. Refuse to boot instead.
  if (production && !appUrl.startsWith("https://")) {
    throw new Error(`APP_URL must start with https:// in production (got ${appUrl}).`);
  }
  const shaping = schemaShapingOptions({
    sendInvitationEmail: async (data) =>
      mail.sendOrgInvitationEmail({
        email: data.email,
        inviterName: data.inviter.user.name,
        orgName: data.organization.name,
        url: `${appUrl}/invite/${data.id}`,
      }),
  });

  return betterAuth({
    ...shaping,
    baseURL: appUrl,
    secret,
    trustedOrigins: origins ? (request) => origins.trustedFor(request?.headers.get("origin")) : [appUrl],
    database: drizzleAdapter(db, { provider: "pg", schema }),
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
      cookieCache: { enabled: true, maxAge: 60 },
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
    },

    hooks: {
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
