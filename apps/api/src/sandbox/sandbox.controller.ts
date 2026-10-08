import type { AuthSession } from "@codechatter/auth";
import { RoomCode, type SandboxStatus } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { Env } from "../config/env.js";
import { ENV, PREVIEW_HOSTS } from "../infra/tokens.js";
import { createPreviewTicket, type PreviewHosts } from "../preview/preview-proxy.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";

const PreviewInput = z.object({ port: z.number().int().min(1).max(65535) });

/** The room's sandbox: live status (ports, CPU, memory), restart, and preview links. */
@Controller("rooms/:roomId")
export class SandboxController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(PREVIEW_HOSTS) private readonly hosts: PreviewHosts,
  ) {}

  @Get("sandbox")
  async status(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string): Promise<SandboxStatus & { previews: boolean }> {
    const room = this.room(roomId);
    await this.rooms.require(room, session.user.id, "room.view");
    const status = await this.runner.status(room, session.user).catch(() => ({ running: false, ports: [], cpuPercent: null, memory: null, processes: null }));
    return { ...status, previews: this.hosts.enabled };
  }

  /** Restarting ends every run and terminal in the room, so it needs terminal rights. */
  @Post("sandbox/restart")
  @HttpCode(200)
  async restart(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string) {
    const room = this.room(roomId);
    await this.rooms.require(room, session.user.id, "terminal.open");
    await this.runner.restart(room, session.user);
    return { ok: true };
  }

  /** A one-time link that opens a dev server's preview on its own origin. */
  @Post("preview")
  @HttpCode(200)
  async preview(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Body(new ZodPipe(PreviewInput)) input: z.infer<typeof PreviewInput>) {
    const room = this.room(roomId);
    await this.rooms.require(room, session.user.id, "room.view");
    if (!this.hosts.enabled) throw new ServiceUnavailableException("Live preview needs PREVIEW_ORIGIN to be configured.");
    return { url: createPreviewTicket({ env: this.env, hosts: this.hosts }, { roomId: room, port: input.port }, { id: session.user.id, name: session.user.name }) };
  }

  private room(roomId: string): string {
    const parsed = RoomCode.safeParse(roomId);
    if (!parsed.success) throw new BadRequestException("Unknown room.");
    return parsed.data;
  }
}
