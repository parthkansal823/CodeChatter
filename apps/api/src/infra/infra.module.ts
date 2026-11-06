import { createAuth, createOriginPolicy, type Auth, type OriginPolicy } from "@codechatter/auth";
import { SESSION_ENDED_CHANNEL } from "@codechatter/contracts";
import { objectStoreFromEnv, type ObjectStore } from "@codechatter/auth/s3";
import { createDb, type DbHandle } from "@codechatter/db";
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import { loadEnv, type Env } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { PreviewHosts } from "../preview/preview-proxy.js";
import { AUTH, DB, ENV, OBJECT_STORE, ORIGINS, PREVIEW_HOSTS, VALKEY } from "./tokens.js";

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: DB, inject: [ENV], useFactory: (env: Env) => createDb(env.DATABASE_URL) },
    {
      provide: VALKEY,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 3 }),
    },
    MailService,
    { provide: PREVIEW_HOSTS, inject: [ENV], useFactory: (env: Env) => new PreviewHosts(env.PREVIEW_ORIGIN) },
    { provide: OBJECT_STORE, inject: [ENV], useFactory: (env: Env): ObjectStore | null => objectStoreFromEnv(env) },
    {
      provide: ORIGINS,
      inject: [ENV],
      // LAN devices are trusted in development only (see packages/auth/src/origins.ts).
      useFactory: (env: Env): OriginPolicy =>
        createOriginPolicy({ appUrl: env.APP_URL, extraOrigins: env.EXTRA_ORIGINS, allowPrivateNetwork: env.NODE_ENV !== "production" }),
    },
    {
      provide: AUTH,
      inject: [ENV, DB, VALKEY, MailService, ORIGINS],
      useFactory: (env: Env, db: DbHandle, redis: Redis, mail: MailService, origins: OriginPolicy): Auth =>
        createAuth({
          db: db.db,
          redis,
          mail,
          appUrl: env.APP_URL,
          secret: env.BETTER_AUTH_SECRET,
          production: env.NODE_ENV === "production",
          origins,
          // Sockets check once, when they connect. Better to leave one open than to fail a sign-out.
          onSessionEnded: async (sessionId) => {
            await redis.publish(SESSION_ENDED_CHANNEL, sessionId).catch((error: unknown) => console.warn(`session ended: ${String(error)}`));
          },
          oauth: {
            ...(env.GOOGLE_CLIENT_ID && {
              google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
            }),
            ...(env.GITHUB_CLIENT_ID && {
              github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
            }),
          },
        }),
    },
  ],
  exports: [ENV, DB, VALKEY, AUTH, ORIGINS, PREVIEW_HOSTS, OBJECT_STORE, MailService],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(VALKEY) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.db.close(), this.redis.quit()]);
  }
}
