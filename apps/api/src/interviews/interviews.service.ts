import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import type { ObjectStore } from "@codechatter/auth/s3";
import {
  can,
  ROOM_ACCESS_CHANNEL,
  roomBlobPrefix,
  type InterviewInvitation,
  type InterviewListItem,
  type InterviewReplay,
  type InterviewerInterview,
  type JudgeEvent,
  type JoinedInterview,
  type QuestionData,
  type QuestionItem,
  type QuestionListItem,
  type RoomInterview,
  type ScheduleInterviewData,
  type ScheduledInterview,
  type Scorecard,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { createHash, randomBytes } from "node:crypto";

import type { Env } from "../config/env.js";
import { DB, ENV, OBJECT_STORE, VALKEY } from "../infra/tokens.js";
import { MailService } from "../mail/mail.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { newRoomCode, RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError, type RunnerUser } from "../runner/runner.client.js";
import { candidateInterview, candidateRun, interviewerInterview, interviewerRun, interviewListItem, type InterviewRow, type RunRow } from "./views.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const SYSTEM: RunnerUser = { id: "interview-timer", name: "Interview timer" };
const SWEEP_MS = 10_000;
const KEEP_OUTPUT = 16 * 1024;
const RUNS_SHOWN = 20;
const MOMENTS = 300;

/**
 * Interview mode (roadmap step 11): an organisation's question bank, scheduling, the
 * candidate's single-use link, the server's timer, tests with hidden cases, a private
 * scorecard and the data for a replay.
 *
 * The server decides when it starts and ends. Ending really takes the candidate's rights
 * away: their role becomes viewer, their open editor connections are closed (collab
 * reconnects them read-only, extensions/revocation.ts), and the sandbox restarts, which
 * ends their terminals and programs. A timer here closes interviews that run out, and
 * several API instances can run it: only one wins each conditional update.
 */
@Injectable()
export class InterviewsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterviewsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Interviews whose tests are running on this instance. */
  private readonly testing = new Set<string>();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly redis: Redis,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    private readonly rooms: RoomsService,
    private readonly repo: RoomsRepository,
    private readonly runner: RunnerClient,
    private readonly mail: MailService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((error: unknown) => this.logger.warn(`interview timer: ${String(error)}`)), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get db() {
    return this.handle.db;
  }

  private async orgOf(session: AuthSession): Promise<string> {
    const orgId = session.session.activeOrganizationId ?? (await ensurePersonalOrg(this.db, session.user));
    if (!(await this.repo.isOrgMember(orgId, session.user.id))) throw new ForbiddenException("You're not a member of that organisation.");
    return orgId;
  }

  // The question bank.

  async listQuestions(session: AuthSession): Promise<QuestionListItem[]> {
    const orgId = await this.orgOf(session);
    const rows = await this.db
      .select()
      .from(schema.interviewQuestions)
      .where(and(eq(schema.interviewQuestions.orgId, orgId), isNull(schema.interviewQuestions.archivedAt)))
      .orderBy(desc(schema.interviewQuestions.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      file: row.file,
      durationMinutes: row.durationMinutes,
      updatedAt: row.updatedAt.toISOString(),
      tests: row.tests.length,
      hiddenTests: row.tests.filter((test) => test.hidden).length,
      criteria: row.rubric.length,
    }));
  }

  private async questionRow(session: AuthSession, id: string) {
    const orgId = await this.orgOf(session);
    const [row] = await this.db
      .select()
      .from(schema.interviewQuestions)
      .where(and(eq(schema.interviewQuestions.id, id), eq(schema.interviewQuestions.orgId, orgId), isNull(schema.interviewQuestions.archivedAt)))
      .limit(1);
    if (!row) throw new NotFoundException("That question isn't in this organisation's bank.");
    return row;
  }

  private questionItem(row: typeof schema.interviewQuestions.$inferSelect): QuestionItem {
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      file: row.file,
      starterFiles: row.starterFiles,
      tests: row.tests,
      rubric: row.rubric,
      durationMinutes: row.durationMinutes,
      timeLimitMs: row.timeLimitMs,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getQuestion(session: AuthSession, id: string): Promise<QuestionItem> {
    return this.questionItem(await this.questionRow(session, id));
  }

  async createQuestion(session: AuthSession, input: QuestionData): Promise<QuestionItem> {
    const orgId = await this.orgOf(session);
    const [row] = await this.db.insert(schema.interviewQuestions).values({ ...input, orgId, createdBy: session.user.id }).returning();
    return this.questionItem(row!);
  }

  async updateQuestion(session: AuthSession, id: string, input: QuestionData): Promise<QuestionItem> {
    await this.questionRow(session, id);
    const [row] = await this.db.update(schema.interviewQuestions).set({ ...input, updatedAt: new Date() }).where(eq(schema.interviewQuestions.id, id)).returning();
    return this.questionItem(row!);
  }

  /** Archived, not deleted: interviews keep their own snapshot anyway. */
  async archiveQuestion(session: AuthSession, id: string): Promise<void> {
    await this.questionRow(session, id);
    await this.db.update(schema.interviewQuestions).set({ archivedAt: new Date() }).where(eq(schema.interviewQuestions.id, id));
  }

  // Interviews.

  private async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
    const [member] = await this.db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
      .limit(1);
    return member?.role === "owner" || member?.role === "admin";
  }

  private async interviewerName(row: InterviewRow): Promise<string | null> {
    if (!row.interviewerId) return null;
    const [user] = await this.db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, row.interviewerId)).limit(1);
    return user?.name ?? null;
  }

  /** An organisation's owners and admins see all its interviews; others, the ones they run. */
  async list(session: AuthSession): Promise<InterviewListItem[]> {
    const orgId = await this.orgOf(session);
    const everything = await this.isOrgAdmin(orgId, session.user.id);
    const rows = await this.db
      .select({ interview: schema.interviews, interviewerName: schema.user.name })
      .from(schema.interviews)
      .leftJoin(schema.user, eq(schema.interviews.interviewerId, schema.user.id))
      .where(and(eq(schema.interviews.orgId, orgId), everything ? undefined : eq(schema.interviews.interviewerId, session.user.id)))
      .orderBy(desc(schema.interviews.createdAt))
      .limit(200);
    return rows.map((row) => interviewListItem(row.interview, row.interviewerName));
  }

  async schedule(session: AuthSession, input: ScheduleInterviewData): Promise<ScheduledInterview> {
    const question = await this.questionRow(session, input.questionId);
    if (input.sendEmail && !input.candidateEmail) throw new BadRequestException("Add the candidate's email to send them the link.");
    const token = randomBytes(24).toString("base64url");
    const row = await this.createRoomAndInterview(session, question, input, sha256(token));
    let emailed = false;
    if (input.sendEmail && input.candidateEmail) {
      try {
        await this.mail.sendInterviewInvitation({
          email: input.candidateEmail,
          candidateName: row.candidateName,
          interviewerName: session.user.name,
          minutes: row.durationMinutes,
          when: row.scheduledAt?.toUTCString() ?? null,
          url: `${this.env.APP_URL}/interview/${token}`,
        });
        emailed = true;
      } catch (error) {
        this.logger.warn(`interview ${row.id}: the invitation email failed: ${String(error)}`);
      }
    }
    return { ...interviewListItem(row, session.user.name), candidateToken: token, emailed };
  }

  private async createRoomAndInterview(
    session: AuthSession,
    question: typeof schema.interviewQuestions.$inferSelect,
    input: { candidateName: string; candidateEmail?: string; scheduledAt?: string; durationMinutes?: number },
    tokenHash: string,
  ): Promise<InterviewRow> {
    for (let attempt = 0; ; attempt++) {
      try {
        const room = await this.repo.createWithOwner(
          {
            id: newRoomCode(),
            orgId: question.orgId,
            name: `Interview: ${input.candidateName}`.slice(0, 80),
            description: "",
            kind: "interview",
            templateId: "blank",
            visibility: "private",
            joinPolicy: "invite",
            inviteTokenHash: sha256(randomBytes(24).toString("base64url")),
            createdBy: session.user.id,
          },
          session.user.id,
          undefined,
          "interviewer",
        );
        const [row] = await this.db
          .insert(schema.interviews)
          .values({
            orgId: question.orgId,
            roomId: room.id,
            questionId: question.id,
            question: { title: question.title, prompt: question.prompt, file: question.file, starterFiles: question.starterFiles, tests: question.tests, rubric: question.rubric, timeLimitMs: question.timeLimitMs },
            candidateName: input.candidateName,
            candidateEmail: input.candidateEmail ?? null,
            interviewerId: session.user.id,
            scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
            durationMinutes: input.durationMinutes ?? question.durationMinutes,
            candidateTokenHash: tokenHash,
          })
          .returning();
        return row!;
      } catch (error) {
        if (attempt < 4 && (error as { code?: string }).code === "23505") continue;
        throw error;
      }
    }
  }

  private async row(id: string): Promise<InterviewRow> {
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.id, id)).limit(1);
    if (!row) throw new NotFoundException("That interview doesn't exist.");
    return row;
  }

  /** The interview, for someone who may see its rubric: its interviewers, and the organisation's owners and admins. */
  private async asInterviewer(id: string, userId: string): Promise<InterviewRow> {
    const row = await this.row(id);
    const member = await this.repo.findMember(row.roomId, userId);
    if (member?.status === "active" && can(member.role, "interview.rubric")) return row;
    if (await this.isOrgAdmin(row.orgId, userId)) return row;
    throw new ForbiddenException("You don't have access to this interview.");
  }

  private async runRows(interviewId: string): Promise<RunRow[]> {
    const rows = await this.db
      .select({ run: schema.interviewRuns, byName: schema.user.name })
      .from(schema.interviewRuns)
      .leftJoin(schema.user, eq(schema.interviewRuns.userId, schema.user.id))
      .where(eq(schema.interviewRuns.interviewId, interviewId))
      .orderBy(desc(schema.interviewRuns.createdAt))
      .limit(RUNS_SHOWN);
    return rows.map((row) => ({ ...row.run, byName: row.byName }));
  }

  private async interviewerView(row: InterviewRow): Promise<InterviewerInterview> {
    return interviewerInterview(row, await this.runRows(row.id), await this.interviewerName(row), new Date());
  }

  async get(id: string, userId: string): Promise<InterviewerInterview> {
    return this.interviewerView(await this.asInterviewer(id, userId));
  }

  /** The room's interview, as this person may see it. */
  async forRoom(roomId: string, userId: string): Promise<RoomInterview> {
    const { role } = await this.rooms.require(roomId, userId, "room.view");
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (!row) throw new NotFoundException("This room isn't an interview.");
    if (can(role, "interview.rubric")) return this.interviewerView(row);
    return { ...candidateInterview(row, await this.runRows(row.id), await this.interviewerName(row), new Date()), role: "candidate" };
  }

  /** Tell collab to reconnect the room's editors with their new rights, and browsers to read the interview again. */
  private async announce(row: Pick<InterviewRow, "roomId">, rightsChanged: boolean): Promise<void> {
    if (rightsChanged) await this.redis.publish(ROOM_ACCESS_CHANNEL, row.roomId).catch((error: unknown) => this.logger.warn(`room access: ${String(error)}`));
    this.events.interviewChanged(row.roomId);
  }

  private async setCandidateRole(row: InterviewRow, role: "candidate" | "viewer"): Promise<void> {
    if (!row.candidateUserId) return;
    await this.db
      .insert(schema.roomMembers)
      .values({ roomId: row.roomId, userId: row.candidateUserId, role, status: "active" })
      .onConflictDoUpdate({ target: [schema.roomMembers.roomId, schema.roomMembers.userId], set: { role, status: "active", updatedAt: new Date() } });
  }

  async start(id: string, userId: string): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, userId);
    const now = new Date();
    const [started] = await this.db
      .update(schema.interviews)
      .set({ status: "live", startedAt: now, endsAt: new Date(now.getTime() + row.durationMinutes * 60_000), updatedAt: now })
      .where(and(eq(schema.interviews.id, id), eq(schema.interviews.status, "scheduled")))
      .returning();
    if (!started) throw new ConflictException(`This interview is ${row.status === "live" ? "already running" : row.status}.`);
    await this.setCandidateRole(started, "candidate");
    // Nobody's rights shrink, and the candidate had no connection to close.
    await this.announce(started, false);
    return this.interviewerView(started);
  }

  async extend(id: string, userId: string, minutes: number): Promise<InterviewerInterview> {
    await this.asInterviewer(id, userId);
    const [row] = await this.db
      .update(schema.interviews)
      .set({ endsAt: sql`${schema.interviews.endsAt} + make_interval(mins => ${minutes})`, updatedAt: new Date() })
      .where(and(eq(schema.interviews.id, id), eq(schema.interviews.status, "live")))
      .returning();
    if (!row) throw new ConflictException("Only a running interview can be extended.");
    await this.announce(row, false);
    return this.interviewerView(row);
  }

  /** End one: the only code that does. Whoever wins the conditional update does the rest. */
  private async close(id: string, user: RunnerUser): Promise<InterviewRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(schema.interviews)
      .set({ status: "finished", finishedAt: now, endsAt: now, updatedAt: now })
      .where(and(eq(schema.interviews.id, id), eq(schema.interviews.status, "live")))
      .returning();
    if (!row) return null;
    await this.setCandidateRole(row, "viewer");
    await this.announce(row, true);
    // Ends their terminals and programs. A viewer can't open another.
    await this.runner.restart(row.roomId, user).catch((error: unknown) => this.logger.warn(`interview ${row.id}: sandbox restart: ${String(error)}`));
    return row;
  }

  async finish(id: string, session: AuthSession): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, session.user.id);
    const closed = await this.close(id, session.user);
    if (!closed && row.status !== "finished") throw new ConflictException(`This interview is ${row.status}, so it can't be finished.`);
    return this.interviewerView(closed ?? row);
  }

  /** Close the interviews whose time is up. */
  async sweep(): Promise<number> {
    const due = await this.db
      .select({ id: schema.interviews.id })
      .from(schema.interviews)
      .where(and(eq(schema.interviews.status, "live"), lte(schema.interviews.endsAt, new Date())));
    let closed = 0;
    for (const { id } of due) if (await this.close(id, SYSTEM)) closed += 1;
    return closed;
  }

  async cancel(id: string, userId: string): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, userId);
    const [cancelled] = await this.db
      .update(schema.interviews)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(schema.interviews.id, id), eq(schema.interviews.status, "scheduled")))
      .returning();
    if (!cancelled) throw new ConflictException(`This interview is ${row.status}, so it can't be cancelled.`);
    await this.announce(cancelled, false);
    return this.interviewerView(cancelled);
  }

  /** A new link, when the first went astray. The old one stops working. Not once someone has used it. */
  async rotateLink(id: string, userId: string): Promise<{ candidateToken: string }> {
    await this.asInterviewer(id, userId);
    const token = randomBytes(24).toString("base64url");
    const [row] = await this.db
      .update(schema.interviews)
      .set({ candidateTokenHash: sha256(token), updatedAt: new Date() })
      .where(and(eq(schema.interviews.id, id), eq(schema.interviews.status, "scheduled"), isNull(schema.interviews.candidateUserId)))
      .returning({ id: schema.interviews.id });
    if (!row) throw new ConflictException("The link can only be replaced before it's used and before the interview starts.");
    return { candidateToken: token };
  }

  async remove(id: string, session: AuthSession): Promise<void> {
    const row = await this.asInterviewer(id, session.user.id);
    await this.repo.deleteRoom(row.roomId); // The interview and its runs go with the room.
    await Promise.all([
      this.runner.destroyRoom(row.roomId, session.user).catch(() => {}),
      this.store?.deletePrefix(roomBlobPrefix(row.roomId)).catch(() => 0),
    ]);
  }

  async saveScorecard(id: string, userId: string, scorecard: Scorecard): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, userId);
    const known = new Set(row.question.rubric.map((criterion) => criterion.id));
    if (scorecard.scores.some((score) => !known.has(score.id))) throw new BadRequestException("That score isn't for one of this interview's criteria.");
    const [saved] = await this.db.update(schema.interviews).set({ scorecard, updatedAt: new Date() }).where(eq(schema.interviews.id, id)).returning();
    return this.interviewerView(saved!);
  }

  // The candidate's link.

  private async byToken(token: string): Promise<InterviewRow> {
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.candidateTokenHash, sha256(token))).limit(1);
    if (!row) throw new NotFoundException("This interview link isn't valid. Ask your interviewer for a new one.");
    return row;
  }

  /** The landing page: nothing about the question. */
  async invitation(token: string): Promise<InterviewInvitation> {
    const row = await this.byToken(token);
    const name = await this.interviewerName(row);
    return {
      title: name ? `Interview with ${name}` : "Interview",
      candidateName: row.candidateName,
      interviewerName: name,
      durationMinutes: row.durationMinutes,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      status: row.status,
      used: row.candidateUserId !== null,
    };
  }

  /** Whether a link can still make an account: it's open, and nobody has used it. */
  async canJoinAsGuest(token: string): Promise<{ name: string }> {
    const row = await this.byToken(token);
    this.assertOpen(row);
    if (row.candidateUserId) throw new ConflictException("This link has been used already. Only the person who used it can get back in.");
    return { name: row.candidateName };
  }

  private assertOpen(row: InterviewRow): void {
    if (row.status === "cancelled") throw new GoneException("This interview was cancelled.");
    if (row.status === "finished") throw new GoneException("This interview has finished.");
  }

  /**
   * Use the link: it belongs to this person from now on. Before the interview starts they
   * only wait (they aren't in the room yet, so they can't read its files); once it has,
   * they're the room's candidate.
   */
  async claim(token: string, userId: string): Promise<JoinedInterview> {
    const row = await this.byToken(token);
    this.assertOpen(row);
    const member = await this.repo.findMember(row.roomId, userId);
    if (member && can(member.role, "interview.rubric")) throw new ConflictException("You're an interviewer here. Open the candidate's link in a private window to try it.");
    const [claimed] = await this.db
      .update(schema.interviews)
      .set({ candidateUserId: userId, candidateJoinedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.interviews.id, row.id), isNull(schema.interviews.candidateUserId)))
      .returning();
    const current = claimed ?? row;
    if (current.candidateUserId !== userId) throw new ConflictException("This link has been used already. Only the person who used it can get back in.");
    if (claimed) this.events.interviewChanged(row.roomId);
    if (current.status !== "live") return { roomId: current.roomId, interviewId: current.id, waiting: true };
    await this.setCandidateRole(current, "candidate");
    return { roomId: current.roomId, interviewId: current.id, waiting: false };
  }

  // The tests.

  /**
   * Run every test in a throwaway container (the runner's judge-box.ts), so hidden inputs
   * leave nothing behind in the candidate's sandbox. They keep their output to the people
   * who may see it: the answer is shaped by who asked.
   */
  async runTests(roomId: string, session: AuthSession, stateVector: string): Promise<{ run: ReturnType<typeof candidateRun> | ReturnType<typeof interviewerRun> }> {
    const { role } = await this.rooms.require(roomId, session.user.id, "code.run");
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (!row) throw new NotFoundException("This room isn't an interview.");
    if (row.status !== "live" || (row.endsAt && row.endsAt <= new Date())) throw new ConflictException("The tests run while the interview is running.");
    const tests = row.question.tests;
    if (!tests.length) throw new ConflictException("This question has no tests.");
    if (this.testing.has(row.id)) throw new ConflictException("The tests are already running.");
    this.testing.add(row.id);
    try {
      const events = await this.judge(roomId, session.user, {
        path: row.question.file,
        stateVector,
        cases: tests.map(({ input, expected }) => ({ input, expected })),
        timeLimitMs: row.question.timeLimitMs,
        isolated: true,
      });
      const failed = events.find((event): event is Extract<JudgeEvent, { type: "error" }> => event.type === "error");
      if (failed) throw new ConflictException(failed.message);
      const compile = events.find((event): event is Extract<JudgeEvent, { type: "compile-error" }> => event.type === "compile-error");
      const results = events
        .filter((event): event is Extract<JudgeEvent, { type: "case" }> => event.type === "case")
        .map((event) => {
          const test = tests[event.index]!;
          return { id: test.id, hidden: test.hidden, verdict: event.verdict, stdout: event.stdout.slice(0, KEEP_OUTPUT), stderr: event.stderr.slice(0, KEEP_OUTPUT), timeMs: event.timeMs };
        });
      const [saved] = await this.db
        .insert(schema.interviewRuns)
        .values({
          interviewId: row.id,
          userId: session.user.id,
          path: row.question.file,
          compileError: compile?.output.slice(0, KEEP_OUTPUT) ?? null,
          results,
          passed: results.filter((result) => result.verdict === "passed").length,
          total: tests.length,
        })
        .returning();
      this.events.interviewChanged(roomId);
      const run: RunRow = { ...saved!, byName: session.user.name };
      return { run: can(role, "interview.rubric") ? interviewerRun(run, tests) : candidateRun(run, tests) };
    } finally {
      this.testing.delete(row.id);
    }
  }

  private async judge(roomId: string, user: RunnerUser, input: Parameters<RunnerClient["judge"]>[2]): Promise<JudgeEvent[]> {
    const upstream = await this.runner.judge(roomId, user, input).catch((error: unknown) => {
      throw error instanceof RunnerUnavailableError ? new ServiceUnavailableException(error.message) : error;
    });
    const decoder = new TextDecoder();
    let buffer = "";
    const events: JudgeEvent[] = [];
    for await (const chunk of upstream) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let at = buffer.indexOf("\n"); at !== -1; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) events.push(JSON.parse(line) as JudgeEvent);
      }
    }
    return events;
  }

  // The replay.

  private range(row: InterviewRow) {
    return { from: row.startedAt ?? row.createdAt, to: row.finishedAt ?? new Date() };
  }

  /** The moments the room's files changed, with runs and chat on the same line. */
  async replay(id: string, userId: string): Promise<InterviewReplay> {
    const row = await this.asInterviewer(id, userId);
    const { from, to } = this.range(row);
    const updates = await this.db
      .select({ ts: schema.docUpdates.ts })
      .from(schema.docUpdates)
      .where(and(eq(schema.docUpdates.docName, `room:${row.roomId}:files`), gte(schema.docUpdates.ts, from), lte(schema.docUpdates.ts, to)))
      .orderBy(asc(schema.docUpdates.ts));
    const step = Math.max(1, Math.ceil(updates.length / MOMENTS));
    const moments = updates.filter((_, index) => index % step === 0 || index === updates.length - 1).map((update) => update.ts.toISOString());
    const runs = await this.db
      .select({ run: schema.interviewRuns, byName: schema.user.name })
      .from(schema.interviewRuns)
      .leftJoin(schema.user, eq(schema.interviewRuns.userId, schema.user.id))
      .where(eq(schema.interviewRuns.interviewId, id));
    const chat = await this.db
      .select({ at: schema.messages.createdAt, body: schema.messages.body, by: schema.user.name })
      .from(schema.messages)
      .leftJoin(schema.user, eq(schema.messages.userId, schema.user.id))
      .where(and(eq(schema.messages.roomId, row.roomId), gte(schema.messages.createdAt, from), lte(schema.messages.createdAt, to), inArray(schema.messages.kind, ["text", "code"])))
      .orderBy(asc(schema.messages.createdAt))
      .limit(2000);
    const events: InterviewReplay["events"] = [
      ...runs.map(({ run, byName }) => ({ kind: "run" as const, at: run.createdAt.toISOString(), passed: run.passed, total: run.total, by: byName, compileError: run.compileError !== null })),
      ...chat.map((message) => ({ kind: "chat" as const, at: message.at.toISOString(), by: message.by, text: message.body.slice(0, 500) })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return { startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null, moments, events };
  }

  /**
   * Every update to the room's files, for the browser to rebuild them at any moment:
   * [time in ms as float64][length as uint32][update bytes], one after another.
   */
  async replayUpdates(id: string, userId: string): Promise<Buffer> {
    const row = await this.asInterviewer(id, userId);
    const updates = await this.db
      .select({ ts: schema.docUpdates.ts, update: schema.docUpdates.update })
      .from(schema.docUpdates)
      .where(eq(schema.docUpdates.docName, `room:${row.roomId}:files`))
      .orderBy(asc(schema.docUpdates.seq));
    const frames: Uint8Array[] = [];
    for (const update of updates) {
      const head = Buffer.alloc(12);
      head.writeDoubleBE(update.ts.getTime(), 0);
      head.writeUInt32BE(update.update.byteLength, 8);
      frames.push(head, update.update);
    }
    return Buffer.concat(frames);
  }
}
