/**
 * `.mcp.json`, the file that lists a room's MCP servers, in the format other MCP tools read, and turning a tool's input schema into a
 * form and back.
 */

export type McpServerEntry = { name: string; command: string; url: string | null };
export type McpConfig = { servers: McpServerEntry[]; problem: string | null };

type Raw = { mcpServers?: Record<string, { command?: unknown; args?: unknown; url?: unknown; type?: unknown }> };
const NAME = /^\w[\w .-]{0,63}$/;

function parse(text: string): Raw {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Raw;
}

export function readMcpConfig(text: string | null): McpConfig {
  if (!text?.trim()) return { servers: [], problem: null };
  let raw: Raw;
  try {
    raw = parse(text);
  } catch {
    return { servers: [], problem: ".mcp.json isn't valid JSON. Open it and fix it to see its servers." };
  }
  const servers = Object.entries(raw.mcpServers ?? {})
    .filter(([name]) => NAME.test(name))
    .map(([name, server]) => ({
      name,
      command: [server.command, ...(Array.isArray(server.args) ? server.args : [])].filter((part) => typeof part === "string").join(" "),
      url: typeof server.url === "string" ? server.url : null,
    }));
  return { servers, problem: null };
}

/** A command as a shell would split it, for quotes around a path with a space in it. */
export function splitCommandLine(line: string): string[] {
  const parts: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) parts.push(match[1] ?? match[2] ?? match[3]!);
  return parts;
}

/** The file with this server added, or why it can't be. A web address is a server that's already running; anything else is a command to start one. */
export function addMcpServer(text: string | null, name: string, target: string): { text: string } | { problem: string } {
  const clean = name.trim();
  if (!NAME.test(clean)) return { problem: "Give it a short name: letters, numbers, spaces, dots and dashes." };
  const where = target.trim();
  if (!where) return { problem: "Say how to start it, or where it's running." };
  let raw: Raw = {};
  if (text?.trim()) {
    try {
      raw = parse(text);
    } catch {
      return { problem: ".mcp.json isn't valid JSON. Fix it first." };
    }
  }
  if (raw.mcpServers?.[clean]) return { problem: `There's already a server called ${clean}.` };
  const isUrl = /^https?:\/\//i.test(where);
  const [command, ...args] = splitCommandLine(where);
  const entry = isUrl ? { type: "streamable-http", url: where } : { command, args };
  return { text: `${JSON.stringify({ ...raw, mcpServers: { ...raw.mcpServers, [clean]: entry } }, null, 2)}\n` };
}

export function removeMcpServer(text: string, name: string): string {
  const raw = parse(text);
  const { [name]: _gone, ...rest } = raw.mcpServers ?? {};
  return `${JSON.stringify({ ...raw, mcpServers: rest }, null, 2)}\n`;
}

export type SchemaField = { name: string; label: string; kind: "text" | "number" | "boolean" | "choice" | "json"; required: boolean; description: string; choices: string[] };

/** A tool's input schema as form fields: what can't be a simple field is written as JSON. */
export function fieldsOf(schema: unknown): SchemaField[] {
  const object = (schema ?? {}) as { properties?: Record<string, { type?: unknown; description?: unknown; enum?: unknown }>; required?: unknown };
  const required = Array.isArray(object.required) ? (object.required as unknown[]) : [];
  return Object.entries(object.properties ?? {}).map(([name, property]) => {
    const choices = Array.isArray(property.enum) ? property.enum.filter((item): item is string => typeof item === "string") : [];
    const kind = choices.length ? "choice" : property.type === "string" ? "text" : property.type === "number" || property.type === "integer" ? "number" : property.type === "boolean" ? "boolean" : "json";
    return { name, label: name, kind, required: required.includes(name), description: typeof property.description === "string" ? property.description : "", choices };
  });
}

/** What the form holds, as the tool's arguments, or what's wrong with it. An empty field is left out. */
export function argumentsFrom(fields: readonly SchemaField[], values: Readonly<Record<string, string | boolean>>): { args: Record<string, unknown> } | { problem: string } {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.kind === "boolean") {
      if (typeof value === "boolean") args[field.name] = value;
      else if (field.required) args[field.name] = false;
      continue;
    }
    const text = typeof value === "string" ? value : "";
    if (!text.trim()) {
      if (field.required) return { problem: `${field.label} is needed.` };
      continue;
    }
    if (field.kind === "number") {
      const number = Number(text);
      if (Number.isNaN(number)) return { problem: `${field.label} has to be a number.` };
      args[field.name] = number;
    } else if (field.kind === "json") {
      try {
        args[field.name] = JSON.parse(text);
      } catch {
        return { problem: `${field.label} has to be valid JSON.` };
      }
    } else {
      args[field.name] = text;
    }
  }
  return { args };
}

export const EXAMPLE_NAME = "example";
export const EXAMPLE_PATH = "mcp-example/server.mjs";
/** A small MCP server with no dependencies, to try the tool on and to start from: real ones use the SDK. */
export const EXAMPLE_SERVER = `// A small MCP server, speaking the protocol over standard input and output with no dependencies.
// Real ones use the SDK: npm install @modelcontextprotocol/sdk
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "add",
    description: "Adds two numbers.",
    inputSchema: { type: "object", properties: { a: { type: "number", description: "The first number" }, b: { type: "number", description: "The second number" } }, required: ["a", "b"] },
  },
  {
    name: "shout",
    description: "Says some text loudly, as many times as you ask.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, times: { type: "integer" }, style: { type: "string", enum: ["plain", "stars"] } }, required: ["text"] },
  },
  {
    name: "fail",
    description: "Always reports a failure, to see what one looks like.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(name, args) {
  if (name === "add") return { content: [{ type: "text", text: String(args.a + args.b) }] };
  if (name === "shout") {
    const loud = String(args.text).toUpperCase().repeat(args.times ?? 1);
    return { content: [{ type: "text", text: args.style === "stars" ? \`*** \${loud} ***\` : loud }] };
  }
  return { isError: true, content: [{ type: "text", text: "This tool always fails." }] };
}

const answers = {
  initialize: (params) => ({ protocolVersion: params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "example", version: "1.0.0" } }),
  "tools/list": () => ({ tools: TOOLS }),
  "tools/call": (params) => callTool(params.name, params.arguments ?? {}),
  "resources/list": () => ({ resources: [{ uri: "note://welcome", name: "Welcome note", mimeType: "text/plain" }] }),
  "resources/read": (params) => ({ contents: [{ uri: params.uri, mimeType: "text/plain", text: "Hello from a resource." }] }),
  "prompts/list": () => ({ prompts: [{ name: "review", description: "Asks for a code review.", arguments: [{ name: "language", required: true }] }] }),
  "prompts/get": (params) => ({ messages: [{ role: "user", content: { type: "text", text: \`Review this \${params.arguments?.language} code.\` } }] }),
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return; // A notification: nothing to answer.
  const answer = answers[method];
  const reply = answer ? { result: answer(params ?? {}) } : { error: { code: -32601, message: \`No method \${method}\` } };
  process.stdout.write(\`\${JSON.stringify({ jsonrpc: "2.0", id, ...reply })}\\n\`);
});
`;
