import type { ObjectStore } from "@codechatter/auth/s3";
import { roomBlobPrefix } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import { DB, OBJECT_STORE } from "../infra/tokens.js";
import { RunnerClient } from "../runner/runner.client.js";

const FIRST_RUN_MS = 30_000;
const EVERY_MS = 6 * 60 * 60_000;

/**
 * Keeps the runner's Docker host and the object store tidy: soon after start
 * and then every six hours, it sends the runner the rooms that exist, and the
 * runner removes the containers, volumes and networks of any others (left by a
 * deletion the runner missed, or a crash). It also deletes the binary files of
 * rooms that are gone. Deleting a room normally cleans up both at once.
 */
@Injectable()
export class RoomJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RoomJanitor.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly runner: RunnerClient,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setTimeout(() => void this.sweep(), FIRST_RUN_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async sweep(): Promise<string[]> {
    try {
      const rooms = await this.handle.db.select({ id: schema.rooms.id }).from(schema.rooms);
      const removed = await this.runner.prune(rooms.map((room) => room.id));
      if (removed.length) this.logger.log(`removed what was left of ${removed.length} deleted rooms: ${removed.join(", ")}`);
      await this.sweepObjects();
      return removed;
    } catch (error) {
      this.logger.warn(`room cleanup didn't run: ${String(error)}`);
      return [];
    } finally {
      this.timer = setTimeout(() => void this.sweep(), EVERY_MS);
    }
  }

  /** Delete the stored binary files of rooms that no longer exist. Returns their room codes. */
  async sweepObjects(): Promise<string[]> {
    if (!this.store) return [];
    try {
      const { prefixes } = await this.store.list("rooms/", "/");
      const seen = prefixes.map((prefix) => /^rooms\/([A-Z0-9]{6})\/$/.exec(prefix)?.[1]).filter((id): id is string => Boolean(id));
      if (!seen.length) return [];
      // Asked now, not with the runner's list above: a room made since then may already have files.
      const live = new Set(
        (await this.handle.db.select({ id: schema.rooms.id }).from(schema.rooms).where(inArray(schema.rooms.id, seen))).map((room) => room.id),
      );
      const gone = seen.filter((id) => !live.has(id));
      let objects = 0;
      for (const id of gone) objects += await this.store.deletePrefix(roomBlobPrefix(id));
      if (gone.length) this.logger.log(`deleted ${objects} stored files of ${gone.length} deleted rooms: ${gone.join(", ")}`);
      return gone;
    } catch (error) {
      this.logger.warn(`stored-file cleanup didn't run: ${String(error)}`);
      return [];
    }
  }
}
