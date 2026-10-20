import type { AuthSession } from "@codechatter/auth";
import { INSTALLS_MINUTES, RoomCode, type DevServerStatus, type SandboxStatus } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { Env } from "../config/env.js";
import { ENV, PREVIEW_HOSTS } from "../infra/tokens.js";
import { createPreviewTicket, type PreviewHosts } from "../preview/preview-proxy.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

const PreviewInput = z.object({ port: z.number().int().min(1).max(65535) });
const FormatInput = z.object({
  path: z.string().min(1).max(1024),
  language: z.enum(["python", "c", "cpp", "shell", "go", "rust"]),
  // The API takes JSON bodies up to 1 MB; the editor sends files up to 512 KB.
  text: z.string().max(600_000),
  tabSize: z.number().int().min(1).max(8),
  insertSpaces: z.boolean(),
});

/** The room's sandbox: live status (ports, CPU, memory), restart, package installs, and preview links. */
@Controller("rooms/:roomId")
export class SandboxController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PREVIEW_HOSTS) private readonly hosts: PreviewHosts,
  ) {}

  @Get("sandbox")
  async status(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string): Promise<SandboxStatus & { previews: boolean }> {
    const room = this.room(roomId);
    await this.rooms.require(room, session.user.id, "room.view");
    const status = await this.runner
      .status(room, session.user)
      .catch((): SandboxStatus => ({ running: false, ports: [], cpuPercent: null, memory: null, processes: null, installs: null }));
    return { ...status, previews: this.hosts.enabled };
  }

  /**
   * Package installs (ADR 0007): the owner lets the sandbox reach package
   * registries, and nothing else, for an hour. Recorded in the audit log.
   */
  @Put("sandbox/installs")
  async allowInstalls(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Req() request: Request) {
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "sandbox.network");
    const installs = await this.runner.allowInstalls(room.id, session.user, INSTALLS_MINUTES);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "sandbox.installs.allow", targetType: "room", targetId: room.id, data: installs }, request);
    return installs;
  }

  @Delete("sandbox/installs")
  @HttpCode(200)
  async stopInstalls(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Req() request: Request) {
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "sandbox.network");
    await this.runner.stopInstalls(room.id, session.user);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "sandbox.installs.stop", targetType: "room", targetId: room.id }, request);
    return { ok: true };
  }

  /** The dev server from .codechatter/room.json (apps/runner/src/dev-server.ts): its settings and whether it runs. */
  @Get("dev")
  async devStatus(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string): Promise<DevServerStatus> {
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "room.view");
    return this.runner.dev(room.id, session.user, "GET");
  }

  /**
   * Start (or restart) it, in a terminal everyone in the room can watch. It
   * runs commands from a file anyone with edit rights can change, so it needs
   * terminal rights, like a terminal.
   */
  @Post("dev")
  @HttpCode(200)
  async startDev(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Req() request: Request): Promise<DevServerStatus> {
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    const status = await this.runner.dev(room.id, session.user, "POST");
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "dev.start", targetType: "room", targetId: room.id }, request);
    return status;
  }

  @Delete("dev")
  @HttpCode(200)
  async stopDev(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Req() request: Request): Promise<DevServerStatus> {
    const { room } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    const status = await this.runner.dev(room.id, session.user, "DELETE");
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "dev.stop", targetType: "room", targetId: room.id }, request);
    return status;
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

  /**
   * Format document for languages the browser can't format (apps/runner/src/format.ts).
   * The formatter runs in the sandbox, and its result changes the file, so it needs edit rights.
   */
  @Post("format")
  @HttpCode(200)
  async format(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Body(new ZodPipe(FormatInput)) input: z.infer<typeof FormatInput>) {
    const room = this.room(roomId);
    await this.rooms.require(room, session.user.id, "files.edit");
    try {
      return await this.runner.format(room, session.user, input);
    } catch (error) {
      if (error instanceof RunnerUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
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
