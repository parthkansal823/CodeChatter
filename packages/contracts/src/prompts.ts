/**
 * The Prompt Playground: one prompt, sent as it's written, tried on several models and settings side by side.
 * `{{name}}` in a prompt is a variable, the same way promptfoo and the like write them.
 */
import { z } from "zod";

export const PROMPT_LIMITS = {
  systemChars: 40_000,
  messageChars: 40_000,
  messages: 30,
  modelChars: 200,
  maxTokens: 64_000,
} as const;

export const AiPromptInput = z.object({
  system: z.string().max(PROMPT_LIMITS.systemChars, "The system prompt is too long.").default(""),
  /** Oldest first, ending with the user's. */
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(PROMPT_LIMITS.messageChars, "That message is too long.") }))
    .min(1)
    .max(PROMPT_LIMITS.messages)
    .refine((list) => list.at(-1)?.role === "user" && list.at(-1)!.content.trim().length > 0, "The last message has to be the user's, with something in it."),
  model: z.string().trim().min(1).max(PROMPT_LIMITS.modelChars),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(PROMPT_LIMITS.maxTokens).optional(),
  /** Ask for an answer that's valid JSON, where the model's server can hold it to that. */
  json: z.boolean().optional(),
});
export type AiPromptInput = z.infer<typeof AiPromptInput>;

/** GET /api/rooms/:roomId/ai/models: what the Playground may offer on this server. */
export type AiPromptModels = {
  models: string[];
  /** The server's own model. Null when AI isn't set up. */
  default: string | null;
  /** The server takes these settings for its models. */
  temperature: boolean;
  json: boolean;
  /** Models here share one machine, so running columns together would make each look slow. */
  oneAtATime: boolean;
  /** Past about this length a local model may silently lose the start of a prompt. */
  contextChars: number;
  /** Code in the room's sandbox can call these models: OPENAI_BASE_URL is set for it, and it needs no key. */
  gateway: { on: boolean; requests: number; windowSeconds: number };
  /** The model that makes embeddings here, if any. Without one, Ask the codebase searches by words only. */
  embedding: string | null;
};

const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** The variables in these texts, once each, in the order they first appear. */
export function promptVariables(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(VARIABLE)) seen.add(match[1]!);
  return [...seen];
}

/** The text with its variables filled in. One without a value stays as it's written, and a value isn't read for more variables. */
export function renderPrompt(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(VARIABLE, (whole, name: string) => (Object.hasOwn(values, name) ? values[name]! : whole));
}
