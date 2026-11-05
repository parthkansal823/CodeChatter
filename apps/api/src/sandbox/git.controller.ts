import type { AuthSession } from "@codechatter/auth";
import { GitRequest, RoomCode, type GitOp, type GitResponse } from "@codechatter/contracts";
import { Body, Controller, HttpCode, Param, Post, ServiceUnavailableException } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";

/** Operations that change the room's files or its history, so they need edit rights too. */
const CHANGES = new Set<GitOp>(["init", "stage", "unstage", "discard", "commit", "checkout"]);

/**
 * Git in the room's sandbox (web: source-control/sandbox-git-section.tsx; runner: git.ts).
 * Git runs in the sandbox, where a repository's own config can run commands, so every
 * request needs Run rights, and changes need edit rights as well. A commit is by the
 * signed-in person: the author comes from the session, never from the browser.
 */
@Controller("rooms/:roomId/git")
export class GitController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
  ) {}

  @Post()
  @HttpCode(200)
  async git(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(GitRequest)) request: GitRequest,
  ): Promise<GitResponse> {
    await this.rooms.require(roomId, session.user.id, "code.run");
    if (CHANGES.has(request.op)) await this.rooms.require(roomId, session.user.id, "files.edit");
    const author = request.op === "commit" ? { name: session.user.name || session.user.email, email: session.user.email } : undefined;
    try {
      return await this.runner.git(roomId, session.user, { request, author });
    } catch (error) {
      if (error instanceof RunnerUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
