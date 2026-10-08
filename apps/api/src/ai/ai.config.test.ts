import { describe, expect, it } from "vitest";

import { aiStatus, DEFAULT_ANTHROPIC_MODEL, resolveAiSetup, type AiEnv } from "./ai.config.js";
import { AnthropicProvider, createProvider, OpenAiCompatibleProvider } from "./providers.js";

const env = (overrides: Partial<AiEnv> = {}): AiEnv => ({
  AI_PROVIDER: "none",
  AI_MODEL: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "",
  AI_VISION: "",
  AI_MAX_TOKENS: undefined,
  AI_RATE_LIMIT: 30,
  AI_RATE_WINDOW_SECONDS: 600,
  ...overrides,
});

describe("resolveAiSetup", () => {
  it("is off by default, with a reason", () => {
    const setup = resolveAiSetup(env());
    expect(setup.settings).toBeNull();
    expect(setup.provider).toBe("none");
    expect(setup.problem).toMatch(/AI_PROVIDER/);
    expect(createProvider(setup.settings)).toBeNull();
  });

  it("uses Claude Sonnet 5 by default for anthropic", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }));
    expect(setup.settings).toMatchObject({ provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL, vision: true, maxTokens: 16_000 });
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5");
    expect(createProvider(setup.settings)).toBeInstanceOf(AnthropicProvider);
  });

  it("needs a key for anthropic", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "anthropic" }));
    expect(setup.settings).toBeNull();
    expect(setup.problem).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("accepts a local OpenAI-compatible server without a key", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "openai", OPENAI_BASE_URL: "http://localhost:11434/v1/", AI_MODEL: "llama3.2" }));
    expect(setup.settings).toMatchObject({ provider: "openai", model: "llama3.2", baseURL: "http://localhost:11434/v1" });
    expect(setup.settings?.apiKey).toBeTruthy();
    expect(setup.settings?.maxTokens).toBeUndefined();
    expect(createProvider(setup.settings)).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it("needs a key for a remote OpenAI-compatible server", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "openai", OPENAI_BASE_URL: "https://api.groq.com/openai/v1", AI_MODEL: "llama-3.3-70b-versatile" }));
    expect(setup.settings).toBeNull();
    expect(setup.problem).toMatch(/OPENAI_API_KEY/);
  });

  it("needs a model name for OpenAI-compatible providers", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" }));
    expect(setup.settings).toBeNull();
    expect(setup.problem).toMatch(/AI_MODEL/);
  });

  it("reports a bad base URL instead of throwing", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_MODEL: "m", OPENAI_BASE_URL: "not a url" }));
    expect(setup.settings).toBeNull();
    expect(setup.problem).toMatch(/OPENAI_BASE_URL/);
  });

  it("reports an unknown provider", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "ollama" }));
    expect(setup.settings).toBeNull();
    expect(setup.problem).toMatch(/anthropic, openai or none/);
  });

  it("lets vision be turned off for text-only models", () => {
    const setup = resolveAiSetup(env({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_MODEL: "m", AI_VISION: "false" }));
    expect(setup.settings?.vision).toBe(false);
  });

  it("never puts a key in the status", () => {
    const e = env({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-secret-value" });
    const status = aiStatus(resolveAiSetup(e), e);
    expect(JSON.stringify(status)).not.toContain("sk-secret-value");
    expect(status).toMatchObject({ configured: true, provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL, limit: { requests: 30, windowSeconds: 600 } });
  });
});
