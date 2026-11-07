import { describe, expect, it } from "vitest";

import { mcpProblem } from "./mcp.js";

describe("what a failed call says", () => {
  it("finds the useful line, leaving out the stack", () => {
    const stderr = `node:internal/process/promises:394
Error: Failed to connect to MCP server: spawn nothing ENOENT
    at connect (file:///x.js:1:1)`;
    expect(mcpProblem("", stderr, 1)).toBe("Error: Failed to connect to MCP server: spawn nothing ENOENT");
  });

  it("isn't misled by the keychain a sandbox doesn't have", () => {
    const stderr = "[mcp-inspector] Keychain error: Couldn't access platform storage: PermissionDenied\nError: spawn nothing ENOENT";
    expect(mcpProblem("", stderr, 1)).toBe("Error: spawn nothing ENOENT");
    expect(mcpProblem("", "[mcp-inspector] Keychain error: no", 3)).toBe("It stopped with exit code 3.");
  });

  it("reads its own failures, which it prints as JSON", () => {
    expect(mcpProblem("", '{"error":{"code":"error","message":"spawn nothing ENOENT"}}', 1)).toBe("spawn nothing ENOENT");
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
