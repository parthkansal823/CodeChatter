import { describe, expect, it } from "vitest";

import { candidateInterview, fullScorecard, interviewerInterview, type InterviewRow, type RunRow } from "./views.js";

const NOW = new Date("2026-11-06T10:00:00Z");
const row = (status: InterviewRow["status"] = "live"): InterviewRow => ({
  id: "i1",
  orgId: "o1",
  roomId: "AB12CD",
  questionId: "q1",
  question: {
    title: "SECRET-TITLE two sum",
    prompt: "SECRET-PROMPT add the numbers",
    file: "main.py",
    starterFiles: [{ path: "main.py", content: "SECRET-STARTER" }],
    tests: [
      { id: "v1", input: "visible-in", expected: "visible-out", hidden: false },
      { id: "h1", input: "HIDDEN-INPUT", expected: "HIDDEN-EXPECTED", hidden: true },
    ],
    rubric: [{ id: "c1", label: "RUBRIC-LABEL" }],
    timeLimitMs: 2000,
  },
  candidateName: "Ana",
  candidateEmail: "CANDIDATE-EMAIL@example.com",
  interviewerId: "u1",
  status,
  scheduledAt: null,
  durationMinutes: 60,
  startedAt: status === "scheduled" ? null : NOW,
  endsAt: status === "scheduled" ? null : new Date(NOW.getTime() + 3600_000),
  finishedAt: null,
  candidateTokenHash: "TOKEN-HASH",
  candidateUserId: "u2",
  candidateJoinedAt: NOW,
  scorecard: { scores: [{ id: "c1", score: 4, note: "SCORE-NOTE" }], overall: 4, recommendation: "yes", notes: "PRIVATE-NOTES" },
  createdAt: NOW,
  updatedAt: NOW,
});
const run: RunRow = {
  id: "r1",
  interviewId: "i1",
  userId: "u2",
  path: "main.py",
  compileError: null,
  results: [
    { id: "v1", hidden: false, verdict: "passed", stdout: "visible-out", stderr: "", timeMs: 5 },
    { id: "h1", hidden: true, verdict: "failed", stdout: "HIDDEN-STDOUT", stderr: "HIDDEN-STDERR", timeMs: 6 },
  ],
  passed: 1,
  total: 2,
  createdAt: NOW,
  byName: "Ana",
};

describe("what a candidate sees", () => {
  const seen = JSON.stringify(candidateInterview(row(), [run], "Bo", NOW));

  it("never includes hidden tests, their output, the rubric, the scorecard or the link", () => {
    for (const secret of ["HIDDEN-INPUT", "HIDDEN-EXPECTED", "HIDDEN-STDOUT", "HIDDEN-STDERR", "RUBRIC-LABEL", "SCORE-NOTE", "PRIVATE-NOTES", "TOKEN-HASH", "CANDIDATE-EMAIL"]) {
      expect(seen, secret).not.toContain(secret);
    }
  });

  it("includes the question, visible tests with results, and hidden tests as counts", () => {
    const view = candidateInterview(row(), [run], "Bo", NOW);
    expect(view.prompt).toContain("add the numbers");
    expect(view.visibleTests).toEqual([{ id: "v1", input: "visible-in", expected: "visible-out" }]);
    expect(view.hiddenTestCount).toBe(1);
    expect(view.runs[0]!.visible[0]!.stdout).toBe("visible-out");
    expect(view.runs[0]!.hidden).toEqual({ passed: 0, total: 1 });
    expect(view.now).toBe(NOW.toISOString());
  });

  it("shows nothing of the question before it starts", () => {
    const seenEarly = JSON.stringify(candidateInterview(row("scheduled"), [], "Bo", NOW));
    for (const secret of ["SECRET-TITLE", "SECRET-PROMPT", "SECRET-STARTER", "visible-in"]) expect(seenEarly, secret).not.toContain(secret);
  });
});

describe("what an interviewer sees", () => {
  it("includes everything, before it starts too", () => {
    const view = interviewerInterview(row("scheduled"), [run], "Bo", NOW);
    expect(view.prompt).toContain("add the numbers");
    expect(view.hiddenTests[0]!.input).toBe("HIDDEN-INPUT");
    expect(view.rubric[0]!.label).toBe("RUBRIC-LABEL");
    expect(view.scorecard.notes).toBe("PRIVATE-NOTES");
    expect(view.runs[0]!.hiddenCases[0]).toMatchObject({ input: "HIDDEN-INPUT", expected: "HIDDEN-EXPECTED", stdout: "HIDDEN-STDOUT", verdict: "failed" });
    expect(view.runs[0]!.by).toBe("Ana");
  });

  it("never gets the link's hash", () => {
    expect(JSON.stringify(interviewerInterview(row(), [run], "Bo", NOW))).not.toContain("TOKEN-HASH");
  });
});

describe("fullScorecard", () => {
  it("has a row for every criterion, in the rubric's order, keeping what was saved", () => {
    const interview = row();
    interview.question.rubric = [{ id: "c2", label: "Two" }, { id: "c1", label: "One" }];
    expect(fullScorecard(interview).scores).toEqual([{ id: "c2", score: null, note: "" }, { id: "c1", score: 4, note: "SCORE-NOTE" }]);
  });
});
