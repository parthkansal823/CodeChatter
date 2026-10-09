import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import type { AiSettings } from "./ai.config.js";
import type { ModelRequest } from "./prompts.js";

export type StreamPiece =
  | { type: "text"; text: string }
  /** `usage` is the provider's own count when it reports one. */
  | { type: "stop"; stop: "end" | "length" | "refusal"; usage?: { inputTokens: number; outputTokens: number } };

/** One model behind one interface: text deltas, then how the answer ended. */
export interface AiProvider {
  readonly settings: AiSettings;
  stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<StreamPiece>;
}

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(readonly settings: AiSettings) {
    this.client = new Anthropic({ apiKey: settings.apiKey, maxRetries: 1 });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<StreamPiece> {
    const messages: Anthropic.MessageParam[] = request.messages.map((turn) => ({ role: turn.role, content: turn.content }));
    const last = messages.at(-1)!;
    if (request.image) {
      // The image goes before the text that refers to it.
      last.content = [
        { type: "image", source: { type: "base64", media_type: request.image.mediaType as Anthropic.Base64ImageSource["media_type"], data: request.image.data } },
        { type: "text", text: last.content as string },
      ];
    }
    const stream = this.client.messages.stream(
      { model: this.settings.model, max_tokens: this.settings.maxTokens ?? 16_000, system: request.system, messages },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
    }
    const { stop_reason: reason, usage } = await stream.finalMessage();
    const cut = reason === "max_tokens" || reason === "model_context_window_exceeded";
    yield {
      type: "stop",
      stop: cut ? "length" : reason === "refusal" ? "refusal" : "end",
      usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
    };
  }
}

/** OpenAI itself or anything that speaks its API: OpenRouter, Groq, Gemini, Together, Ollama, LM Studio… */
export class OpenAiCompatibleProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(readonly settings: AiSettings) {
    this.client = new OpenAI({ apiKey: settings.apiKey, maxRetries: 1, ...(settings.baseURL && { baseURL: settings.baseURL }) });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<StreamPiece> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: request.system },
      ...request.messages.map((turn): OpenAI.Chat.ChatCompletionMessageParam => ({ role: turn.role, content: turn.content })),
    ];
    const last = messages.at(-1)!;
    if (request.image && last.role === "user") {
      last.content = [
        { type: "text", text: last.content as string },
        { type: "image_url", image_url: { url: `data:${request.image.mediaType};base64,${request.image.data}` } },
      ];
    }
    const stream = await this.client.chat.completions.create(
      {
        model: this.settings.model,
        messages,
        stream: true,
        // Only OpenAI itself is sure to accept this; other servers get an estimate unless they report usage unasked.
        ...(!this.settings.baseURL && { stream_options: { include_usage: true } }),
        ...(this.settings.maxTokens && { max_tokens: this.settings.maxTokens }),
      },
      { signal },
    );
    let finish: string | null = null;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) yield { type: "text", text: choice.delta.content };
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
    }
    yield { type: "stop", stop: finish === "length" ? "length" : finish === "content_filter" ? "refusal" : "end", ...(usage && { usage }) };
  }
}

export function createProvider(settings: AiSettings | null): AiProvider | null {
  if (!settings) return null;
  return settings.provider === "anthropic" ? new AnthropicProvider(settings) : new OpenAiCompatibleProvider(settings);
}

type Failure = "abort" | "auth" | "permission" | "not-found" | "rate-limit" | "bad-request" | "connection" | "server" | "other";

function classify(error: unknown): Failure {
  // Most specific first; the two SDKs share their class names.
  if (error instanceof Anthropic.APIUserAbortError || error instanceof OpenAI.APIUserAbortError) return "abort";
  if (error instanceof Anthropic.AuthenticationError || error instanceof OpenAI.AuthenticationError) return "auth";
  if (error instanceof Anthropic.PermissionDeniedError || error instanceof OpenAI.PermissionDeniedError) return "permission";
  if (error instanceof Anthropic.NotFoundError || error instanceof OpenAI.NotFoundError) return "not-found";
  if (error instanceof Anthropic.RateLimitError || error instanceof OpenAI.RateLimitError) return "rate-limit";
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof OpenAI.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError ||
    error instanceof OpenAI.UnprocessableEntityError
  ) {
    return "bad-request";
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) return "connection";
  if (error instanceof Anthropic.InternalServerError || error instanceof OpenAI.InternalServerError) return "server";
  if ((error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) && (error.status ?? 0) >= 500) return "server";
  return "other";
}

/** The provider's own explanation, without the status prefix or the JSON wrapper. */
function providerDetail(error: unknown): string {
  if (!(error instanceof Anthropic.APIError || error instanceof OpenAI.APIError)) return "";
  const body = error.error as { message?: unknown; error?: { message?: unknown } } | undefined;
  const message = body?.error?.message ?? body?.message ?? error.message;
  return String(message ?? "")
    .replace(/^\d{3}\s+/, "")
    .slice(0, 240);
}

/**
 * A message the person asking can act on, or null when they cancelled.
 * Names the setting to check; never includes a key.
 */
export function describeAiError(error: unknown, settings: AiSettings, withImage: boolean): string | null {
  const keyName = settings.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const where = settings.baseURL ? ` at ${new URL(settings.baseURL).host}` : "";
  switch (classify(error)) {
    case "abort":
      return null;
    case "auth":
      return `The AI provider rejected the API key. Ask the server owner to check ${keyName}.`;
    case "permission":
      return `This API key isn't allowed to use the model "${settings.model}". Check the plan or choose another AI_MODEL.`;
    case "not-found":
      if (settings.provider === "ollama") return `Ollama doesn't have the model "${settings.model}" yet. Pull it on the server: ollama pull ${settings.model}`;
      return settings.provider === "openai"
        ? `The AI provider${where} has no model called "${settings.model}". Check AI_MODEL and OPENAI_BASE_URL.`
        : `There's no model called "${settings.model}". Check AI_MODEL.`;
    case "rate-limit":
      return "The AI provider is limiting requests from this server (free tiers allow only a few per minute). Wait a minute and try again.";
    case "bad-request": {
      const detail = providerDetail(error);
      const hint = withImage ? " If you attached an image, this model may not read images: try without it." : "";
      return `The AI provider couldn't handle this request${detail ? `: ${detail}` : "."}${hint}`;
    }
    case "connection":
      if (settings.provider === "ollama") return `Couldn't reach Ollama${where}. Start the Ollama app on the server (or run: ollama serve), then try again.`;
      return settings.baseURL
        ? `Couldn't reach the AI server${where}. If it's Ollama, check that it's running (ollama serve).`
        : "Couldn't reach the AI provider. Check the server's internet connection and try again.";
    case "server":
      return "The AI provider is having trouble right now. Try again in a moment.";
    default: {
      const detail = providerDetail(error);
      return detail ? `The AI request failed: ${detail}` : "The AI request failed. Try again.";
    }
  }
}
