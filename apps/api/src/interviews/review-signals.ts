/**
 * What can be worked out about a sitting by plain code, before any model reads it. A small local
 * model misses things and makes things up; these are right every time, and the model is told them
 * so it can explain them. Each one is something to check, with its innocent explanation: none of
 * them says what happened.
 */
import type { AiReviewFinding } from "@codechatter/contracts";

import type { ReviewFacts } from "./ai-review.js";

/** Smaller than this and one minute's edit is just someone typing. */
const BURST_BYTES = 400;
const BURST_SHARE = 0.6;
const AWAY_SECONDS = 30;
const AWAY_BEFORE_MS = 5 * 60_000;
const FAST_SHARE = 0.25;
const MOST_QUOTE = 120;

/** Text in someone's work that's addressed to whoever, or whatever, marks it. */
const AT_THE_AI = [
  /\b(ignore|disregard)\b.{0,40}\b(previous|prior|above|earlier|instructions?)\b/i,
  /\b(report|say|flag|find)\b.{0,30}\b(no|nothing|not)\b.{0,30}\b(findings?|suspicious|cheat\w*|to check|issues?)\b/i,
  /\b(notes?|messages?|instructions?)\s+(to|for)\s+(any\s+|the\s+|all\s+)?(ai|llm|model|reviewers?|graders?|assistant)\b/i,
  /\byou are (an? )?(ai|assistant|language model|reviewer|grader)\b/i,
];

const DEFINED = /\b(?:def|function|func|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const SNAKE = /^[a-z]+(?:_[a-z0-9]+)+$/;
const CAMEL = /^[a-z]+[a-z0-9]*[A-Z][A-Za-z0-9]*$/;

const signal = (level: AiReviewFinding["level"], title: string, detail: string, at: Date | null): AiReviewFinding => ({ source: "signals", level, title, detail, at: at ? at.toISOString() : null });

const minutesLabel = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} minutes`;

function addressedToTheAi(facts: ReviewFacts): AiReviewFinding[] {
  const places = [...facts.files.map((file) => ({ where: file.path, text: file.text })), ...facts.answers.map((answer) => ({ where: `the answer to ${answer.questionId}`, text: answer.text }))];
  const found: AiReviewFinding[] = [];
  for (const { where, text } of places) {
    const lines = text.split("\n");
    const index = lines.findIndex((line) => AT_THE_AI.some((pattern) => pattern.test(line)));
    if (index === -1) continue;
    found.push(signal("look", "Text addressed to whoever reviews this", `Line ${index + 1} of ${where}: "${lines[index]!.trim().slice(0, MOST_QUOTE)}". It may be part of the task, if the task is about AI or prompts.`, null));
  }
  return found;
}

function howItArrived(facts: ReviewFacts): AiReviewFinding[] {
  const total = facts.edits.reduce((sum, row) => sum + row.bytes, 0);
  const biggest = facts.edits.reduce<ReviewFacts["edits"][number] | null>((best, row) => (!best || row.bytes > best.bytes ? row : best), null);
  if (!biggest || biggest.bytes < BURST_BYTES || biggest.bytes / total < BURST_SHARE) return [];
  const found = [
    signal(
      "look",
      "Most of the work arrived at once",
      `${biggest.bytes} of the ${total} bytes changed came in one minute. A program writing a file, or copying their own earlier work, looks the same.`,
      biggest.minute,
    ),
  ];
  const away = facts.events.find((event) => {
    if ((event.kind !== "tab-hidden" && event.kind !== "window-blur") || (event.detail.seconds ?? 0) < AWAY_SECONDS) return false;
    const before = biggest.minute.getTime() + 60_000 - event.at.getTime();
    return before >= 0 && before <= AWAY_BEFORE_MS;
  });
  if (away) found.push(signal("look", "It came just after they left the page", `They were away for ${away.detail.seconds} seconds shortly before that minute. Leaving can be looking up something that's allowed.`, away.at));
  return found;
}

function howTheTestsWent(facts: ReviewFacts): AiReviewFinding[] {
  const found: AiReviewFinding[] = [];
  const seen = new Set<string>();
  for (const run of facts.runs) {
    const key = run.questionId ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    if (!run.compileError && run.total > 0 && run.passed === run.total) {
      found.push(signal("note", "Passed every test on the first run", `${run.passed} of ${run.total}${run.questionId ? ` on ${run.questionId}` : ""}, with no failed run before it. A strong candidate can do this, especially if they ran it in the terminal first.`, run.at));
    }
  }
  return found;
}

function howLongItTook(facts: ReviewFacts): AiReviewFinding[] {
  if (!facts.finishedAt || !facts.durationMinutes) return [];
  const used = facts.finishedAt.getTime() - facts.startedAt.getTime();
  const allowed = facts.durationMinutes * 60_000;
  if (used >= allowed * FAST_SHARE || !facts.runs.some((run) => !run.compileError && run.total > 0 && run.passed === run.total)) return [];
  return [signal("note", "Finished well before the time", `It took about ${minutesLabel(used)} of the ${facts.durationMinutes} allowed, with every test passing. The question may just have been easy for them.`, facts.finishedAt)];
}

function namingStyles(facts: ReviewFacts): AiReviewFinding[] {
  const found: AiReviewFinding[] = [];
  for (const file of facts.files) {
    const names = Array.from(file.text.matchAll(DEFINED), (match) => match[1]!);
    const snake = names.find((name) => SNAKE.test(name));
    const camel = names.find((name) => CAMEL.test(name));
    if (snake && camel) found.push(signal("note", "Two naming styles in one file", `${file.path} defines both ${snake} and ${camel}. People do mix styles, or follow the starter code.`, null));
  }
  return found;
}

/** Most worth checking first. */
export function reviewSignals(facts: ReviewFacts): AiReviewFinding[] {
  const found = [...addressedToTheAi(facts), ...howItArrived(facts), ...howTheTestsWent(facts), ...howLongItTook(facts), ...namingStyles(facts)];
  return [...found.filter((item) => item.level === "look"), ...found.filter((item) => item.level !== "look")];
}
