/** Authorize room access before checking browser-parsed package coordinates against OSV. */
import type { AuthSession } from "@codechatter/auth";
import { DependencyCheckInput, RoomCode, type DependencyCheckResponse } from "@codechatter/contracts";
import { Body, Controller, Header, HttpCode, Param, Post } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { DependenciesService } from "./dependencies.service.js";

@Controller("rooms/:roomId/dependencies")
export class DependenciesController {
  constructor(private readonly rooms: RoomsService, private readonly dependencies: DependenciesService) {}

  @Post("check")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  async check(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(DependencyCheckInput)) input: DependencyCheckInput,
  ): Promise<DependencyCheckResponse> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.dependencies.check(input.packages);
  }
}
