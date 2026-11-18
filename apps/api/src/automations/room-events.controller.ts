/**
 * The API's side of what a room's sandbox asks for itself, through the runner (its token says which room; no session):
 * - room events the runner sees for automations: commits made in the sandbox, read from its git's reflog by the agent (sandbox/agent/src/git-log.ts),
 *   queued like the rest (room-activity.ts);
 * - a message in the room's chat from a flow's "Post to the room's chat" step (sandbox/image/automation/builtins.mjs), which reaches here through the
 *   agent's gateway door and the runner (apps/runner/src/gateway.ts). It's marked as the automations', never as a person's.
 */
import { verifyServiceToken } from "@codechatter/auth/service-token";
import { RoomCode, type GitEventData, type RoomEventPerson } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";

import { RateLimiter } from "../ai/rate-limit.js";
import { Public } from "../auth/public.decorator.js";
import type { Env } from "../config/env.js";
import { ENV, VALKEY } from "../infra/tokens.js";
import { MessagesService } from "../messages/messages.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
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
const ChatPost = z.object({ text: z.string().trim().min(1, "Say something to post.").max(4000, "A message is up to 4,000 characters.") });

@Public()
@Controller("internal/automations")
export class RoomEventsController {
  /** A room's code can't flood its chat: 20 messages a minute. */
  private readonly chatLimiter: RateLimiter;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly redis: Redis,
    private readonly rooms: RoomsRepository,
    private readonly messages: MessagesService,
    private readonly gateway: EventsGateway,
  ) {
    this.chatLimiter = new RateLimiter(redis, { limit: 20, windowSeconds: 60, prefix: "automations:chat-post" });
  }

  /** Which room asked: the runner's token says, never anything the sandbox sent. */
  private roomOf(req: Request): string {
    const claims = verifyServiceToken(this.env.SERVICE_SECRET, req.headers.authorization?.replace(/^Bearer /, ""), "api");
    if (!claims) throw new UnauthorizedException("This address is only for CodeChatter's own services.");
    const room = RoomCode.safeParse(claims.sub);
    if (!room.success) throw new BadRequestException("That isn't a room.");
    return room.data;
  }

  @Post("chat")
  async chat(@Req() req: Request, @Body() body: unknown): Promise<{ id: string; createdAt: string }> {
    const roomId = this.roomOf(req);
    const input = ChatPost.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.issues[0]?.message ?? "Say something to post.");
    const room = await this.rooms.findById(roomId);
    if (!room) throw new NotFoundException("This room doesn't exist any more.");
    if (room.kind === "interview") throw new ForbiddenException("Automations can't post in an interview's chat.");
    const decision = await this.chatLimiter.hit(roomId);
    if (!decision.allowed) throw new HttpException(`This room's automations have posted 20 messages in a minute. Try again in ${decision.retryAfterSeconds} seconds.`, HttpStatus.TOO_MANY_REQUESTS);
    const message = await this.messages.post(roomId, "automation", input.data.text);
    this.gateway.postToChat(roomId, message);
    return { id: message.id, createdAt: message.createdAt };
  }

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
