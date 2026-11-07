/**
 * The Prompt Playground's document (`prompts`): prompts anyone in the room can edit together, the columns they're tried on, and
 * their last runs. Long text is Y.Text, so two people can type in it at once. A run is plain data: what's been sent doesn't change.
 */
import { promptVariables, renderPrompt, type AiTokenCount } from "@codechatter/contracts";
import { randomId, setText } from "@codechatter/workspace-model";
import * as Y from "yjs";

export const MOST_COLUMNS = 4;
export const MOST_RUNS = 12;
/** A document everyone in the room loads can't hold whole books of answers. */
export const MOST_ANSWER_CHARS = 16_000;

export type PromptRole = "user" | "assistant";
export type PromptColumn = { id: string; model: string; temperature: number | null; maxTokens: number | null; json: boolean };
export type ColumnStatus = "waiting" | "running" | "done" | "cut" | "refused" | "stopped" | "error";
export type ColumnResult = {
  column: PromptColumn;
  text: string;
  status: ColumnStatus;
  error: string | null;
  firstMs: number | null;
  totalMs: number | null;
  usage: AiTokenCount | null;
  /** Only the start of the answer was kept. */
  shortened?: boolean;
};
export type PromptText = { system: string; messages: Array<{ role: PromptRole; content: string }>; values: Record<string, string> };
export type PromptRun = PromptText & { id: string; at: number; by: string; results: ColumnResult[] };
export type PromptItem = { id: string; name: string };
export type PromptMessage = { id: string; role: PromptRole; text: Y.Text };
type Node = Y.Map<unknown>;

export const promptsOf = (doc: Y.Doc) => doc.getMap<Node>("prompts");

const textFrom = (value: string) => {
  const text = new Y.Text();
  text.insert(0, value);
  return text;
};

function messageNode(role: PromptRole, content: string): Node {
  const node = new Y.Map<unknown>();
  node.set("id", randomId());
  node.set("role", role);
  node.set("text", textFrom(content));
  return node;
}

export function createPrompt(doc: Y.Doc, input: { name: string; columns: PromptColumn[] } & Partial<PromptText>): string {
  const id = randomId();
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("name", input.name);
    node.set("createdAt", Date.now());
    node.set("system", textFrom(input.system ?? ""));
    const messages = new Y.Array<Node>();
    messages.push((input.messages ?? [{ role: "user" as const, content: "" }]).map((message) => messageNode(message.role, message.content)));
    node.set("messages", messages);
    const values = new Y.Map<Y.Text>();
    for (const [name, value] of Object.entries(input.values ?? {})) values.set(name, textFrom(value));
    node.set("values", values);
    const columns = new Y.Array<PromptColumn>();
    columns.push(input.columns);
    node.set("columns", columns);
    node.set("runs", new Y.Array<PromptRun>());
    node.set("cases", new Y.Array<Y.Map<unknown>>());
    node.set("evals", new Y.Array<unknown>());
    promptsOf(doc).set(id, node);
  });
  return id;
}

export function readPrompts(doc: Y.Doc): PromptItem[] {
  return [...promptsOf(doc).entries()]
    .map(([id, node]) => ({ id, name: String(node.get("name") ?? "Prompt"), at: Number(node.get("createdAt") ?? 0) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
}

export const deletePrompt = (doc: Y.Doc, id: string) => promptsOf(doc).delete(id);
export const renamePrompt = (node: Node, name: string) => node.set("name", name);
export const systemOf = (node: Node) => node.get("system") as Y.Text;
const messagesNode = (node: Node) => node.get("messages") as Y.Array<Node>;
const valuesNode = (node: Node) => node.get("values") as Y.Map<Y.Text>;
const columnsNode = (node: Node) => node.get("columns") as Y.Array<PromptColumn>;
const runsNode = (node: Node) => node.get("runs") as Y.Array<PromptRun>;

export const readMessages = (node: Node): PromptMessage[] =>
  messagesNode(node)
    .toArray()
    .map((message) => ({ id: String(message.get("id")), role: message.get("role") === "assistant" ? "assistant" : "user", text: message.get("text") as Y.Text }));

/** A conversation goes turn by turn, so a new message answers the last one. */
export function addMessage(node: Node): void {
  const list = readMessages(node);
  messagesNode(node).push([messageNode(list.at(-1)?.role === "user" ? "assistant" : "user", "")]);
}

export function removeMessage(node: Node, id: string): void {
  const index = readMessages(node).findIndex((message) => message.id === id);
  if (index !== -1) messagesNode(node).delete(index);
}

export function setMessageRole(node: Node, id: string, role: PromptRole): void {
  messagesNode(node)
    .toArray()
    .find((message) => message.get("id") === id)
    ?.set("role", role);
}

export const valueText = (node: Node, name: string) => valuesNode(node).get(name);

/** The Y.Text for a variable's value, made when someone first goes to type in it. */
export function ensureValue(node: Node, name: string): Y.Text {
  const values = valuesNode(node);
  const existing = values.get(name);
  if (existing) return existing;
  const text = new Y.Text();
  values.set(name, text);
  return text;
}

export const readColumns = (node: Node): PromptColumn[] => columnsNode(node).toArray();

/** The next model nobody's trying yet; with only one to try, the same one with more freedom, which is the next thing to compare. */
export function nextColumn(columns: readonly PromptColumn[], models: readonly string[], fallback: string): PromptColumn {
  const unused = models.find((model) => !columns.some((column) => column.model === model));
  return { id: randomId(), model: unused ?? columns.at(-1)?.model ?? fallback, temperature: unused || columns.length === 0 ? null : 1, maxTokens: null, json: false };
}

export function addColumn(node: Node, column: PromptColumn): void {
  if (columnsNode(node).length < MOST_COLUMNS) columnsNode(node).push([column]);
}

export function removeColumn(node: Node, id: string): void {
  const index = readColumns(node).findIndex((column) => column.id === id);
  if (index !== -1) columnsNode(node).delete(index);
}

export function updateColumn(node: Node, id: string, patch: Partial<Omit<PromptColumn, "id">>): void {
  const columns = columnsNode(node);
  const index = columns.toArray().findIndex((column) => column.id === id);
  if (index === -1) return;
  const next = { ...columns.get(index), ...patch };
  (node.doc ?? new Y.Doc()).transact(() => {
    columns.delete(index);
    columns.insert(index, [next]);
  });
}

/** Newest first. */
export const readRuns = (node: Node): PromptRun[] => runsNode(node).toArray().reverse();

export function addRun(node: Node, run: PromptRun): void {
  const runs = runsNode(node);
  const kept: PromptRun = {
    ...run,
    results: run.results.map((result) => (result.text.length > MOST_ANSWER_CHARS ? { ...result, text: result.text.slice(0, MOST_ANSWER_CHARS), shortened: true } : result)),
  };
  (node.doc ?? new Y.Doc()).transact(() => {
    runs.push([kept]);
    if (runs.length > MOST_RUNS) runs.delete(0, runs.length - MOST_RUNS);
  });
}

/** The prompt as it's written now, with its variables not filled in. */
export function readPromptText(node: Node): PromptText {
  const values: Record<string, string> = {};
  valuesNode(node).forEach((text, name) => {
    values[name] = text.toString();
  });
  return { system: systemOf(node).toString(), messages: readMessages(node).map((message) => ({ role: message.role, content: message.text.toString() })), values };
}

/** Put a run's prompt back. */
export function restorePrompt(node: Node, prompt: PromptText): void {
  (node.doc ?? new Y.Doc()).transact(() => {
    setText(systemOf(node), prompt.system);
    const messages = messagesNode(node);
    messages.delete(0, messages.length);
    messages.push(prompt.messages.map((message) => messageNode(message.role, message.content)));
    for (const [name, value] of Object.entries(prompt.values)) setText(ensureValue(node, name), value);
  });
}

/** Only the variables a prompt uses count: a value left over from an earlier wording doesn't change what's sent. */
export function usedValues(prompt: PromptText): Record<string, string> {
  const used = promptVariables([prompt.system, ...prompt.messages.map((message) => message.content)]);
  return Object.fromEntries(used.filter((name) => Object.hasOwn(prompt.values, name)).map((name) => [name, prompt.values[name]!]));
}

export function renderedPrompt(prompt: PromptText): Pick<PromptText, "system" | "messages"> {
  return {
    system: renderPrompt(prompt.system, prompt.values),
    messages: prompt.messages.map((message) => ({ role: message.role, content: renderPrompt(message.content, prompt.values) })),
  };
}

/** Whether these two would send the same thing. */
export function samePrompt(a: PromptText, b: PromptText): boolean {
  return JSON.stringify(renderedPrompt(a)) === JSON.stringify(renderedPrompt(b));
}

/** Why it can't be run yet, in the same words the server would use. */
export function whyNotRunnable(prompt: PromptText, columns: readonly PromptColumn[]): string | null {
  if (columns.length === 0) return "Add a column to try it on.";
  const last = prompt.messages.at(-1);
  if (last?.role !== "user" || !renderPrompt(last.content, prompt.values).trim()) return "The last message has to be the user's, with something in it.";
  return null;
}

export const CODE_LANGUAGES = ["Python", "JavaScript", "curl"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** This prompt and column as code that runs in the room's sandbox, as it stands: no address or key, as the SDKs find those in the environment. */
export function promptAsCode(prompt: PromptText, column: PromptColumn, language: CodeLanguage): string {
  const { system, messages } = renderedPrompt(prompt);
  const turns = [...(system ? [{ role: "system", content: system }] : []), ...messages];
  const settings: Array<[string, unknown]> = [
    ["model", column.model],
    ["messages", turns],
    ...(column.temperature !== null ? [["temperature", column.temperature] as [string, unknown]] : []),
    ...(column.maxTokens !== null ? [["max_tokens", column.maxTokens] as [string, unknown]] : []),
    ...(column.json ? [["response_format", { type: "json_object" }] as [string, unknown]] : []),
  ];
  if (language === "curl") {
    const body = JSON.stringify(Object.fromEntries(settings), null, 2).replaceAll("'", "'\\''");
    return `curl "$OPENAI_BASE_URL/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'\n`;
  }
  const indent = (text: string) => text.replaceAll("\n", "\n  ");
  if (language === "JavaScript") {
    const lines = settings.map(([name, value]) => `  ${name}: ${indent(JSON.stringify(value, null, 2))},`).join("\n");
    return `import OpenAI from "openai";\n\nconst client = new OpenAI();\nconst answer = await client.chat.completions.create({\n${lines}\n});\nconsole.log(answer.choices[0].message.content);\n`;
  }
  // JSON holding only text and numbers is also Python.
  const lines = settings.map(([name, value]) => `    ${name}=${indent(indent(JSON.stringify(value, null, 2)))},`).join("\n");
  return `from openai import OpenAI\n\nclient = OpenAI()\nanswer = client.chat.completions.create(\n${lines}\n)\nprint(answer.choices[0].message.content)\n`;
}

/** Tokens a second while it was writing, leaving out the wait for the first word. Null when there's too little to say. */
export function tokensPerSecond(result: Pick<ColumnResult, "firstMs" | "totalMs" | "usage">): number | null {
  if (!result.usage || result.firstMs === null || result.totalMs === null) return null;
  const writing = result.totalMs - result.firstMs;
  return writing >= 100 && result.usage.outputTokens > 0 ? result.usage.outputTokens / (writing / 1000) : null;
}

export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
