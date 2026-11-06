/** The rules a question and a batch must follow, pasting a list of candidates, and how the integrity record is read. */
import { describe, expect, it } from "vitest";

import { ImportQuestionsInput, integrityLevel, parseCandidates, parseQuestionImport, QuestionInput, ScheduleBatchInput } from "./interviews.js";

const messages = (result: ReturnType<typeof QuestionInput.safeParse>) => (result.success ? [] : result.error.issues.map((issue) => issue.message));

describe("QuestionInput", () => {
  it("still takes a coding question as it always was, with no kind named", () => {
    const parsed = QuestionInput.parse({ title: "Add", file: "main.py", starterFiles: [{ path: "main.py", content: "" }] });
    expect(parsed).toMatchObject({ kind: "coding", difficulty: "medium", marks: 1, tags: [], choices: [] });
  });

  it("still holds a coding question to its rules", () => {
    expect(messages(QuestionInput.safeParse({ title: "Add" }))).toContain("A question needs at least one file.");
    expect(messages(QuestionInput.safeParse({ title: "Add", file: "other.py", starterFiles: [{ path: "main.py", content: "" }] }))).toContain("The file the tests run must be one of the starter files.");
  });

  it("needs two choices and a right answer for multiple choice, and no files", () => {
    const choice = (id: string, correct = false) => ({ id, text: `Choice ${id}`, correct });
    expect(messages(QuestionInput.safeParse({ kind: "mcq", title: "Which?", choices: [choice("a", true)] }))).toContain("A multiple choice question needs at least two choices.");
    expect(messages(QuestionInput.safeParse({ kind: "mcq", title: "Which?", choices: [choice("a"), choice("b")] }))).toContain("Mark at least one choice as right.");
    expect(messages(QuestionInput.safeParse({ kind: "mcq", title: "Which?", choices: [choice("a", true), choice("a")] }))).toContain("Two choices have the same id.");
    expect(QuestionInput.safeParse({ kind: "mcq", title: "Which?", choices: [choice("a", true), choice("b")] }).success).toBe(true);
  });

  it("takes a short answer with nothing else", () => {
    expect(QuestionInput.safeParse({ kind: "short", title: "Why?" }).success).toBe(true);
  });

  it("tidies tags", () => {
    expect(QuestionInput.parse({ kind: "short", title: "Why?", tags: ["  SQL "] }).tags).toEqual(["sql"]);
  });
});

describe("ScheduleBatchInput", () => {
  const batch = { mode: "assessment" as const, title: "Screening", candidates: [{ name: "Ana", email: "ana@x.com" }], paper: { random: [{ count: 1 }] }, durationMinutes: 30 };

  it("takes a batch", () => {
    expect(ScheduleBatchInput.safeParse(batch).success).toBe(true);
  });

  it("needs a question for an assessment, and a candidate", () => {
    expect(ScheduleBatchInput.safeParse({ ...batch, paper: {} }).success).toBe(false);
    expect(ScheduleBatchInput.safeParse({ ...batch, candidates: [] }).success).toBe(false);
  });

  it("lets an interview leave the questions until it's running", () => {
    expect(ScheduleBatchInput.safeParse({ ...batch, mode: "interview", paper: undefined }).success).toBe(true);
  });

  it("refuses the same email twice, whatever its case", () => {
    expect(ScheduleBatchInput.safeParse({ ...batch, candidates: [{ name: "Ana", email: "ana@x.com" }, { name: "Ana two", email: "ANA@x.com" }] }).success).toBe(false);
  });

  it("refuses a window that closes before it opens", () => {
    expect(ScheduleBatchInput.safeParse({ ...batch, startsAt: "2026-12-02T10:00:00Z", closesAt: "2026-12-01T10:00:00Z" }).success).toBe(false);
  });

  it("can't email someone with no address", () => {
    expect(ScheduleBatchInput.safeParse({ ...batch, sendEmail: true, candidates: [{ name: "Ana" }] }).success).toBe(false);
  });
});

describe("parseCandidates", () => {
  it("reads the ways people paste a list", () => {
    const { candidates, problems } = parseCandidates(["Ana Ruiz, ana@x.com", "Ben Lee <ben@x.com>", "Cy Young\tcy@x.com", "dee.wong@x.com", "Eli Roy", "", "  "].join("\n"));
    expect(problems).toEqual([]);
    expect(candidates).toEqual([
      { name: "Ana Ruiz", email: "ana@x.com" },
      { name: "Ben Lee", email: "ben@x.com" },
      { name: "Cy Young", email: "cy@x.com" },
      { name: "dee wong", email: "dee.wong@x.com" },
      { name: "Eli Roy" },
    ]);
  });

  it("says which lines it couldn't read", () => {
    const { candidates, problems } = parseCandidates("Ana, ana@@x");
    expect(candidates).toEqual([]);
    expect(problems).toEqual(["Ana, ana@@x"]);
  });
});

describe("parseQuestionImport", () => {
  const HEADER = "question,a,b,c,answer,difficulty,marks,tags";

  it("reads a table of multiple choice", () => {
    const { questions, problems } = parseQuestionImport(`${HEADER}\nCapital of France?,Paris,Rome,Oslo,a,easy,2,geo;europe`);
    expect(problems).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ kind: "mcq", title: "Capital of France?", difficulty: "easy", marks: 2, tags: ["geo", "europe"] });
    expect(questions[0]!.choices).toEqual([{ id: "a", text: "Paris", correct: true }, { id: "b", text: "Rome", correct: false }, { id: "c", text: "Oslo", correct: false }]);
  });

  it("reads what a spreadsheet pastes, with tabs", () => {
    const { questions, problems } = parseQuestionImport("question\ta\tb\tanswer\nOne, two?\tYes\tNo\tb");
    expect(problems).toEqual([]);
    expect(questions[0]!.title).toBe("One, two?");
    expect(questions[0]!.choices[1]!.correct).toBe(true);
  });

  it("takes quotes, commas and line breaks inside a cell", () => {
    const { questions, problems } = parseQuestionImport(`question,a,b,answer\n"He said ""hi"", then
left?",Yes,No,a`);
    expect(problems).toEqual([]);
    expect(questions[0]!.title).toBe('He said "hi", then\nleft?');
  });

  it("marks more than one right answer", () => {
    const { questions } = parseQuestionImport("question,a,b,c,answer\nWhich?,X,Y,Z,a;c");
    expect(questions[0]!.choices.filter((choice) => choice.correct).map((choice) => choice.id)).toEqual(["a", "c"]);
  });

  it("makes a question with no choices a short answer, and takes a design", () => {
    const { questions } = parseQuestionImport('question,kind,model answer\nWhy?,,"Because."\nDesign a queue,design,Partitions');
    expect(questions.map((question) => question.kind)).toEqual(["short", "design"]);
    expect(questions[1]!.modelAnswer).toBe("Partitions");
  });

  it("keeps a long question whole as its prompt", () => {
    const long = "word ".repeat(40).trim();
    const { questions } = parseQuestionImport(`question,a,b,answer\n${long},Yes,No,a`);
    expect(questions[0]!.title.length).toBeLessThanOrEqual(120);
    expect(questions[0]!.prompt).toBe(long);
  });

  it("says which lines are wrong and why", () => {
    const { questions, problems } = parseQuestionImport(["question,a,b,answer", "Fine?,Yes,No,a", "No answer?,Yes,No,", "Wrong letter?,Yes,No,z", ",Yes,No,a"].join("\n"));
    expect(questions).toHaveLength(1);
    expect(problems[0]).toMatch(/^Line 3: Mark at least one/);
    expect(problems[1]).toMatch(/^Line 4: the answer "z"/);
    expect(problems[2]).toMatch(/^Line 5: Give the question a title/);
  });

  it("skips empty lines", () => {
    expect(parseQuestionImport("question,a,b,answer\nOne?,Y,N,a\n,,,\n\nTwo?,Y,N,b\n").questions).toHaveLength(2);
  });

  it("asks for a header it can read", () => {
    expect(parseQuestionImport("Capital?,Paris,Rome,a").problems[0]).toMatch(/name the columns/);
  });

  it("reads JSON, for any kind", () => {
    const { questions, problems } = parseQuestionImport(JSON.stringify([{ kind: "coding", title: "Add", file: "main.py", starterFiles: [{ path: "main.py", content: "" }] }, { kind: "short", title: "Why?" }, { kind: "mcq", title: "Bad" }]));
    expect(questions.map((question) => question.kind)).toEqual(["coding", "short"]);
    expect(problems[0]).toMatch(/^Question 3: A multiple choice question needs/);
    expect(parseQuestionImport("[oops").problems).toEqual(["That JSON doesn't parse."]);
  });

  it("has nothing to say about nothing", () => {
    expect(parseQuestionImport("  ")).toEqual({ questions: [], problems: [] });
  });

  it("limits how many go at once", () => {
    const one = { kind: "short", title: "Why?" };
    expect(ImportQuestionsInput.safeParse({ questions: Array(200).fill(one) }).success).toBe(true);
    expect(ImportQuestionsInput.safeParse({ questions: Array(201).fill(one) }).success).toBe(false);
    expect(ImportQuestionsInput.safeParse({ questions: [] }).success).toBe(false);
  });
});

describe("integrityLevel", () => {
  it("doesn't mind a normal sitting", () => {
    expect(integrityLevel({}, 0)).toBe("clear");
    expect(integrityLevel({ "tab-hidden": 2, "window-blur": 4 }, 2)).toBe("clear");
  });

  it("asks someone to look at what's unusual", () => {
    expect(integrityLevel({ "tab-hidden": 3 }, 0)).toBe("look");
    expect(integrityLevel({ pasted: 1 }, 0)).toBe("look");
    expect(integrityLevel({ "copy-blocked": 1 }, 0)).toBe("look");
    expect(integrityLevel({}, 3)).toBe("look");
  });

  it("raises a concern for what's hard to explain", () => {
    expect(integrityLevel({ "second-session": 1 }, 0)).toBe("concern");
    expect(integrityLevel({ pasted: 5 }, 0)).toBe("concern");
    expect(integrityLevel({ "page-silent": 3 }, 0)).toBe("concern");
  });
});
