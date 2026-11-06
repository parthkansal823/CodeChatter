import assert from "node:assert/strict";
import { test } from "node:test";

import type { InterviewerInterview } from "@codechatter/contracts";

import { candidateLink, formatCountdown, isoFromLocalInput } from "./format";
import { interviewReport } from "./report";

const interview = (over: Partial<InterviewerInterview> = {}): InterviewerInterview => ({
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
    { id: "r1", at: "2026-11-06T10:20:00.000Z", path: "main.py", compileError: "bad", visible: [], hidden: { passed: 0, total: 1 }, hiddenCases: [], passed: 0, total: 2, by: "Ana" },
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
