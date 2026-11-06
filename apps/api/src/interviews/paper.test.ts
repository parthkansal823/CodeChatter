import { describe, expect, it } from "vitest";

import { adhocPaperQuestion, answerProblem, askedOf, drawPaper, drawQuestions, integrityReport, markChoices, nextQuestionId, PaperError, scorePaper, sessionsAfterBeat, shuffled, sittingFrom, type BankQuestion } from "./paper.js";

const firstAlways = () => 0;
let next = 0;
function question(partial: Partial<BankQuestion> = {}): BankQuestion {
  next += 1;
  return {
    id: `id-${next}`,
    orgId: "org",
    title: `Question ${next}`,
    kind: "mcq",
    difficulty: "medium",
    tags: [],
    marks: 1,
    choices: [
      { id: "a", text: "A", correct: true },
      { id: "b", text: "B", correct: false },
      { id: "c", text: "C", correct: false },
    ],
    modelAnswer: "",
    prompt: "",
    file: "",
    starterFiles: [],
    tests: [],
    rubric: [],
    durationMinutes: 60,
    timeLimitMs: 2000,
    createdBy: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as BankQuestion;
}
const coding = (partial: Partial<BankQuestion> = {}) => question({ kind: "coding", choices: [], file: "main.py", starterFiles: [{ path: "main.py", content: "pass" }], tests: [{ id: "t1", input: "", expected: "", hidden: false }], ...partial });

describe("shuffled", () => {
  it("keeps everything and leaves the original alone", () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffled(items, (below) => below - 1);
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("drawQuestions", () => {
  it("draws from what a rule allows, never the same question twice", () => {
    const easy = [question({ difficulty: "easy" }), question({ difficulty: "easy" })];
    const hard = question({ difficulty: "hard" });
    const drawn = drawQuestions([...easy, hard], { fixed: [], random: [{ count: 2, difficulty: "easy" }] }, firstAlways);
    expect(drawn.map((item) => item.id).sort()).toEqual(easy.map((item) => item.id).sort());
    expect(new Set(drawn.map((item) => item.id)).size).toBe(2);
  });

  it("gives different candidates different papers", () => {
    const bank = Array.from({ length: 30 }, () => question());
    let seed = 1;
    const random = (below: number) => (seed = (seed * 48271) % 2147483647) % below;
    const papers = Array.from({ length: 8 }, () => drawQuestions(bank, { fixed: [], random: [{ count: 5 }] }, random).map((item) => item.id).sort().join());
    expect(new Set(papers).size).toBeGreaterThan(1);
  });

  it("always includes the fixed questions, and doesn't draw them again", () => {
    const fixed = question();
    const other = question();
    const drawn = drawQuestions([fixed, other], { fixed: [fixed.id], random: [{ count: 1 }] }, firstAlways);
    expect(drawn.map((item) => item.id)).toEqual([fixed.id, other.id]);
  });

  it("matches on kind and tag", () => {
    const sql = question({ tags: ["sql"] });
    const python = coding({ tags: ["python"] });
    expect(drawQuestions([sql, python], { fixed: [], random: [{ count: 1, tag: "sql" }] }, firstAlways)).toEqual([sql]);
    expect(drawQuestions([sql, python], { fixed: [], random: [{ count: 1, kind: "coding" }] }, firstAlways)).toEqual([python]);
  });

  it("says what's short, in words", () => {
    expect(() => drawQuestions([question()], { fixed: [], random: [{ count: 3, kind: "mcq", difficulty: "hard", tag: "sql" }] }, firstAlways)).toThrow(/Not enough hard multiple choice tagged "sql" in the bank: 3 wanted, 0 left/);
    expect(() => drawQuestions([], { fixed: ["gone"], random: [] }, firstAlways)).toThrow(PaperError);
  });

  it("lets the narrow rule draw first, whatever order they were written in", () => {
    const sql = question({ tags: ["sql"] });
    const other = question();
    const drawn = drawQuestions([sql, other], { fixed: [], random: [{ count: 1 }, { count: 1, tag: "sql" }] }, firstAlways);
    expect(drawn.map((item) => item.id).sort()).toEqual([sql.id, other.id].sort());
  });
});

describe("drawPaper", () => {
  it("tries again when overlapping rules run short by bad luck", () => {
    const both = question({ tags: ["sql"], difficulty: "easy" });
    const sql = question({ tags: ["sql"], difficulty: "hard" });
    const spec = { fixed: [], random: [{ count: 1, tag: "sql" }, { count: 1, difficulty: "easy" as const }] };
    // A random source that first picks the question both rules want, then the other.
    const picks = [1, 0, 0, 0, 0];
    const random = () => picks.shift() ?? 0;
    expect(drawPaper([both, sql], spec, random).map((item) => item.id).sort()).toEqual([both.id, sql.id].sort());
  });

  it("gives up when the bank really can't do it", () => {
    expect(() => drawPaper([question()], { fixed: [], random: [{ count: 2 }, { count: 1, tag: "x" }] }, firstAlways, 3)).toThrow(PaperError);
  });
});

describe("sittingFrom", () => {
  it("puts the quick questions first, and gives each question its own id", () => {
    const { paper } = sittingFrom([coding(), question({ kind: "design", choices: [] }), question({ kind: "short", choices: [] }), question()], firstAlways);
    expect(paper.map((item) => item.kind)).toEqual(["mcq", "short", "coding", "design"]);
    expect(paper.map((item) => item.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("gives several coding questions a folder each", () => {
    const { paper, starterFiles } = sittingFrom([coding(), coding()], firstAlways);
    expect(paper.map((item) => item.file)).toEqual(["q1/main.py", "q2/main.py"]);
    expect(starterFiles.map((file) => file.path)).toEqual(["q1/main.py", "q2/main.py"]);
  });

  it("leaves one coding question where it was written", () => {
    const { paper, starterFiles } = sittingFrom([coding()], firstAlways);
    expect(paper[0]!.file).toBe("main.py");
    expect(starterFiles.map((file) => file.path)).toEqual(["main.py"]);
  });

  it("gives a paper with no code a file for notes", () => {
    expect(sittingFrom([question()], firstAlways).starterFiles.map((file) => file.path)).toEqual(["notes.md"]);
  });

  it("shuffles choices without losing which are right", () => {
    const { paper } = sittingFrom([question()], (below) => below - 1);
    expect(paper[0]!.choices.filter((choice) => choice.correct).map((choice) => choice.id)).toEqual(["a"]);
    expect(paper[0]!.choices).toHaveLength(3);
  });

  it("asks about each criterion once", () => {
    const { rubric } = sittingFrom([coding({ rubric: [{ id: "x", label: "Code quality" }] }), coding({ rubric: [{ id: "y", label: "Code quality" }, { id: "z", label: "Speed" }] })], firstAlways);
    expect(rubric.map((criterion) => criterion.label).sort()).toEqual(["Code quality", "Speed"]);
    expect(new Set(rubric.map((criterion) => criterion.id)).size).toBe(2);
  });

  it("keeps coding details off the other kinds", () => {
    const stray = question({ tests: [{ id: "t", input: "secret", expected: "", hidden: true }], file: "x.py" });
    const { paper } = sittingFrom([stray], firstAlways);
    expect(paper[0]!.tests).toEqual([]);
    expect(paper[0]!.file).toBe("");
  });
});

describe("a live interview's paper", () => {
  it("keeps every question's files out of the room until it's asked", () => {
    const { paper, starterFiles } = sittingFrom([coding()], firstAlways, "interview");
    expect(starterFiles.map((file) => file.path)).toEqual(["notes.md"]);
    expect(paper[0]!.starterFiles.map((file) => file.path)).toEqual(["q1/main.py"]);
    expect(paper[0]!.file).toBe("q1/main.py");
  });

  it("shows a candidate only what's been asked; an assessment shows it all", () => {
    expect(askedOf("interview", { askedAt: null })).toBe(false);
    expect(askedOf("interview", { askedAt: "2026-11-06T10:00:00Z" })).toBe(true);
    expect(askedOf("assessment", { askedAt: null })).toBe(true);
  });

  it("numbers on from the highest id, whatever's on the paper", () => {
    expect(nextQuestionId([])).toBe("q1");
    expect(nextQuestionId([{ id: "q1" }, { id: "q7" }])).toBe("q8");
  });

  it("gives a question made up on the spot a file to write in, and no tests", () => {
    const question = adhocPaperQuestion({ kind: "coding", title: "Reverse it", prompt: "", marks: 10, file: "rev.py", choices: [] }, "q3", firstAlways);
    expect(question).toMatchObject({ id: "q3", bankId: null, file: "q3/rev.py", tests: [], starterFiles: [{ path: "q3/rev.py", content: "" }], askedAt: null });
  });

  it("gives other kinds no file", () => {
    expect(adhocPaperQuestion({ kind: "design", title: "Design a queue", prompt: "", marks: 10, file: "main.py", choices: [] }, "q1", firstAlways)).toMatchObject({ file: "", starterFiles: [] });
  });
});

describe("markChoices", () => {
  const question = { marks: 4, choices: [{ id: "a", text: "", correct: true }, { id: "b", text: "", correct: true }, { id: "c", text: "", correct: false }] };

  it("gives the marks for all the right answers and only those", () => {
    expect(markChoices(question, ["b", "a"])).toBe(4);
    expect(markChoices(question, ["a"])).toBe(0);
    expect(markChoices(question, ["a", "b", "c"])).toBe(0);
    expect(markChoices(question, [])).toBe(0);
  });
});

describe("answerProblem", () => {
  const paperQuestion = (kind: "mcq" | "short" | "coding" | "design", correct = 1) => ({ ...sittingFrom([question({ kind, choices: kind === "mcq" ? [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: correct > 1 }] : [] })], firstAlways).paper[0]! });

  it("refuses what isn't on the question", () => {
    expect(answerProblem(paperQuestion("mcq"), ["z"])).toMatch(/isn't one of/);
    expect(answerProblem(paperQuestion("mcq"), ["a", "a"])).toMatch(/twice/);
    expect(answerProblem(paperQuestion("short"), ["a"])).toMatch(/doesn't have choices/);
    expect(answerProblem(paperQuestion("coding"), [])).toMatch(/its code/);
  });

  it("takes one choice unless more are right, without saying which", () => {
    expect(answerProblem(paperQuestion("mcq"), ["a", "b"])).toMatch(/one choice/);
    expect(answerProblem(paperQuestion("mcq", 2), ["a", "b"])).toBeNull();
    expect(answerProblem(paperQuestion("mcq"), [])).toBeNull();
  });
});

describe("scorePaper", () => {
  const paper = sittingFrom(
    [question({ marks: 2 }), question({ kind: "short", choices: [], marks: 3 }), coding({ marks: 10 }), question({ kind: "design", choices: [], marks: 5 })],
    firstAlways,
  ).paper;
  const [mcq, short, code, design] = paper as [(typeof paper)[0], (typeof paper)[0], (typeof paper)[0], (typeof paper)[0]];

  it("adds up what's been earned, against everything on the paper", () => {
    const score = scorePaper(paper, [{ questionId: mcq.id, awarded: 2, text: "" }, { questionId: short.id, awarded: 1, text: "because" }, { questionId: design.id, awarded: 4, text: "" }], [{ questionId: code.id, passed: 1, total: 2 }]);
    expect(score).toMatchObject({ marks: 12, max: 20, unmarked: 0 });
    expect(score.byKind.coding).toEqual({ marks: 5, max: 10 });
    expect(score.byKind.design).toEqual({ marks: 4, max: 5 });
  });

  it("counts a coding question's best run", () => {
    expect(scorePaper(paper, [], [{ questionId: code.id, passed: 2, total: 2 }, { questionId: code.id, passed: 0, total: 2 }]).byKind.coding.marks).toBe(10);
  });

  it("lets the interviewer's own mark stand for a coding question", () => {
    expect(scorePaper(paper, [{ questionId: code.id, awarded: 7, text: "" }], [{ questionId: code.id, passed: 2, total: 2 }]).byKind.coding.marks).toBe(7);
  });

  it("waits for a person on a coding question with no tests", () => {
    const made = sittingFrom([coding({ tests: [] })], firstAlways).paper;
    expect(scorePaper(made, [], []).unmarked).toBe(1);
    expect(scorePaper(made, [{ questionId: made[0]!.id, awarded: 1, text: "" }], []).unmarked).toBe(0);
  });

  it("says what's still waiting for a person", () => {
    expect(scorePaper(paper, [{ questionId: short.id, awarded: null, text: "because" }], []).unmarked).toBe(2); // the short answer, and the design
    expect(scorePaper(paper, [{ questionId: short.id, awarded: null, text: "  " }, { questionId: design.id, awarded: 0, text: "" }], []).unmarked).toBe(0);
  });
});

describe("integrityReport", () => {
  it("counts by kind and reads the level", () => {
    const event = (kind: "tab-hidden" | "second-session") => ({ id: "1", kind, source: "browser" as const, at: "" });
    expect(integrityReport([event("tab-hidden")], 0)).toMatchObject({ counts: { "tab-hidden": 1 }, level: "clear" });
    expect(integrityReport([event("tab-hidden"), event("second-session")], 0).level).toBe("concern");
  });
});

describe("sessionsAfterBeat", () => {
  it("is quiet for one tab", () => {
    const first = sessionsAfterBeat(null, "a");
    expect(first.second).toBe(false);
    expect(sessionsAfterBeat(first.stored, "a")).toEqual({ stored: first.stored, second: false });
  });

  it("doesn't mistake a reload for a second tab", () => {
    const first = sessionsAfterBeat(null, "a");
    expect(sessionsAfterBeat(first.stored, "b").second).toBe(false);
  });

  it("notices two tabs taking turns", () => {
    const a = sessionsAfterBeat(null, "a");
    const b = sessionsAfterBeat(a.stored, "b");
    expect(sessionsAfterBeat(b.stored, "a").second).toBe(true);
  });
});
