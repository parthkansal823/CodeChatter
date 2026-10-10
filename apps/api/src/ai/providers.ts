import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import type { AiSettings } from "./ai.config.js";
import { COMPLETION, type CompletionRequest } from "./complete.js";
import type { ModelRequest } from "./prompts.js";

type TokenUsage = { inputTokens: number; outputTokens: number };

export type StreamPiece =
  | { type: "text"; text: string }
  /** `usage` is the provider's own count when it reports one. */
  | { type: "stop"; stop: "end" | "length" | "refusal"; usage?: TokenUsage };

/** An inline completion as the model wrote it (complete.ts cleans it). `usage` is the provider's own count when it reports one. */
export type CompletionAnswer = { text: string; mode: "fim" | "chat"; truncated: boolean; usage?: TokenUsage };

/** One model behind one interface: text deltas, then how the answer ended; or one short answer for inline completions. */
export interface AiProvider {
  readonly settings: AiSettings;
  stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<StreamPiece>;
  complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionAnswer>;
}

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;
  /** Older models (Haiku 4.5, Sonnet 4.5) refuse `effort`; after one refusal it isn't sent again. */
  private effort = true;

  constructor(readonly settings: AiSettings) {
    this.client = new Anthropic({ apiKey: settings.apiKey, maxRetries: 1 });
  }

  async complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionAnswer> {
    const send = (effort: boolean) =>
      this.client.messages.create(
        {
          model: this.settings.model,
          max_tokens: COMPLETION.claudeMaxTokens,
          system: request.chat.system,
          messages: request.chat.messages.map((turn) => ({ role: turn.role, content: turn.content })),
          // Current Claude models refuse sampling settings such as temperature; low effort keeps the answer quick instead.
          ...(effort && { output_config: { effort: "low" as const } }),
        },
        // A retry would arrive after the person has typed on.
        { signal, maxRetries: 0 },
      );
    let message: Anthropic.Message;
    try {
      message = await send(this.effort);
    } catch (error) {
      if (!this.effort || signal.aborted || !(error instanceof Anthropic.BadRequestError)) throw error;
      this.effort = false;
      message = await send(false);
    }
    return {
      text: message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
      mode: "chat",
      truncated: message.stop_reason === "max_tokens",
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
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
  /** Some models (OpenAI's reasoning ones) refuse temperature and max_tokens; after one refusal they aren't sent again. */
  private tuned = true;
  /** Whether the Ollama model fills in the middle (takes a suffix); unknown until Ollama has said. */
  private fills: boolean | undefined;

  constructor(readonly settings: AiSettings) {
    this.client = new OpenAI({ apiKey: settings.apiKey, maxRetries: 1, ...(settings.baseURL && { baseURL: settings.baseURL }) });
  }

  async complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionAnswer> {
    if (this.settings.provider === "ollama" && (await this.canFill(signal))) {
      try {
        return await this.fill(request, signal);
      } catch (error) {
        if (signal.aborted || !(error instanceof OpenAI.BadRequestError)) throw error;
        // It refused a suffix after all: use the chat prompt from now on.
        this.fills = false;
      }
    }
    const send = (tuned: boolean) =>
      this.client.chat.completions.create(
        {
          model: this.settings.model,
          messages: [
            { role: "system", content: request.chat.system },
            ...request.chat.messages.map((turn): OpenAI.Chat.ChatCompletionMessageParam => ({ role: turn.role, content: turn.content })),
          ],
          ...(tuned && { temperature: request.temperature, max_tokens: request.maxTokens }),
        },
        // A retry would arrive after the person has typed on.
        { signal, maxRetries: 0 },
      );
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await send(this.tuned);
    } catch (error) {
      if (!this.tuned || signal.aborted || !(error instanceof OpenAI.BadRequestError)) throw error;
      this.tuned = false;
      completion = await send(false);
    }
    const choice = completion.choices[0];
    return {
      text: choice?.message?.content ?? "",
      mode: "chat",
      truncated: choice?.finish_reason === "length",
      ...(completion.usage && { usage: { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } }),
    };
  }

  /** Ollama's own API, beside the OpenAI-style one under /v1. */
  private get ollamaBase(): string {
    return (this.settings.baseURL ?? "").replace(/\/v1$/, "");
  }

  /** Ollama lists "insert" among a model's capabilities when it fills in the middle (qwen2.5-coder, codellama:code, starcoder2…). */
  private async canFill(signal: AbortSignal): Promise<boolean> {
    if (this.fills !== undefined) return this.fills;
    try {
      const response = await fetch(`${this.ollamaBase}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.settings.model }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
      });
      if (!response.ok) return false;
      const { capabilities } = (await response.json()) as { capabilities?: unknown };
      this.fills = Array.isArray(capabilities) && capabilities.includes("insert");
      return this.fills;
    } catch {
      return false; // Asked again next time.
    }
  }

  /** Fill in the middle through Ollama's OpenAI-style completions endpoint, which takes a suffix. */
  private async fill(request: CompletionRequest, signal: AbortSignal): Promise<CompletionAnswer> {
    const completion = await this.client.completions.create(
      {
        model: this.settings.model,
        prompt: request.prefix,
        // Ollama uses the model's fill-in-the-middle template only when there is a suffix.
        suffix: request.suffix || "\n",
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      },
      { signal, maxRetries: 0 },
    );
    const choice = completion.choices[0];
    return {
      text: choice?.text ?? "",
      mode: "fim",
      truncated: choice?.finish_reason === "length",
      ...(completion.usage && { usage: { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } }),
    };
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
