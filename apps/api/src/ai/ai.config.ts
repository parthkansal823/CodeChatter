import type { AiProviderName, AiStatus } from "@codechatter/contracts";

import type { Env } from "../config/env.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16_000;

export type AiEnv = Pick<
  Env,
  | "AI_PROVIDER"
  | "AI_MODEL"
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "OPENAI_BASE_URL"
  | "OLLAMA_URL"
  | "AI_VISION"
  | "AI_MAX_TOKENS"
  | "AI_RATE_LIMIT"
  | "AI_RATE_WINDOW_SECONDS"
>;

/** Everything needed to call a model. Only ever lives on the server. */
export type AiSettings = {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey: string;
  /** OpenAI-compatible endpoint; undefined means api.openai.com. */
  baseURL?: string;
  vision: boolean;
  /** Required by Anthropic; for OpenAI-compatible servers only sent when set (their limits vary by model). */
  maxTokens?: number;
};

export type AiSetup = {
  settings: AiSettings | null;
  provider: AiProviderName;
  model: string | null;
  problem: string | null;
};

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** OLLAMA_URL (or the default) without a trailing slash, or null when it isn't an http(s) URL. */
export function ollamaUrl(env: Pick<AiEnv, "OLLAMA_URL">): string | null {
  try {
    const url = new URL(env.OLLAMA_URL || DEFAULT_OLLAMA_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "").replace(/\/v1$/, "");
  } catch {
    return null;
  }
}

// A local server (Ollama, LM Studio, llama.cpp) needs no key.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "host.docker.internal"]);

/**
 * Decide which provider to use from the environment. Never throws: a
 * missing or malformed setting becomes a `problem` the setup panel shows,
 * so AI settings can't stop the API from booting.
 */
export function resolveAiSetup(env: AiEnv): AiSetup {
  const provider = env.AI_PROVIDER || "none";
  const vision = env.AI_VISION !== "false" && env.AI_VISION !== "0" && env.AI_VISION !== "no";
  const off = (name: AiProviderName, model: string | null, problem: string): AiSetup => ({ settings: null, provider: name, model, problem });

  if (provider === "none") {
    return off("none", null, "AI is off on this server. Set AI_PROVIDER to ollama, anthropic or openai in .env, then restart the API.");
  }

  if (provider === "anthropic") {
    const model = env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL;
    if (!env.ANTHROPIC_API_KEY) return off("anthropic", model, "AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is empty.");
    return {
      settings: { provider: "anthropic", model, apiKey: env.ANTHROPIC_API_KEY, vision, maxTokens: env.AI_MAX_TOKENS ?? DEFAULT_ANTHROPIC_MAX_TOKENS },
      provider: "anthropic",
      model,
      problem: null,
    };
  }

  if (provider === "ollama") {
    // Ollama serves the OpenAI chat API under /v1 and needs no key. Most local models read only text.
    const model = env.AI_MODEL || null;
    const url = ollamaUrl(env);
    if (!url) return off("ollama", model, "OLLAMA_URL isn't a valid URL. It should look like http://localhost:11434.");
    if (!model) return off("ollama", null, "Set AI_MODEL to a model you've pulled into Ollama, for example qwen2.5-coder (ollama pull qwen2.5-coder).");
    const ollamaVision = env.AI_VISION === "true" || env.AI_VISION === "1" || env.AI_VISION === "yes";
    return {
      settings: { provider: "ollama", model, apiKey: "ollama", baseURL: `${url}/v1`, vision: ollamaVision, ...(env.AI_MAX_TOKENS && { maxTokens: env.AI_MAX_TOKENS }) },
      provider: "ollama",
      model,
      problem: null,
    };
  }

  if (provider === "openai") {
    const model = env.AI_MODEL || null;
    let baseURL: string | undefined;
    let local = false;
    if (env.OPENAI_BASE_URL) {
      let url: URL;
      try {
        url = new URL(env.OPENAI_BASE_URL);
      } catch {
        return off("openai", model, "OPENAI_BASE_URL isn't a valid URL. It should look like http://localhost:11434/v1.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return off("openai", model, "OPENAI_BASE_URL must start with http:// or https://.");
      }
      baseURL = url.toString().replace(/\/+$/, "");
      local = LOCAL_HOSTS.has(url.hostname);
    }
    if (!env.OPENAI_API_KEY && !local) {
      return off("openai", model, "AI_PROVIDER is openai but OPENAI_API_KEY is empty. Only a local server such as Ollama works without a key.");
    }
    // Every OpenAI-compatible provider names its models differently, so there is no safe default.
    if (!model) return off("openai", null, "Set AI_MODEL to the model name your provider uses, for example llama3.2 for Ollama.");
    return {
      // The SDK refuses an empty key even when the server ignores it.
      settings: { provider: "openai", model, apiKey: env.OPENAI_API_KEY || "not-needed", ...(baseURL && { baseURL }), vision, ...(env.AI_MAX_TOKENS && { maxTokens: env.AI_MAX_TOKENS }) },
      provider: "openai",
      model,
      problem: null,
    };
  }

  return off("none", null, `AI_PROVIDER must be ollama, anthropic, openai or none (it is "${provider.slice(0, 40)}").`);
}

export function aiStatus(setup: AiSetup, env: Pick<AiEnv, "AI_RATE_LIMIT" | "AI_RATE_WINDOW_SECONDS">): AiStatus {
  return {
    configured: setup.settings !== null,
    provider: setup.provider,
    model: setup.model,
    vision: setup.settings?.vision ?? false,
    problem: setup.problem,
    limit: { requests: env.AI_RATE_LIMIT, windowSeconds: env.AI_RATE_WINDOW_SECONDS },
    ollama: null,
  };
}
