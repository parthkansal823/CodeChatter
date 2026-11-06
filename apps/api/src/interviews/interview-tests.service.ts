/** Many candidates at once, a candidate's answers, marking them, and the page reporting in for the integrity record. */
import { HeartbeatInput, integrityLevel, SaveAnswerInput, type BatchListItem, type BatchResultRow, type BatchResults, type CandidateAnswer, type IntegrityKind, type IntegrityReport, type InterviewerInterview, type ScheduleBatchData, type ScheduledBatch } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";

import type { AuthSession } from "@codechatter/auth";
import type { Env } from "../config/env.js";
import { DB, ENV } from "../infra/tokens.js";
import { MailService } from "../mail/mail.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { InterviewsService } from "./interviews.service.js";
import { answerProblem, askedOf, drawPaper, markChoices, PaperError, scorePaper, secureRandom, sessionsAfterBeat, sittingFrom } from "./paper.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const EMAILS_AT_ONCE = 5;
/** One sitting can't fill the table, whatever a page sends. */
const MOST_EVENTS = 2000;
/** The page reports every 15 seconds, and a hidden tab's timers can slow to once a minute. */
const SILENT_MS = 90_000;
const SECOND_SESSION_REPEAT_MS = 60_000;

@Injectable()
export class InterviewTestsService {
  private readonly logger = new Logger(InterviewTestsService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
    private readonly interviews: InterviewsService,
    private readonly events: EventsGateway,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // Many candidates at once.

  /**
   * Every paper is drawn before anything is made, so a bank too small for them leaves nothing
   * half-scheduled. One candidate failing after that doesn't take the others with it.
   */
  async scheduleBatch(session: AuthSession, input: ScheduleBatchData): Promise<ScheduledBatch> {
    const orgId = await this.interviews.orgOf(session);
    const bank = await this.interviews.bankOf(orgId);
    let sittings;
    try {
      sittings = input.candidates.map(() => sittingFrom(drawPaper(bank, input.paper, secureRandom), secureRandom, input.mode));
    } catch (error) {
      if (error instanceof PaperError) throw new BadRequestException(error.message);
      throw error;
    }
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const closesAt = input.closesAt ? new Date(input.closesAt) : null;
    const [batch] = await this.db
      .insert(schema.interviewBatches)
      .values({ orgId, mode: input.mode, title: input.title, durationMinutes: input.durationMinutes, paper: input.paper, opensAt: startsAt, closesAt, fullscreen: input.fullscreen, lockClipboard: input.lockClipboard, createdBy: session.user.id })
      .returning();

    const made: Array<{ row: Awaited<ReturnType<InterviewsService["createSitting"]>>; token: string }> = [];
    const failed: ScheduledBatch["failed"] = [];
    for (const [index, candidate] of input.candidates.entries()) {
      const sitting = sittings[index]!;
      const token = randomBytes(24).toString("base64url");
      try {
        const row = await this.interviews.createSitting(
          session,
          orgId,
          {
            questionId: null,
            snapshot: { title: input.title, prompt: "", file: "", starterFiles: sitting.starterFiles, tests: [], rubric: sitting.rubric, timeLimitMs: 2000 },
            paper: sitting.paper,
            candidateName: candidate.name,
            candidateEmail: candidate.email ?? null,
            scheduledAt: startsAt,
            durationMinutes: input.durationMinutes,
            mode: input.mode,
            batchId: batch!.id,
            opensAt: input.mode === "assessment" ? startsAt : null,
            closesAt: input.mode === "assessment" ? closesAt : null,
            fullscreen: input.fullscreen,
            lockClipboard: input.lockClipboard,
          },
          sha256(token),
        );
        made.push({ row, token });
      } catch (error) {
        this.logger.warn(`batch ${batch!.id}: a candidate couldn't be scheduled: ${String(error)}`);
        failed.push({ candidateName: candidate.name, reason: "Their room couldn't be made. Schedule them again." });
      }
    }

    const emailed = new Set<string>();
    if (input.sendEmail) {
      const when = input.mode === "assessment" ? windowWords(startsAt, closesAt) : (startsAt?.toUTCString() ?? null);
      const queue = [...made];
      await Promise.all(
        Array.from({ length: EMAILS_AT_ONCE }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const { row, token } = next;
            if (!row.candidateEmail) continue;
            try {
              await this.mail.sendInterviewInvitation({ email: row.candidateEmail, candidateName: row.candidateName, interviewerName: session.user.name, minutes: row.durationMinutes, when, url: `${this.env.APP_URL}/interview/${token}`, mode: input.mode, title: input.title });
              emailed.add(row.id);
            } catch (error) {
              this.logger.warn(`interview ${row.id}: the invitation email failed: ${String(error)}`);
            }
          }
        }),
      );
    }

    return {
      id: batch!.id,
      mode: input.mode,
      title: input.title,
      links: made.map(({ row, token }) => ({ interviewId: row.id, candidateName: row.candidateName, candidateEmail: row.candidateEmail, candidateToken: token, emailed: emailed.has(row.id) })),
      failed,
    };
  }

  private async countsFor(batchIds: string[]) {
    if (!batchIds.length) return new Map<string, { candidates: number; started: number; finished: number }>();
    const rows = await this.db
      .select({
        batchId: schema.interviews.batchId,
        candidates: count(),
        started: sql<number>`count(*) filter (where ${schema.interviews.startedAt} is not null)::int`,
        finished: sql<number>`count(*) filter (where ${schema.interviews.status} = 'finished')::int`,
      })
      .from(schema.interviews)
      .where(inArray(schema.interviews.batchId, batchIds))
      .groupBy(schema.interviews.batchId);
    return new Map(rows.map((row) => [row.batchId!, row]));
  }

  private listItem(batch: typeof schema.interviewBatches.$inferSelect, counts: { candidates: number; started: number; finished: number } | undefined): BatchListItem {
    return {
      id: batch.id,
      mode: batch.mode,
      title: batch.title,
      durationMinutes: batch.durationMinutes,
      opensAt: batch.opensAt?.toISOString() ?? null,
      closesAt: batch.closesAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      candidates: counts?.candidates ?? 0,
      started: counts?.started ?? 0,
      finished: counts?.finished ?? 0,
    };
  }

  /** An organisation's owners and admins see all of them; others, the ones they made. */
  async listBatches(session: AuthSession): Promise<BatchListItem[]> {
    const orgId = await this.interviews.orgOf(session);
    const everything = await this.interviews.isOrgAdmin(orgId, session.user.id);
    const where: SQL | undefined = and(eq(schema.interviewBatches.orgId, orgId), everything ? undefined : eq(schema.interviewBatches.createdBy, session.user.id));
    const batches = await this.db.select().from(schema.interviewBatches).where(where).orderBy(desc(schema.interviewBatches.createdAt)).limit(100);
    const counts = await this.countsFor(batches.map((batch) => batch.id));
    return batches.map((batch) => this.listItem(batch, counts.get(batch.id)));
  }

  private async batchFor(id: string, userId: string) {
    const [batch] = await this.db.select().from(schema.interviewBatches).where(eq(schema.interviewBatches.id, id)).limit(1);
    if (!batch) throw new NotFoundException("That doesn't exist.");
    if (batch.createdBy !== userId && !(await this.interviews.isOrgAdmin(batch.orgId, userId))) throw new ForbiddenException("You don't have access to this.");
    return batch;
  }

  /** The results table: one line a candidate, with nothing the table doesn't need. */
  async results(id: string, userId: string): Promise<BatchResults> {
    const batch = await this.batchFor(id, userId);
    const rows = await this.db.select().from(schema.interviews).where(eq(schema.interviews.batchId, id)).orderBy(schema.interviews.candidateName);
    const ids = rows.map((row) => row.id);
    const [answers, runs, events, bigEdits] = ids.length
      ? await Promise.all([
          this.db.select().from(schema.interviewAnswers).where(inArray(schema.interviewAnswers.interviewId, ids)),
          this.db.select({ interviewId: schema.interviewRuns.interviewId, questionId: schema.interviewRuns.questionId, passed: schema.interviewRuns.passed, total: schema.interviewRuns.total }).from(schema.interviewRuns).where(inArray(schema.interviewRuns.interviewId, ids)),
          this.db.select({ interviewId: schema.interviewEvents.interviewId, kind: schema.interviewEvents.kind, n: count() }).from(schema.interviewEvents).where(inArray(schema.interviewEvents.interviewId, ids)).groupBy(schema.interviewEvents.interviewId, schema.interviewEvents.kind),
          this.interviews.bigEditsByRoom(rows.map((row) => row.roomId)),
        ])
      : [[], [], [], new Map<string, number>()];

    const table: BatchResultRow[] = rows.map((row) => {
      const mine = answers.filter((answer) => answer.interviewId === row.id);
      const counts: IntegrityReport["counts"] = {};
      for (const event of events) if (event.interviewId === row.id) counts[event.kind as IntegrityKind] = event.n;
      const edits = bigEdits.get(row.roomId) ?? 0;
      const answeredRuns = new Set(runs.filter((run) => run.interviewId === row.id && run.questionId).map((run) => run.questionId));
      return {
        interviewId: row.id,
        roomId: row.roomId,
        candidateName: row.candidateName,
        candidateEmail: row.candidateEmail,
        joined: row.candidateUserId !== null,
        status: row.status,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        answered: mine.filter((answer) => answer.choiceIds.length > 0 || answer.text.trim()).length + answeredRuns.size,
        questions: row.paper.length,
        score: scorePaper(row.paper, mine, runs.filter((run) => run.interviewId === row.id)),
        integrity: { level: integrityLevel(counts, edits), counts, bigEdits: edits },
        recommendation: row.scorecard.recommendation,
      };
    });
    const tally = { candidates: rows.length, started: rows.filter((row) => row.startedAt).length, finished: rows.filter((row) => row.status === "finished").length };
    return { ...this.listItem(batch, tally), fullscreen: batch.fullscreen, lockClipboard: batch.lockClipboard, rows: table };
  }

  /** Delete it and every sitting in it, with their rooms. Not while one is running. */
  async removeBatch(id: string, session: AuthSession): Promise<void> {
    const batch = await this.batchFor(id, session.user.id);
    const rows = await this.db.select({ id: schema.interviews.id, status: schema.interviews.status }).from(schema.interviews).where(eq(schema.interviews.batchId, id));
    if (rows.some((row) => row.status === "live")) throw new ConflictException("Someone's still in the middle of it. Wait for them to finish, or finish theirs first.");
    for (const row of rows) await this.interviews.removeSitting(row.id, session.user);
    await this.db.delete(schema.interviewBatches).where(eq(schema.interviewBatches.id, batch.id));
  }

  // The candidate's side.

  private async candidateSitting(roomId: string, userId: string) {
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (!row) throw new NotFoundException("This room isn't an interview.");
    if (row.candidateUserId !== userId) throw new ForbiddenException("Only the candidate can do that.");
    return row;
  }

  /** Saved as they go, and marked here if it's multiple choice. What they got is never sent back. */
  async saveAnswer(roomId: string, userId: string, questionId: string, input: z.output<typeof SaveAnswerInput>): Promise<CandidateAnswer> {
    const row = await this.candidateSitting(roomId, userId);
    if (row.status !== "live" || (row.endsAt && row.endsAt <= new Date())) throw new ConflictException("Time's up, so this answer wasn't saved.");
    const question = row.paper.find((item) => item.id === questionId);
    if (!question || !askedOf(row.mode, question)) throw new NotFoundException("That isn't one of your questions.");
    const problem = answerProblem(question, input.choiceIds);
    if (problem) throw new BadRequestException(problem);
    const awarded = question.kind === "mcq" ? markChoices(question, input.choiceIds) : null;
    const text = question.kind === "mcq" ? "" : input.text;
    const now = new Date();
    await this.db
      .insert(schema.interviewAnswers)
      .values({ interviewId: row.id, questionId, choiceIds: input.choiceIds, text, awarded })
      // A changed written answer needs marking again.
      .onConflictDoUpdate({ target: [schema.interviewAnswers.interviewId, schema.interviewAnswers.questionId], set: { choiceIds: input.choiceIds, text, awarded, updatedAt: now } });
    // An interviewer's watching; in an assessment nobody needs telling.
    if (row.mode === "interview") this.events.interviewChanged(roomId);
    return { questionId, choiceIds: input.choiceIds, text, at: now.toISOString() };
  }

  /** The candidate hands in an assessment before the time's up. In an interview, that's the interviewer's call. */
  async submit(roomId: string, session: AuthSession): Promise<void> {
    const row = await this.candidateSitting(roomId, session.user.id);
    if (row.mode !== "assessment") throw new ConflictException("Your interviewer finishes the interview.");
    await this.interviews.closeSitting(row.id, session.user);
  }

  /** A person's mark for a short answer, a design or a coding question. Multiple choice marks itself. */
  async mark(id: string, userId: string, questionId: string, marks: number): Promise<InterviewerInterview> {
    const row = await this.interviews.asInterviewer(id, userId);
    const question = row.paper.find((item) => item.id === questionId);
    if (!question) throw new NotFoundException("That question isn't on this paper.");
    if (question.kind === "mcq") throw new BadRequestException("Multiple choice marks itself.");
    if (marks > question.marks) throw new BadRequestException(`This question is worth ${question.marks}.`);
    await this.db
      .insert(schema.interviewAnswers)
      .values({ interviewId: id, questionId, awarded: marks })
      .onConflictDoUpdate({ target: [schema.interviewAnswers.interviewId, schema.interviewAnswers.questionId], set: { awarded: marks, updatedAt: new Date() } });
    return this.interviews.viewFor(id);
  }

  /**
   * The candidate's page, every 15 seconds, with what it noticed since last time. The server adds
   * what it can see for itself, which the page can't hide: two tabs or devices taking turns, a
   * different network, or the page going quiet. The network is kept as a hash, not the address.
   */
  async heartbeat(roomId: string, userId: string, ip: string, input: z.output<typeof HeartbeatInput>): Promise<{ status: string }> {
    const row = await this.candidateSitting(roomId, userId);
    if (row.status !== "live") return { status: row.status };
    const now = new Date();
    const network = sha256(`${row.id}:${ip}`).slice(0, 16);
    const noticed: Array<typeof schema.interviewEvents.$inferInsert> = [];
    const server = (kind: IntegrityKind, detail: { seconds?: number } = {}) => noticed.push({ interviewId: row.id, kind, source: "server", at: now, detail });

    const sessions = sessionsAfterBeat(row.beatSession, input.sessionId);
    if (sessions.second && !(await this.saidLately(row.id, "second-session", now))) server("second-session");
    if (row.beatNetwork && row.beatNetwork !== network) server("network-changed");
    if (row.beatAt && now.getTime() - row.beatAt.getTime() > SILENT_MS) server("page-silent", { seconds: Math.round((now.getTime() - row.beatAt.getTime()) / 1000) });
    for (const event of input.events) {
      const at = new Date(event.at);
      noticed.push({ interviewId: row.id, kind: event.kind, source: "browser", at: at > now ? now : at, detail: event.length === undefined ? {} : { length: event.length } });
    }
    if (noticed.length) {
      const [held] = await this.db.select({ n: count() }).from(schema.interviewEvents).where(eq(schema.interviewEvents.interviewId, row.id));
      if ((held?.n ?? 0) < MOST_EVENTS) await this.db.insert(schema.interviewEvents).values(noticed);
    }
    await this.db.update(schema.interviews).set({ beatSession: sessions.stored, beatNetwork: network, beatAt: now }).where(eq(schema.interviews.id, row.id));
    return { status: row.status };
  }

  private async saidLately(interviewId: string, kind: IntegrityKind, now: Date): Promise<boolean> {
    const [last] = await this.db.select({ at: schema.interviewEvents.at }).from(schema.interviewEvents).where(and(eq(schema.interviewEvents.interviewId, interviewId), eq(schema.interviewEvents.kind, kind))).orderBy(desc(schema.interviewEvents.at)).limit(1);
    return Boolean(last && now.getTime() - last.at.getTime() < SECOND_SESSION_REPEAT_MS);
  }
}

function windowWords(opens: Date | null, closes: Date | null): string | null {
  if (opens && closes) return `between ${opens.toUTCString()} and ${closes.toUTCString()}`;
  if (closes) return `by ${closes.toUTCString()}`;
  if (opens) return `from ${opens.toUTCString()}`;
  return null;
}
