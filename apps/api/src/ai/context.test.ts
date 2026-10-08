import type { RunSnapshot } from "@codechatter/contracts";
import { describe, expect, it } from "vitest";

import { buildContextBlock, plainTerminalText, truncateMiddle, truncateStart } from "./context.js";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1} ${"x".repeat(30)}`).join("\n");

describe("truncateMiddle", () => {
  it("leaves short text alone", () => {
    expect(truncateMiddle("a\nb", 100)).toEqual({ text: "a\nb", omitted: null });
  });

  it("cuts whole lines from the middle and says which", () => {
    const source = numbered(200);
    const { text, omitted } = truncateMiddle(source, 2000);
    expect(text.length).toBeLessThanOrEqual(2000 + 80);
    expect(text.startsWith("line 1 ")).toBe(true);
    expect(text.endsWith(`line 200 ${"x".repeat(30)}`)).toBe(true);
    expect(omitted).toMatch(/^lines \d+-\d+$/);
    expect(text).toContain(`[${omitted} omitted`);
    // Every kept line is intact.
    for (const line of text.split("\n")) if (!line.startsWith("…")) expect(line).toMatch(/^line \d+ x{30}$/);
  });

  it("cuts characters when there is only one huge line", () => {
    const { text, omitted } = truncateMiddle("y".repeat(10_000), 1000);
    expect(text.length).toBeLessThan(1100);
    expect(omitted).toBe("9000 characters");
  });
});

describe("truncateStart", () => {
  it("keeps the end of long output", () => {
    const { text, omitted } = truncateStart(numbered(300), 500);
    expect(omitted).toBe(true);
    expect(text.startsWith("… [earlier output omitted]")).toBe(true);
    expect(text).toContain("line 300");
    expect(text).not.toContain("line 1 ");
  });
});

describe("plainTerminalText", () => {
  it("drops colours and keeps the last state of redrawn lines", () => {
    expect(plainTerminalText("\x1b[31mError\x1b[0m: boom\r\n")).toBe("Error: boom\n");
    expect(plainTerminalText("progress 10%\rprogress 100%\ndone")).toBe("progress 100%\ndone");
    expect(plainTerminalText("\x1b]0;title\x07ok")).toBe("ok");
  });
});

const snapshot = (output: string, code: number | null): RunSnapshot => ({
  run: { id: "r1", roomId: "TEAM22", path: "main.py", command: "python3 main.py", startedBy: { id: "u", name: "A" }, startedAt: "2026-01-01T00:00:00Z" },
  output,
  exit: code === null ? null : { runId: "r1", code, reason: "exit", durationMs: 12 },
});

describe("buildContextBlock: agent files and summaries", () => {
  it("adds each file the agent was allowed to read", () => {
    const block = buildContextBlock({ extra: [{ path: "src/util.py", text: "def f():\n    return 1\n" }] }, 10_000);
    expect(block).toContain('<file path="src/util.py" lines="2">\ndef f():\n    return 1\n\n</file>');
  });

  it("shares the budget between several extra files", () => {
    const big = numbered(2000);
    const block = buildContextBlock({ extra: [{ path: "a.py", text: big }, { path: "b.py", text: big }] }, 10_000);
    expect(block.length).toBeLessThan(10_000);
    expect(block).toMatch(/<file path="a.py" lines="2000" truncated="lines \d+-\d+">/);
  });

  it("wraps the room's recent history in labelled sections, and says when a source is empty", () => {
    const block = buildContextBlock({ summary: { minutes: 30, chat: "[5 min ago] Priya: hi", activity: "", changes: "created a.py" } }, 10_000);
    expect(block).toContain('<recent_chat minutes="30">\n[5 min ago] Priya: hi\n</recent_chat>');
    expect(block).toContain("(nobody saved edits in this window)");
    expect(block).toContain("<file_changes>\ncreated a.py\n</file_changes>");
  });
});

describe("buildContextBlock", () => {
  it("renders each attached part in its own tagged section", () => {
    const block = buildContextBlock(
      {
        paths: ["main.py", "lib/util.py"],
        file: { path: "main.py", text: "print(1)\nprint(x)" },
        selection: { path: "main.py", text: "print(x)", startLine: 2, endLine: 2 },
        run: { status: "ok", snapshot: snapshot("\x1b[31mNameError: name 'x' is not defined\x1b[0m\r\n", 1) },
      },
      48_000,
    );
    expect(block).toContain('<room_files count="2">\nmain.py\nlib/util.py\n</room_files>');
    expect(block).toContain('<active_file path="main.py" language="Python" lines="2">\nprint(1)\nprint(x)\n</active_file>');
    expect(block).toContain('<selection path="main.py" lines="2-2">');
    expect(block).toContain('result="exited with code 1"');
    expect(block).toContain("NameError: name 'x' is not defined");
    expect(block).not.toContain("\x1b");
  });

  it("says when there is no run or the runner is down", () => {
    expect(buildContextBlock({ run: { status: "ok", snapshot: { run: null, output: "", exit: null } } }, 10_000)).toContain("Nobody has run code");
    expect(buildContextBlock({ run: { status: "unavailable" } }, 10_000)).toContain('status="unavailable"');
  });

  it("keeps the whole block within the budget", () => {
    const budget = 12_000;
    const block = buildContextBlock(
      {
        paths: Array.from({ length: 400 }, (_, i) => `src/folder-${i}/file-${i}.ts`),
        file: { path: "big.ts", text: numbered(5000) },
        selection: { path: "big.ts", text: numbered(1000), startLine: 1, endLine: 1000 },
        run: { status: "ok", snapshot: snapshot(numbered(2000), 1) },
      },
      budget,
    );
    expect(block.length).toBeLessThan(budget * 1.1);
    expect(block).toMatch(/… and \d+ more/);
    expect(block).toMatch(/<active_file path="big.ts" language="TypeScript" lines="5000" truncated="lines \d+-\d+">/);
    expect(block).toContain("[earlier output omitted]");
  });
});
