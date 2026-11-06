/**
 * An assessment's recordings: taking clips from the candidate's page, keeping them from anyone
 * but interviewers, and deleting them on time. They're among the most personal things this
 * app holds, so each rule here is about what they can't be used for.
 */
import type { ObjectStore } from "@codechatter/auth/s3";
import { RECORDING_SITTING_MAX_BYTES, roomBlobPrefix, type InterviewRecordings, type RecordingStream } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Env } from "../config/env.js";
import { DB, ENV, OBJECT_STORE } from "../infra/tokens.js";
import { InterviewsService } from "./interviews.service.js";

const CLEANUP_MS = 60 * 60_000;
const CLEANUP_BATCH = 500;
const CLEANUP_BUDGET_MS = 20_000;
/** The last clip is sent as it ends, so it can arrive just after. */
const LAST_CLIP_GRACE_MS = 2 * 60_000;
const VIDEO_TYPES = new Set(["video/webm", "video/mp4"]);

/** Whether these bytes really start like the video they say they are. Whatever's stored here gets played in someone's browser. */
export function looksLikeVideo(type: string, bytes: Uint8Array): boolean {
  if (type === "video/webm") return bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (type === "video/mp4") return bytes.length > 8 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
  return false;
}

@Injectable()
export class InterviewRecordingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterviewRecordingsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    private readonly interviews: InterviewsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup().catch((error: unknown) => this.logger.warn(`recording cleanup: ${String(error)}`)), CLEANUP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get db() {
    return this.handle.db;
  }

  private requireStore(): ObjectStore {
    if (!this.store) throw new ServiceUnavailableException("Recording needs file storage, which isn't set up on this server.");
    return this.store;
  }

  /** One clip from the candidate's own page, while their sitting runs and only for what they agreed to. */
  async saveClip(roomId: string, userId: string, input: { stream: RecordingStream; startedAt: string; durationMs: number }, contentType: string, bytes: Buffer): Promise<{ id: string }> {
    const store = this.requireStore();
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (!row) throw new NotFoundException("This room isn't an interview.");
    if (row.candidateUserId !== userId) throw new ForbiddenException("Only the candidate's page sends this.");
    if (!row.recordingConsentAt) throw new ConflictException("Nobody has agreed to being recorded here.");
    if (!(input.stream === "webcam" ? row.recordWebcam : row.recordScreen)) throw new ConflictException("This assessment doesn't record that.");
    const now = Date.now();
    const running = row.status === "live" || (row.status === "finished" && row.finishedAt !== null && now - row.finishedAt.getTime() < LAST_CLIP_GRACE_MS);
    if (!running) throw new ConflictException("This assessment isn't running.");

    const type = contentType.toLowerCase().split(";")[0]!.trim();
    if (!VIDEO_TYPES.has(type) || !looksLikeVideo(type, bytes)) throw new BadRequestException("That isn't a video clip.");
    const [held] = await this.db.select({ bytes: sql<string>`coalesce(sum(${schema.interviewRecordings.bytes}), 0)` }).from(schema.interviewRecordings).where(eq(schema.interviewRecordings.interviewId, row.id));
    if (Number(held?.bytes ?? 0) + bytes.byteLength > RECORDING_SITTING_MAX_BYTES) throw new PayloadTooLargeException("This assessment's recording is as long as it can be.");

    // The page's clock could say anything: keep it inside the sitting.
    const started = new Date(input.startedAt).getTime();
    const startedAt = new Date(Math.min(now, Math.max(row.startedAt?.getTime() ?? now, started)));
    const key = `${roomBlobPrefix(roomId)}recordings/${row.id}/${input.stream}/${randomUUID()}`;
    await store.put(key, bytes, type);
    const [saved] = await this.db
      .insert(schema.interviewRecordings)
      .values({ interviewId: row.id, stream: input.stream, key, contentType: type, bytes: bytes.byteLength, startedAt, durationMs: input.durationMs })
      .returning({ id: schema.interviewRecordings.id });
    return { id: saved!.id };
  }

  /** Interviewers and the organisation's admins only: asInterviewer decides. */
  async list(id: string, userId: string): Promise<InterviewRecordings & { orgId: string }> {
    const row = await this.interviews.asInterviewer(id, userId);
    const clips = await this.db.select().from(schema.interviewRecordings).where(eq(schema.interviewRecordings.interviewId, id)).orderBy(asc(schema.interviewRecordings.startedAt));
    return {
      orgId: row.orgId,
      clips: clips.map((clip) => ({ id: clip.id, stream: clip.stream, startedAt: clip.startedAt.toISOString(), durationMs: clip.durationMs, bytes: clip.bytes })),
      bytes: clips.reduce((sum, clip) => sum + clip.bytes, 0),
      consentAt: row.recordingConsentAt?.toISOString() ?? null,
      keptDays: this.env.INTERVIEW_RECORDING_RETENTION_DAYS,
    };
  }

  async clip(id: string, userId: string, clipId: string): Promise<{ body: Buffer | Uint8Array; contentType: string }> {
    await this.interviews.asInterviewer(id, userId);
    const [clip] = await this.db.select().from(schema.interviewRecordings).where(and(eq(schema.interviewRecordings.id, clipId), eq(schema.interviewRecordings.interviewId, id))).limit(1);
    if (!clip) throw new NotFoundException("That clip isn't here any more.");
    const object = await this.requireStore().get(clip.key);
    if (!object) throw new NotFoundException("That clip isn't here any more.");
    return { body: object.body, contentType: clip.contentType };
  }

  /** Delete one sitting's recordings now, say because the candidate asked. */
  async removeAll(id: string, userId: string): Promise<{ orgId: string; removed: number }> {
    const row = await this.interviews.asInterviewer(id, userId);
    const clips = await this.db.select({ id: schema.interviewRecordings.id, key: schema.interviewRecordings.key }).from(schema.interviewRecordings).where(eq(schema.interviewRecordings.interviewId, id));
    const removed = await this.removeClips(clips);
    return { orgId: row.orgId, removed };
  }

  /** The bytes first: a row left behind can be deleted later, but bytes with no row would never be found again. */
  private async removeClips(clips: ReadonlyArray<{ id: string; key: string }>): Promise<number> {
    const store = this.requireStore();
    const gone: string[] = [];
    for (const clip of clips) {
      try {
        await store.delete(clip.key);
        gone.push(clip.id);
      } catch (error) {
        this.logger.warn(`recording ${clip.id} couldn't be deleted: ${String(error)}`);
      }
    }
    if (gone.length) await this.db.delete(schema.interviewRecordings).where(inArray(schema.interviewRecordings.id, gone));
    return gone.length;
  }

  /** Whatever has passed its time goes, a batch at a time, without holding anything up for long. */
  async cleanup(now = new Date()): Promise<number> {
    if (!this.store) return 0;
    const before = new Date(now.getTime() - this.env.INTERVIEW_RECORDING_RETENTION_DAYS * 24 * 60 * 60_000);
    const until = Date.now() + CLEANUP_BUDGET_MS;
    let removed = 0;
    for (;;) {
      const clips = await this.db.select({ id: schema.interviewRecordings.id, key: schema.interviewRecordings.key }).from(schema.interviewRecordings).where(lt(schema.interviewRecordings.createdAt, before)).limit(CLEANUP_BATCH);
      if (!clips.length) return removed;
      const done = await this.removeClips(clips);
      removed += done;
      // Nothing could be deleted, or that's enough for this hour: try again next time.
      if (!done || clips.length < CLEANUP_BATCH || Date.now() > until) return removed;
    }
  }
}
