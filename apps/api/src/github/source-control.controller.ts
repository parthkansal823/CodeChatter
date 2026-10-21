import type { AuthSession } from "@codechatter/auth";
import { CommitInput, GistInput, OpenPullInput, PublishInput, PullCommentInput, PullInput, RoomCode } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { GithubService } from "./github.service.js";
import { SourceControlService } from "./source-control.service.js";

const PullNumber = z.coerce.number().int().positive().max(10_000_000);

/**
 * A room's GitHub repository (web: the Source Control view). Anyone in the room can see
 * it and its changes; committing and pulling change the files, so they need edit rights,
 * and a commit is made with the committer's own GitHub token.
 */
@Controller("rooms/:roomId/repo")
export class SourceControlController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly sourceControl: SourceControlService,
    private readonly github: GithubService,
    private readonly audit: AuditService,
  ) {}

  /** Publish the room as a new repository of yours (for a room not on GitHub yet), then link the room to it. */
  @Post("publish")
  async publish(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(PublishInput)) input: PublishInput,
    @Req() request: Request,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "room.manage");
    const result = await this.sourceControl.publish(roomId, session.user.id, input);
    await this.audit.record(
      { orgId: room.orgId, actorId: session.user.id, action: "repo.publish", targetType: "room", targetId: roomId, data: { repo: result.repo, private: input.private, files: input.files.length } },
      request,
    );
    return result;
  }

  /** One of the room's files as a gist of yours: anyone who can read the room can share what they read. */
  @Post("gist")
  async gist(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(GistInput)) input: GistInput) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return { url: await this.github.gist(session.user.id, input) };
  }

  @Get()
  async info(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.sourceControl.info(roomId, session.user.id);
  }

  /** The base's files, [{ path, content }], gzipped as stored; x-repo-commit says which commit they are. */
  @Get("files")
  async files(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Res() response: Response) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    const { commit, gzipped } = await this.sourceControl.files(roomId);
    response
      .set({ "content-type": "application/json", "content-encoding": "gzip", "x-repo-commit": commit, "cache-control": "private, no-cache" })
      .end(Buffer.from(gzipped));
  }

  @Get("branches")
  async branches(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return { branches: await this.sourceControl.branches(roomId, session.user.id) };
  }

  @Post("commit")
  @HttpCode(200)
  async commit(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(CommitInput)) input: CommitInput,
    @Req() request: Request,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "files.edit");
    const result = await this.sourceControl.commit(roomId, session.user.id, input);
    await this.audit.record(
      { orgId: room.orgId, actorId: session.user.id, action: "repo.commit", targetType: "room", targetId: roomId, data: { ...result, files: input.changes.length } },
      request,
    );
    return result;
  }

  @Get("pulls")
  async pulls(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return { pulls: await this.sourceControl.pullRequests(roomId, session.user.id) };
  }

  @Get("pulls/:number")
  async pullRequest(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("number", new ZodPipe(PullNumber)) number: number,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.view");
    return this.sourceControl.pullRequest(roomId, session.user.id, number);
  }

  /** Open a pull request from the room's branch, with your token. */
  @Post("pulls")
  async openPull(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(OpenPullInput)) input: OpenPullInput,
    @Req() request: Request,
  ) {
    const { room } = await this.rooms.require(roomId, session.user.id, "files.edit");
    const pull = await this.sourceControl.openPull(roomId, session.user.id, input);
    await this.audit.record(
      { orgId: room.orgId, actorId: session.user.id, action: "repo.pull-request", targetType: "room", targetId: roomId, data: { number: pull.number, url: pull.url } },
      request,
    );
    return pull;
  }

  /** A review comment, posted to GitHub with your token: anyone who can talk in the room can review. */
  @Post("pulls/:number/comments")
  async comment(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("number", new ZodPipe(PullNumber)) number: number,
    @Body(new ZodPipe(PullCommentInput)) input: PullCommentInput,
  ) {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    return this.sourceControl.commentOnPull(roomId, session.user.id, number, input);
  }

  /** Post the repository's pushes, pull requests and Actions results to the room's chat. */
  @Post("webhook")
  @HttpCode(200)
  async connectWebhook(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.manage");
    return this.sourceControl.connectWebhook(roomId, session.user.id);
  }

  @Delete("webhook")
  @HttpCode(204)
  async disconnectWebhook(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string) {
    await this.rooms.require(roomId, session.user.id, "room.manage");
    await this.sourceControl.disconnectWebhook(roomId, session.user.id);
  }

  @Post("pull")
  @HttpCode(200)
  async pull(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(PullInput)) input: PullInput) {
    await this.rooms.require(roomId, session.user.id, "files.edit");
    return this.sourceControl.pull(roomId, session.user.id, input);
  }
}
