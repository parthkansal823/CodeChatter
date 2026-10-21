import type { AuthSession } from "@codechatter/auth";
import { KubeRequest, RoomCode } from "@codechatter/contracts";
import { Body, Controller, HttpCode, Param, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

/** Requests that change the cluster, kept in the audit log. */
const CHANGES = new Set(["up", "down", "apply", "delete"]);

/**
 * The room's Kubernetes panel (web: tools/kubernetes): kubectl against the playground in
 * the room's sandbox. Using the cluster is running code there, so it needs Run rights.
 */
@Controller("rooms/:roomId/kube")
export class KubernetesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  async kube(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(KubeRequest)) input: KubeRequest,
    @Req() request: Request,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "code.run");
    try {
      const answer = await this.runner.kube(roomId, session.user, input);
      if (CHANGES.has(input.op)) {
        const target = "ref" in input ? `${input.ref.kind}/${input.ref.name}` : undefined;
        await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: `kube.${input.op}`, targetType: "room", targetId: roomId, data: target ? { target } : {} }, request);
      }
      return answer;
    } catch (error) {
      if (error instanceof RunnerUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
