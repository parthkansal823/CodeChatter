/** Opens a room's connections for its runs (RunnerClient, for a run or a run carrying on), and nothing else. On its own, so the runner's client needn't import the service that uses it. */
import type { ConnectionValue } from "@codechatter/contracts";
import { Inject, Injectable } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { openToken } from "../github/token-box.js";
import { ENV } from "../infra/tokens.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { CONNECTION_PURPOSE, entriesOf, forRun } from "./connections.js";

@Injectable()
export class ConnectionsVault {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: RoomsRepository,
  ) {}

  async forRun(roomId: string): Promise<Record<string, { piece: string; value: ConnectionValue }>> {
    const room = await this.repository.findById(roomId);
    if (!room || room.kind === "interview") return {};
    return forRun(entriesOf(room.settings), (sealed) => openToken(this.env.BETTER_AUTH_SECRET, sealed, CONNECTION_PURPOSE));
  }
}
