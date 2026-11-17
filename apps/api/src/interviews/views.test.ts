import { describe, expect, it } from "vitest";

import { candidateInterview, fullScorecard, interviewerInterview, scorecardView, type InterviewRow, type RunRow, type ScorecardRow } from "./views.js";

const NOW = new Date("2026-11-06T10:00:00Z");
const row = (status: InterviewRow["status"] = "live"): InterviewRow => ({
  id: "i1",
  orgId: "o1",
  roomId: "AB12CD",
  questionId: "q1",
  mode: "interview",
  batchId: null,
  paper: [],
  aiAllowed: false,
  opensAt: null,
  closesAt: null,
  fullscreen: false,
  lockClipboard: false,
  recordWebcam: false,
  recordScreen: false,
  recordingConsentAt: null,
  aiReviewRecording: false,
  aiReview: null,
  beatSession: null,
  beatNetwork: null,
  beatAt: null,
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
  createdAt: NOW,
  updatedAt: NOW,
});
const run: RunRow = {
  id: "r1",
  questionId: null,
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

const secretPaper: InterviewRow["paper"] = [
  {
    id: "q1", bankId: "b1", kind: "mcq", title: "Which?", prompt: "Pick", marks: 2, difficulty: "easy",
    choices: [{ id: "a", text: "Right one", correct: true }, { id: "b", text: "Wrong one", correct: false }],
    modelAnswer: "MODEL-ANSWER", file: "", tests: [], timeLimitMs: 2000, starterFiles: [], askedAt: "2026-11-06T10:00:00Z",
  },
  {
    id: "q2", bankId: "b2", kind: "coding", title: "NOT-ASKED-YET", prompt: "NOT-ASKED-PROMPT", marks: 5, difficulty: "hard",
    choices: [], modelAnswer: "", file: "q2/main.py", tests: [{ id: "t", input: "PAPER-HIDDEN-INPUT", expected: "PAPER-HIDDEN-OUT", hidden: true }], timeLimitMs: 2000, starterFiles: [{ path: "q2/main.py", content: "NOT-ASKED-STARTER" }], askedAt: null,
  },
];

describe("a paper, as a candidate sees it", () => {
  const withPaper = (mode: InterviewRow["mode"], status: InterviewRow["status"] = "live") => ({ ...row(status), mode, paper: secretPaper });
  const answer = { interviewId: "i1", questionId: "q1", choiceIds: ["a"], text: "", awarded: 2, createdAt: NOW, updatedAt: NOW };

  it("never carries a right answer or a mark", () => {
    const seen = JSON.stringify(candidateInterview(withPaper("interview"), [], "Bo", NOW, [answer]));
    expect(seen).toContain("Right one");
    expect(seen).not.toContain("correct");
    expect(seen).not.toContain("awarded");
    expect(seen).not.toContain("MODEL-ANSWER");
  });

  it("in an interview, shows only what's been asked, files included", () => {
    const seen = JSON.stringify(candidateInterview(withPaper("interview"), [], "Bo", NOW));
    expect(seen).not.toContain("NOT-ASKED");
    expect(candidateInterview(withPaper("interview"), [], "Bo", NOW).paper.map((question) => question.id)).toEqual(["q1"]);
  });

  it("in an assessment, shows the whole paper once it's started, without hidden tests or starter files", () => {
    const seen = candidateInterview(withPaper("assessment"), [], "Bo", NOW);
    expect(seen.paper.map((question) => question.id)).toEqual(["q1", "q2"]);
    expect(seen.paper[1]!.hiddenTestCount).toBe(1);
    expect(JSON.stringify(seen)).not.toContain("PAPER-HIDDEN");
    expect(JSON.stringify(seen)).not.toContain("NOT-ASKED-STARTER");
  });

  it("never carries the AI's reading", () => {
    const reviewed = { ...withPaper("assessment"), aiReview: { at: "", model: "m", summary: "AI-SUMMARY", findings: [], questions: [{ question: "AI-QUESTION", about: "" }], looked: { camera: false, screen: false }, note: null } };
    const seen = JSON.stringify(candidateInterview(reviewed, [], "Bo", NOW));
    expect(seen).not.toContain("AI-SUMMARY");
    expect(seen).not.toContain("AI-QUESTION");
    expect(JSON.stringify(interviewerInterview(reviewed, [], "Bo", NOW))).toContain("AI-SUMMARY");
  });

  it("shows nothing of it before it starts, whichever mode", () => {
    for (const mode of ["interview", "assessment"] as const) expect(candidateInterview(withPaper(mode, "scheduled"), [], "Bo", NOW).paper).toEqual([]);
    expect(candidateInterview(withPaper("assessment", "missed"), [], "Bo", NOW).paper).toEqual([]);
    expect(candidateInterview(withPaper("assessment", "scheduled"), [], "Bo", NOW).title).toBe("Assessment");
  });

  it("drops an answer to a question they can't see", () => {
    expect(candidateInterview(withPaper("interview"), [], "Bo", NOW, [{ ...answer, questionId: "q2" }]).answers).toEqual([]);
  });
});

describe("a paper, as an interviewer sees it", () => {
  it("has everything: the unasked questions, right answers, marks and the record", () => {
    const seen = interviewerInterview({ ...row(), paper: secretPaper }, [], "Bo", NOW, {
      answers: [{ interviewId: "i1", questionId: "q1", choiceIds: ["a"], text: "", awarded: 2, createdAt: NOW, updatedAt: NOW }],
      events: [{ id: "e1", interviewId: "i1", kind: "second-session", source: "server", detail: {}, at: NOW }],
      bigEdits: 1,
      runScores: [{ questionId: "q2", passed: 0, total: 1 }],
    });
    expect(seen.paper).toEqual(secretPaper);
    expect(seen.answers[0]!.awarded).toBe(2);
    expect(seen.score).toMatchObject({ marks: 2, max: 7 });
    expect(seen.integrity).toMatchObject({ level: "concern", bigEdits: 1, counts: { "second-session": 1 } });
  });
});

describe("what a candidate sees", () => {
  const contaminated = { ...row(), scorecard: { notes: "PRIVATE-NOTES", scores: [{ note: "SCORE-NOTE" }] }, scorecards: { submitted: [{ notes: "SECOND-PRIVATE" }], summary: { overall: 5 } } };
  const seen = JSON.stringify(candidateInterview(contaminated, [run], "Bo", NOW));

  it("never includes hidden tests, their output, the rubric, the scorecard or the link", () => {
    for (const secret of ["HIDDEN-INPUT", "HIDDEN-EXPECTED", "HIDDEN-STDOUT", "HIDDEN-STDERR", "RUBRIC-LABEL", "SCORE-NOTE", "PRIVATE-NOTES", "SECOND-PRIVATE", "TOKEN-HASH", "CANDIDATE-EMAIL", '"scorecard"', '"scorecards"']) {
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
    const view = interviewerInterview(row("scheduled"), [run], "Bo", NOW, { scorecards: [card()], interviewers, viewer: { userId: "u1", interviewer: true, admin: false } });
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
    expect(fullScorecard(interview, card()).scores).toEqual([{ id: "c2", score: null, note: "" }, { id: "c1", score: 4, note: "SCORE-NOTE" }]);
  });
});

const interviewers = [{ id: "u1", name: "First interviewer", image: null }, { id: "u3", name: "Second interviewer", image: null }];
function card(over: Partial<ScorecardRow> = {}): ScorecardRow {
  return { id: "card1", interviewId: "i1", interviewerId: "u1", scores: [{ id: "c1", score: 4, note: "SCORE-NOTE" }], overall: 4, recommendation: "yes", notes: "PRIVATE-NOTES", submittedAt: null, updatedAt: NOW, interviewerName: "First interviewer", interviewerImage: null, ...over };
}
const second = (over: Partial<ScorecardRow> = {}) => card({ id: "card2", interviewerId: "u3", interviewerName: "Second interviewer", notes: "SECOND-PRIVATE", ...over });
const firstViewer = { userId: "u1", interviewer: true, admin: false };

describe("independent scorecard disclosure", () => {
  it("always supplies an active interviewer's own empty draft", () => {
    const view = scorecardView(row(), [], interviewers, firstViewer);
    expect(view).toMatchObject({ canWrite: true, locked: true, otherSubmittedCount: 0, submitted: [], summary: null });
    expect(view.own).toMatchObject({ interviewer: interviewers[0], submittedAt: null, updatedAt: null, scores: [{ id: "c1", score: null, note: "" }] });
  });

  it("keeps concurrent personal drafts separate and never returns the other's draft", () => {
    const cards = [card(), second()];
    const first = scorecardView(row(), cards, interviewers, firstViewer);
    const other = scorecardView(row(), cards, interviewers, { ...firstViewer, userId: "u3" });
    expect(first.own?.notes).toBe("PRIVATE-NOTES");
    expect(other.own?.notes).toBe("SECOND-PRIVATE");
    expect(JSON.stringify(first)).not.toContain("SECOND-PRIVATE");
    expect(JSON.stringify(other)).not.toContain("PRIVATE-NOTES");
  });

  it("reveals only the count, with no author or summary, before submitting", () => {
    const view = scorecardView(row(), [card(), second({ submittedAt: NOW })], interviewers, firstViewer);
    expect(view).toMatchObject({ locked: true, otherSubmittedCount: 1, submitted: [], summary: null });
    expect(JSON.stringify(view)).not.toContain("SECOND-PRIVATE");
    expect(JSON.stringify(view)).not.toContain("Second interviewer");
  });

  it("does not let organisation-admin status bypass an active interviewer's blind review", () => {
    expect(scorecardView(row(), [second({ submittedAt: NOW })], interviewers, { ...firstViewer, admin: true })).toMatchObject({ locked: true, submitted: [], summary: null, otherSubmittedCount: 1 });
  });

  it("shows both submitted judgements and their averages once the viewer submits", () => {
    const view = scorecardView(row(), [card({ submittedAt: NOW }), second({ submittedAt: NOW, scores: [{ id: "c1", score: 2, note: "" }], recommendation: "maybe" })], interviewers, firstViewer);
    expect(view.locked).toBe(false);
    expect(view.submitted).toHaveLength(2);
    expect(view.submitted[1]).toMatchObject({ interviewer: interviewers[1], submittedAt: NOW.toISOString() });
    expect(view.summary).toMatchObject({ criteria: [{ id: "c1", average: 3, count: 2 }], recommendations: { yes: 1, maybe: 1, no: 0 }, submitted: 2, pending: [] });
  });

  it("never includes somebody else's unsubmitted draft even after the viewer submits", () => {
    const view = scorecardView(row(), [card({ submittedAt: NOW }), second()], interviewers, firstViewer);
    expect(view.submitted).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("SECOND-PRIVATE");
    expect(view.summary?.pending).toEqual([interviewers[1]]);
  });

  it("lets non-participant admins read submitted cards but not write or see any draft", () => {
    const view = scorecardView(row(), [card({ submittedAt: NOW }), second(), card({ id: "admin-draft", interviewerId: "admin", notes: "ADMIN-DRAFT" })], interviewers, { userId: "admin", interviewer: false, admin: true });
    expect(view).toMatchObject({ canWrite: false, own: null, locked: false });
    expect(view.submitted).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("SECOND-PRIVATE");
    expect(JSON.stringify(view)).not.toContain("ADMIN-DRAFT");
  });

  it("denies candidate identities even with forged interviewer and admin flags", () => {
    const view = scorecardView(row(), [card({ submittedAt: NOW }), second()], interviewers, { userId: "u2", interviewer: true, admin: true });
    expect(view).toEqual({ canWrite: false, own: null, submitted: [], otherSubmittedCount: 0, locked: true, summary: null });
    for (const status of ["scheduled", "live", "finished"] as const) {
      const contaminated = { ...row(status), scorecards: view, scorecard: card() };
      const candidate = candidateInterview(contaminated, [run], "Bo", NOW);
      expect(candidate).not.toHaveProperty("scorecard");
      expect(candidate).not.toHaveProperty("scorecards");
    }
  });

  it("retains a removed interviewer's submission without listing them as awaiting submission", () => {
    const view = scorecardView(row(), [card({ submittedAt: NOW }), second({ submittedAt: NOW })], [interviewers[0]!], firstViewer);
    expect(view.submitted).toHaveLength(2);
    expect(view.summary?.pending).toEqual([]);
    expect(scorecardView(row(), [second({ submittedAt: NOW })], [interviewers[0]!], { userId: "u3", interviewer: false, admin: false }).submitted).toEqual([]);
  });

  it("relocks disclosure when a submission is withdrawn into a draft", () => {
    expect(scorecardView(row(), [card(), second({ submittedAt: NOW })], interviewers, firstViewer)).toMatchObject({ locked: true, submitted: [], otherSubmittedCount: 1, summary: null });
  });

  it("fails closed without caller context and preserves unattributed historical submissions", () => {
    expect(scorecardView(row(), [card({ submittedAt: NOW })], interviewers).submitted).toEqual([]);
    const view = scorecardView(row(), [card({ interviewerId: null, interviewerName: null, submittedAt: NOW })], interviewers, { userId: "admin", interviewer: false, admin: true });
    expect(view.submitted[0]?.interviewer).toEqual({ id: null, name: "Former interviewer", image: null });
  });
});
