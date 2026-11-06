/** Asking the AI about a sitting, for an interviewer. It reads the evidence and their work, and suggests what to check and what to ask. A person decides. */
import type { AuthSession } from "@codechatter/auth";
import type { AiReview, AiReviewFinding, AiReviewInput, InterviewerInterview } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, GatewayTimeoutException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { and, asc, count, eq, sql } from "drizzle-orm";

import { AiService } from "../ai/ai.service.js";
import type { ModelRequest } from "../ai/prompts.js";
import { describeAiError, type AiProvider } from "../ai/providers.js";
import { estimateUsage } from "../ai/usage.js";
import { DB } from "../infra/tokens.js";
import { looksLikeJpeg, parseReview, parseSheet, ReviewUnreadable, reviewRequest, sheetRequest, theirWords, type ReviewFacts } from "./ai-review.js";
import { reviewSignals } from "./review-signals.js";
import { InterviewsService } from "./interviews.service.js";
import { askedOf } from "./paper.js";

const TIME_LIMIT_MS = 3 * 60_000;

@Injectable()
export class InterviewAiReviewService {
  private readonly logger = new Logger(InterviewAiReviewService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ai: AiService,
    private readonly interviews: InterviewsService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /** One call to the model, with its usage counted. */
  private async ask(provider: AiProvider, userId: string, request: ModelRequest): Promise<string> {
    let text = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for await (const piece of provider.stream(request, AbortSignal.timeout(TIME_LIMIT_MS))) {
      if (piece.type === "text") text += piece.text;
      else usage = piece.usage;
    }
    await this.ai.record(userId, usage ? { ...usage, estimated: false } : estimateUsage(request, text.length)).catch((error: unknown) => this.logger.warn(`AI usage not recorded: ${String(error)}`));
    return text;
  }

  async review(id: string, session: AuthSession, input: AiReviewInput): Promise<{ interview: InterviewerInterview; orgId: string; looked: AiReview["looked"] }> {
    const row = await this.interviews.asInterviewer(id, session.user.id);
    if (!row.startedAt) throw new ConflictException("It hasn't started, so there's nothing to review.");
    const provider = this.ai.provider;
    if (!provider) throw new ServiceUnavailableException(this.ai.setup.problem ?? "AI isn't set up on this server.");
    // The candidate was told what the AI would look at, before they agreed. Nothing beyond that.
    if ((input.webcam && !(row.aiReviewRecording && row.recordWebcam)) || (input.screen && !(row.aiReviewRecording && row.recordScreen))) {
      throw new ForbiddenException("The candidate wasn't told the AI would look at their recording, so it can't.");
    }
    for (const sheet of [input.webcam, input.screen]) if (sheet && !looksLikeJpeg(sheet.data)) throw new BadRequestException("Stills have to be a JPEG.");

    const limit = await this.ai.hit(session.user.id);
    if (!limit.allowed) throw new HttpException(`You've used the AI a lot just now. Try again in ${limit.retryAfterSeconds} seconds.`, HttpStatus.TOO_MANY_REQUESTS);

    const { docUpdates } = schema;
    const [events, edits, runs, answers] = await Promise.all([
      this.db.select().from(schema.interviewEvents).where(eq(schema.interviewEvents.interviewId, id)).orderBy(asc(schema.interviewEvents.at)),
      this.db
        .select({ minute: sql<string>`date_trunc('minute', ${docUpdates.ts})`, edits: count(), bytes: sql<number>`sum(octet_length(${docUpdates.update}))::int` })
        .from(docUpdates)
        .where(and(eq(docUpdates.docName, `room:${row.roomId}:files`), sql`${docUpdates.origin} not like '%:seed'`))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      this.db.select().from(schema.interviewRuns).where(eq(schema.interviewRuns.interviewId, id)).orderBy(asc(schema.interviewRuns.createdAt)),
      this.db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewId, id)).orderBy(asc(schema.interviewAnswers.updatedAt)),
    ]);

    const facts: ReviewFacts = {
      mode: row.mode,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMinutes: row.durationMinutes,
      aiAllowed: row.aiAllowed,
      questions: row.paper.filter((question) => askedOf(row.mode, question)),
      events: events.map((event) => ({ kind: event.kind, at: event.at, detail: event.detail })),
      edits: edits.map((item) => ({ minute: new Date(item.minute), edits: item.edits, bytes: item.bytes })),
      runs: runs.map((run) => ({ at: run.createdAt, questionId: run.questionId, passed: run.passed, total: run.total, compileError: run.compileError !== null })),
      answers: answers.map((answer) => ({ questionId: answer.questionId, at: answer.updatedAt, text: answer.text, chose: answer.choiceIds.length, awarded: answer.awarded })),
      files: input.files,
    };
    let found: Pick<AiReview, "summary" | "findings" | "questions">;
    const looked = { camera: false, screen: false };
    const notes: string[] = [];
    const stills: AiReviewFinding[] = [];
    try {
      const text = await this.ask(
        provider,
        session.user.id,
        reviewRequest(facts, this.ai.contextChars),
      );
      found = parseReview(text, row.startedAt, { words: theirWords(facts), minutes: row.durationMinutes });
    } catch (error) {
      if (error instanceof ReviewUnreadable) throw new BadGatewayException("The AI's answer couldn't be read. Try again.");
      if ((error as Error).name === "TimeoutError") throw new GatewayTimeoutException("The AI took too long. Try again.");
      this.logger.warn(`AI review failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadGatewayException(describeAiError(error, provider.settings, false) ?? "The AI request failed. Try again.");
    }

    // Stills only with a model that can see, and losing them doesn't lose the rest.
    const sheets = [{ source: "camera" as const, sheet: input.webcam }, { source: "screen" as const, sheet: input.screen }].filter((item) => item.sheet);
    if (sheets.length && !provider.settings.vision) notes.push("This AI model can't read images, so it didn't look at the recording.");
    else {
      for (const { source, sheet } of sheets) {
        try {
          stills.push(...parseSheet(await this.ask(provider, session.user.id, sheetRequest(source, sheet!.data, sheet!.times, row.startedAt)), source, sheet!.times));
          looked[source] = true;
        } catch (error) {
          this.logger.warn(`AI review of ${source} stills failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
          notes.push(`The AI couldn't look at the ${source === "camera" ? "camera" : "screen"} recording this time.`);
        }
      }
    }

    const review: AiReview = { at: new Date().toISOString(), model: provider.settings.model, summary: found.summary, findings: [...reviewSignals(facts), ...found.findings, ...stills], questions: found.questions, looked, note: notes.join(" ") || null };
    // Only its own column. A score and the record's level are never the AI's to change.
    await this.db.update(schema.interviews).set({ aiReview: review }).where(eq(schema.interviews.id, id));
    return { interview: await this.interviews.viewFor(id), orgId: row.orgId, looked };
  }
}
