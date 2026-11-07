import { describe, expect, it } from "vitest";

import { analysisFacts, buildProjectDigest, pathsNotInProject, redactSecrets, type ProjectFile } from "./ai-analysis.js";
import type { RoomAnalysis } from "./analysis.js";

const file = (path: string, text: string | null = "x = 1\n"): ProjectFile => ({ path, text });
const facts = (files: ProjectFile[]) => buildProjectDigest(files).facts.join("\n");

const REPORT: RoomAnalysis = {
  at: "2026-11-07T00:00:00.000Z",
  ms: 1000,
  tools: [
    { name: "scc", ran: true, note: null, ms: 10 },
    { name: "bandit", ran: false, note: "bandit only reads Python, and there's none here.", ms: 0 },
  ],
  size: { files: 3, lines: 120, code: 100, comments: 10, blanks: 10, complexity: 9, languages: [{ name: "Python", files: 3, code: 100, comments: 10, blanks: 10, complexity: 9 }], biggest: [{ path: "src/app.py", language: "Python", code: 80, complexity: 7 }] },
  functions: { total: 12, tooComplex: 1, worst: [{ path: "src/app.py", name: "tangled", line: 5, complexity: 20, lines: 40, params: 3 }, { path: "src/app.py", name: "simple", line: 50, complexity: 1, lines: 2, params: 0 }] },
  secrets: { total: 1, items: [{ path: "src/keys.py", line: 2, rule: "github-pat", description: "A token." }] },
  security: { total: 2, items: [{ path: "src/app.py", line: 9, severity: "high", confidence: "high", code: "B602", message: "shell=True.", cwe: 78 }, { path: "src/app.py", line: 1, severity: "low", confidence: "high", code: "B404", message: "subprocess.", cwe: 78 }] },
  problems: { errors: 1, warnings: 0, infos: 0, items: [{ path: "src/app.py", severity: "error", message: "Undefined name.", source: "Pyright", code: null, line: 3, column: 1, endLine: 3, endColumn: 2 }] },
};

describe("secrets", () => {
  const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

  it("takes out what looks like one", () => {
    for (const secret of [TOKEN, "AKIAIOSFODNN7EXAMPLE", "sk-abcdefghijklmnopqrstuvwx", "xoxb-1234567890-abcdefgh", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop"]) {
      expect(redactSecrets(`token = ${secret} # here`)).not.toContain(secret);
    }
    expect(redactSecrets('password = "hunter2hunter2"')).toBe('password = "[removed: looks like a secret]"');
    expect(redactSecrets('const API_KEY: "abcdef123456"')).not.toContain("abcdef123456");
    expect(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).not.toContain("abc");
    expect(redactSecrets("postgres://admin:s3cretpw@db:5432/app")).not.toContain("s3cretpw");
    expect(redactSecrets("postgres://admin:s3cretpw@db:5432/app")).toContain("db:5432/app");
  });

  it("leaves ordinary code and placeholders alone", () => {
    for (const fine of ['password = "${DB_PASSWORD}"', 'api_key = "your-api-key"', 'secret: "<your secret>"', "const password = process.env.PASSWORD", "tokens = tokenize(text)", 'name = "Parth Kansal"']) {
      expect(redactSecrets(fine)).toBe(fine);
    }
  });

  it("never reaches the digest, whether a file is read or outlined", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const digest = buildProjectDigest([
      file("README.md", `key: ${secret}`),
      file("deep/down/a/long/way/service.py", `def connect(key="${secret}"):\n    pass\n`),
      ...Array.from({ length: 20 }, (_, index) => file(`src/m${index}.py`, `def f${index}(k="${secret}"): pass\n`)),
    ]);
    expect(JSON.stringify(digest)).not.toContain(secret);
  });

  it("doesn't read private files at all, but says they're there", () => {
    const digest = buildProjectDigest([file(".env", "DATABASE=whatever-it-says"), file("certs/server.key", "whatever"), file(".env.example", "DATABASE=")]);
    expect(JSON.stringify(digest.files)).not.toContain("whatever");
    expect(digest.files.map((item) => item.path)).toContain(".env.example");
    expect(digest.facts.join()).toContain(".env");
    expect(digest.facts.join()).toContain("certs/server.key");
  });
});

describe("the shape of a project", () => {
  it("counts files and lines, leaving out what's generated", () => {
    const digest = buildProjectDigest([file("a.py", "1\n2\n3\n"), file("b.ts", "1\n"), file("node_modules/x/i.js", "1\n2\n"), file("logo.png", null)]);
    expect(digest.counts).toEqual({ files: 4, lines: 4 });
    expect(digest.tree).not.toContain("node_modules/x/i.js");
    expect(digest.tree).toContain("logo.png");
  });

  it("notices no tests, and says how many there are otherwise", () => {
    const source = [file("a.py"), file("b.py"), file("c.py")];
    expect(facts(source)).toContain("No test files among 3 source files.");
    expect(facts([...source, file("tests/test_a.py")])).toContain("1 test file and 3 source files.");
    expect(facts([...source, file("a.test.ts"), file("b_test.go"), file("test_c.py")])).toContain("3 test files");
  });

  it("notices what's missing, and not when it's there", () => {
    const said = facts([file("a.py"), file("b.py"), file("c.py")]);
    for (const missing of ["No README", "No package manifest", "No .gitignore", "No CI"]) expect(said).toContain(missing);
    const tidy = facts([file("a.py"), file("b.py"), file("c.py"), file("README.md"), file("requirements.txt"), file(".gitignore"), file(".github/workflows/ci.yml")]);
    expect(tidy).not.toMatch(/No README|No package manifest|No \.gitignore|No CI/);
  });

  it("notices a package.json with no lockfile, and generated files", () => {
    expect(facts([file("package.json", "{}")])).toContain("no lockfile");
    expect(facts([file("package.json", "{}"), file("pnpm-lock.yaml")])).not.toContain("no lockfile");
    expect(facts([file("node_modules/x/index.js")])).toContain("installed or generated");
  });

  it("reads the files that explain a project first, and outlines the rest", () => {
    const digest = buildProjectDigest([
      file("README.md", "# hello"),
      file("package.json", "{}"),
      file("src/index.ts", "export function start() {}\n"),
      ...Array.from({ length: 30 }, (_, index) => file(`src/lib/m${index}.ts`, `export function f${index}(a: number) {\n  return a;\n}\nconst inner = 1;\n`)),
    ]);
    expect(digest.files.slice(0, 3).map((item) => item.path)).toEqual(["README.md", "package.json", "src/index.ts"]);
    expect(digest.files.length).toBeLessThanOrEqual(12);
    const outline = digest.outlines[0]!;
    expect(outline.lines[0]).toMatch(/^export function f\d+\(a: number\)$/);
    expect(outline.lines.join()).not.toContain("inner");
    expect(digest.outlines.map((item) => item.path)).not.toContain("README.md");
  });

  it("doesn't choke on an empty project or binary files", () => {
    expect(buildProjectDigest([]).counts).toEqual({ files: 0, lines: 0 });
    expect(buildProjectDigest([file("a.png", null)]).files).toEqual([]);
  });
});

describe("what the tools found, as facts", () => {
  const said = analysisFacts(REPORT).join("\n");

  it("says who found what, and where", () => {
    expect(said).toContain("scc: 100 lines of code in 3 files: Python 100.");
    expect(said).toContain("tangled at src/app.py:5 (20)");
    expect(said).toContain("gitleaks: 1 secret in the code: src/keys.py:2 (github-pat)");
    expect(said).toContain("bandit, Python security: 1 high, 0 medium, 1 low.");
    expect(said).toContain("src/app.py:9 B602 (high): shell=True.");
    expect(said).toContain("1 error, 0 warnings. src/app.py:3 Undefined name.");
  });

  it("leaves out what doesn't matter", () => {
    expect(said).not.toContain("simple at");
    expect(said).not.toContain("B404");
  });

  it("says what couldn't run, so the model doesn't take silence for a clean result", () => {
    expect(said).toContain("Not run: bandit only reads Python");
  });

  it("comes first in the digest, before what plain code can say", () => {
    const digest = buildProjectDigest([file("a.py")], REPORT);
    expect(digest.facts[0]).toMatch(/^scc:/);
    expect(digest.facts.join()).toContain("No README");
  });

  it("is quiet about a project with nothing to report", () => {
    const empty: RoomAnalysis = { ...REPORT, tools: [], size: { ...REPORT.size, languages: [], biggest: [] }, functions: { total: 0, tooComplex: 0, worst: [] }, secrets: { total: 0, items: [] }, security: { total: 0, items: [] }, problems: { errors: 0, warnings: 0, infos: 0, items: [] } };
    expect(analysisFacts(empty)).toEqual([]);
  });
});

describe("paths in an answer", () => {
  const known = ["src/app/main.py", "src/app/db.py", "README.md", "package.json"];

  it("finds the ones that aren't in the project", () => {
    expect(pathsNotInProject("See `src/app/auth.py` and `lib/utils.ts`.", known)).toEqual(["src/app/auth.py", "lib/utils.ts"]);
    expect(pathsNotInProject("Look at `settings.py`.", known)).toEqual(["settings.py"]);
  });

  it("accepts the real ones, however they're written", () => {
    for (const fine of ["`src/app/main.py`", "`./src/app/main.py`", "`main.py`", "`app/main.py`", "`src/app`", "`src/app/`", "`src/app/main.py:12`", "`src/app/main.py:5-16`", "`README.md`"]) {
      expect(pathsNotInProject(fine, known)).toEqual([]);
    }
  });

  it("doesn't mistake code for a path", () => {
    for (const code of ["`foo.bar()`", "`x = 1`", "`os.path`", "`self.name`", "`console.log`", "`a / b`", "`https://example.com/a.py`", "`--flag`", "`Map<string>`", "`subprocess.call`"]) {
      expect(pathsNotInProject(code, known)).toEqual([]);
    }
  });
});
