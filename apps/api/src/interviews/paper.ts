/** A candidate's paper: drawing it from the bank, marking it, and reading the integrity record. Pure, so all of it can be tested alone. */
import { integrityLevel, type AskQuestionData, type GradedAnswer, type IntegrityEvent, type IntegrityReport, type PaperQuestion, type PaperRule, type PaperScore, type PaperSpec, type QuestionKind } from "@codechatter/contracts";
import type { schema } from "@codechatter/db";
import { randomInt } from "node:crypto";

export type BankQuestion = typeof schema.interviewQuestions.$inferSelect;
type AskAdhoc = Extract<AskQuestionData, { adhoc: unknown }>["adhoc"];
export type Random = (below: number) => number;
/** A candidate can't guess or influence what they'll be asked. */
export const secureRandom: Random = (below) => randomInt(below);

/** The bank can't make this paper: say why, in words the person scheduling can act on. */
export class PaperError extends Error {}

const KIND_WORD: Record<QuestionKind, string> = { coding: "coding", mcq: "multiple choice", short: "short answer", design: "system design" };
const NOTES = { path: "notes.md", content: "# Notes\n\nAnything you write here stays with your answers.\n" };

export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const matches = (question: BankQuestion, rule: PaperRule) =>
  (!rule.kind || question.kind === rule.kind) && (!rule.difficulty || question.difficulty === rule.difficulty) && (!rule.tag || question.tags.includes(rule.tag));
const narrowness = (rule: PaperRule) => Number(Boolean(rule.kind)) + Number(Boolean(rule.difficulty)) + Number(Boolean(rule.tag));
const describe = (rule: PaperRule) => [rule.difficulty, rule.kind && KIND_WORD[rule.kind], rule.tag && `tagged "${rule.tag}"`].filter(Boolean).join(" ");

/**
 * The fixed questions and the random draws, no question twice. The narrowest rules draw first,
 * so "2 of anything" doesn't use up what "2 hard SQL" needs.
 */
export function drawQuestions(bank: readonly BankQuestion[], spec: PaperSpec, random: Random): BankQuestion[] {
  const chosen = new Map<string, BankQuestion>();
  for (const id of spec.fixed) {
    const question = bank.find((item) => item.id === id);
    if (!question) throw new PaperError("One of the questions you chose isn't in the bank any more.");
    chosen.set(id, question);
  }
  for (const rule of [...spec.random].sort((a, b) => narrowness(b) - narrowness(a))) {
    const open = bank.filter((question) => matches(question, rule) && !chosen.has(question.id));
    if (open.length < rule.count) throw new PaperError(`Not enough ${describe(rule) || "questions"} in the bank: ${rule.count} wanted, ${open.length} left.`.replace(/\s+/g, " "));
    for (const question of shuffled(open, random).slice(0, rule.count)) chosen.set(question.id, question);
  }
  return [...chosen.values()];
}

/**
 * Overlapping rules can run short by bad luck when another draw would have fitted. Try again a
 * few times before saying the bank can't do it.
 */
export function drawPaper(bank: readonly BankQuestion[], spec: PaperSpec, random: Random, attempts = 25): BankQuestion[] {
  for (let attempt = 1; ; attempt++) {
    try {
      return drawQuestions(bank, spec, random);
    } catch (error) {
      if (attempt >= attempts || !(error instanceof PaperError) || spec.random.length < 2) throw error;
    }
  }
}

export type Sitting = {
  paper: PaperQuestion[];
  /** What the room's files start with. */
  starterFiles: Array<{ path: string; content: string }>;
  /** What the scorecard asks about: every question's criteria, once each. */
  rubric: Array<{ id: string; label: string }>;
};

/**
 * One bank question on a paper: choices shuffled, and a coding question's files in `folder`.
 */
export function paperQuestion(question: BankQuestion, id: string, folder: string, random: Random): PaperQuestion {
  const coding = question.kind === "coding";
  return {
    id,
    bankId: question.id,
    kind: question.kind,
    title: question.title,
    prompt: question.prompt,
    marks: question.marks,
    difficulty: question.difficulty,
    choices: question.kind === "mcq" ? shuffled(question.choices, random) : [],
    modelAnswer: question.modelAnswer,
    file: coding ? `${folder}${question.file}` : "",
    tests: coding ? question.tests : [],
    timeLimitMs: question.timeLimitMs,
    starterFiles: coding ? question.starterFiles.map((file) => ({ path: `${folder}${file.path}`, content: file.content })) : [],
    askedAt: null,
  };
}

/** A question made up during an interview. It has no tests, so the interviewer marks it. */
export function adhocPaperQuestion(input: AskAdhoc, id: string, random: Random): PaperQuestion {
  const file = input.kind === "coding" ? `${id}/${input.file || "main.py"}` : "";
  return {
    id,
    bankId: null,
    kind: input.kind,
    title: input.title,
    prompt: input.prompt,
    marks: input.marks,
    difficulty: "medium",
    choices: input.kind === "mcq" ? shuffled(input.choices, random) : [],
    modelAnswer: "",
    file,
    tests: [],
    timeLimitMs: 2000,
    starterFiles: file ? [{ path: file, content: "" }] : [],
    askedAt: null,
  };
}

/** The next id on a paper: questions come and go during an interview, so counting them isn't enough. */
export function nextQuestionId(paper: ReadonlyArray<Pick<PaperQuestion, "id">>): string {
  const highest = Math.max(0, ...paper.map((question) => Number(/^q(\d+)$/.exec(question.id)?.[1] ?? 0)));
  return `q${highest + 1}`;
}

/**
 * Questions into a candidate's own paper: the quick ones first, each kind in its own order.
 * In an assessment the room starts with the code questions' files, in a folder each when
 * there are several. In a live interview it starts with none of them, as they'd give the
 * questions away: each comes when it's asked. A room with no code gets a file for notes.
 */
export function sittingFrom(questions: readonly BankQuestion[], random: Random, mode: "interview" | "assessment" = "assessment"): Sitting {
  const kinds: QuestionKind[] = ["mcq", "short", "coding", "design"];
  const ordered = kinds.flatMap((kind) => shuffled(questions.filter((question) => question.kind === kind), random));
  const codingCount = ordered.filter((question) => question.kind === "coding").length;
  const rubric = new Map<string, { id: string; label: string }>();

  const paper = ordered.map((question, index): PaperQuestion => {
    const id = `q${index + 1}`;
    for (const criterion of question.rubric) if (!rubric.has(criterion.label)) rubric.set(criterion.label, { id: `${id}-${criterion.id}`.slice(0, 64), label: criterion.label });
    return paperQuestion(question, id, mode === "interview" || codingCount > 1 ? `${id}/` : "", random);
  });
  const starterFiles = mode === "assessment" ? paper.flatMap((question) => question.starterFiles) : [];
  return { paper, starterFiles: starterFiles.length ? starterFiles : [NOTES], rubric: [...rubric.values()] };
}

/** Multiple choice: the right answers, all of them and only them. Half right on "choose all" is wrong, as on most tests. */
export function markChoices(question: Pick<PaperQuestion, "choices" | "marks">, choiceIds: readonly string[]): number {
  const right = question.choices.filter((choice) => choice.correct).map((choice) => choice.id);
  const given = new Set(choiceIds);
  return given.size === right.length && right.every((id) => given.has(id)) ? question.marks : 0;
}

/** A reason this answer can't be for this question, if any. */
export function answerProblem(question: PaperQuestion, choiceIds: readonly string[]): string | null {
  if (question.kind === "coding") return "A coding question's answer is its code.";
  if (question.kind !== "mcq") return choiceIds.length ? "This question doesn't have choices." : null;
  const known = new Set(question.choices.map((choice) => choice.id));
  if (choiceIds.some((id) => !known.has(id))) return "That isn't one of this question's choices.";
  if (new Set(choiceIds).size !== choiceIds.length) return "The same choice was sent twice.";
  if (choiceIds.length > 1 && question.choices.filter((choice) => choice.correct).length < 2) return "This question takes one choice.";
  return null;
}

type RunScore = { questionId: string | null; passed: number; total: number };

/**
 * A coding question scores for the best run of its tests, unless the interviewer gave it a mark
 * themselves (a question with no tests needs that). Short answers and designs count once marked.
 */
export function scorePaper(paper: readonly PaperQuestion[], answers: ReadonlyArray<Pick<GradedAnswer, "questionId" | "awarded" | "text">>, runs: readonly RunScore[]): PaperScore {
  const score: PaperScore = { marks: 0, max: 0, unmarked: 0, byKind: { coding: { marks: 0, max: 0 }, mcq: { marks: 0, max: 0 }, short: { marks: 0, max: 0 }, design: { marks: 0, max: 0 } } };
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (const question of paper) {
    const answer = byId.get(question.id);
    let got = 0;
    const awarded = answer?.awarded ?? null;
    if (question.kind === "coding") {
      const best = Math.max(0, ...runs.filter((run) => run.questionId === question.id && run.total > 0).map((run) => run.passed / run.total));
      got = awarded ?? Math.round(question.marks * best);
      if (question.tests.length === 0 && awarded === null) score.unmarked += 1;
    } else {
      got = awarded ?? 0;
      // Nothing written to mark in a short answer; a design may be all in its diagrams, so it always waits for a person.
      if ((question.kind === "short" && answer?.text.trim() && awarded === null) || (question.kind === "design" && awarded === null)) score.unmarked += 1;
    }
    score.marks += got;
    score.max += question.marks;
    score.byKind[question.kind].marks += got;
    score.byKind[question.kind].max += question.marks;
  }
  return score;
}

/** Whether a candidate sees a question: an assessment's whole paper, or what an interviewer has asked. */
export const askedOf = (mode: "interview" | "assessment", question: Pick<PaperQuestion, "askedAt">) => mode === "assessment" || question.askedAt !== null;

export function integrityReport(events: readonly IntegrityEvent[], bigEdits: number): IntegrityReport {
  const counts: IntegrityReport["counts"] = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return { events: [...events], counts, bigEdits, level: integrityLevel(counts, bigEdits) };
}

/** Two tabs take turns reporting: A, B, A. A reload only goes A, B, so it isn't mistaken for a second device. */
export function sessionsAfterBeat(stored: string | null, sessionId: string): { stored: string; second: boolean } {
  const [current, previous] = (stored ?? "").split("|");
  if (current === sessionId) return { stored: stored ?? sessionId, second: false };
  return { stored: `${sessionId}|${current ?? ""}`, second: previous === sessionId };
}
