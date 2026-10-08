import type { DbHandle } from "@codechatter/db";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Redis } from "ioredis";

import { Public } from "../auth/public.decorator.js";
import { DB, VALKEY } from "../infra/tokens.js";

@Controller()
@Public()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(VALKEY) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. Never touches dependencies (v1 pinged Atlas here). */
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  /** Readiness: dependencies answer. Load balancers stop routing here on failure. */
  @Get("readyz")
  async readyz() {
    const [database, valkey] = await Promise.allSettled([this.db.sql`select 1`, this.redis.ping()]);
    const checks = { database: database.status === "fulfilled", valkey: valkey.status === "fulfilled" };
    if (!checks.database || !checks.valkey) throw new ServiceUnavailableException({ message: "Not ready", errors: checks });
    return { status: "ready", checks };
  }
}
