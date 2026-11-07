import { describe, expect, it } from "vitest";

import { parseBandit, parseGitleaks, parseLizard, parseScc } from "./analysis.js";

// Each tool's real output, from running it on a small project.
const SCC = JSON.stringify([
  {
    Name: "Python", Bytes: 584, CodeBytes: 0, Lines: 19, Code: 17, Comment: 1, Blank: 1, Complexity: 7, Count: 2, WeightedComplexity: 0, LineLength: null, ULOC: 0,
    Files: [
      { Language: "Python", Filename: "test_a.py", Extension: "py", Location: "tests/test_a.py", Lines: 2, Code: 2, Comment: 0, Blank: 0, Complexity: 0, Binary: false },
      { Language: "Python", Filename: "app.py", Extension: "py", Location: "src/app.py", Lines: 17, Code: 15, Comment: 1, Blank: 1, Complexity: 7, Binary: false },
    ],
  },
  { Name: "TypeScript", Lines: 90, Code: 80, Comment: 5, Blank: 5, Complexity: 2, Count: 1, Files: [{ Language: "TypeScript", Location: "./src/util.ts", Code: 80, Complexity: 2 }] },
]);

const LIZARD = `2,1,8,0,2,"test_a@1-2@./tests/test_a.py","./tests/test_a.py","test_a","test_a( )",1,2
1,2,26,2,1,"add@1-1@./src/util.ts","./src/util.ts","add","add ( a , b )",1,1
13,20,84,5,13,"run@5-17@./src/app.py","./src/app.py","run","run( cmd , data , a , b , c )",5,17
`;

const SECRET_VALUE = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

describe("scc", () => {
  it("adds up the project, largest language first", () => {
    const size = parseScc(SCC);
    expect(size).toMatchObject({ files: 3, lines: 109, code: 97, comments: 6, blanks: 6, complexity: 9 });
    expect(size.languages.map((language) => language.name)).toEqual(["TypeScript", "Python"]);
    expect(size.languages[1]).toEqual({ name: "Python", files: 2, code: 17, comments: 1, blanks: 1, complexity: 7 });
  });

  it("lists the biggest files, with clean paths", () => {
    expect(parseScc(SCC).biggest.slice(0, 2)).toEqual([
      { path: "src/util.ts", language: "TypeScript", code: 80, complexity: 2 },
      { path: "src/app.py", language: "Python", code: 15, complexity: 7 },
    ]);
  });

  it("copes with an empty room", () => {
    expect(parseScc("")).toMatchObject({ files: 0, languages: [] });
    expect(parseScc("[]").biggest).toEqual([]);
  });
});

describe("lizard", () => {
  it("puts the most tangled function first, with where it is", () => {
    const { total, tooComplex, worst } = parseLizard(LIZARD);
    expect(total).toBe(3);
    expect(tooComplex).toBe(1);
    expect(worst[0]).toEqual({ path: "src/app.py", name: "run", line: 5, complexity: 20, lines: 13, params: 5 });
  });

  it("isn't thrown by commas in quotes, or by other lines", () => {
    const { worst } = parseLizard(`1,3,8,2,2,"f@1-2@./a,b.py","./a,b.py","f","f( a, b )",1,2\nWARNING: something\n\n`);
    expect(worst).toEqual([{ path: "a,b.py", name: "f", line: 1, complexity: 3, lines: 1, params: 2 }]);
  });
});

describe("gitleaks", () => {
  const report = JSON.stringify([
    { RuleID: "github-pat", Description: "Uncovered a GitHub Personal Access Token.", StartLine: 2, EndLine: 2, Match: SECRET_VALUE, Secret: SECRET_VALUE, File: "src/app.py", Fingerprint: `src/app.py:github-pat:2:${SECRET_VALUE}`, Entropy: 4.7 },
    { RuleID: "aws-access-token", Description: "Identified AWS credentials.", StartLine: 1, Match: "REDACTED", Secret: "REDACTED", File: "./src/app.py" },
  ]);

  it("keeps where and which rule, and never the secret, even if a tool lets it through", () => {
    const secrets = parseGitleaks(report);
    expect(secrets.total).toBe(2);
    expect(secrets.items[0]).toEqual({ path: "src/app.py", line: 1, rule: "aws-access-token", description: "Identified AWS credentials." });
    expect(JSON.stringify(secrets)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(secrets)).not.toContain("REDACTED");
  });

  it("reads no findings as none", () => {
    expect(parseGitleaks("[]")).toEqual({ total: 0, items: [] });
    expect(parseGitleaks("null")).toEqual({ total: 0, items: [] });
    expect(parseGitleaks("")).toEqual({ total: 0, items: [] });
  });
});

describe("bandit", () => {
  const report = (results: unknown[]) => JSON.stringify({ errors: [], generated_at: "x", metrics: {}, results });
  const issue = { code: `1 password = "${SECRET_VALUE}"\n`, col_offset: 0, filename: "./src/app.py", issue_confidence: "HIGH", issue_cwe: { id: 502 }, issue_severity: "HIGH", issue_text: "Use of pickle.", line_number: 7, line_range: [7], more_info: "https://x", test_id: "B301", test_name: "pickle" };

  it("keeps what's useful, worst first", () => {
    const low = { ...issue, issue_severity: "LOW", line_number: 1, test_id: "B403" };
    const { total, items } = parseBandit(report([low, issue]));
    expect(total).toBe(2);
    expect(items[0]).toEqual({ path: "src/app.py", line: 7, severity: "high", confidence: "high", code: "B301", message: "Use of pickle.", cwe: 502 });
    expect(items[1]!.code).toBe("B403");
  });

  it("never keeps the source line, which can hold a secret", () => {
    expect(JSON.stringify(parseBandit(report([issue])))).not.toContain(SECRET_VALUE);
  });

  it("doesn't repeat a password that bandit's message quotes", () => {
    const hardcoded = { ...issue, test_id: "B105", issue_text: `Possible hardcoded password: '${SECRET_VALUE}'` };
    const { items } = parseBandit(report([hardcoded]));
    expect(items[0]!.message).toBe("Possible hardcoded password.");
    expect(JSON.stringify(items)).not.toContain(SECRET_VALUE);
  });

  it("throws on what isn't its report, so it becomes a note", () => {
    expect(() => parseBandit("Traceback (most recent call last):")).toThrow();
  });
});
