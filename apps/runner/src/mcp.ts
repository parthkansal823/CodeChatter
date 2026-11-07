/**
 * The MCP tool: the official MCP Inspector's command line, in the sandbox, inside the jail like a Run. A stdio server in `.mcp.json` is
 * started for each call and stopped after it, so it keeps nothing between calls; one that serves HTTP stays up in a terminal.
 */
import { mcpArguments, type McpInput, type McpOutput } from "@codechatter/contracts";

import { run } from "./check.js";
import type { RoomSandbox } from "./sandbox.js";

const WORKSPACE = "/workspace";

/** The useful line of what a failed call printed: the Inspector's own stack trace says little. */
export function mcpProblem(stdout: string, stderr: string, code: number | null): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s/.test(line) && !/^\^+$/.test(line) && !/^node:/.test(line));
  const said = lines.find((line) => /error|failed|not found|unknown|invalid|refused/i.test(line)) ?? lines[0];
  return said ? said.slice(0, 600) : `It stopped with exit code ${code}.`;
}

export async function callMcp(sandbox: RoomSandbox, input: McpInput): Promise<McpOutput> {
  const started = Date.now();
  const output = await run(sandbox, WORKSPACE, ["mcp-inspector", ...mcpArguments(input)]);
  const ms = Date.now() - started;
  if (output.code === 127) return { ok: false, error: "This room's sandbox doesn't have the MCP Inspector yet: its image needs rebuilding (pnpm sandbox:build).", ms };
  if (output.code === 124) return { ok: false, error: "The server took too long to answer, and was stopped.", ms };
  if (output.code !== 0) return { ok: false, error: mcpProblem(output.stdout, output.stderr, output.code), ms };
  try {
    return { ok: true, result: JSON.parse(output.stdout) as unknown, ms };
  } catch {
    return { ok: false, error: "The server's answer couldn't be read.", ms };
  }
}
