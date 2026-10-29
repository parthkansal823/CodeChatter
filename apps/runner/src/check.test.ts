import { describe, expect, it } from "vitest";

import { parseLines, parsePyright, parseTsc } from "./check.js";

describe("parsePyright", () => {
  it("takes the room's files, with lines and columns from 1", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "/workspace/app/main.py", severity: "error", message: '"x" is not defined', rule: "reportUndefinedVariable", range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } } },
        { file: "/usr/lib/python3/x.py", severity: "error", message: "not ours", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
        { file: "/workspace/b.py", severity: "information", message: "fyi", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      ],
    });
    expect(parsePyright(json)).toEqual([
      { path: "app/main.py", severity: "error", message: '"x" is not defined', source: "Pyright", code: "reportUndefinedVariable", line: 3, column: 5, endLine: 3, endColumn: 6 },
      { path: "b.py", severity: "info", message: "fyi", source: "Pyright", code: null, line: 1, column: 1, endLine: 1, endColumn: 2 },
    ]);
  });
});

describe("parseTsc", () => {
  it("reads tsc's lines from its folder, a message's later lines with it", () => {
    const output = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  The expected type comes from here.\nsrc/b.ts(1,1): error TS1005: ';' expected.\n";
    const problems = parseTsc(output, "web");
    expect(problems.map((p) => [p.path, p.line, p.column, p.code])).toEqual([
      ["web/src/a.ts", 3, 7, "TS2322"],
      ["web/src/b.ts", 1, 1, "TS1005"],
    ]);
    expect(problems[0]!.message).toBe("Type 'string' is not assignable to type 'number'.\nThe expected type comes from here.");
  });
});

describe("parseLines", () => {
  it("reads go vet's and cargo's short form, from the folder they ran in", () => {
    const vet = "# example.com/x\n./main.go:12:2: fmt.Printf format %d has arg s of wrong type string\n";
    expect(parseLines(vet, "svc", "go vet").map((p) => [p.path, p.line, p.column, p.severity])).toEqual([["svc/main.go", 12, 2, "error"]]);
    const cargo = "src/main.rs:3:5: error[E0425]: cannot find value `y` in this scope\nsrc/main.rs:2:9: warning: unused variable: `x`\nerror: could not compile `crab`\n";
    expect(parseLines(cargo, "", "cargo").map((p) => [p.path, p.severity, p.code, p.message])).toEqual([
      ["src/main.rs", "error", "E0425", "cannot find value `y` in this scope"],
      ["src/main.rs", "warning", null, "unused variable: `x`"],
    ]);
  });
});
