import { z } from "zod";

import { WorkspacePath } from "./run.js";

/**
 * Interviews and assessments: an organisation's question bank, scheduling one candidate or
 * many, the single-use candidate link, the server's timer, tests with hidden cases, multiple
 * choice marked by the server, a private scorecard, an integrity record and a replay.
 *
 * An interview is live, on video: an interviewer starts it, asks questions as it goes (from
 * the bank or made up on the spot), decides whether AI is allowed, and evaluates there and
 * then. An assessment is a test with nobody watching: the candidate starts it within a
 * window, and the paper is fixed.
 *
 * What a candidate may see is decided here, by type: `CandidateInterview` carries no
 * hidden test, right answer, rubric, scorecard or integrity record, and a run's hidden cases
 * come back as counts only.
 */

export const INTERVIEW_MODES = ["interview", "assessment"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

/** System design: the candidate draws in the room's Diagrams or Board and explains it in writing, and a person marks it. */
export const QUESTION_KINDS = ["coding", "mcq", "short", "design"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

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

export const QuestionChoice = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1, "A choice can't be empty.").max(2000),
  correct: z.boolean(),
});
export type QuestionChoice = z.infer<typeof QuestionChoice>;

export const QuestionInput = z
  .object({
    kind: z.enum(QUESTION_KINDS).default("coding"),
    title: z.string().trim().min(1, "Give the question a title.").max(200),
    prompt: z.string().max(50_000).default(""),
    difficulty: z.enum(QUESTION_DIFFICULTIES).default("medium"),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10).default([]),
    marks: z.number().int().min(1).max(100).default(1),
    /** Multiple choice. More than one right answer makes it "choose all that apply". */
    choices: z.array(QuestionChoice).max(10).default([]),
    /** Short answers and system designs: what a good one says, for whoever marks it. */
    modelAnswer: z.string().max(10_000).default(""),
    /** Coding: the file the tests run, the files it starts with, its tests. */
    file: z.union([WorkspacePath, z.literal("")]).default(""),
    starterFiles: z.array(z.object({ path: WorkspacePath, content: z.string().max(256 * 1024) })).max(20).default([]),
    tests: z.array(InterviewTest).max(30).default([]),
    rubric: z.array(InterviewCriterion).max(20).default([]),
    durationMinutes: z.number().int().min(5).max(480).default(60),
    timeLimitMs: z.number().int().min(500).max(20_000).default(2000),
  })
  .superRefine((question, context) => {
    const problem = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (question.kind === "coding") {
      if (question.starterFiles.length === 0) problem("starterFiles", "A question needs at least one file.");
      else if (!question.starterFiles.some((file) => file.path === question.file)) problem("file", "The file the tests run must be one of the starter files.");
      if (new Set(question.starterFiles.map((file) => file.path)).size !== question.starterFiles.length) problem("starterFiles", "Two starter files have the same path.");
      if (new Set(question.tests.map((test) => test.id)).size !== question.tests.length) problem("tests", "Two tests have the same id.");
    }
    if (question.kind === "mcq") {
      if (question.choices.length < 2) problem("choices", "A multiple choice question needs at least two choices.");
      if (!question.choices.some((choice) => choice.correct)) problem("choices", "Mark at least one choice as right.");
      if (new Set(question.choices.map((choice) => choice.id)).size !== question.choices.length) problem("choices", "Two choices have the same id.");
    }
  });
export type QuestionInput = z.input<typeof QuestionInput>;
export type QuestionData = z.output<typeof QuestionInput>;

export type QuestionItem = QuestionData & { id: string; createdAt: string; updatedAt: string; createdBy: string | null };
export type QuestionListItem = Pick<QuestionItem, "id" | "kind" | "title" | "file" | "difficulty" | "tags" | "marks" | "durationMinutes" | "updatedAt"> & { tests: number; hiddenTests: number; criteria: number; choices: number };

export const MOST_IMPORTED = 200;
export const ImportQuestionsInput = z.object({ questions: z.array(QuestionInput).min(1, "There's nothing to import.").max(MOST_IMPORTED, `At most ${MOST_IMPORTED} questions at a time.`) });
export type ImportQuestionsData = z.output<typeof ImportQuestionsInput>;

/** Cells of a pasted table: tabs from a spreadsheet, or commas with quotes as in a CSV. */
function tableRows(text: string): string[][] {
  const delimiter = text.split(/\r?\n/, 1)[0]!.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * Questions from pasted text. A JSON array of questions, for any kind. Or a table from a
 * spreadsheet, with a header naming its columns: `question`, a column per choice (`a`, `b`, `c`...),
 * `answer` (letters, like `b` or `a;c`), and any of `kind`, `difficulty`, `marks`, `tags` (split by
 * semicolons) and `model answer`. A long question keeps its whole text as the prompt.
 *
 * It says which lines are wrong and imports none of them until they're all right: half a bank
 * is harder to fix than a paste.
 */
export function parseQuestionImport(text: string): { questions: QuestionData[]; problems: string[] } {
  const questions: QuestionData[] = [];
  const problems: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { questions, problems };

  const add = (label: string, input: unknown) => {
    const parsed = QuestionInput.safeParse(input);
    if (parsed.success) questions.push(parsed.data);
    else problems.push(`${label}: ${parsed.error.issues[0]?.message ?? "It doesn't look right."}`);
  };

  if (trimmed.startsWith("[")) {
    let list: unknown;
    try {
      list = JSON.parse(trimmed);
    } catch {
      return { questions, problems: ["That JSON doesn't parse."] };
    }
    if (!Array.isArray(list)) return { questions, problems: ["Expected a list of questions."] };
    list.forEach((item, index) => add(`Question ${index + 1}`, item));
    return { questions, problems };
  }

  const [header, ...rows] = tableRows(trimmed);
  const columns = header!.map((name) => name.trim().toLowerCase());
  const at = (row: string[], name: string) => {
    const index = columns.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };
  if (!columns.includes("question")) return { questions, problems: ["The first line has to name the columns, with one called \"question\"."] };
  const letters = columns.filter((name) => /^[a-j]$/.test(name));

  rows.forEach((row, index) => {
    if (row.every((cell) => !cell.trim())) return;
    const line = `Line ${index + 2}`;
    const asked = at(row, "question");
    const choiceLetters = letters.filter((letter) => at(row, letter));
    const answer = at(row, "answer").toLowerCase().split(/[;,\s]+/).filter(Boolean);
    const unknown = answer.find((letter) => !choiceLetters.includes(letter));
    if (choiceLetters.length && unknown) return void problems.push(`${line}: the answer "${unknown}" isn't one of its choices.`);
    const marks = at(row, "marks");
    add(line, {
      kind: at(row, "kind").toLowerCase() || (choiceLetters.length ? "mcq" : "short"),
      title: asked.length > 120 ? `${asked.slice(0, 117)}...` : asked,
      prompt: asked.length > 120 ? asked : "",
      difficulty: at(row, "difficulty").toLowerCase() || "medium",
      tags: at(row, "tags").split(";").map((tag) => tag.trim()).filter(Boolean),
      marks: marks ? Number(marks) : 1,
      choices: choiceLetters.map((letter) => ({ id: letter, text: at(row, letter), correct: answer.includes(letter) })),
      modelAnswer: at(row, "model answer"),
    });
  });
  return { questions, problems };
}

/** N questions drawn at random, narrowed by kind, difficulty and tag. */
export const PaperRule = z.object({
  count: z.number().int().min(1, "Draw at least one question.").max(100),
  kind: z.enum(QUESTION_KINDS).optional(),
  difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
  tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
});
export type PaperRule = z.infer<typeof PaperRule>;

/** What goes on each candidate's paper: these questions for everyone, and these random draws for each. */
export const PaperSpec = z.object({ fixed: z.array(z.uuid()).max(100).default([]), random: z.array(PaperRule).max(20).default([]) });
export type PaperSpec = z.output<typeof PaperSpec>;

/** One question on a candidate's paper, right answers included. Only interviewers and the server see this. */
export type PaperQuestion = {
  id: string;
  bankId: string | null;
  kind: QuestionKind;
  title: string;
  prompt: string;
  marks: number;
  difficulty: QuestionDifficulty;
  choices: QuestionChoice[];
  modelAnswer: string;
  file: string;
  tests: InterviewTest[];
  timeLimitMs: number;
  /** Its files in the room, for a question asked during an interview. */
  starterFiles: Array<{ path: string; content: string }>;
  /** In an interview, the candidate sees a question from when it's asked. */
  askedAt: string | null;
};

/** A question the interviewer makes up during the interview. */
export const AdhocQuestion = z
  .object({
    kind: z.enum(QUESTION_KINDS).default("coding"),
    title: z.string().trim().min(1, "Give the question a title.").max(200),
    prompt: z.string().max(50_000).default(""),
    marks: z.number().int().min(1).max(100).default(10),
    /** Coding: the file to write it in. */
    file: z.union([WorkspacePath, z.literal("")]).default("main.py"),
    choices: z.array(QuestionChoice).max(10).default([]),
  })
  .superRefine((question, context) => {
    if (question.kind !== "mcq") return;
    if (question.choices.length < 2) context.addIssue({ code: "custom", path: ["choices"], message: "A multiple choice question needs at least two choices." });
    if (!question.choices.some((choice) => choice.correct)) context.addIssue({ code: "custom", path: ["choices"], message: "Mark at least one choice as right." });
  });
export type AdhocQuestion = z.input<typeof AdhocQuestion>;

/** Ask a question now: one from the bank, one drawn at random, or one made up on the spot. */
export const AskQuestionInput = z.union([
  z.object({ bankId: z.uuid() }),
  z.object({ random: PaperRule.omit({ count: true }) }),
  z.object({ adhoc: AdhocQuestion }),
]);
export type AskQuestionInput = z.input<typeof AskQuestionInput>;
export type AskQuestionData = z.output<typeof AskQuestionInput>;

export const SetInterviewAiInput = z.object({ allowed: z.boolean() });

/** The same for a candidate: no right answers, no hidden tests. */
export type CandidatePaperQuestion = Pick<PaperQuestion, "id" | "kind" | "title" | "prompt" | "marks" | "file" | "timeLimitMs"> & {
  choices: Array<{ id: string; text: string }>;
  /** "Choose all that apply." */
  multiple: boolean;
  visibleTests: Array<Pick<InterviewTest, "id" | "input" | "expected">>;
  hiddenTestCount: number;
};

export const SaveAnswerInput = z.object({
  choiceIds: z.array(z.string().min(1).max(64)).max(10).default([]),
  text: z.string().max(20_000).default(""),
});
export type SaveAnswerInput = z.input<typeof SaveAnswerInput>;
export type CandidateAnswer = { questionId: string; choiceIds: string[]; text: string; at: string };
/** What interviewers see of an answer. `awarded` is null for one a person hasn't marked yet. */
export type GradedAnswer = CandidateAnswer & { awarded: number | null };
export const MarkAnswerInput = z.object({ marks: z.number().int().min(0).max(100) });

export type PaperScore = {
  marks: number;
  max: number;
  /** Short answers and designs waiting for a person to mark them. */
  unmarked: number;
  byKind: Record<QuestionKind, { marks: number; max: number }>;
};

// The integrity record.

/** What the candidate's page reports about itself. It could be suppressed, which is why the server also notices the page going quiet. */
export const BROWSER_INTEGRITY_KINDS = ["tab-hidden", "window-blur", "fullscreen-left", "pasted", "paste-blocked", "copy-blocked", "second-screen"] as const;
/** What the server sees for itself. */
export const SERVER_INTEGRITY_KINDS = ["second-session", "network-changed", "page-silent", "ai-on", "ai-off", "ai-used"] as const;
export type IntegrityKind = (typeof BROWSER_INTEGRITY_KINDS)[number] | (typeof SERVER_INTEGRITY_KINDS)[number];

export const INTEGRITY_LABEL: Record<IntegrityKind, string> = {
  "tab-hidden": "Left the tab",
  "window-blur": "Left the window",
  "fullscreen-left": "Left full screen",
  pasted: "Pasted from outside",
  "paste-blocked": "Tried to paste",
  "copy-blocked": "Tried to copy a question",
  "second-screen": "Has a second screen",
  "second-session": "Open in a second tab or device",
  "network-changed": "Changed network",
  "page-silent": "The page stopped reporting",
  "ai-on": "AI allowed by the interviewer",
  "ai-off": "AI turned off by the interviewer",
  "ai-used": "Used the AI",
};

export const HeartbeatInput = z.object({
  /** Made by the page when it loads: two at once means two tabs or devices. */
  sessionId: z.uuid(),
  events: z.array(z.object({ kind: z.enum(BROWSER_INTEGRITY_KINDS), at: z.iso.datetime({ offset: true }), length: z.number().int().min(0).max(100_000_000).optional() })).max(50).default([]),
});
export type HeartbeatInput = z.input<typeof HeartbeatInput>;

export type IntegrityEvent = { id: string; kind: IntegrityKind; source: "browser" | "server"; at: string; length?: number; seconds?: number };
export type IntegrityLevel = "clear" | "look" | "concern";
export type IntegrityReport = {
  events: IntegrityEvent[];
  counts: Partial<Record<IntegrityKind, number>>;
  /** Edits of a lot of text at once in the room's files: pasting, or a program writing a file. Counted by the server. */
  bigEdits: number;
  level: IntegrityLevel;
};

/**
 * How much there is to look at, for a person to weigh. Leaving a tab now and then is normal;
 * a second device, or lots of pasting, isn't. It never fails anyone by itself.
 */
export function integrityLevel(counts: IntegrityReport["counts"], bigEdits: number): IntegrityLevel {
  const n = (kind: IntegrityKind) => counts[kind] ?? 0;
  if (n("second-session") > 0 || n("pasted") >= 5 || n("tab-hidden") >= 15 || n("page-silent") >= 3) return "concern";
  if (n("pasted") > 0 || n("paste-blocked") > 0 || n("copy-blocked") > 0 || n("tab-hidden") >= 3 || n("window-blur") >= 5 || n("fullscreen-left") > 0 || n("network-changed") > 0 || n("page-silent") > 0 || bigEdits > 2) return "look";
  return "clear";
}

export const ScheduleInterviewInput = z.object({
  /** Left out, the interviewer chooses during the interview. */
  questionId: z.uuid().optional(),
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

export const BatchCandidate = z.object({
  name: z.string().trim().min(1, "A candidate needs a name.").max(200),
  email: z.email("One of the emails doesn't look right.").max(320).optional(),
});
export type BatchCandidate = z.infer<typeof BatchCandidate>;

/** Interviews or an assessment for many people at once. */
export const ScheduleBatchInput = z
  .object({
    mode: z.enum(INTERVIEW_MODES),
    title: z.string().trim().min(1, "Give it a name.").max(200),
    candidates: z.array(BatchCandidate).min(1, "Add at least one candidate.").max(200, "At most 200 candidates at a time."),
    /** An interview can leave this empty and ask as it goes. An assessment's paper is fixed. */
    paper: PaperSpec.default({ fixed: [], random: [] }),
    durationMinutes: z.number().int().min(5).max(480),
    /** An interview: when it's planned for. An assessment: when it opens (now if left out). */
    startsAt: z.iso.datetime({ offset: true }).optional(),
    /** An assessment: the last moment to start it. */
    closesAt: z.iso.datetime({ offset: true }).optional(),
    fullscreen: z.boolean().default(false),
    lockClipboard: z.boolean().default(false),
    sendEmail: z.boolean().default(false),
  })
  .refine((batch) => batch.mode === "interview" || batch.paper.fixed.length + batch.paper.random.length > 0, { path: ["paper"], message: "Add at least one question." })
  .refine((batch) => !batch.startsAt || !batch.closesAt || Date.parse(batch.startsAt) < Date.parse(batch.closesAt), { path: ["closesAt"], message: "It has to close after it opens." })
  .refine((batch) => new Set(batch.candidates.flatMap((candidate) => (candidate.email ? [candidate.email.toLowerCase()] : []))).size === batch.candidates.filter((candidate) => candidate.email).length, { path: ["candidates"], message: "The same email is on the list twice." })
  .refine((batch) => !batch.sendEmail || batch.candidates.every((candidate) => candidate.email), { path: ["candidates"], message: "To email the links, every candidate needs an email." });
export type ScheduleBatchInput = z.input<typeof ScheduleBatchInput>;
export type ScheduleBatchData = z.output<typeof ScheduleBatchInput>;

/**
 * Candidates from pasted text, one a line: "Ana Ruiz, ana@x.com", "Ana Ruiz <ana@x.com>", tabs
 * from a spreadsheet, "ana@x.com" alone (the name comes from the address) or a name alone.
 */
export function parseCandidates(text: string): { candidates: BatchCandidate[]; problems: string[] } {
  const candidates: BatchCandidate[] = [];
  const problems: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const address = /[^\s,;<>"]+@[^\s,;<>"]+/.exec(trimmed)?.[0];
    const name = (address ? trimmed.replace(address, "") : trimmed).replace(/[<>"]/g, " ").replace(/[,;\t]+/g, " ").replace(/\s+/g, " ").trim();
    const parsed = BatchCandidate.safeParse({ name: name || address?.split("@")[0]?.replace(/[._-]+/g, " ") || "", ...(address && { email: address }) });
    if (parsed.success) candidates.push(parsed.data);
    else problems.push(trimmed.slice(0, 80));
  }
  return { candidates, problems };
}

export const INTERVIEW_STATUSES = ["scheduled", "live", "finished", "cancelled", "missed"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type InterviewListItem = {
  id: string;
  roomId: string;
  mode: InterviewMode;
  batchId: string | null;
  questionCount: number;
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

/** Each candidate's link, shown once, and whether their email went out. */
export type BatchLink = { interviewId: string; candidateName: string; candidateEmail: string | null; candidateToken: string; emailed: boolean };
export type ScheduledBatch = { id: string; mode: InterviewMode; title: string; links: BatchLink[]; failed: Array<{ candidateName: string; reason: string }> };
export type BatchListItem = {
  id: string;
  mode: InterviewMode;
  title: string;
  durationMinutes: number;
  opensAt: string | null;
  closesAt: string | null;
  createdAt: string;
  candidates: number;
  started: number;
  finished: number;
};
/** A candidate's line in the results table. */
export type BatchResultRow = {
  interviewId: string;
  roomId: string;
  candidateName: string;
  candidateEmail: string | null;
  joined: boolean;
  status: InterviewStatus;
  startedAt: string | null;
  finishedAt: string | null;
  answered: number;
  questions: number;
  score: PaperScore;
  integrity: { level: IntegrityLevel; counts: IntegrityReport["counts"]; bigEdits: number };
  recommendation: "yes" | "maybe" | "no" | null;
};
export type BatchResults = BatchListItem & { fullscreen: boolean; lockClipboard: boolean; rows: BatchResultRow[] };

/** A run's result as anyone in the room sees it. Hidden cases are only counted. */
export type VisibleCaseResult = { id: string; input: string; expected: string; verdict: string; stdout: string; stderr: string; timeMs: number };
export type CandidateRun = {
  id: string;
  /** Which of the paper's coding questions; null for an interview of one question. */
  questionId: string | null;
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
  mode: InterviewMode;
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
  /** Their questions, once it has started. Empty for an interview of one question. */
  paper: CandidatePaperQuestion[];
  answers: CandidateAnswer[];
  fullscreen: boolean;
  lockClipboard: boolean;
  /** Whether the candidate may use the AI. */
  aiAllowed: boolean;
};

export const Scorecard = z.object({
  scores: z.array(z.object({ id: z.string().min(1).max(64), score: z.number().int().min(1).max(5).nullable(), note: z.string().max(5000) })).max(20),
  overall: z.number().int().min(1).max(5).nullable(),
  recommendation: z.enum(["yes", "maybe", "no"]).nullable(),
  notes: z.string().max(20_000),
});
export type Scorecard = z.infer<typeof Scorecard>;

/** What interviewers see in addition. Never sent to the candidate. */
export type InterviewerInterview = Omit<CandidateInterview, "runs" | "paper" | "answers"> & {
  role: "interviewer";
  paper: PaperQuestion[];
  answers: GradedAnswer[];
  score: PaperScore;
  integrity: IntegrityReport;
  batchId: string | null;
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
  mode: InterviewMode;
  title: string;
  /** How many of each kind of question, and no more than that. Null for one coding question. */
  questions: Record<QuestionKind, number> | null;
  /** An assessment can be started in this window. */
  opensAt: string | null;
  closesAt: string | null;
  fullscreen: boolean;
  lockClipboard: boolean;
  /** The server's clock, so a wrong clock doesn't change when the window looks open. */
  now: string;
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

/** What asking a question gives back: the interview, and the question, whose files the interviewer's browser adds to the room. */
export type AskedQuestion = { interview: InterviewerInterview; question: PaperQuestion };

export const RunInterviewTestsInput = z.object({
  stateVector: z.string().max(200_000).default(""),
  /** Which of the paper's coding questions. */
  questionId: z.string().min(1).max(64).optional(),
});

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
