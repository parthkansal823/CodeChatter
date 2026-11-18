/**
 * Room events the runner sees for automations: commits made in a room's sandbox, read from its git's reflog by the agent (sandbox/agent/src/git-log.ts).
 * The runner's token says which room; no session. They're queued like the rest (room-activity.ts).
 */
import { verifyServiceToken } from "@codechatter/auth/service-token";
import { RoomCode, type GitEventData, type RoomEventPerson } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";

import { Public } from "../auth/public.decorator.js";
import type { Env } from "../config/env.js";
import { ENV, VALKEY } from "../infra/tokens.js";
import { queueRoomEvent } from "./room-activity.js";

const Sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const SandboxCommits = z.object({
  event: z.literal("git.commit"),
  branch: z.string().max(250).nullable(),
  commits: z
    .array(
      z.object({
        commit: Sha,
        parent: Sha.nullable(),
        kind: z.enum(["commit", "initial", "amend", "merge", "cherry-pick", "revert"]),
        message: z.string().max(2000),
        author: z.object({ name: z.string().max(200), email: z.string().max(320) }),
        at: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(20),
});

@Public()
@Controller("internal/automations")
export class RoomEventsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly redis: Redis,
  ) {}

  @Post("events")
  @HttpCode(204)
  async event(@Req() req: Request, @Body() body: unknown): Promise<void> {
    const claims = verifyServiceToken(this.env.SERVICE_SECRET, req.headers.authorization?.replace(/^Bearer /, ""), "api");
    if (!claims) throw new UnauthorizedException("This address is only for CodeChatter's own services.");
    const room = RoomCode.safeParse(claims.sub);
    const input = SandboxCommits.safeParse(body);
    if (!room.success || !input.success) throw new BadRequestException("That isn't a room event.");
    // Who git says made them: a name and an email, not an account.
    const by: RoomEventPerson[] = [...new Set(input.data.commits.map((each) => each.author.name || each.author.email))].map((name) => ({ id: null, name }));
    const data: GitEventData = { branch: input.data.branch, commits: input.data.commits };
    await queueRoomEvent(this.redis, { room: room.data, event: "git.commit", at: Date.now(), by, data });
  }
}
