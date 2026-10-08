import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";

import { DB } from "../infra/tokens.js";

export interface AuditEntry {
  orgId: string | null;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only audit trail. Written from day one so the Phase 6 audit viewer
 * has history. A failed audit write is logged, never allowed to fail the
 * user's action.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async record(entry: AuditEntry, request?: Request): Promise<void> {
    try {
      await this.handle.db.insert(schema.auditEvents).values({
        ...entry,
        ip: request?.ip ?? null,
        userAgent: request?.get("user-agent")?.slice(0, 300) ?? null,
      });
    } catch (error) {
      this.logger.error(`audit write failed for ${entry.action}: ${String(error)}`);
    }
  }
}
