import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as Y from "yjs";

import {
  addColumn,
  addMessage,
  addRun,
  CODE_LANGUAGES,
  createPrompt,
  deletePrompt,
  ensureValue,
  isValidJson,
  MOST_ANSWER_CHARS,
  MOST_COLUMNS,
  MOST_RUNS,
  nextColumn,
  promptAsCode,
  promptsOf,
  readColumns,
  readMessages,
  readPrompts,
  readPromptText,
  readRuns,
  removeColumn,
  removeMessage,
  renderedPrompt,
  restorePrompt,
  samePrompt,
  setMessageRole,
  systemOf,
  tokensPerSecond,
  updateColumn,
  usedValues,
  whyNotRunnable,
  type ColumnResult,
  type PromptColumn,
  type PromptRun,
} from "./model";

const column = (over: Partial<PromptColumn> = {}): PromptColumn => ({ id: "c1", model: "a", temperature: null, maxTokens: null, json: false, ...over });
const setup = () => {
  const doc = new Y.Doc();
  const id = createPrompt(doc, { name: "One", system: "Be brief.", messages: [{ role: "user", content: "Explain {{topic}}." }], values: { topic: "recursion" }, columns: [column()] });
  return { doc, id, node: promptsOf(doc).get(id)! };
};
const result = (over: Partial<ColumnResult> = {}): ColumnResult => ({ column: column(), text: "answer", status: "done", error: null, firstMs: 100, totalMs: 1100, usage: { inputTokens: 5, outputTokens: 50, estimated: false }, ...over });
const run = (at: number, over: Partial<PromptRun> = {}): PromptRun => ({ id: `r${at}`, at, by: "A", system: "", messages: [], values: {}, results: [result()], ...over });

describe("a prompt", () => {
  it("reads back as it was made", () => {
    const { node } = setup();
    assert.deepEqual(readPromptText(node), { system: "Be brief.", messages: [{ role: "user", content: "Explain {{topic}}." }], values: { topic: "recursion" } });
    assert.deepEqual(readColumns(node), [column()]);
  });

  it("lists oldest first, and goes when deleted", () => {
    const { doc, id } = setup();
    const second = createPrompt(doc, { name: "Two", columns: [] });
    assert.deepEqual(readPrompts(doc).map((item) => item.name).sort(), ["One", "Two"]);
    deletePrompt(doc, id);
    assert.deepEqual(readPrompts(doc), [{ id: second, name: "Two" }]);
  });

  it("merges two people typing in the system prompt", () => {
    const { doc, node } = setup();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    systemOf(node).insert(0, "Hi. ");
    systemOf(promptsOf(other).get([...promptsOf(other).keys()][0]!)!).insert(9, " Really.");
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    assert.equal(systemOf(node).toString(), "Hi. Be brief. Really.");
  });
});

describe("messages", () => {
  it("take turns as they're added", () => {
    const { node } = setup();
    addMessage(node);
    addMessage(node);
    assert.deepEqual(readMessages(node).map((message) => message.role), ["user", "assistant", "user"]);
  });

  it("can change role and be removed", () => {
    const { node } = setup();
    addMessage(node);
    const [first, second] = readMessages(node);
    setMessageRole(node, second!.id, "user");
    assert.equal(readMessages(node)[1]!.role, "user");
    removeMessage(node, first!.id);
    assert.deepEqual(readMessages(node).map((message) => message.id), [second!.id]);
  });
});

describe("columns", () => {
  it("stop at the most that fit", () => {
    const { node } = setup();
    for (let index = 0; index < MOST_COLUMNS + 2; index += 1) addColumn(node, column({ id: `x${index}` }));
    assert.equal(readColumns(node).length, MOST_COLUMNS);
  });

  it("change in place, and go when removed", () => {
    const { node } = setup();
    addColumn(node, column({ id: "c2", model: "b" }));
    updateColumn(node, "c1", { temperature: 0.5 });
    assert.deepEqual(readColumns(node).map((item) => [item.id, item.temperature]), [["c1", 0.5], ["c2", null]]);
    removeColumn(node, "c1");
    assert.deepEqual(readColumns(node).map((item) => item.id), ["c2"]);
  });

  it("offer the next untried model, then the same with more freedom", () => {
    assert.equal(nextColumn([column()], ["a", "b"], "a").model, "b");
    assert.equal(nextColumn([column()], ["a", "b"], "a").temperature, null);
    const same = nextColumn([column()], ["a"], "a");
    assert.deepEqual([same.model, same.temperature], ["a", 1]);
    assert.deepEqual([nextColumn([], ["a"], "a").model, nextColumn([], [], "z").model, nextColumn([], [], "z").temperature], ["a", "z", null]);
  });
});

describe("runs", () => {
  it("come back newest first, keeping only the last few", () => {
    const { node } = setup();
    for (let at = 1; at <= MOST_RUNS + 3; at += 1) addRun(node, run(at));
    const runs = readRuns(node);
    assert.equal(runs.length, MOST_RUNS);
    assert.equal(runs[0]!.at, MOST_RUNS + 3);
    assert.equal(runs.at(-1)!.at, 4);
  });

  it("keep the start of a very long answer, and say so", () => {
    const { node } = setup();
    addRun(node, run(1, { results: [result({ text: "x".repeat(MOST_ANSWER_CHARS + 10) }), result()] }));
    const [long, short] = readRuns(node)[0]!.results;
    assert.equal(long!.text.length, MOST_ANSWER_CHARS);
    assert.equal(long!.shortened, true);
    assert.equal(short!.shortened, undefined);
  });

  it("put an earlier prompt back, values too", () => {
    const { node } = setup();
    const before = readPromptText(node);
    systemOf(node).insert(0, "Changed. ");
    addMessage(node);
    ensureValue(node, "topic").insert(0, "not ");
    assert.equal(samePrompt(before, readPromptText(node)), false);
    restorePrompt(node, before);
    assert.deepEqual(readPromptText(node), before);
  });
});

describe("what's sent", () => {
  it("has its variables filled in", () => {
    const { node } = setup();
    assert.deepEqual(renderedPrompt(readPromptText(node)).messages, [{ role: "user", content: "Explain recursion." }]);
  });

  it("is the same when only a value nobody uses differs", () => {
    const base = { system: "", messages: [{ role: "user" as const, content: "{{a}}" }], values: { a: "1" } };
    assert.equal(samePrompt(base, { ...base, values: { a: "1", b: "2" } }), true);
    assert.equal(samePrompt(base, { ...base, values: { a: "2" } }), false);
    assert.deepEqual(usedValues({ ...base, values: { a: "1", b: "2" } }), { a: "1" });
  });

  it("can't go without a column, or something from the user last", () => {
    const fine = { system: "", messages: [{ role: "user" as const, content: "Hi" }], values: {} };
    assert.equal(whyNotRunnable(fine, [column()]), null);
    assert.match(whyNotRunnable(fine, [])!, /column/);
    assert.match(whyNotRunnable({ ...fine, messages: [{ role: "user", content: "  " }] }, [column()])!, /last message/);
    assert.match(whyNotRunnable({ ...fine, messages: [{ role: "assistant", content: "Hi" }] }, [column()])!, /last message/);
    assert.match(whyNotRunnable({ ...fine, messages: [{ role: "user", content: "{{a}}" }], values: { a: "" } }, [column()])!, /last message/);
  });
});

describe("the prompt as code", () => {
  const prompt = { system: "Be brief.", messages: [{ role: "user" as const, content: "It's {{a}} \"quoted\"\nline two" }], values: { a: "fine" } };

  it("fills in its variables and keeps the system prompt first, in every language", () => {
    for (const language of CODE_LANGUAGES) {
      const code = promptAsCode(prompt, column(), language);
      assert.ok(code.indexOf("Be brief.") < code.indexOf("fine"), language);
      assert.ok(!code.includes("{{a}}"), language);
    }
  });

  it("sends only the settings chosen", () => {
    const plain = promptAsCode(prompt, column(), "Python");
    assert.ok(!plain.includes("temperature") && !plain.includes("max_tokens") && !plain.includes("response_format"));
    const tuned = promptAsCode(prompt, column({ temperature: 0, maxTokens: 5, json: true }), "Python");
    assert.ok(tuned.includes("temperature=0,") && tuned.includes("max_tokens=5,") && tuned.includes('"json_object"'), tuned);
    assert.ok(promptAsCode(prompt, column({ temperature: 0.5 }), "JavaScript").includes("temperature: 0.5,"));
  });

  it("names no address or key, as the room's environment has them", () => {
    for (const language of CODE_LANGUAGES) {
      const code = promptAsCode(prompt, column(), language);
      assert.ok(!code.includes("127.0.0.1") && !/api_key|apiKey|Authorization/.test(code), language);
    }
  });

  it("makes a curl body that survives the shell", () => {
    const code = promptAsCode(prompt, column(), "curl");
    const body = /-d '([\s\S]*)'\n$/.exec(code)![1]!.replaceAll("'\\''", "'");
    assert.equal(JSON.parse(body).messages[1].content, "It's fine \"quoted\"\nline two");
  });
});

describe("the numbers", () => {
  it("leave out the wait for the first word", () => {
    assert.equal(tokensPerSecond(result({ firstMs: 9000, totalMs: 10_000, usage: { inputTokens: 1, outputTokens: 50, estimated: false } })), 50);
  });

  it("say nothing when there's too little to go on", () => {
    assert.equal(tokensPerSecond(result({ usage: null })), null);
    assert.equal(tokensPerSecond(result({ firstMs: null })), null);
    assert.equal(tokensPerSecond(result({ firstMs: 100, totalMs: 120 })), null);
    assert.equal(tokensPerSecond(result({ usage: { inputTokens: 1, outputTokens: 0, estimated: false } })), null);
  });

  it("can tell JSON from what only looks like it", () => {
    assert.equal(isValidJson('{"a": 1}'), true);
    assert.equal(isValidJson("```json\n{}\n```"), false);
  });
});
