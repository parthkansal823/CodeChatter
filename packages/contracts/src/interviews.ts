import { z } from "zod";

import { WorkspacePath } from "./run.js";

/**
 * Interview mode: an organisation's question bank, scheduling, the single-use candidate
 * link, the server's timer, tests with hidden cases, a private scorecard and a replay.
 *
 * What a candidate may see is decided here, by type: `CandidateInterview` carries no
 * hidden test, rubric or scorecard, and a run's hidden cases come back as counts only.
 */

/** The Valkey channel the API tells collab on, with a room's code, that someone's rights in it changed. */
export const ROOM_ACCESS_CHANNEL = "codechatter:room-access";

/** How a socket closes when its owner's rights changed. Clients that reconnect get what's left. */
export const ROOM_ACCESS_CLOSE = { code: 4205, reason: "Your access to this room changed" } as const;

/** Whose rights changed: one person's, or (no userId) anyone's in the room. */
export type RoomAccessChange = { roomId: string; userId?: string };

export const roomAccessMessage = ({ roomId, userId }: RoomAccessChange): string => (userId ? `${roomId}:${userId}` : roomId);

export function parseRoomAccessMessage(message: string): RoomAccessChange {
  const at = message.indexOf(":");
  return at === -1 ? { roomId: message } : { roomId: message.slice(0, at), userId: message.slice(at + 1) };
}

export const InterviewTest = z.object({
  id: z.string().min(1).max(64),
  input: z.string().max(64 * 1024),
  expected: z.string().max(64 * 1024),
  /** Hidden: the candidate sees only how many pass, never the input, the output or a diff. */
  hidden: z.boolean(),
});
export type InterviewTest = z.infer<typeof InterviewTest>;

export const InterviewCriterion = z.object({ id: z.string().min(1).max(64), label: z.string().trim().min(1).max(200) });
export type InterviewCriterion = z.infer<typeof InterviewCriterion>;

export const QuestionInput = z
  .object({
    title: z.string().trim().min(1, "Give the question a title.").max(200),
    prompt: z.string().max(50_000).default(""),
    file: WorkspacePath,
    starterFiles: z.array(z.object({ path: WorkspacePath, content: z.string().max(256 * 1024) })).min(1, "A question needs at least one file.").max(20),
    tests: z.array(InterviewTest).max(30).default([]),
    rubric: z.array(InterviewCriterion).max(20).default([]),
    durationMinutes: z.number().int().min(5).max(480).default(60),
    timeLimitMs: z.number().int().min(500).max(20_000).default(2000),
  })
  .refine((question) => question.starterFiles.some((file) => file.path === question.file), { path: ["file"], message: "The file the tests run must be one of the starter files." })
  .refine((question) => new Set(question.starterFiles.map((file) => file.path)).size === question.starterFiles.length, { path: ["starterFiles"], message: "Two starter files have the same path." })
  .refine((question) => new Set(question.tests.map((test) => test.id)).size === question.tests.length, { path: ["tests"], message: "Two tests have the same id." });
export type QuestionInput = z.input<typeof QuestionInput>;
export type QuestionData = z.output<typeof QuestionInput>;

export type QuestionItem = QuestionData & { id: string; createdAt: string; updatedAt: string; createdBy: string | null };
export type QuestionListItem = Pick<QuestionItem, "id" | "title" | "file" | "durationMinutes" | "updatedAt"> & { tests: number; hiddenTests: number; criteria: number };

export const ScheduleInterviewInput = z.object({
  questionId: z.uuid(),
  candidateName: z.string().trim().min(1, "Name the candidate.").max(200),
  candidateEmail: z.email().max(320).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  /** The question's own length when left out. */
  durationMinutes: z.number().int().min(5).max(480).optional(),
  /** Email the link to the candidate (needs candidateEmail). */
  sendEmail: z.boolean().default(false),
});
export type ScheduleInterviewInput = z.input<typeof ScheduleInterviewInput>;
export type ScheduleInterviewData = z.output<typeof ScheduleInterviewInput>;

export const INTERVIEW_STATUSES = ["scheduled", "live", "finished", "cancelled"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type InterviewListItem = {
  id: string;
  roomId: string;
  title: string;
  candidateName: string;
  candidateEmail: string | null;
  interviewer: { id: string; name: string } | null;
  status: InterviewStatus;
  scheduledAt: string | null;
  durationMinutes: number;
  startedAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  candidateJoined: boolean;
  createdAt: string;
};

export type ScheduledInterview = InterviewListItem & {
  /** The single-use link's token: shown when it's made, and never again (only its hash is kept). */
  candidateToken: string;
  /** Whether the email went out, when one was asked for. */
  emailed: boolean;
};

/** A run's result as anyone in the room sees it. Hidden cases are only counted. */
export type VisibleCaseResult = { id: string; input: string; expected: string; verdict: string; stdout: string; stderr: string; timeMs: number };
export type CandidateRun = {
  id: string;
  at: string;
  path: string;
  compileError: string | null;
  visible: VisibleCaseResult[];
  hidden: { passed: number; total: number };
  passed: number;
  total: number;
};
/** What interviewers see of a run: every case, with its input, output and verdict. */
export type InterviewerRun = CandidateRun & { by: string | null; hiddenCases: VisibleCaseResult[] };

/** What everyone in the room may know. The clock comes from the server: browsers count down to `endsAt` from `now`. */
export type CandidateInterview = {
  id: string;
  roomId: string;
  title: string;
  candidateName: string;
  interviewerName: string | null;
  status: InterviewStatus;
  startedAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  durationMinutes: number;
  /** The server's clock when this was answered. */
  now: string;
  prompt: string;
  file: string;
  timeLimitMs: number;
  visibleTests: Array<Pick<InterviewTest, "id" | "input" | "expected">>;
  hiddenTestCount: number;
  runs: CandidateRun[];
};

export const Scorecard = z.object({
  scores: z.array(z.object({ id: z.string().min(1).max(64), score: z.number().int().min(1).max(5).nullable(), note: z.string().max(5000) })).max(20),
  overall: z.number().int().min(1).max(5).nullable(),
  recommendation: z.enum(["yes", "maybe", "no"]).nullable(),
  notes: z.string().max(20_000),
});
export type Scorecard = z.infer<typeof Scorecard>;

/** What interviewers see in addition. Never sent to the candidate. */
export type InterviewerInterview = Omit<CandidateInterview, "runs"> & {
  role: "interviewer";
  candidateEmail: string | null;
  candidateJoined: boolean;
  hiddenTests: Array<Pick<InterviewTest, "id" | "input" | "expected">>;
  rubric: InterviewCriterion[];
  scorecard: Scorecard;
  runs: InterviewerRun[];
};

export type RoomInterview = (CandidateInterview & { role: "candidate" }) | InterviewerInterview;

/** The candidate's landing page, reachable without an account. */
export type InterviewInvitation = {
  title: string;
  candidateName: string;
  interviewerName: string | null;
  durationMinutes: number;
  scheduledAt: string | null;
  status: InterviewStatus;
  /** The link has been used already; only that person can get back in. */
  used: boolean;
};

export const InterviewId = z.uuid();
export const InterviewToken = z.string().min(16).max(200);
/** Who used the link. `waiting`: it hasn't started, so they aren't in the room yet. */
export type JoinedInterview = { roomId: string; interviewId: string; waiting: boolean };

export const ExtendInterviewInput = z.object({ minutes: z.number().int().min(1).max(120) });

export const RunInterviewTestsInput = z.object({ stateVector: z.string().max(200_000).default("") });

/** What the replay shows: the room's edits as moments in time, with runs and chat on the same line. */
export type ReplayEvent =
  | { kind: "run"; at: string; passed: number; total: number; by: string | null; compileError: boolean }
  | { kind: "chat"; at: string; by: string | null; text: string };
export type InterviewReplay = {
  startedAt: string | null;
  finishedAt: string | null;
  /** Update times for the slider, thinned to at most a few hundred points. */
  moments: string[];
  events: ReplayEvent[];
};
