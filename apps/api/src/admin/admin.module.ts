/** Wire isolated instance administration and close raw plugin admin HTTP routes before main.ts mounts the auth handler. */
import type { Auth } from "@codechatter/auth";
import { Inject, Module } from "@nestjs/common";

import { AUTH } from "../infra/tokens.js";
import { blockRawAdminHttp } from "./admin-auth-boundary.js";
import { AdminController } from "./admin.controller.js";
import { InstanceAdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";
import { AdminHealthService } from "./admin-health.service.js";

@Module({ controllers: [AdminController], providers: [InstanceAdminGuard, AdminService, AdminHealthService] })
export class AdminModule {
  constructor(@Inject(AUTH) auth: Auth) { blockRawAdminHttp(auth); }
}
