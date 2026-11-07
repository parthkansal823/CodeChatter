/**
 * The MCP tool: list and call what an MCP server in the room's sandbox offers, through the official MCP Inspector's command line.
 * Servers are in `.mcp.json` at the room's root, the same file other MCP tools read.
 */
import { z } from "zod";

export const MCP_CONFIG_PATH = ".mcp.json";
export const MCP_LIMITS = { nameChars: 64, itemChars: 512, argChars: 200_000, args: 100 } as const;

/** Not starting with a dash: it goes on a command line. */
const ServerName = z.string().regex(/^\w[\w .-]{0,63}$/, "That isn't a server's name.");
const Item = z.string().min(1).max(MCP_LIMITS.itemChars);
const Key = z.string().min(1).max(MCP_LIMITS.itemChars).regex(/^[^=\s]+$/, "That isn't an argument's name.");
const base = { server: ServerName, stateVector: z.string().max(4_000_000).optional() };

export const McpInput = z.discriminatedUnion("method", [
  z.object({ ...base, method: z.literal("tools/list") }),
  z.object({ ...base, method: z.literal("tools/call"), tool: Item, args: z.record(Key, z.unknown()).default({}) }),
  z.object({ ...base, method: z.literal("resources/list") }),
  z.object({ ...base, method: z.literal("resources/read"), uri: Item }),
  z.object({ ...base, method: z.literal("prompts/list") }),
  z.object({ ...base, method: z.literal("prompts/get"), prompt: Item, args: z.record(Key, z.string().max(MCP_LIMITS.argChars)).default({}) }),
]);
export type McpInput = z.infer<typeof McpInput>;

/** POST /api/rooms/:roomId/mcp. A server's own failure is an answer, not an error from us. */
export type McpOutput = { ok: true; result: unknown; ms: number } | { ok: false; error: string; ms: number };

/**
 * The Inspector's command line for a request. Values go as JSON, so that text like "123" stays text; names go as `--x=name`, so that
 * one starting with a dash can't be taken for an option.
 */
export function mcpArguments(input: McpInput): string[] {
  const start = ["--cli", "--config", MCP_CONFIG_PATH, "--server", input.server, "--method", input.method];
  switch (input.method) {
    case "tools/call":
      return [...start, `--tool-name=${input.tool}`, ...Object.entries(input.args).flatMap(([key, value]) => ["--tool-arg", `${key}=${JSON.stringify(value)}`])];
    case "resources/read":
      return [...start, `--uri=${input.uri}`];
    case "prompts/get":
      return [...start, `--prompt-name=${input.prompt}`, ...Object.entries(input.args).flatMap(([key, value]) => ["--prompt-args", `${key}=${value}`])];
    default:
      return start;
  }
}
