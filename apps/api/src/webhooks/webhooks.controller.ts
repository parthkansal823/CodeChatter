/** Signed-in organisation admins manage outgoing endpoints and inspect delivery history here. */
import type { AuthSession } from "@codechatter/auth";
import { WebhookInput, WebhookPatch } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { WebhooksService } from "./webhooks.service.js";

const OrgId = z.string().trim().min(1).max(128);
const Id = z.uuid();
const DeliveryQuery = z.strictObject({ before: Id.optional() });

@Controller("orgs/:orgId/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string) {
    return this.webhooks.list(orgId, session.user.id);
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  create(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string, @Body(new ZodPipe(WebhookInput)) input: WebhookInput) {
    return this.webhooks.create(orgId, session.user.id, input);
  }

  @Patch(":id")
  @Header("Cache-Control", "private, no-store")
  update(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Param("id", new ZodPipe(Id)) id: string, @Body(new ZodPipe(WebhookPatch)) input: WebhookPatch) {
    return this.webhooks.update(orgId, session.user.id, id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @Header("Cache-Control", "private, no-store")
  remove(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string, @Param("id", new ZodPipe(Id)) id: string) {
    return this.webhooks.remove(orgId, session.user.id, id);
  }

  @Post(":id/rotate-secret")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  rotate(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string, @Param("id", new ZodPipe(Id)) id: string) {
    return this.webhooks.rotateSecret(orgId, session.user.id, id);
  }

  @Post(":id/test")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  test(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string, @Param("id", new ZodPipe(Id)) id: string) {
    return this.webhooks.test(orgId, session.user.id, id);
  }

  @Get(":id/deliveries")
  @Header("Cache-Control", "private, no-store")
  deliveries(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Param("id", new ZodPipe(Id)) id: string, @Query(new ZodPipe(DeliveryQuery)) query: z.infer<typeof DeliveryQuery>) {
    return this.webhooks.deliveries(orgId, session.user.id, id, query.before);
  }

  @Post(":id/deliveries/:deliveryId/redeliver")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  redeliver(@CurrentSession() session: AuthSession, @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Param("id", new ZodPipe(Id)) id: string, @Param("deliveryId", new ZodPipe(Id)) deliveryId: string) {
    return this.webhooks.redeliver(orgId, session.user.id, id, deliveryId);
  }
}
