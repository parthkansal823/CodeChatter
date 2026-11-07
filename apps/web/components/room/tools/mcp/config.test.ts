import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addMcpServer, argumentsFrom, fieldsOf, readMcpConfig, removeMcpServer, splitCommandLine } from "./config";

const added = (text: string | null, name: string, target: string) => {
  const out = addMcpServer(text, name, target);
  if ("problem" in out) throw new Error(out.problem);
  return out.text;
};
const problem = (text: string | null, name: string, target: string) => {
  const out = addMcpServer(text, name, target);
  if (!("problem" in out)) throw new Error("It should have been refused.");
  return out.problem;
};

describe("the file", () => {
  it("is empty when there's none", () => {
    assert.deepEqual(readMcpConfig(null), { servers: [], problem: null });
    assert.deepEqual(readMcpConfig("  "), { servers: [], problem: null });
  });

  it("lists commands and addresses", () => {
    const { servers } = readMcpConfig(JSON.stringify({ mcpServers: { one: { command: "node", args: ["a.mjs", "--x"] }, two: { url: "http://localhost:3000/mcp" } } }));
    assert.deepEqual(servers, [{ name: "one", command: "node a.mjs --x", url: null }, { name: "two", command: "", url: "http://localhost:3000/mcp" }]);
  });

  it("says when it can't be read, rather than showing nothing", () => {
    assert.match(readMcpConfig("{ nope").problem!, /isn't valid JSON/);
    assert.match(readMcpConfig("[]").problem!, /isn't valid JSON/);
  });

  it("leaves out a name that couldn't go on a command line", () => {
    assert.deepEqual(readMcpConfig(JSON.stringify({ mcpServers: { "--evil": { command: "x" }, fine: { command: "y" } } })).servers.map((s) => s.name), ["fine"]);
  });
});

describe("adding and removing", () => {
  it("writes a command, split as a shell would", () => {
    const text = added(null, "one", 'python3 "my server.py" --port 3');
    assert.deepEqual(JSON.parse(text), { mcpServers: { one: { command: "python3", args: ["my server.py", "--port", "3"] } } });
    assert.deepEqual(splitCommandLine(`a 'b c' "d e" f`), ["a", "b c", "d e", "f"]);
  });

  it("writes an address as one that's already running", () => {
    assert.deepEqual(JSON.parse(added(null, "web", "http://localhost:3000/mcp")).mcpServers.web, { type: "streamable-http", url: "http://localhost:3000/mcp" });
  });

  it("keeps what's already there, whatever else the file holds", () => {
    const text = added(JSON.stringify({ other: 1, mcpServers: { a: { command: "x", env: { K: "V" } } } }), "b", "y");
    const parsed = JSON.parse(text);
    assert.equal(parsed.other, 1);
    assert.deepEqual(parsed.mcpServers.a, { command: "x", env: { K: "V" } });
    assert.deepEqual(Object.keys(parsed.mcpServers), ["a", "b"]);
  });

  it("says what's wrong", () => {
    assert.match(problem(null, "--bad", "x"), /short name/);
    assert.match(problem(null, "fine", "  "), /how to start/);
    assert.match(problem('{"mcpServers":{"a":{}}}', "a", "x"), /already/);
    assert.match(problem("{ nope", "a", "x"), /isn't valid JSON/);
  });

  it("removes only that one", () => {
    const text = removeMcpServer(added(added(null, "a", "x"), "b", "y"), "a");
    assert.deepEqual(Object.keys(JSON.parse(text).mcpServers), ["b"]);
  });
});

describe("a tool's form", () => {
  const schema = { type: "object", properties: { text: { type: "string", description: "What to say" }, times: { type: "integer" }, loud: { type: "boolean" }, style: { type: "string", enum: ["a", "b"] }, more: { type: "object" } }, required: ["text"] };
  const fields = fieldsOf(schema);

  it("has a field of the right kind for each", () => {
    assert.deepEqual(fields.map((field) => [field.name, field.kind, field.required]), [["text", "text", true], ["times", "number", false], ["loud", "boolean", false], ["style", "choice", false], ["more", "json", false]]);
    assert.deepEqual(fields[3]!.choices, ["a", "b"]);
    assert.equal(fields[0]!.description, "What to say");
  });

  it("copes with no schema", () => {
    assert.deepEqual(fieldsOf(undefined), []);
    assert.deepEqual(fieldsOf({ type: "object" }), []);
  });

  it("gives values their types, and leaves out empty ones", () => {
    assert.deepEqual(argumentsFrom(fields, { text: "123", times: "2", loud: true, style: "b", more: '{"x":1}' }), { args: { text: "123", times: 2, loud: true, style: "b", more: { x: 1 } } });
    assert.deepEqual(argumentsFrom(fields, { text: "hi", times: "", more: " " }), { args: { text: "hi" } });
    assert.deepEqual(argumentsFrom(fields, { text: "hi", times: "0" }), { args: { text: "hi", times: 0 } });
  });

  it("says what's wrong", () => {
    assert.deepEqual(argumentsFrom(fields, {}), { problem: "text is needed." });
    assert.deepEqual(argumentsFrom(fields, { text: "a", times: "many" }), { problem: "times has to be a number." });
    assert.deepEqual(argumentsFrom(fields, { text: "a", more: "{nope" }), { problem: "more has to be valid JSON." });
  });

  it("sends a required switch even when it's off", () => {
    assert.deepEqual(argumentsFrom(fieldsOf({ properties: { on: { type: "boolean" } }, required: ["on"] }), {}), { args: { on: false } });
  });
});
