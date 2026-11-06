import assert from "node:assert/strict";
import { test } from "node:test";

import type { InterviewerInterview } from "@codechatter/contracts";

import { candidateLink, csvRow, formatCountdown, isoFromLocalInput } from "./format";
import { interviewReport } from "./report";

const interview = (over: Partial<InterviewerInterview> = {}): InterviewerInterview => ({
  mode: "interview",
  batchId: null,
  paper: [],
  answers: [],
  score: { marks: 0, max: 0, unmarked: 0, byKind: { coding: { marks: 0, max: 0 }, mcq: { marks: 0, max: 0 }, short: { marks: 0, max: 0 }, design: { marks: 0, max: 0 } } },
  integrity: { events: [], counts: {}, bigEdits: 0, level: "clear" },
  fullscreen: false,
  lockClipboard: false,
  aiAllowed: false,
  recordWebcam: false,
  recordScreen: false,
  recordingConsentAt: null,
  aiReview: null,
  aiReviewRecording: false,
  id: "i1",
  roomId: "ABC234",
  title: "Two sum",
  candidateName: "Ana",
  interviewerName: "Bo",
  status: "finished",
  startedAt: "2026-11-06T10:00:00.000Z",
  endsAt: "2026-11-06T11:00:00.000Z",
  finishedAt: "2026-11-06T10:45:00.000Z",
  durationMinutes: 60,
  now: "2026-11-06T12:00:00.000Z",
  prompt: "",
  file: "main.py",
  timeLimitMs: 2000,
  visibleTests: [],
  hiddenTestCount: 1,
  role: "interviewer",
  candidateEmail: null,
  candidateJoined: true,
  hiddenTests: [],
  rubric: [{ id: "c1", label: "Problem | solving" }],
  scorecard: { scores: [{ id: "c1", score: 4, note: "good\nstart" }], overall: 4, recommendation: "yes", notes: "Hire them." },
  runs: [
    {
      id: "r2",
      questionId: null,
      at: "2026-11-06T10:40:00.000Z",
      path: "main.py",
      compileError: null,
      visible: [{ id: "v1", input: "", expected: "", verdict: "passed", stdout: "", stderr: "", timeMs: 5 }],
      hidden: { passed: 0, total: 1 },
      hiddenCases: [{ id: "h1", input: "", expected: "", verdict: "failed", stdout: "", stderr: "", timeMs: 6 }],
      passed: 1,
      total: 2,
      by: "Ana",
    },
    { id: "r1", questionId: null, at: "2026-11-06T10:20:00.000Z", path: "main.py", compileError: "bad", visible: [], hidden: { passed: 0, total: 1 }, hiddenCases: [], passed: 0, total: 2, by: "Ana" },
  ],
  ...over,
});

test("has the result, scores, notes and every run", () => {
  const report = interviewReport(interview());
  assert.match(report, /^# Interview report: Ana/);
  assert.match(report, /\*\*Recommendation:\*\* Yes/);
  assert.match(report, /\*\*Overall:\*\* 4 \/ 5/);
  assert.match(report, /Hire them\./);
  assert.match(report, /1 of 2 passed \(Ana\)/);
  assert.match(report, /didn't compile/);
});

test("lists runs oldest first, and the last run's hidden cases", () => {
  const report = interviewReport(interview());
  assert.ok(report.indexOf("didn't compile") < report.indexOf("1 of 2 passed"));
  assert.match(report, /\| Hidden test 1 \| Hidden \| failed \| 6 ms \|/);
  assert.match(report, /\| Test 1 \| Visible \| passed \| 5 ms \|/);
});

test("keeps a table's rows whole", () => {
  assert.match(interviewReport(interview()), /\| Problem \\\| solving \| 4 \/ 5 \| good start \|/);
});

test("reads sensibly with nothing filled in", () => {
  const report = interviewReport(interview({ runs: [], rubric: [], scorecard: { scores: [], overall: null, recommendation: null, notes: " " }, startedAt: null, finishedAt: null, interviewerName: null }));
  assert.match(report, /None yet/);
  assert.match(report, /Not scored/);
  assert.match(report, /No tests were run\./);
  assert.doesNotMatch(report, /## Scores/);
  assert.doesNotMatch(report, /## Notes/);
  assert.doesNotMatch(report, /undefined|null/);
});

const question = (over: Partial<InterviewerInterview["paper"][number]>): InterviewerInterview["paper"][number] => ({
  id: "q1", bankId: "b", kind: "mcq", title: "Which?", prompt: "", marks: 2, difficulty: "easy", choices: [], modelAnswer: "", file: "", tests: [], timeLimitMs: 2000, starterFiles: [], askedAt: "2026-11-06T10:00:00Z", ...over,
});

test("has the paper, what they answered and what it scored", () => {
  const report = interviewReport(interview({
    mode: "assessment",
    paper: [
      question({ choices: [{ id: "a", text: "Paris", correct: true }, { id: "b", text: "Rome", correct: false }] }),
      question({ id: "q2", kind: "design", title: "Design a queue", marks: 20, askedAt: null }),
    ],
    answers: [{ questionId: "q1", choiceIds: ["b"], text: "", at: "", awarded: 0 }, { questionId: "q2", choiceIds: [], text: "Boxes | arrows", at: "", awarded: 15 }],
    score: { marks: 15, max: 22, unmarked: 0, byKind: { coding: { marks: 0, max: 0 }, mcq: { marks: 0, max: 2 }, short: { marks: 0, max: 0 }, design: { marks: 15, max: 20 } } },
  }));
  assert.match(report, /^# Assessment report: Ana/);
  assert.match(report, /\*\*15 of 22 marks\*\*/);
  assert.match(report, /\| 1 \| Which\? \| Multiple choice \| 0 of 2 \| Rome \(wrong\) \|/);
  assert.match(report, /\| 2 \| Design a queue \| System design \| 15 of 20 \| Boxes \\| arrows \|/);
});

test("leaves out what an interviewer never asked", () => {
  const report = interviewReport(interview({ paper: [question({ title: "Never asked", askedAt: null })] }));
  assert.doesNotMatch(report, /Never asked/);
});

test("has the record, as signs to weigh", () => {
  const report = interviewReport(interview({ integrity: { events: [], counts: { "second-session": 1 }, bigEdits: 2, level: "concern" } }));
  assert.match(report, /Signs to weigh, not proof/);
  assert.match(report, /Open in a second tab or device: 1/);
  assert.match(report, /Big edits at once: 2/);
  assert.match(interviewReport(interview()), /Nothing was recorded/);
});

test("marks what the AI said as what it is", () => {
  const report = interviewReport(interview({ aiReview: { at: "", model: "stand-in", summary: "One thing.", findings: [{ source: "activity", level: "look", title: "All at once", detail: "A big edit.", at: null }], questions: [{ question: "Why this?", about: "" }], looked: { camera: false, screen: false }, note: null } }));
  assert.match(report, /## What the AI suggested/);
  assert.match(report, /it can be wrong: this isn't a finding/);
  assert.match(report, /- All at once: A big edit\./);
  assert.match(report, /- Why this\?/);
  assert.doesNotMatch(interviewReport(interview()), /What the AI suggested/);
});

test("says they agreed to being recorded", () => {
  assert.match(interviewReport(interview({ recordingConsentAt: "2026-11-06T10:00:00.000Z" })), /Recorded with their agreement/);
});

test("a CSV can't smuggle in a formula, or break its columns", () => {
  assert.equal(csvRow(["Ana", 5]), "Ana,5");
  assert.equal(csvRow(["=HYPERLINK(1)"]), "'=HYPERLINK(1)");
  assert.equal(csvRow(["@cmd", "+1", "-1"]), "'@cmd,'+1,'-1");
  assert.equal(csvRow(['a,"b"']), '"a,""b"""');
  assert.equal(csvRow([-5]), "-5");
});

test("formats the countdown", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(-5000), "0:00");
  assert.equal(formatCountdown(1), "0:01");
  assert.equal(formatCountdown(65_000), "1:05");
  assert.equal(formatCountdown(3_725_000), "1:02:05");
});

test("makes the link and reads the date field", () => {
  assert.equal(candidateLink("https://a.example", "tok"), "https://a.example/interview/tok");
  assert.equal(isoFromLocalInput(""), undefined);
  assert.equal(isoFromLocalInput("not a date"), undefined);
  assert.equal(isoFromLocalInput("2026-11-06T10:00:00Z"), "2026-11-06T10:00:00.000Z");
});
