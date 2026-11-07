/**
 * The MCP tool: the official MCP Inspector's command line, in the sandbox, inside the jail like a Run. A stdio server in `.mcp.json` is
 * started for each call and stopped after it, so it keeps nothing between calls; one that serves HTTP stays up in a terminal.
 */
import { mcpArguments, type McpInput, type McpOutput } from "@codechatter/contracts";

import { run } from "./check.js";
import type { RoomSandbox } from "./sandbox.js";

const WORKSPACE = "/workspace";
/** It looks for a keychain to keep sign-ins in, and a sandbox has none: that's never why a call failed. */
const NOT_THE_REASON = /keychain/i;

/** The useful line of what a failed call printed: the Inspector's own stack trace says little. */
export function mcpProblem(stdout: string, stderr: string, code: number | null): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !NOT_THE_REASON.test(line) && !/^at\s/.test(line) && !/^\^+$/.test(line) && !/^node:/.test(line));
  const said = lines.find((line) => /error|failed|not found|unknown|invalid|refused/i.test(line)) ?? lines[0];
  if (!said) return `It stopped with exit code ${code}.`;
  // It prints its own failures as {"error":{"message":"…"}}.
  try {
    const message = (JSON.parse(said) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message.slice(0, 600);
  } catch {
    // Plain text, as most is.
  }
  return said.slice(0, 600);
}

/** The server's answer in what the Inspector printed, if there is one. It can exit with a failure and still have one: a tool saying it failed. */
function answerIn(stdout: string): { result: unknown } | null {
  const text = stdout.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return { result: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

export async function callMcp(sandbox: RoomSandbox, input: McpInput): Promise<McpOutput> {
  const started = Date.now();
  const output = await run(sandbox, WORKSPACE, ["mcp-inspector", ...mcpArguments(input)]);
  const ms = Date.now() - started;
  if (output.code === 127) return { ok: false, error: "This room's sandbox doesn't have the MCP Inspector yet: its image needs rebuilding (pnpm sandbox:build).", ms };
  if (output.code === 124) return { ok: false, error: "The server took too long to answer, and was stopped.", ms };
  const answer = answerIn(output.stdout);
  if (answer) return { ok: true, result: answer.result, ms };
  return { ok: false, error: output.code === 0 ? "The server's answer couldn't be read." : mcpProblem(output.stdout, output.stderr, output.code), ms };
}
