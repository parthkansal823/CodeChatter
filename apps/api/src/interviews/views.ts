/** What each person may see of an interview: the one place hidden tests, right answers, the rubric, the scorecard and the integrity record are kept from candidates. */
import type { CandidateAnswer, CandidateInterview, CandidatePaperQuestion, CandidateRun, GradedAnswer, InterviewerInterview, InterviewerRun, IntegrityEvent, IntegrityKind, InterviewListItem, PaperQuestion, Scorecard, VisibleCaseResult } from "@codechatter/contracts";
import type { schema } from "@codechatter/db";

import { askedOf, integrityReport, scorePaper } from "./paper.js";

export type InterviewRow = typeof schema.interviews.$inferSelect;
export type RunRow = typeof schema.interviewRuns.$inferSelect & { byName?: string | null };
export type AnswerRow = typeof schema.interviewAnswers.$inferSelect;
export type EventRow = typeof schema.interviewEvents.$inferSelect;
type Test = InterviewRow["question"]["tests"][number];
/** Every run's score, not only the ones shown: a coding question counts its best. */
type RunScore = { questionId: string | null; passed: number; total: number };

const caseResult = (result: RunRow["results"][number], test: Test | undefined): VisibleCaseResult => ({
  id: result.id,
  input: test?.input ?? "",
  expected: test?.expected ?? "",
  verdict: result.verdict,
  stdout: result.stdout,
  stderr: result.stderr,
  timeMs: result.timeMs,
});

/** A run's tests: its question's on a paper, otherwise the interview's one question. */
export const testsOf = (row: Pick<InterviewRow, "paper" | "question">, questionId: string | null | undefined): readonly Test[] =>
  questionId ? (row.paper.find((question) => question.id === questionId)?.tests ?? []) : row.question.tests;

/** A run for a candidate: visible cases in full, hidden ones only counted. */
export function candidateRun(run: RunRow, tests: readonly Test[]): CandidateRun {
  const byId = new Map(tests.map((test) => [test.id, test]));
  const hidden = run.results.filter((result) => result.hidden);
  return {
    id: run.id,
    questionId: run.questionId ?? null,
    at: run.createdAt.toISOString(),
    path: run.path,
    compileError: run.compileError,
    visible: run.results.filter((result) => !result.hidden).map((result) => caseResult(result, byId.get(result.id))),
    hidden: { passed: hidden.filter((result) => result.verdict === "passed").length, total: tests.filter((test) => test.hidden).length },
    passed: run.passed,
    total: run.total,
  };
}

export function interviewerRun(run: RunRow, tests: readonly Test[]): InterviewerRun {
  const byId = new Map(tests.map((test) => [test.id, test]));
  return {
    ...candidateRun(run, tests),
    by: run.byName ?? null,
    hiddenCases: run.results.filter((result) => result.hidden).map((result) => caseResult(result, byId.get(result.id))),
  };
}

export function interviewListItem(row: InterviewRow, interviewerName: string | null): InterviewListItem {
  return {
    id: row.id,
    roomId: row.roomId,
    mode: row.mode,
    batchId: row.batchId,
    questionCount: row.paper.length || (row.question.file ? 1 : 0),
    title: row.question.title,
    candidateName: row.candidateName,
    candidateEmail: row.candidateEmail,
    interviewer: row.interviewerId ? { id: row.interviewerId, name: interviewerName ?? "" } : null,
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    durationMinutes: row.durationMinutes,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    candidateJoined: row.candidateUserId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A question as a candidate sees it: no right answers, no hidden tests, no notes for whoever marks it. */
export function candidateQuestion(question: PaperQuestion): CandidatePaperQuestion {
  return {
    id: question.id,
    kind: question.kind,
    title: question.title,
    prompt: question.prompt,
    marks: question.marks,
    file: question.file,
    timeLimitMs: question.timeLimitMs,
    choices: question.choices.map(({ id, text }) => ({ id, text })),
    multiple: question.choices.filter((choice) => choice.correct).length > 1,
    visibleTests: question.tests.filter((test) => !test.hidden).map(({ id, input, expected }) => ({ id, input, expected })),
    hiddenTestCount: question.tests.filter((test) => test.hidden).length,
  };
}

const answerOf = (row: AnswerRow): CandidateAnswer => ({ questionId: row.questionId, choiceIds: row.choiceIds, text: row.text, at: row.updatedAt.toISOString() });
const gradedOf = (row: AnswerRow): GradedAnswer => ({ ...answerOf(row), awarded: row.awarded });
const eventOf = (row: EventRow): IntegrityEvent => ({ id: row.id, kind: row.kind as IntegrityKind, source: row.source, at: row.at.toISOString(), ...row.detail });

/**
 * What everyone in the room may know. Before it starts there's no question at all: the
 * candidate isn't a member yet, and nothing here should depend on that alone.
 */
export function candidateInterview(row: InterviewRow, runs: readonly RunRow[], interviewerName: string | null, now: Date, answers: readonly AnswerRow[] = []): CandidateInterview {
  const started = row.status === "live" || row.status === "finished";
  const tests = row.question.tests;
  const asked = started ? row.paper.filter((question) => askedOf(row.mode, question)) : [];
  const askedIds = new Set(asked.map((question) => question.id));
  return {
    id: row.id,
    roomId: row.roomId,
    mode: row.mode,
    title: started ? row.question.title : row.mode === "assessment" ? "Assessment" : "Interview",
    candidateName: row.candidateName,
    interviewerName,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMinutes: row.durationMinutes,
    now: now.toISOString(),
    prompt: started ? row.question.prompt : "",
    file: row.question.file,
    timeLimitMs: row.question.timeLimitMs,
    visibleTests: started ? tests.filter((test) => !test.hidden).map(({ id, input, expected }) => ({ id, input, expected })) : [],
    hiddenTestCount: started ? tests.filter((test) => test.hidden).length : 0,
    runs: runs.map((run) => candidateRun(run, testsOf(row, run.questionId))),
    paper: asked.map(candidateQuestion),
    answers: answers.filter((answer) => askedIds.has(answer.questionId)).map(answerOf),
    fullscreen: row.fullscreen,
    lockClipboard: row.lockClipboard,
    aiAllowed: row.aiAllowed,
    recordWebcam: row.recordWebcam,
    recordScreen: row.recordScreen,
  };
}

/** A scorecard with a row for every criterion in the rubric, whatever was saved before. */
export function fullScorecard(row: InterviewRow): Scorecard {
  const saved = new Map(row.scorecard.scores.map((score) => [score.id, score]));
  return { ...row.scorecard, scores: row.question.rubric.map(({ id }) => saved.get(id) ?? { id, score: null, note: "" }) };
}

export type InterviewerExtras = { answers?: readonly AnswerRow[]; events?: readonly EventRow[]; bigEdits?: number; runScores?: readonly RunScore[] };

export function interviewerInterview(row: InterviewRow, runs: readonly RunRow[], interviewerName: string | null, now: Date, extras: InterviewerExtras = {}): InterviewerInterview {
  const tests = row.question.tests;
  const answers = (extras.answers ?? []).map(gradedOf);
  return {
    ...candidateInterview(row, [], interviewerName, now),
    // Interviewers see the question before it starts, too.
    title: row.question.title,
    prompt: row.question.prompt,
    visibleTests: tests.filter((test) => !test.hidden).map(({ id, input, expected }) => ({ id, input, expected })),
    hiddenTestCount: tests.filter((test) => test.hidden).length,
    role: "interviewer",
    batchId: row.batchId,
    recordingConsentAt: row.recordingConsentAt?.toISOString() ?? null,
    aiReview: row.aiReview,
    aiReviewRecording: row.aiReviewRecording,
    candidateEmail: row.candidateEmail,
    candidateJoined: row.candidateUserId !== null,
    hiddenTests: tests.filter((test) => test.hidden).map(({ id, input, expected }) => ({ id, input, expected })),
    rubric: row.question.rubric,
    scorecard: fullScorecard(row),
    runs: runs.map((run) => interviewerRun(run, testsOf(row, run.questionId))),
    paper: row.paper,
    answers,
    score: scorePaper(row.paper, answers, extras.runScores ?? []),
    integrity: integrityReport((extras.events ?? []).map(eventOf), extras.bigEdits ?? 0),
  };
}
