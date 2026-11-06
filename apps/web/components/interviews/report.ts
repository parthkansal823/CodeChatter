/** An interview's report as Markdown, to copy or download. It has hidden tests' results and the scorecard, so it's for interviewers. */
import type { InterviewerInterview, InterviewerRun } from "@codechatter/contracts";

import { RECOMMENDATION_LABEL, STATUS_LABEL } from "./format";

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

export function interviewReport(interview: InterviewerInterview): string {
  const { scorecard } = interview;
  const labels = new Map(interview.rubric.map((criterion) => [criterion.id, criterion.label]));
  const latest = interview.runs[0];
  const lines = [
    `# Interview report: ${interview.candidateName}`,
    "",
    `- **Question:** ${interview.title}`,
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
  lines.push("", "## Test runs", "");
  if (latest) {
    // Newest first in the data; a report reads oldest first.
    lines.push(...[...interview.runs].reverse().map(runLine), ...lastRunCases(latest));
  } else {
    lines.push("No tests were run.");
  }
  return `${lines.join("\n")}\n`;
}
