/** What each person may see of an interview: the one place hidden tests, the rubric and the scorecard are kept from candidates. */
import type { CandidateInterview, CandidateRun, InterviewerInterview, InterviewerRun, InterviewListItem, Scorecard, VisibleCaseResult } from "@codechatter/contracts";
import type { schema } from "@codechatter/db";

export type InterviewRow = typeof schema.interviews.$inferSelect;
export type RunRow = typeof schema.interviewRuns.$inferSelect & { byName?: string | null };
type Test = InterviewRow["question"]["tests"][number];

const caseResult = (result: RunRow["results"][number], test: Test | undefined): VisibleCaseResult => ({
  id: result.id,
  input: test?.input ?? "",
  expected: test?.expected ?? "",
  verdict: result.verdict,
  stdout: result.stdout,
  stderr: result.stderr,
  timeMs: result.timeMs,
});

/** A run for a candidate: visible cases in full, hidden ones only counted. */
export function candidateRun(run: RunRow, tests: readonly Test[]): CandidateRun {
  const byId = new Map(tests.map((test) => [test.id, test]));
  const hidden = run.results.filter((result) => result.hidden);
  return {
    id: run.id,
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

/**
 * What everyone in the room may know. Before it starts there's no question at all: the
 * candidate isn't a member yet, and nothing here should depend on that alone.
 */
export function candidateInterview(row: InterviewRow, runs: readonly RunRow[], interviewerName: string | null, now: Date): CandidateInterview {
  const started = row.status !== "scheduled";
  const tests = row.question.tests;
  return {
    id: row.id,
    roomId: row.roomId,
    title: started ? row.question.title : "Interview",
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
    runs: runs.map((run) => candidateRun(run, tests)),
  };
}

/** A scorecard with a row for every criterion in the rubric, whatever was saved before. */
export function fullScorecard(row: InterviewRow): Scorecard {
  const saved = new Map(row.scorecard.scores.map((score) => [score.id, score]));
  return { ...row.scorecard, scores: row.question.rubric.map(({ id }) => saved.get(id) ?? { id, score: null, note: "" }) };
}

export function interviewerInterview(row: InterviewRow, runs: readonly RunRow[], interviewerName: string | null, now: Date): InterviewerInterview {
  const tests = row.question.tests;
  return {
    ...candidateInterview(row, [], interviewerName, now),
    // Interviewers see the question before it starts, too.
    title: row.question.title,
    prompt: row.question.prompt,
    visibleTests: tests.filter((test) => !test.hidden).map(({ id, input, expected }) => ({ id, input, expected })),
    hiddenTestCount: tests.filter((test) => test.hidden).length,
    role: "interviewer",
    candidateEmail: row.candidateEmail,
    candidateJoined: row.candidateUserId !== null,
    hiddenTests: tests.filter((test) => test.hidden).map(({ id, input, expected }) => ({ id, input, expected })),
    rubric: row.question.rubric,
    scorecard: fullScorecard(row),
    runs: runs.map((run) => interviewerRun(run, tests)),
  };
}
