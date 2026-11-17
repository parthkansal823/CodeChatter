/** Expose only guarded, bounded instance metadata and confirmed-user actions; organisation roles never authorise this controller. */
import type { AuthSession } from "@codechatter/auth";
import { AdminBanInput, AdminPageQuery, AdminRoleInput, type AdminAccess } from "@codechatter/contracts";
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AdminHealthService } from "./admin-health.service.js";
import { InstanceAdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

const UserId = z.string().min(1).max(128);
const Empty = z.strictObject({});

@Controller("admin")
@Public()
@UseGuards(InstanceAdminGuard)
export class AdminController {
  constructor(private readonly service: AdminService, private readonly health: AdminHealthService) {}

  @Get("access") @Header("Cache-Control", "private, no-store")
  access(@CurrentSession() session: AuthSession): AdminAccess { return { userId: session.user.id, role: "admin" }; }

  @Get("users") @Header("Cache-Control", "private, no-store")
  users(@Query(new ZodPipe(AdminPageQuery)) query: AdminPageQuery) { return this.service.users(query); }

  @Get("rooms") @Header("Cache-Control", "private, no-store")
  rooms(@CurrentSession() session: AuthSession, @Query(new ZodPipe(AdminPageQuery)) query: AdminPageQuery) { return this.service.rooms(query, session.user.id); }

  @Get("health") @Header("Cache-Control", "private, no-store")
  checks() { return this.health.read(); }

  @Post("users/:id/ban") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  ban(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(UserId)) id: string, @Body(new ZodPipe(AdminBanInput)) input: AdminBanInput, @Req() request: Request) { return this.service.change(session.user.id, id, { kind: "ban", reason: input.reason, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }, request); }

  @Post("users/:id/unban") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  unban(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(UserId)) id: string, @Body(new ZodPipe(Empty)) _input: unknown, @Req() request: Request) { return this.service.change(session.user.id, id, { kind: "unban" }, request); }

  @Post("users/:id/sessions/revoke") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  revoke(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(UserId)) id: string, @Body(new ZodPipe(Empty)) _input: unknown, @Req() request: Request) { return this.service.change(session.user.id, id, { kind: "sessions" }, request); }

  @Post("users/:id/role") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  role(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(UserId)) id: string, @Body(new ZodPipe(AdminRoleInput)) input: AdminRoleInput, @Req() request: Request) { return this.service.change(session.user.id, id, { kind: "role", role: input.role }, request); }
}
