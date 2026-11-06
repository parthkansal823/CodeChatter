/** An interview's report as Markdown, to copy or download. It has hidden tests' results and the scorecard, so it's for interviewers. */
import { INTEGRITY_LABEL, type IntegrityKind, type InterviewerInterview, type InterviewerRun } from "@codechatter/contracts";

import { KIND_LABEL, MODE_LABEL, RECOMMENDATION_LABEL, STATUS_LABEL } from "./format";

/** One table cell: pipes and line breaks would break the row. */
const cell = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\s*\r?\n\s*/g, " ").trim();
const when = (iso: string | null) => (iso ? new Date(iso).toUTCString() : "Not recorded");
const score = (value: number | null) => (value === null ? "Not scored" : `${value} / 5`);

function runLine(run: InterviewerRun): string {
  const result = run.compileError !== null ? "didn't compile" : `${run.passed} of ${run.total} passed`;
  return `- ${when(run.at)}: ${result}${run.by ? ` (${run.by})` : ""}`;
}

function lastRunCases(run: InterviewerRun): string[] {
  const rows = [
    ...run.visible.map((result, index) => ({ result, label: `Test ${index + 1}`, kind: "Visible" })),
    ...run.hiddenCases.map((result, index) => ({ result, label: `Hidden test ${index + 1}`, kind: "Hidden" })),
  ];
  if (!rows.length) return [];
  return [
    "",
    "### The last run, case by case",
    "",
    "| Case | Kind | Verdict | Time |",
    "| --- | --- | --- | --- |",
    ...rows.map(({ result, label, kind }) => `| ${label} | ${kind} | ${cell(result.verdict)} | ${result.timeMs} ms |`),
  ];
}

/** The paper, question by question. Questions never asked aren't part of what happened. */
function paperLines(interview: InterviewerInterview): string[] {
  const asked = interview.paper.filter((question) => interview.mode === "assessment" || question.askedAt !== null);
  if (!asked.length) return [];
  const answers = new Map(interview.answers.map((answer) => [answer.questionId, answer]));
  const { score } = interview;
  return [
    "",
    "## Questions",
    "",
    `**${score.marks} of ${score.max} marks**${score.unmarked ? ` (${score.unmarked} not marked yet)` : ""}`,
    "",
    "| # | Question | Kind | Marks | Answer |",
    "| --- | --- | --- | --- | --- |",
    ...asked.map((question, index) => {
      const answer = answers.get(question.id);
      const runs = interview.runs.filter((run) => run.questionId === question.id);
      const best = runs.length ? Math.max(...runs.map((run) => (run.total ? run.passed / run.total : 0))) : null;
      const chosen = question.choices.filter((choice) => answer?.choiceIds.includes(choice.id)).map((choice) => `${choice.text}${choice.correct ? " (right)" : " (wrong)"}`);
      const given = question.kind === "mcq" ? chosen.join("; ") || "Not answered" : question.kind === "coding" ? (best === null ? `${question.file}: tests not run` : `${question.file}: best run ${Math.round(best * 100)}%`) : answer?.text.trim() || "Nothing written";
      const marks = question.kind === "mcq" ? (answer?.awarded ?? 0) : question.kind === "coding" && answer?.awarded == null ? Math.round(question.marks * (best ?? 0)) : (answer?.awarded ?? "Not marked");
      return `| ${index + 1} | ${cell(question.title)} | ${KIND_LABEL[question.kind]} | ${marks} of ${question.marks} | ${cell(given)} |`;
    }),
  ];
}

function recordLines(interview: InterviewerInterview): string[] {
  const { integrity } = interview;
  const counts = Object.entries(integrity.counts) as Array<[IntegrityKind, number]>;
  if (!counts.length && !integrity.bigEdits) return ["", "## The record", "", "Nothing was recorded."];
  return [
    "",
    "## The record",
    "",
    "Signs to weigh, not proof.",
    "",
    ...counts.map(([kind, count]) => `- ${INTEGRITY_LABEL[kind] ?? kind}: ${count}`),
    ...(integrity.bigEdits ? [`- Big edits at once: ${integrity.bigEdits}`] : []),
  ];
}

/** The AI's reading, marked as what it is. */
function aiLines(interview: InterviewerInterview): string[] {
  const review = interview.aiReview;
  if (!review) return [];
  return [
    "",
    "## What the AI suggested",
    "",
    `From ${review.model}. It points, and it can be wrong: this isn't a finding, and it didn't change any marks.`,
    ...(review.summary ? ["", review.summary] : []),
    ...(review.findings.length ? ["", ...review.findings.map((finding) => `- ${finding.title}${finding.detail ? `: ${finding.detail}` : ""}`)] : []),
    ...(review.questions.length ? ["", "Questions to ask them:", "", ...review.questions.map((question) => `- ${question.question}`)] : []),
  ];
}

export function interviewReport(interview: InterviewerInterview): string {
  const { scorecard } = interview;
  const labels = new Map(interview.rubric.map((criterion) => [criterion.id, criterion.label]));
  const latest = interview.runs[0];
  const lines = [
    `# ${MODE_LABEL[interview.mode ?? "interview"]} report: ${interview.candidateName}`,
    "",
    `- **${interview.paper?.length ? "Paper" : "Question"}:** ${interview.title}`,
    `- **Interviewer:** ${interview.interviewerName ?? "Not recorded"}`,
    `- **Status:** ${STATUS_LABEL[interview.status]}`,
    `- **Started:** ${when(interview.startedAt)}`,
    `- **Finished:** ${when(interview.finishedAt)}`,
    "",
    "## Result",
    "",
    `- **Recommendation:** ${scorecard.recommendation ? RECOMMENDATION_LABEL[scorecard.recommendation] : "None yet"}`,
    `- **Overall:** ${score(scorecard.overall)}`,
  ];
  if (scorecard.scores.length) {
    lines.push(
      "",
      "## Scores",
      "",
      "| Criterion | Score | Note |",
      "| --- | --- | --- |",
      ...scorecard.scores.map((row) => `| ${cell(labels.get(row.id) ?? row.id)} | ${score(row.score)} | ${cell(row.note)} |`),
    );
  }
  if (scorecard.notes.trim()) lines.push("", "## Notes", "", scorecard.notes.trim());
  if (interview.paper?.length) lines.push(...paperLines(interview));
  if (interview.integrity) lines.push(...recordLines(interview));
  if (interview.recordingConsentAt) lines.push("", `Recorded with their agreement, given ${when(interview.recordingConsentAt)}.`);
  lines.push(...aiLines(interview));
  lines.push("", "## Test runs", "");
  if (latest) {
    // Newest first in the data; a report reads oldest first.
    lines.push(...[...interview.runs].reverse().map(runLine), ...lastRunCases(latest));
  } else {
    lines.push("No tests were run.");
  }
  return `${lines.join("\n")}\n`;
}
