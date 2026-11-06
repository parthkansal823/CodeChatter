import type { AuthSession } from "@codechatter/auth";
import { InterviewId, RECORDING_CLIP_MAX_BYTES, RecordingClipQuery, RoomCode, type InterviewRecordings } from "@codechatter/contracts";
import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { parseRange } from "../blobs/blob-headers.js";
import { readBody } from "../blobs/blobs.controller.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { InterviewRecordingsService } from "./interview-recordings.service.js";

const Id = new ZodPipe(InterviewId);
const ClipId = new ZodPipe(z.uuid());

/**
 * An assessment's webcam and screen recordings. Clips come as the raw body, so no body parser
 * touches them. Watching and deleting them goes in the audit log: who saw someone's recording
 * should never be a question nobody can answer.
 */
@Controller()
export class InterviewRecordingsController {
  constructor(
    private readonly recordings: InterviewRecordingsService,
    private readonly audit: AuditService,
  ) {}

  @Post("rooms/:roomId/interview/recordings")
  @HttpCode(201)
  async upload(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(RecordingClipQuery)) query: z.output<typeof RecordingClipQuery>,
    @Req() request: Request,
  ): Promise<{ id: string }> {
    const { bytes } = await readBody(request, RECORDING_CLIP_MAX_BYTES);
    return this.recordings.saveClip(roomId, session.user.id, query, request.headers["content-type"] ?? "", bytes);
  }

  @Get("interviews/:id/recordings")
  async list(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Req() request: Request): Promise<InterviewRecordings> {
    const { orgId, ...recordings } = await this.recordings.list(id, session.user.id);
    if (recordings.clips.length) await this.audit.record({ orgId, actorId: session.user.id, action: "interview.recording.view", targetType: "interview", targetId: id, data: { clips: recordings.clips.length } }, request);
    return recordings;
  }

  /** Only as itself, never to be run or cached, whatever someone managed to upload. */
  @Get("interviews/:id/recordings/:clipId")
  async clip(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Param("clipId", ClipId) clipId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const { body, contentType } = await this.recordings.clip(id, session.user.id, clipId);
    response.set({
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Accept-Ranges": "bytes",
    });
    const range = parseRange(request.headers.range, body.byteLength);
    if (range === "unsatisfiable") {
      response.status(416).set("Content-Range", `bytes */${body.byteLength}`).end();
      return;
    }
    if (range) {
      response.status(206).set("Content-Range", `bytes ${range.start}-${range.end}/${body.byteLength}`).end(Buffer.from(body.subarray(range.start, range.end + 1)));
      return;
    }
    response.status(200).end(Buffer.from(body));
  }

  @Delete("interviews/:id/recordings")
  async remove(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Req() request: Request): Promise<{ removed: number }> {
    const { orgId, removed } = await this.recordings.removeAll(id, session.user.id);
    await this.audit.record({ orgId, actorId: session.user.id, action: "interview.recording.delete", targetType: "interview", targetId: id, data: { clips: removed } }, request);
    return { removed };
  }
}
