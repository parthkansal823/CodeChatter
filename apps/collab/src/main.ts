import { createAuth, createOriginPolicy } from "@codechatter/auth";
import { createDb } from "@codechatter/db";
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import { Server } from "@hocuspocus/server";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

import { loadEnv } from "./env.js";
import { accessExtension } from "./extensions/access.js";
import { persistenceExtension } from "./extensions/persistence.js";

/**
 * Real-time document server (Hocuspocus 4). Runs as N instances behind Caddy
 * at /collab; the Redis extension on Valkey keeps replicas in sync (ADR 0005).
 */
const env = loadEnv();
const instance = `collab-${randomUUID().slice(0, 8)}`;
const handle = createDb(env.DATABASE_URL, { max: 10 });
const redis = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 3 });

// Collab only reads sessions; it never sends mail.
const noMail = {
  sendVerificationEmail: async () => {},
  sendPasswordResetEmail: async () => {},
  sendOrgInvitationEmail: async () => {},
};
// LAN devices are trusted in development only (packages/auth/src/origins.ts).
const origins = createOriginPolicy({
  appUrl: env.APP_URL,
  extraOrigins: env.EXTRA_ORIGINS,
  allowPrivateNetwork: env.NODE_ENV !== "production",
});
const auth = createAuth({
  db: handle.db,
  redis,
  mail: noMail,
  appUrl: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  production: env.NODE_ENV === "production",
  origins,
});

const server = new Server({
  name: instance,
  port: env.COLLAB_PORT,
  address: "0.0.0.0",
  quiet: true,
  debounce: 1000,
  maxDebounce: 5000,
  extensions: [
    new RedisExtension({ createClient: () => new Redis(env.VALKEY_URL) }),
    accessExtension({ auth, db: handle.db, origins, serviceSecret: env.SERVICE_SECRET }),
    persistenceExtension(handle, instance),
  ],
});

await server.listen();
console.log(`[collab] ${instance} listening on :${env.COLLAB_PORT}`);

async function shutdown() {
  await server.destroy();
  await Promise.allSettled([handle.close(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
