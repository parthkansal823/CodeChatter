/**
 * The AI gateway's rules: what code in a sandbox may ask of the room's model, in OpenAI's format so real SDKs and tools work. A
 * provider that speaks it gets the request nearly as it came; one that doesn't (Claude) gets plain text chat through its adapter.
 */
import { PROMPT_LIMITS } from "@codechatter/contracts";

import type { AiSettings } from "./ai.config.js";
import type { ModelRequest } from "./prompts.js";

export type GatewayFailure = { status: number; message: string; type: string; code?: string };
export const errorBody = (failure: Omit<GatewayFailure, "status">) => ({ error: { message: failure.message, type: failure.type, param: null, code: failure.code ?? null } });

/** Only these reach a provider: others could change what's billed or kept, such as `store` and `service_tier`. */
const CHAT_FIELDS = ["messages", "stream", "temperature", "top_p", "stop", "seed", "presence_penalty", "frequency_penalty", "response_format", "tools", "tool_choice", "parallel_tool_calls", "logit_bias", "logprobs", "top_logprobs", "user", "reasoning_effort"];
const EMBEDDING_FIELDS = ["input", "encoding_format", "dimensions", "user"];
const MOST_INPUTS = 2048;

const invalid = (message: string): GatewayFailure => ({ status: 400, message, type: "invalid_request_error" });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const pick = (from: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter((field) => from[field] !== undefined).map((field) => [field, from[field]]));

/** The model to use: `default` means the server's own, so code needn't name it. */
export function chooseModel(asked: unknown, offered: readonly string[], fallback: string | null): string | GatewayFailure {
  const name = asked === undefined || asked === "default" ? fallback : asked;
  if (typeof name !== "string" || !name) return invalid('Say which model: "default" is this room\'s.');
  if (!offered.includes(name)) return { status: 404, message: `This server doesn't offer the model "${name.slice(0, 100)}". It offers: ${offered.join(", ")}.`, type: "invalid_request_error", code: "model_not_found" };
  return name;
}

export type ChatPlan = { body: Record<string, unknown>; model: string; stream: boolean; askedForUsage: boolean };

/** What goes to the provider for a chat request, or why it can't. */
export function planChat(raw: unknown, offered: readonly string[], settings: AiSettings): ChatPlan | GatewayFailure {
  if (!isObject(raw)) return invalid("Send a JSON object.");
  const model = chooseModel(raw.model, offered, settings.model);
  if (typeof model !== "string") return model;
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) return invalid("`messages` has to be a list with something in it.");
  if (raw.n !== undefined && raw.n !== 1) return invalid("This gateway gives one answer per request: `n` has to be 1.");
  const limit = raw.max_completion_tokens ?? raw.max_tokens;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > PROMPT_LIMITS.maxTokens)) return invalid(`\`max_tokens\` has to be a whole number up to ${PROMPT_LIMITS.maxTokens}.`);
  const stream = raw.stream === true;
  const options = isObject(raw.stream_options) ? raw.stream_options : {};
  const askedForUsage = options.include_usage === true;
  const reportsUsage = !settings.baseURL || settings.provider === "ollama";
  const body: Record<string, unknown> = {
    ...pick(raw, CHAT_FIELDS),
    model,
    ...(limit !== undefined && { [raw.max_completion_tokens !== undefined ? "max_completion_tokens" : "max_tokens"]: limit }),
    // Tokens are counted for the room's usage, whether or not the code asked to see them.
    ...(stream && (askedForUsage || reportsUsage) && { stream_options: { include_usage: true } }),
    // Thinking first made a local model about four times slower: the same choice as the room's own AI, unless the code asks otherwise.
    ...(settings.provider === "ollama" && raw.reasoning_effort === undefined && { reasoning_effort: "none" }),
  };
  return { body, model, stream, askedForUsage };
}

export function planEmbeddings(raw: unknown, offered: readonly string[], settings: AiSettings, embedding: string | null = null): { body: Record<string, unknown>; model: string } | GatewayFailure {
  if (!isObject(raw)) return invalid("Send a JSON object.");
  if (settings.provider === "anthropic") return { status: 404, message: "This server's AI is Claude, which doesn't make embeddings.", type: "invalid_request_error" };
  const model = chooseModel(raw.model, embedding ? [...offered, embedding] : offered, embedding ?? settings.model);
  if (typeof model !== "string") return model;
  const input = raw.input;
  if (typeof input !== "string" && !(Array.isArray(input) && input.length > 0)) return invalid("`input` has to be text, or a list of it.");
  if (Array.isArray(input) && input.length > MOST_INPUTS) return invalid(`At most ${MOST_INPUTS} inputs in one request.`);
  return { body: { ...pick(raw, EMBEDDING_FIELDS), model }, model };
}

const contentText = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content.map((part: unknown) => (isObject(part) && part.type === "text" && typeof part.text === "string" ? part.text : null));
  return parts.includes(null) ? null : parts.join("");
};

/** A chat request for a provider that doesn't speak OpenAI's format: plain text only, and it says so rather than quietly dropping the rest. */
export function adapterRequest(plan: ChatPlan): ModelRequest | GatewayFailure {
  const { body } = plan;
  if (body.tools !== undefined || body.response_format !== undefined) return invalid("This server's AI goes through a plain text adapter here: `tools` and `response_format` aren't available.");
  const system: string[] = [];
  const messages: ModelRequest["messages"] = [];
  for (const message of body.messages as unknown[]) {
    if (!isObject(message)) return invalid("Each message has to be an object.");
    const text = contentText(message.content);
    if (text === null) return invalid("This server's AI goes through a plain text adapter here: messages have to be text.");
    if (message.role === "system" || message.role === "developer") system.push(text);
    else if (message.role === "user" || message.role === "assistant") messages.push({ role: message.role, content: text });
    else return invalid(`This adapter doesn't take messages from "${String(message.role)}".`);
  }
  if (messages.at(-1)?.role !== "user") return invalid("The last message has to be the user's.");
  const maxTokens = (body.max_completion_tokens ?? body.max_tokens) as number | undefined;
  return { system: system.join("\n\n"), messages, tuning: { model: plan.model, ...(maxTokens !== undefined && { maxTokens }) } };
}

export type GatewayUsage = { inputTokens: number; outputTokens: number };

const usageOf = (value: unknown): GatewayUsage | null => {
  if (!isObject(value)) return null;
  const input = value.prompt_tokens;
  return typeof input === "number" ? { inputTokens: input, outputTokens: typeof value.completion_tokens === "number" ? value.completion_tokens : 0 } : null;
};

/** A provider's answer as it came: only its token count is read. */
export const usageIn = (answer: unknown): GatewayUsage | null => (isObject(answer) ? usageOf(answer.usage) : null);

/**
 * Passes a provider's stream on as it comes, noting its token count. A chunk that only reports usage is dropped if the code
 * didn't ask for it: it has no `choices`, and plenty of code reads `chunk.choices[0]` without checking.
 */
export class StreamRelay {
  private buffer = "";
  usage: GatewayUsage | null = null;
  outputChars = 0;

  constructor(private readonly passUsage: boolean) {}

  feed(text: string): string {
    this.buffer += text;
    const end = this.buffer.lastIndexOf("\n");
    if (end === -1) return "";
    const whole = this.buffer.slice(0, end + 1);
    this.buffer = this.buffer.slice(end + 1);
    return whole.split(/(?<=\n)/).map((line) => this.line(line)).join("");
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest ? this.line(rest) : "";
  }

  private line(line: string): string {
    if (!line.startsWith("data: ") || line.startsWith("data: [DONE]")) return line;
    let chunk: unknown;
    try {
      chunk = JSON.parse(line.slice(6));
    } catch {
      return line;
    }
    if (!isObject(chunk)) return line;
    const usage = usageOf(chunk.usage);
    if (usage) this.usage = usage;
    const choices = Array.isArray(chunk.choices) ? (chunk.choices as unknown[]) : [];
    for (const choice of choices) {
      const delta = isObject(choice) && isObject(choice.delta) ? choice.delta.content : null;
      if (typeof delta === "string") this.outputChars += delta.length;
    }
    return usage && choices.length === 0 && !this.passUsage ? "" : line;
  }
}

/** A provider's refusal, without anything that could carry its key. */
export function upstreamFailure(status: number, answer: unknown, apiKey: string): GatewayFailure {
  if (status === 401 || status === 403) return { status: 502, message: "The AI provider refused this server's key. Ask the server's owner to check it.", type: "api_error" };
  const error = isObject(answer) && isObject(answer.error) ? answer.error : isObject(answer) ? answer : {};
  const said = typeof error.message === "string" ? error.message : typeof answer === "string" ? answer : "";
  const message = (said || `The AI provider answered ${status}.`).split(apiKey).join("[key]").slice(0, 500);
  return { status: status >= 500 ? 502 : status, message, type: status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error" };
}
