import { RoomCode } from "@codechatter/contracts";
import { Controller, Headers, HttpCode, Logger, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

import { Public } from "../auth/public.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { MessagesService } from "../messages/messages.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { SourceControlService } from "./source-control.service.js";
import { signatureOk, webhookMessage } from "./webhook-messages.js";

/**
 * Where GitHub delivers a room's webhook (made from the Source Control view). No session:
 * a delivery counts only when it's signed with the room's secret and is about the room's
 * repository. What it says goes to the room's chat as a message from GitHub.
 */
@Controller("github/webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly sourceControl: SourceControlService,
    private readonly messages: MessagesService,
    private readonly gateway: EventsGateway,
  ) {}

  @Public()
  @Post(":roomId")
  @HttpCode(204)
  async deliver(
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Headers("x-github-event") event: string | undefined,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ): Promise<void> {
    const target = await this.sourceControl.webhookTarget(roomId);
    if (!target) throw new NotFoundException("This room doesn't take GitHub deliveries.");
    if (!request.rawBody || !signatureOk(target.secret, request.rawBody, signature)) throw new UnauthorizedException("The delivery isn't signed with this room's secret.");
    const payload = request.body as Parameters<typeof webhookMessage>[1];
    // A webhook moved to another repository speaks for that one, not the room's.
    if (payload.repository?.full_name?.toLowerCase() !== target.repo.toLowerCase()) return;
    const text = webhookMessage(event ?? "", payload);
    if (!text) return;
    const message = await this.messages.post(roomId, "github", text);
    this.gateway.postToChat(roomId, message);
    this.logger.debug(`github ${event} → room ${roomId}`);
  }
}
