import { describe, expect, it } from "vitest";

import { mcpArguments, McpInput } from "./mcp.js";

const parse = (value: object) => McpInput.parse({ server: "tools", ...value });
const start = ["--cli", "--config", ".mcp.json", "--server", "tools"];

describe("what may be asked", () => {
  it("takes each method", () => {
    for (const method of ["tools/list", "resources/list", "prompts/list"]) expect(parse({ method }).method).toBe(method);
    expect(parse({ method: "tools/call", tool: "add" })).toMatchObject({ args: {} });
    expect(parse({ method: "resources/read", uri: "note://one" })).toMatchObject({ uri: "note://one" });
    expect(parse({ method: "prompts/get", prompt: "greet", args: { who: "A" } })).toMatchObject({ args: { who: "A" } });
  });

  it("refuses a method it doesn't list", () => {
    for (const method of ["servers/add", "logging/setLevel", "tools/delete"]) expect(McpInput.safeParse({ server: "tools", method }).success).toBe(false);
  });

  it("refuses a server's name that could be an option", () => {
    for (const server of ["--config", "-x", "", "a/b", "a\nb", "x".repeat(65)]) expect(McpInput.safeParse({ server, method: "tools/list" }).success).toBe(false);
    for (const server of ["tools", "my server", "a.b-c_d"]) expect(McpInput.safeParse({ server, method: "tools/list" }).success).toBe(true);
  });

  it("refuses an argument's name that would change what's sent", () => {
    expect(McpInput.safeParse({ server: "s", method: "tools/call", tool: "t", args: { "a=b": 1 } }).success).toBe(false);
    expect(McpInput.safeParse({ server: "s", method: "tools/call", tool: "t", args: { "a b": 1 } }).success).toBe(false);
  });

  it("needs what the method is about", () => {
    expect(McpInput.safeParse({ server: "s", method: "tools/call" }).success).toBe(false);
    expect(McpInput.safeParse({ server: "s", method: "resources/read" }).success).toBe(false);
    expect(McpInput.safeParse({ server: "s", method: "prompts/get" }).success).toBe(false);
  });
});

describe("the command line", () => {
  it("names the config, the server and the method", () => {
    expect(mcpArguments(parse({ method: "tools/list" }))).toEqual([...start, "--method", "tools/list"]);
  });

  it("sends values as JSON, so text stays text", () => {
    const args = mcpArguments(parse({ method: "tools/call", tool: "add", args: { a: 2, text: "123", on: true, list: [1], nested: { x: 1 } } }));
    expect(args).toEqual([...start, "--method", "tools/call", "--tool-name=add", "--tool-arg", "a=2", "--tool-arg", 'text="123"', "--tool-arg", "on=true", "--tool-arg", "list=[1]", "--tool-arg", 'nested={"x":1}']);
  });

  it("can't take a name for an option", () => {
    const args = mcpArguments(parse({ method: "tools/call", tool: "--config=/etc/passwd" }));
    expect(args).toContain("--tool-name=--config=/etc/passwd");
    expect(args).not.toContain("--config=/etc/passwd");
    expect(mcpArguments(parse({ method: "resources/read", uri: "--x" }))).toContain("--uri=--x");
    expect(mcpArguments(parse({ method: "prompts/get", prompt: "--x" }))).toContain("--prompt-name=--x");
  });

  it("passes a prompt's arguments", () => {
    expect(mcpArguments(parse({ method: "prompts/get", prompt: "greet", args: { who: "A B" } })).slice(-3)).toEqual(["--prompt-name=greet", "--prompt-args", "who=A B"]);
  });
});
