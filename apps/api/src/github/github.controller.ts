import type { AuthSession } from "@codechatter/auth";
import { GithubTokenInput } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Put } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { GithubService } from "./github.service.js";

/** Your GitHub token, for importing private repositories. It's never sent back, only whose it is. */
@Controller("me/github")
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get()
  connection(@CurrentSession() session: AuthSession) {
    return this.github.connection(session.user.id);
  }

  @Put()
  @HttpCode(200)
  save(@CurrentSession() session: AuthSession, @Body(new ZodPipe(GithubTokenInput)) input: GithubTokenInput) {
    return this.github.saveToken(session.user.id, input.token);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentSession() session: AuthSession) {
    await this.github.removeToken(session.user.id);
  }
}
