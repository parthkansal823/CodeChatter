import type { AuthSession } from "@codechatter/auth";
import { RoomCode, type CallJoin } from "@codechatter/contracts";
import { Controller, HttpCode, Inject, Param, Post, ServiceUnavailableException } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { livekitToken } from "./livekit-token.js";

/** The dev stack's LiveKit (infra/livekit/livekit.dev.yaml), used when .env names none outside production. */
const DEV_KEY = "codechatter-dev";
const DEV_SECRET = "codechatter-dev-livekit-secret-not-for-production";

/**
 * A room's call (video, voice, screen share), on LiveKit: the address and a token to join
 * it with. Anyone who can talk in the room can join and send their camera, microphone and
 * screen; the token lasts six hours and is for this room's call only.
 */
@Controller("rooms/:roomId/call")
export class CallsController {
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

  @Post()
  @HttpCode(200)
  async join(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<CallJoin> {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    if (!this.config) throw new ServiceUnavailableException("Calls aren't set up on this server (LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET).");
    const room = `room-${roomId}`;
    const token = livekitToken({
      apiKey: this.config.key,
      apiSecret: this.config.secret,
      identity: session.user.id,
      name: session.user.name,
      room,
      canPublish: true,
    });
    return { url: this.config.url, token, room };
  }
}
