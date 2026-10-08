import { describe, expect, it } from "vitest";

import { AI_MODES, AiChatInput, parseAgentReply } from "./ai.js";

describe("parseAgentReply", () => {
  it("splits text, a plan and actions in order", () => {
    const segments = parseAgentReply(
      'I will fix it.\n<plan>\n1. Read util\n2. Edit app\n</plan>\n<read path="src/util.py"/>\n<edit path="src/app.py">\nprint(1)\n</edit>\n<run path="src/app.py" />\n<test path="src/app.py"></test>\nThen we are done.',
    );
    expect(segments.map((s) => (s.type === "text" ? "text" : `${s.action.kind}:${s.action.path}`))).toEqual([
      "text",
      "read:src/util.py",
      "edit:src/app.py",
      "run:src/app.py",
      "test:src/app.py",
      "text",
    ]);
    expect(segments[0]).toEqual({ type: "text", text: "I will fix it.\n\n**Plan**\n\n1. Read util\n2. Edit app" });
    const edit = segments.find((s) => s.type === "action" && s.action.kind === "edit");
    expect(edit).toMatchObject({ complete: true, action: { content: "print(1)" } });
    const indexes = segments.flatMap((s) => (s.type === "action" ? [s.index] : []));
    expect(indexes).toEqual([0, 1, 2, 3]);
  });

  it("strips a code fence inside an edit and keeps indentation", () => {
    const [segment] = parseAgentReply('<create path="a/b.py">\n```python\ndef f():\n    return 1\n```\n</create>');
    expect(segment).toMatchObject({ type: "action", action: { kind: "create", path: "a/b.py", content: "def f():\n    return 1" } });
  });

  it("marks a half-streamed edit incomplete and hides a half-typed tag", () => {
    const partial = parseAgentReply('Working.\n<edit path="x.py">\nline 1\nline 2');
    expect(partial.at(-1)).toMatchObject({ type: "action", complete: false, action: { content: "line 1\nline 2" } });
    expect(parseAgentReply("Next:\n<edi")).toEqual([{ type: "text", text: "Next:" }]);
    expect(parseAgentReply('Next:\n<read path="src/a')).toEqual([{ type: "text", text: "Next:" }]);
  });

  it("ignores actions with unsafe paths", () => {
    const segments = parseAgentReply('<edit path="../secret">x</edit><read path="/etc/passwd"/><run path="ok.py"/>');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "action", index: 0, action: { kind: "run", path: "ok.py" } });
  });

  it("returns plain text untouched", () => {
    expect(parseAgentReply("Just an answer with `code` and a < b.")).toEqual([{ type: "text", text: "Just an answer with `code` and a < b." }]);
  });
});

describe("AiChatInput", () => {
  const base = { messages: [{ role: "user", content: "q" }] };

  it("knows every mode", () => {
    expect(AI_MODES).toEqual(expect.arrayContaining(["edit", "agent", "summary"]));
  });

  it("accepts a summary window and defaults it", () => {
    const parsed = AiChatInput.parse({ ...base, mode: "summary", context: { summary: { changes: "created a.py" } } });
    expect(parsed.context.summary).toEqual({ minutes: 60, changes: "created a.py" });
    expect(AiChatInput.safeParse({ ...base, context: { summary: { minutes: 1 } } }).success).toBe(false);
  });

  it("caps the files an agent can attach", () => {
    const file = { path: "a.py", text: "x" };
    expect(AiChatInput.safeParse({ ...base, context: { extraFiles: Array(6).fill(file) } }).success).toBe(true);
    expect(AiChatInput.safeParse({ ...base, context: { extraFiles: Array(7).fill(file) } }).success).toBe(false);
  });
});
