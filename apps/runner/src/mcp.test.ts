import { describe, expect, it } from "vitest";

import { mcpProblem } from "./mcp.js";

describe("what a failed call says", () => {
  it("finds the useful line, leaving out the stack", () => {
    const stderr = `node:internal/process/promises:394
Error: Failed to connect to MCP server: spawn nothing ENOENT
    at connect (file:///x.js:1:1)`;
    expect(mcpProblem("", stderr, 1)).toBe("Error: Failed to connect to MCP server: spawn nothing ENOENT");
  });

  it("makes do with what there is", () => {
    expect(mcpProblem("", "Something odd", 1)).toBe("Something odd");
    expect(mcpProblem("Server said no", "", 1)).toBe("Server said no");
    expect(mcpProblem("", "", 3)).toBe("It stopped with exit code 3.");
  });

  it("isn't too long", () => {
    expect(mcpProblem("", `Error ${"x".repeat(2000)}`, 1).length).toBe(600);
  });
});
