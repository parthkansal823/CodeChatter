import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { DB } from "../infra/tokens.js";
import { RunnerClient } from "../runner/runner.client.js";

const FIRST_RUN_MS = 30_000;
const EVERY_MS = 6 * 60 * 60_000;

/**
 * Keeps the runner's Docker host tidy: soon after start and then every six
 * hours, it sends the runner the rooms that exist, and the runner removes the
 * containers, volumes and networks of any others (left by a deletion the
 * runner missed, or a crash). Deleting a room normally cleans up at once.
 */
@Injectable()
export class RoomJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RoomJanitor.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly runner: RunnerClient,
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
      return removed;
    } catch (error) {
      this.logger.warn(`room cleanup didn't run: ${String(error)}`);
      return [];
    } finally {
      this.timer = setTimeout(() => void this.sweep(), EVERY_MS);
    }
  }
}
