import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import type { ObjectStore } from "@codechatter/auth/s3";
import {
  can,
  roomBlobPrefix,
  type AskQuestionData,
  type AskedQuestion,
  type InterviewInvitation,
  type InterviewListItem,
  type InterviewReplay,
  type InterviewerInterview,
  type JudgeEvent,
  type JoinedInterview,
  type PaperQuestion,
  type QuestionData,
  type QuestionKind,
  type QuestionItem,
  type QuestionListItem,
  type RoomInterview,
  type ScheduleInterviewData,
  type ScheduledInterview,
  type Scorecard,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import type { Env } from "../config/env.js";
import { DB, ENV, OBJECT_STORE } from "../infra/tokens.js";
import { MailService } from "../mail/mail.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { newRoomCode, RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError, type RunnerUser } from "../runner/runner.client.js";
import { adhocPaperQuestion, askedOf, drawQuestions, nextQuestionId, PaperError, paperQuestion, secureRandom, sittingFrom, type BankQuestion } from "./paper.js";
import { candidateInterview, candidateRun, interviewerInterview, interviewerRun, interviewListItem, testsOf, type InterviewRow, type RunRow } from "./views.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const SYSTEM: RunnerUser = { id: "interview-timer", name: "Interview timer" };
const SWEEP_MS = 10_000;
const KEEP_OUTPUT = 16 * 1024;
const RUNS_SHOWN = 20;
const MOMENTS = 300;
/** More text than a person types in one go: pasting, or a program writing a file. */
const BIG_EDIT_BYTES = 1500;

/** Everything one sitting starts with. */
export type NewSitting = {
  questionId: string | null;
  snapshot: InterviewRow["question"];
  paper: PaperQuestion[];
  candidateName: string;
  candidateEmail: string | null;
  scheduledAt: Date | null;
  durationMinutes: number;
  mode: InterviewRow["mode"];
  batchId: string | null;
  opensAt: Date | null;
  closesAt: Date | null;
  fullscreen: boolean;
  lockClipboard: boolean;
  recordWebcam: boolean;
  recordScreen: boolean;
  aiReviewRecording: boolean;
};

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

  async orgOf(session: AuthSession): Promise<string> {
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
      kind: row.kind,
      title: row.title,
      file: row.file,
      difficulty: row.difficulty,
      tags: row.tags,
      marks: row.marks,
      durationMinutes: row.durationMinutes,
      updatedAt: row.updatedAt.toISOString(),
      tests: row.tests.length,
      hiddenTests: row.tests.filter((test) => test.hidden).length,
      criteria: row.rubric.length,
      choices: row.choices.length,
    }));
  }

  /** Everything in an organisation's bank, to draw from. */
  bankOf(orgId: string): Promise<BankQuestion[]> {
    return this.db.select().from(schema.interviewQuestions).where(and(eq(schema.interviewQuestions.orgId, orgId), isNull(schema.interviewQuestions.archivedAt)));
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
      kind: row.kind,
      title: row.title,
      prompt: row.prompt,
      difficulty: row.difficulty,
      tags: row.tags,
      marks: row.marks,
      choices: row.choices,
      modelAnswer: row.modelAnswer,
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

  /** All of them or none: half a bank is harder to fix than a paste. */
  async importQuestions(session: AuthSession, questions: QuestionData[]): Promise<{ imported: number }> {
    const orgId = await this.orgOf(session);
    const rows = await this.db.insert(schema.interviewQuestions).values(questions.map((question) => ({ ...question, orgId, createdBy: session.user.id }))).returning({ id: schema.interviewQuestions.id });
    return { imported: rows.length };
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

  async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
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

  /**
   * One live interview. A coding question goes straight in as it always did. Any other kind waits
   * on the paper to be asked. With no question at all, the interviewer chooses as it runs.
   */
  async schedule(session: AuthSession, input: ScheduleInterviewData): Promise<ScheduledInterview> {
    const question = input.questionId ? await this.questionRow(session, input.questionId) : null;
    if (input.sendEmail && !input.candidateEmail) throw new BadRequestException("Add the candidate's email to send them the link.");
    const token = randomBytes(24).toString("base64url");
    const direct = question?.kind === "coding";
    const sitting = sittingFrom(question && !direct ? [question] : [], secureRandom, "interview");
    const row = await this.createSitting(
      session,
      question?.orgId ?? (await this.orgOf(session)),
      {
        questionId: question?.id ?? null,
        snapshot: direct
          ? { title: question.title, prompt: question.prompt, file: question.file, starterFiles: question.starterFiles, tests: question.tests, rubric: question.rubric, timeLimitMs: question.timeLimitMs }
          : { title: question?.title ?? "Live interview", prompt: "", file: "", starterFiles: sitting.starterFiles, tests: [], rubric: sitting.rubric, timeLimitMs: 2000 },
        paper: sitting.paper,
        candidateName: input.candidateName,
        candidateEmail: input.candidateEmail ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        durationMinutes: input.durationMinutes ?? question?.durationMinutes ?? 60,
        mode: "interview",
        batchId: null,
        opensAt: null,
        closesAt: null,
        fullscreen: false,
        lockClipboard: false,
        recordWebcam: false,
        recordScreen: false,
        aiReviewRecording: false,
      },
      sha256(token),
    );
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

  /** A room and its sitting, with whoever scheduled it as the interviewer. */
  async createSitting(session: AuthSession, orgId: string, input: NewSitting, tokenHash: string): Promise<InterviewRow> {
    for (let attempt = 0; ; attempt++) {
      try {
        const room = await this.repo.createWithOwner(
          {
            id: newRoomCode(),
            orgId,
            name: `${input.mode === "assessment" ? "Assessment" : "Interview"}: ${input.candidateName}`.slice(0, 80),
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
            orgId,
            roomId: room.id,
            questionId: input.questionId,
            mode: input.mode,
            batchId: input.batchId,
            question: input.snapshot,
            paper: input.paper,
            candidateName: input.candidateName,
            candidateEmail: input.candidateEmail,
            interviewerId: session.user.id,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            opensAt: input.opensAt,
            closesAt: input.closesAt,
            fullscreen: input.fullscreen,
            lockClipboard: input.lockClipboard,
            recordWebcam: input.recordWebcam,
            recordScreen: input.recordScreen,
            aiReviewRecording: input.aiReviewRecording,
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
  async asInterviewer(id: string, userId: string): Promise<InterviewRow> {
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

  /** How many big edits each room's files have had, the seed aside. The server counts these: a page can't hide them. */
  async bigEditsByRoom(roomIds: string[]): Promise<Map<string, number>> {
    if (!roomIds.length) return new Map();
    const { docUpdates } = schema;
    const rows = await this.db
      .select({ docName: docUpdates.docName, n: count() })
      .from(docUpdates)
      .where(and(inArray(docUpdates.docName, roomIds.map((id) => `room:${id}:files`)), sql`octet_length(${docUpdates.update}) > ${BIG_EDIT_BYTES}`, sql`${docUpdates.origin} not like '%:seed'`))
      .groupBy(docUpdates.docName);
    return new Map(rows.map((row) => [row.docName.split(":")[1]!, row.n]));
  }

  private async interviewerView(row: InterviewRow): Promise<InterviewerInterview> {
    const [runs, name, answers, events, bigEdits, runScores] = await Promise.all([
      this.runRows(row.id),
      this.interviewerName(row),
      this.db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewId, row.id)),
      this.db.select().from(schema.interviewEvents).where(eq(schema.interviewEvents.interviewId, row.id)).orderBy(asc(schema.interviewEvents.at)),
      this.bigEditsByRoom([row.roomId]),
      this.db.select({ questionId: schema.interviewRuns.questionId, passed: schema.interviewRuns.passed, total: schema.interviewRuns.total }).from(schema.interviewRuns).where(eq(schema.interviewRuns.interviewId, row.id)),
    ]);
    return interviewerInterview(row, runs, name, new Date(), { answers, events, bigEdits: bigEdits.get(row.roomId) ?? 0, runScores });
  }

  async viewFor(id: string): Promise<InterviewerInterview> {
    return this.interviewerView(await this.row(id));
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
    const answers = await this.db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewId, row.id));
    return { ...candidateInterview(row, await this.runRows(row.id), await this.interviewerName(row), new Date(), answers), role: "candidate" };
  }

  /** Tell collab to reconnect the room's editors with their new rights, and browsers to read the interview again. */
  private async announce(row: Pick<InterviewRow, "roomId">, rightsChanged: boolean): Promise<void> {
    if (rightsChanged) await this.rooms.accessChanged(row.roomId);
    this.events.interviewChanged(row.roomId);
  }

  private async setCandidateRole(row: InterviewRow, role: "candidate" | "viewer"): Promise<void> {
    if (!row.candidateUserId) return;
    await this.db
      .insert(schema.roomMembers)
      .values({ roomId: row.roomId, userId: row.candidateUserId, role, status: "active" })
      .onConflictDoUpdate({ target: [schema.roomMembers.roomId, schema.roomMembers.userId], set: { role, status: "active", updatedAt: new Date() } });
  }

  /** The clock starts: the only code that does this. */
  private async begin(row: InterviewRow): Promise<InterviewRow> {
    const now = new Date();
    const [started] = await this.db
      .update(schema.interviews)
      .set({ status: "live", startedAt: now, endsAt: new Date(now.getTime() + row.durationMinutes * 60_000), updatedAt: now })
      .where(and(eq(schema.interviews.id, row.id), eq(schema.interviews.status, "scheduled")))
      .returning();
    if (!started) throw new ConflictException(`This interview is ${row.status === "live" ? "already running" : row.status}.`);
    await this.setCandidateRole(started, "candidate");
    // Nobody's rights shrink, and the candidate had no connection to close.
    await this.announce(started, false);
    return started;
  }

  async start(id: string, userId: string): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, userId);
    // Starting someone's assessment for them would start their clock, and a recording they haven't agreed to.
    if (row.mode === "assessment") throw new ConflictException("The candidate starts an assessment themselves.");
    return this.interviewerView(await this.begin(row));
  }

  /** The candidate starts their assessment: once the link is theirs, and only inside its window. */
  async startAssessment(token: string, userId: string, consent: boolean): Promise<JoinedInterview> {
    const row = await this.byToken(token);
    this.assertOpen(row);
    if (row.mode !== "assessment") throw new ConflictException("Your interviewer starts the interview.");
    if (row.candidateUserId !== userId) throw new ForbiddenException("This link belongs to someone else.");
    if (row.status === "live") {
      await this.setCandidateRole(row, "candidate");
      return { roomId: row.roomId, interviewId: row.id, waiting: false };
    }
    const now = new Date();
    if (row.opensAt && row.opensAt > now) throw new ConflictException("This assessment hasn't opened yet.");
    if (row.closesAt && row.closesAt <= now) throw new GoneException("This assessment has closed.");
    if (row.recordWebcam || row.recordScreen) {
      if (!consent) throw new BadRequestException("This assessment records you, so you have to agree to that before it starts.");
      await this.db.update(schema.interviews).set({ recordingConsentAt: now }).where(eq(schema.interviews.id, row.id));
    }
    const started = await this.begin(row);
    return { roomId: started.roomId, interviewId: started.id, waiting: false };
  }

  // During a live interview.

  private assertAskable(row: InterviewRow): void {
    if (row.mode !== "interview") throw new ConflictException("An assessment's paper is fixed.");
    if (row.status !== "live" && row.status !== "scheduled") throw new ConflictException(`This interview is ${row.status}.`);
  }

  /**
   * A question for the candidate, now: from the bank, drawn at random, or made up on the spot.
   * Before the interview starts it waits on the paper instead. Its files aren't in the room
   * yet: the interviewer's browser adds them (the API doesn't touch live documents).
   */
  async askQuestion(id: string, userId: string, input: AskQuestionData): Promise<AskedQuestion> {
    const row = await this.asInterviewer(id, userId);
    this.assertAskable(row);
    const questionId = nextQuestionId(row.paper);
    let question: PaperQuestion;
    let rubric: Array<{ id: string; label: string }> = [];
    if ("adhoc" in input) {
      question = adhocPaperQuestion(input.adhoc, questionId, secureRandom);
    } else {
      const bank = await this.bankOf(row.orgId);
      let source: BankQuestion | undefined;
      if ("bankId" in input) {
        source = bank.find((item) => item.id === input.bankId);
        if (!source) throw new NotFoundException("That question isn't in this organisation's bank.");
      } else {
        const onPaper = new Set(row.paper.map((item) => item.bankId));
        try {
          source = drawQuestions(bank.filter((item) => !onPaper.has(item.id)), { fixed: [], random: [{ ...input.random, count: 1 }] }, secureRandom)[0];
        } catch (error) {
          if (error instanceof PaperError) throw new BadRequestException(error.message);
          throw error;
        }
      }
      question = paperQuestion(source!, questionId, `${questionId}/`, secureRandom);
      rubric = source!.rubric;
    }
    const now = new Date();
    if (row.status === "live") question = { ...question, askedAt: now.toISOString() };
    const known = new Set(row.question.rubric.map((criterion) => criterion.label));
    const added = rubric.filter((criterion) => !known.has(criterion.label)).map((criterion) => ({ id: `${questionId}-${criterion.id}`.slice(0, 64), label: criterion.label }));
    const [saved] = await this.db
      .update(schema.interviews)
      .set({
        // Added to what's there, not the copy read above, so two interviewers asking at once both count.
        paper: sql`${schema.interviews.paper} || ${JSON.stringify([question])}::jsonb`,
        question: { ...row.question, rubric: [...row.question.rubric, ...added] },
        updatedAt: now,
      })
      .where(eq(schema.interviews.id, id))
      .returning();
    await this.announce(saved!, false);
    return { interview: await this.interviewerView(saved!), question };
  }

  /** Ask a question that's been waiting on the paper. */
  async askPrepared(id: string, userId: string, questionId: string): Promise<AskedQuestion> {
    const row = await this.asInterviewer(id, userId);
    this.assertAskable(row);
    if (row.status !== "live") throw new ConflictException("Start the interview first.");
    const question = row.paper.find((item) => item.id === questionId);
    if (!question) throw new NotFoundException("That question isn't on this paper.");
    const asked = { ...question, askedAt: question.askedAt ?? new Date().toISOString() };
    const [saved] = await this.db
      .update(schema.interviews)
      .set({ paper: row.paper.map((item) => (item.id === questionId ? asked : item)), updatedAt: new Date() })
      .where(eq(schema.interviews.id, id))
      .returning();
    await this.announce(saved!, false);
    return { interview: await this.interviewerView(saved!), question: asked };
  }

  /** The interviewer's call, and they can change it as it runs. It goes on the record. */
  async setAi(id: string, userId: string, allowed: boolean): Promise<InterviewerInterview> {
    const row = await this.asInterviewer(id, userId);
    const [saved] = await this.db.update(schema.interviews).set({ aiAllowed: allowed, updatedAt: new Date() }).where(eq(schema.interviews.id, id)).returning();
    if (row.aiAllowed !== allowed && row.status === "live") await this.db.insert(schema.interviewEvents).values({ interviewId: id, kind: allowed ? "ai-on" : "ai-off", source: "server" });
    await this.announce(saved!, false);
    return this.interviewerView(saved!);
  }

  /** Whether the room's candidate may use the AI right now. */
  async candidateMayUseAi(roomId: string): Promise<boolean> {
    const [row] = await this.db.select({ aiAllowed: schema.interviews.aiAllowed, status: schema.interviews.status }).from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    return row?.status === "live" && row.aiAllowed;
  }

  /** The interviewer sees when they used it. */
  async noteAiUse(roomId: string): Promise<void> {
    const [row] = await this.db.select({ id: schema.interviews.id }).from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (row) await this.db.insert(schema.interviewEvents).values({ interviewId: row.id, kind: "ai-used", source: "server" });
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
  async closeSitting(id: string, user: RunnerUser): Promise<InterviewRow | null> {
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
    const closed = await this.closeSitting(id, session.user);
    if (!closed && row.status !== "finished") throw new ConflictException(`This interview is ${row.status}, so it can't be finished.`);
    return this.interviewerView(closed ?? row);
  }

  /** Close the interviews whose time is up, and the assessments nobody started in time. */
  async sweep(): Promise<number> {
    const missed = await this.db
      .update(schema.interviews)
      .set({ status: "missed", updatedAt: new Date() })
      .where(and(eq(schema.interviews.status, "scheduled"), eq(schema.interviews.mode, "assessment"), lte(schema.interviews.closesAt, new Date())))
      .returning({ roomId: schema.interviews.roomId });
    for (const { roomId } of missed) this.events.interviewChanged(roomId);
    const due = await this.db
      .select({ id: schema.interviews.id })
      .from(schema.interviews)
      .where(and(eq(schema.interviews.status, "live"), lte(schema.interviews.endsAt, new Date())));
    let closed = 0;
    for (const { id } of due) if (await this.closeSitting(id, SYSTEM)) closed += 1;
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
    await this.asInterviewer(id, session.user.id);
    await this.removeSitting(id, session.user);
  }

  /** The sitting and everything of it: the caller has checked who's asking. */
  async removeSitting(id: string, user: RunnerUser): Promise<void> {
    const row = await this.row(id);
    await this.repo.deleteRoom(row.roomId); // The interview and its runs go with the room.
    await this.rooms.accessChanged(row.roomId);
    await Promise.all([
      this.runner.destroyRoom(row.roomId, user).catch(() => {}),
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
    const questions: Record<QuestionKind, number> = { coding: 0, mcq: 0, short: 0, design: 0 };
    for (const question of row.paper) questions[question.kind] += 1;
    return {
      mode: row.mode,
      title: row.mode === "assessment" ? row.question.title : name ? `Interview with ${name}` : "Interview",
      // In a live interview, the questions are the interviewer's to reveal.
      questions: row.mode === "assessment" && row.paper.length ? questions : null,
      opensAt: row.opensAt?.toISOString() ?? null,
      closesAt: row.closesAt?.toISOString() ?? null,
      fullscreen: row.fullscreen,
      lockClipboard: row.lockClipboard,
      recordWebcam: row.recordWebcam,
      recordScreen: row.recordScreen,
      recordingKeptDays: this.env.INTERVIEW_RECORDING_RETENTION_DAYS,
      aiReviewRecording: row.aiReviewRecording,
      now: new Date().toISOString(),
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
    if (row.status === "missed") throw new GoneException("This assessment has closed.");
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
  async runTests(roomId: string, session: AuthSession, stateVector: string, questionId?: string): Promise<{ run: ReturnType<typeof candidateRun> | ReturnType<typeof interviewerRun> }> {
    const { role } = await this.rooms.require(roomId, session.user.id, "code.run");
    const [row] = await this.db.select().from(schema.interviews).where(eq(schema.interviews.roomId, roomId)).limit(1);
    if (!row) throw new NotFoundException("This room isn't an interview.");
    if (row.status !== "live" || (row.endsAt && row.endsAt <= new Date())) throw new ConflictException("The tests run while the interview is running.");
    const onPaper = questionId ? row.paper.find((question) => question.id === questionId && question.kind === "coding") : undefined;
    if (questionId && (!onPaper || (!can(role, "interview.rubric") && !askedOf(row.mode, onPaper)))) throw new NotFoundException("That isn't one of this interview's coding questions.");
    const tests = testsOf(row, questionId);
    const path = onPaper?.file ?? row.question.file;
    const timeLimitMs = onPaper?.timeLimitMs ?? row.question.timeLimitMs;
    if (!tests.length) throw new ConflictException("This question has no tests.");
    if (this.testing.has(row.id)) throw new ConflictException("The tests are already running.");
    this.testing.add(row.id);
    try {
      const events = await this.judge(roomId, session.user, {
        path,
        stateVector,
        cases: tests.map(({ input, expected }) => ({ input, expected })),
        timeLimitMs,
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
          questionId: questionId ?? null,
          path,
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
