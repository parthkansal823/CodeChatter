/**
 * What a trace keeps, and how it's sent on. Text is cut to size and has secrets taken out before it's stored, as the prompts here
 * can hold the room's code. Spans use OpenTelemetry's names for AI calls, so Langfuse, Phoenix or Jaeger can read them.
 */
import { randomBytes } from "node:crypto";

import { redactSecrets, type AiTraceSource, type AiTraceStatus } from "@codechatter/contracts";

export const MOST_TRACE_CHARS = 16_000;
const MOST_TRACE_MESSAGES = 20;

export type TraceMessage = { role: string; content: string };

export type NewAiTrace = {
  roomId: string;
  userId: string | null;
  source: AiTraceSource;
  mode: string | null;
  model: string;
  provider: string;
  status: AiTraceStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  firstMs: number | null;
  totalMs: number;
  input: TraceMessage[];
  output: string;
};

/** The start and end of a long text, with what was left out in between. */
export function clipText(text: string, most = MOST_TRACE_CHARS): string {
  if (text.length <= most) return text;
  const head = Math.floor(most * 0.7);
  const tail = most - head;
  return `${text.slice(0, head)}\n… ${(text.length - most).toLocaleString("en")} characters left out …\n${text.slice(-tail)}`;
}

/** Ready to store: no secret, and not too much. The newest messages are the ones that matter when there are too many. */
export function cleanTrace(input: readonly TraceMessage[], output: string): { input: TraceMessage[]; output: string } {
  return {
    input: input.slice(-MOST_TRACE_MESSAGES).map((message) => ({ role: message.role, content: clipText(redactSecrets(message.content)) })),
    output: clipText(redactSecrets(output)),
  };
}

/** Messages in OpenAI's format as text: an image isn't kept, only that there was one. */
export function messagesAsText(messages: unknown): TraceMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message: unknown) => {
    if (typeof message !== "object" || message === null) return [];
    const { role, content } = message as { role?: unknown; content?: unknown };
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: { type?: unknown; text?: unknown }) => (typeof part?.text === "string" ? part.text : `[${String(part?.type ?? "part")}]`)).join("\n") : "";
    return [{ role: typeof role === "string" ? role : "unknown", content: text }];
  });
}

const attribute = (key: string, value: string | number | boolean) => ({
  key,
  value: typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { boolValue: value } : { intValue: String(value) },
});

/** One call as OTLP/HTTP JSON. Prompts go only if the server's owner asks for them, as they then leave this server. */
export function otlpBody(trace: NewAiTrace, options: { withContent: boolean; now?: number }) {
  const end = options.now ?? Date.now();
  const nanos = (ms: number) => `${BigInt(ms) * 1_000_000n}`;
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute("service.name", "codechatter-ai")] },
        scopeSpans: [
          {
            scope: { name: "codechatter" },
            spans: [
              {
                traceId: randomBytes(16).toString("hex"),
                spanId: randomBytes(8).toString("hex"),
                name: `${trace.source === "embedding" ? "embeddings" : "chat"} ${trace.model}`,
                kind: 3,
                startTimeUnixNano: nanos(end - trace.totalMs),
                endTimeUnixNano: nanos(end),
                status: trace.status === "error" ? { code: 2, ...(trace.error && { message: trace.error }) } : { code: 1 },
                attributes: [
                  attribute("gen_ai.operation.name", trace.source === "embedding" ? "embeddings" : "chat"),
                  attribute("gen_ai.provider.name", trace.provider),
                  attribute("gen_ai.request.model", trace.model),
                  attribute("gen_ai.usage.input_tokens", trace.inputTokens),
                  attribute("gen_ai.usage.output_tokens", trace.outputTokens),
                  attribute("codechatter.room", trace.roomId),
                  attribute("codechatter.source", trace.source),
                  attribute("codechatter.status", trace.status),
                  attribute("codechatter.tokens_estimated", trace.estimated),
                  ...(trace.firstMs === null ? [] : [attribute("codechatter.first_word_ms", trace.firstMs)]),
                  ...(options.withContent ? [attribute("gen_ai.input.messages", JSON.stringify(trace.input)), attribute("gen_ai.output.messages", JSON.stringify([{ role: "assistant", content: trace.output }]))] : []),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
