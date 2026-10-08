import type { SecondaryStorage } from "better-auth";
import type { Redis } from "ioredis";

/**
 * Better Auth secondary storage on Valkey: session cache and rate-limit
 * counters shared by every API and collab instance (v1's limiter was
 * per-process and trivially bypassed).
 */
export function valkeyStorage(redis: Redis, prefix = "ba:"): SecondaryStorage {
  const k = (key: string) => prefix + key;
  return {
    get: (key) => redis.get(k(key)),
    getAndDelete: (key) => redis.getdel(k(key)),
    increment: async (key, ttl) => {
      const [[, count]] = (await redis.multi().incr(k(key)).expire(k(key), ttl, "NX").exec()) as [[null, number]];
      return count;
    },
    set: async (key, value, ttl) => {
      if (ttl) await redis.set(k(key), value, "EX", ttl);
      else await redis.set(k(key), value);
    },
    delete: async (key) => {
      await redis.del(k(key));
    },
  };
}
