/** A room's call on LiveKit: tokens to join it, and taking out whoever may no longer be in it. */
import type { CallJoin, RoomAccessChange } from "@codechatter/contracts";
import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { livekitAdminToken, livekitToken } from "./livekit-token.js";

/** The dev stack's LiveKit (infra/livekit/livekit.dev.yaml), used when .env names none outside production. */
const DEV_KEY = "codechatter-dev";
const DEV_SECRET = "codechatter-dev-livekit-secret-not-for-production";
/**
 * LiveKit checks a token only when someone connects, and hands connected people fresh ones to
 * reconnect with. So it only has to last until the browser connects, and a person who's been
 * removed can't come back with an old one after that.
 */
const JOIN_TOKEN_SECONDS = 10 * 60;
const callName = (roomId: string) => `room-${roomId}`;

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private readonly config: { url: string; key: string; secret: string } | null;

  constructor(
    @Inject(ENV) env: Env,
    private readonly rooms: RoomsService,
  ) {
    const dev = env.NODE_ENV !== "production";
    const url = env.LIVEKIT_URL || (dev ? `${env.APP_URL.replace(/^http/, "ws")}/livekit` : "");
    const key = env.LIVEKIT_API_KEY || (dev ? DEV_KEY : "");
    const secret = env.LIVEKIT_API_SECRET || (dev ? DEV_SECRET : "");
    this.config = url && key && secret ? { url, key, secret } : null;
  }

  join(roomId: string, user: { id: string; name: string }): CallJoin {
    if (!this.config) throw new ServiceUnavailableException("Calls aren't set up on this server (LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET).");
    const room = callName(roomId);
    const token = livekitToken({
      apiKey: this.config.key,
      apiSecret: this.config.secret,
      identity: user.id,
      name: user.name,
      room,
      canPublish: true,
      ttlSeconds: JOIN_TOKEN_SECONDS,
    });
    return { url: this.config.url, token, room };
  }

  /** Whoever's in the call and may no longer talk in the room leaves it (joining takes `room.chat`). */
  async recheck({ roomId, userId }: RoomAccessChange): Promise<void> {
    if (!this.config) return;
    const people = userId ? [userId] : await this.participants(roomId);
    await Promise.all(
      people.map(async (identity) => {
        const allowed = await this.rooms.require(roomId, identity, "room.chat").then(
          () => true,
          () => false,
        );
        if (!allowed) await this.twirp(roomId, "RemoveParticipant", { room: callName(roomId), identity });
      }),
    );
  }

  private async participants(roomId: string): Promise<string[]> {
    const answer = (await this.twirp(roomId, "ListParticipants", { room: callName(roomId) })) as { participants?: Array<{ identity: string }> } | null;
    return (answer?.participants ?? []).map((participant) => participant.identity);
  }

  /** LiveKit's server API. Null when there's no such call, or no such person in it. */
  private async twirp(roomId: string, method: string, body: object): Promise<unknown> {
    const { url, key, secret } = this.config!;
    const response = await fetch(`${url.replace(/^ws/, "http").replace(/\/$/, "")}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${livekitAdminToken({ apiKey: key, apiSecret: secret, room: callName(roomId) })}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      this.logger.warn(`LiveKit ${method} answered ${response.status}`);
      return null;
    }
    return response.json();
  }
}
