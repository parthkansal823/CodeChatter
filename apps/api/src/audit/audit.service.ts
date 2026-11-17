import { isRoomEvent, ROOM_EVENTS_QUEUE, type QueuedRoomEvent } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Request } from "express";
import type { Redis } from "ioredis";

import { DB, VALKEY } from "../infra/tokens.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";

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

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly webhooks: WebhooksService,
    @Optional() @Inject(VALKEY) private readonly redis?: Redis,
  ) {}

  async record(entry: AuditEntry, request?: Request): Promise<void> {
    let written: { id: string; createdAt: Date } | undefined;
    try {
      [written] = await this.handle.db.insert(schema.auditEvents).values({
        ...entry,
        ip: request?.ip ?? null,
        userAgent: request?.get("user-agent")?.slice(0, 300) ?? null,
      }).returning({ id: schema.auditEvents.id, createdAt: schema.auditEvents.createdAt });
    } catch (error) {
      this.logger.error(`audit write failed for ${entry.action}: ${String(error)}`);
      return;
    }
    // The event is recorded either way; a webhook that can't be queued is logged on its own.
    if (!written) return;
    try {
      await this.webhooks.queue({ ...entry, ...written });
    } catch (error) {
      this.logger.error(`webhook queue failed for ${entry.action}: ${String(error)}`);
    }
    // What happens in a room can start its automations (apps/api/src/automations): queued for them, as collab queues files changing.
    if (this.redis && entry.targetType === "room" && entry.targetId && isRoomEvent(entry.action) && entry.action !== "files.changed") {
      const event: QueuedRoomEvent = { room: entry.targetId, event: entry.action, at: written.createdAt.getTime(), by: entry.actorId ? [entry.actorId] : [], data: entry.data ?? {} };
      try {
        await this.redis.rpush(ROOM_EVENTS_QUEUE, JSON.stringify(event));
        await this.redis.ltrim(ROOM_EVENTS_QUEUE, -1000, -1);
      } catch (error) {
        this.logger.error(`room event queue failed for ${entry.action}: ${String(error)}`);
      }
    }
  }
}
