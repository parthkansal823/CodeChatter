import { describe, expect, it } from "vitest";

import type { AiSettings } from "./ai.config.js";
import { adapterRequest, chooseModel, planChat, planEmbeddings, StreamRelay, upstreamFailure, usageIn, type ChatPlan } from "./gateway.js";

const ollama: AiSettings = { provider: "ollama", model: "gemma", apiKey: "ollama", baseURL: "http://localhost:11434/v1", vision: false };
const openai: AiSettings = { provider: "openai", model: "gpt-cheap", apiKey: "sk-secret-key", vision: false };
const compatible: AiSettings = { ...openai, baseURL: "http://other/v1" };
const claude: AiSettings = { provider: "anthropic", model: "claude", apiKey: "k", vision: false };
const offered = ["gemma", "gpt-cheap", "other"];
const CHAT = { model: "gemma", messages: [{ role: "user", content: "Hi" }] };
const plan = (raw: unknown, settings = ollama) => {
  const planned = planChat(raw, offered, settings);
  if ("status" in planned) throw new Error(planned.message);
  return planned;
};
const refusal = (raw: unknown, settings = ollama) => {
  const planned = planChat(raw, offered, settings);
  if (!("status" in planned)) throw new Error("It should have been refused.");
  return planned;
};

describe("which model", () => {
  it("takes one on offer, and default for the server's own", () => {
    expect(chooseModel("other", offered, "gemma")).toBe("other");
    expect(chooseModel("default", offered, "gemma")).toBe("gemma");
    expect(chooseModel(undefined, offered, "gemma")).toBe("gemma");
  });

  it("takes a name without its tag, as Ollama does", () => {
    expect(chooseModel("nomic-embed-text", ["nomic-embed-text:latest"], "gemma")).toBe("nomic-embed-text:latest");
    expect(chooseModel("nomic-embed-text:v2", ["nomic-embed-text:latest"], "gemma")).toMatchObject({ status: 404 });
  });

  it("refuses one that isn't, and says what there is", () => {
    const failure = chooseModel("gpt-very-expensive", offered, "gemma");
    expect(failure).toMatchObject({ status: 404, code: "model_not_found" });
    expect(JSON.stringify(failure)).toContain("It offers: gemma, gpt-cheap, other.");
    expect(chooseModel(5, offered, "gemma")).toMatchObject({ status: 400 });
    expect(chooseModel(undefined, offered, null)).toMatchObject({ status: 400 });
  });
});

describe("a chat request", () => {
  it("goes nearly as it came", () => {
    const { body } = plan({ ...CHAT, temperature: 0.2, top_p: 0.5, stop: ["x"], seed: 7, response_format: { type: "json_object" }, tools: [{ type: "function" }], max_tokens: 10 });
    expect(body).toMatchObject({ model: "gemma", temperature: 0.2, top_p: 0.5, stop: ["x"], seed: 7, response_format: { type: "json_object" }, tools: [{ type: "function" }], max_tokens: 10 });
  });

  it("drops what could change what's billed or kept", () => {
    const { body } = plan({ ...CHAT, store: true, service_tier: "priority", metadata: { a: 1 }, prediction: {}, whatever: 1 });
    for (const field of ["store", "service_tier", "metadata", "prediction", "whatever"]) expect(body).not.toHaveProperty(field);
  });

  it("refuses what isn't a request", () => {
    for (const bad of [null, [], "text", {}, { messages: [] }, { messages: "Hi" }]) expect(refusal(bad).status).toBe(400);
  });

  it("gives one answer per request", () => {
    expect(refusal({ ...CHAT, n: 5 }).status).toBe(400);
    expect(plan({ ...CHAT, n: 1 }).body).not.toHaveProperty("n");
  });

  it("limits how much can be asked for", () => {
    for (const bad of [0, -1, 1.5, "10", 10_000_000]) {
      expect(refusal({ ...CHAT, max_tokens: bad }).status).toBe(400);
      expect(refusal({ ...CHAT, max_completion_tokens: bad }).status).toBe(400);
    }
    expect(plan({ ...CHAT, max_completion_tokens: 5 }, openai).body.max_completion_tokens).toBe(5);
  });

  it("counts tokens when the provider can, without telling the code unless it asked", () => {
    const quiet = plan({ ...CHAT, stream: true });
    expect(quiet.body.stream_options).toEqual({ include_usage: true });
    expect(quiet.askedForUsage).toBe(false);
    expect(plan({ ...CHAT, stream: true, stream_options: { include_usage: true } }).askedForUsage).toBe(true);
    expect(plan({ ...CHAT, model: "gpt-cheap", stream: true }, openai).body.stream_options).toEqual({ include_usage: true });
    expect(plan({ ...CHAT, model: "gpt-cheap", stream: true }, compatible).body).not.toHaveProperty("stream_options");
    expect(plan(CHAT).body).not.toHaveProperty("stream_options");
  });

  it("doesn't think first on a local model, unless asked to", () => {
    expect(plan(CHAT).body.reasoning_effort).toBe("none");
    expect(plan({ ...CHAT, reasoning_effort: "high" }).body.reasoning_effort).toBe("high");
    expect(plan({ ...CHAT, model: "gpt-cheap" }, openai).body).not.toHaveProperty("reasoning_effort");
  });
});

describe("embeddings", () => {
  it("take text or a list of it", () => {
    expect(planEmbeddings({ model: "gemma", input: "Hi" }, offered, ollama)).toMatchObject({ model: "gemma", body: { input: "Hi" } });
    expect(planEmbeddings({ input: ["a", "b"], store: true }, offered, ollama)).toEqual({ model: "gemma", body: { model: "gemma", input: ["a", "b"] } });
  });

  it("know which model makes them, for default and when it's asked for by name", () => {
    expect(planEmbeddings({ input: "Hi" }, offered, ollama, "embedder")).toMatchObject({ model: "embedder" });
    expect(planEmbeddings({ model: "default", input: "Hi" }, offered, ollama, "embedder")).toMatchObject({ model: "embedder" });
    expect(planEmbeddings({ model: "embedder", input: "Hi" }, offered, ollama, "embedder")).toMatchObject({ model: "embedder" });
    expect(planEmbeddings({ model: "embedder", input: "Hi" }, offered, ollama)).toMatchObject({ status: 404 });
  });

  it("refuse anything else, too many, and a provider without them", () => {
    for (const bad of [{ model: "gemma" }, { model: "gemma", input: [] }, { model: "gemma", input: 5 }, { model: "gemma", input: Array(3000).fill("x") }]) {
      expect(planEmbeddings(bad, offered, ollama)).toMatchObject({ status: 400 });
    }
    expect(planEmbeddings({ model: "nope", input: "Hi" }, offered, ollama)).toMatchObject({ status: 404 });
    expect(planEmbeddings({ model: "claude", input: "Hi" }, ["claude"], claude)).toMatchObject({ status: 404 });
  });
});

describe("the plain text adapter", () => {
  const planned = (body: Record<string, unknown>): ChatPlan => ({ body: { messages: CHAT.messages, ...body }, model: "claude", stream: false, askedForUsage: false });

  it("sorts out the system prompt and the turns", () => {
    const request = adapterRequest(planned({ messages: [{ role: "system", content: "Be brief." }, { role: "developer", content: "Be kind." }, { role: "user", content: [{ type: "text", text: "Hi " }, { type: "text", text: "there" }] }], max_tokens: 9 }));
    expect(request).toEqual({ system: "Be brief.\n\nBe kind.", messages: [{ role: "user", content: "Hi there" }], tuning: { model: "claude", maxTokens: 9 } });
  });

  it("says what it can't do, rather than quietly dropping it", () => {
    expect(adapterRequest(planned({ tools: [{}] }))).toMatchObject({ status: 400 });
    expect(adapterRequest(planned({ response_format: {} }))).toMatchObject({ status: 400 });
    expect(adapterRequest(planned({ messages: [{ role: "user", content: [{ type: "image_url" }] }] }))).toMatchObject({ status: 400 });
    expect(adapterRequest(planned({ messages: [{ role: "tool", content: "x" }] }))).toMatchObject({ status: 400 });
    expect(adapterRequest(planned({ messages: [{ role: "assistant", content: "x" }] }))).toMatchObject({ status: 400 });
    expect(adapterRequest(planned({ messages: ["x"] }))).toMatchObject({ status: 400 });
  });
});

describe("a stream passing through", () => {
  const data = (value: unknown) => `data: ${JSON.stringify(value)}\n`;
  const text = data({ choices: [{ delta: { content: "Hello" } }] });
  const last = data({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } });

  it("comes through as it was, and is counted", () => {
    const relay = new StreamRelay(true);
    expect(relay.feed(`${text}\n${last}\ndata: [DONE]\n\n`)).toBe(`${text}\n${last}\ndata: [DONE]\n\n`);
    expect(relay.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(relay.outputChars).toBe(5);
  });

  it("leaves out the usage chunk if the code didn't ask for it", () => {
    const relay = new StreamRelay(false);
    const out = relay.feed(`${text}\n${last}\ndata: [DONE]\n\n`);
    expect(out).not.toContain("usage");
    expect(out).toContain("Hello");
    expect(out).toContain("[DONE]");
    expect(relay.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it("doesn't mind where the pieces break", () => {
    const relay = new StreamRelay(true);
    const whole = `${text}\n${last}\n`;
    const out = [...whole].map((character) => relay.feed(character)).join("") + relay.flush();
    expect(out).toBe(whole);
    expect(relay.outputChars).toBe(5);
    expect(relay.usage?.outputTokens).toBe(2);
  });

  it("passes on what it can't read", () => {
    const relay = new StreamRelay(false);
    expect(relay.feed(": comment\ndata: {broken\nevent: x\n")).toBe(": comment\ndata: {broken\nevent: x\n");
  });
});

describe("what a provider said", () => {
  it("reads the count from an answer", () => {
    expect(usageIn({ usage: { prompt_tokens: 3, completion_tokens: 2 } })).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(usageIn({ usage: { prompt_tokens: 3 } })).toEqual({ inputTokens: 3, outputTokens: 0 });
    expect(usageIn({})).toBeNull();
  });

  it("never carries the key", () => {
    expect(JSON.stringify(upstreamFailure(401, { error: { message: "Bad key sk-secret-key" } }, "sk-secret-key"))).not.toContain("sk-secret-key");
    expect(JSON.stringify(upstreamFailure(400, { error: { message: "Bad key sk-secret-key" } }, "sk-secret-key"))).not.toContain("sk-secret-key");
  });

  it("keeps what helps, and doesn't blame the code for the provider's trouble", () => {
    expect(upstreamFailure(400, { error: { message: "Bad field" } }, "k")).toMatchObject({ status: 400, message: "Bad field", type: "invalid_request_error" });
    expect(upstreamFailure(429, { error: { message: "Slow down" } }, "k")).toMatchObject({ status: 429, type: "rate_limit_error" });
    expect(upstreamFailure(500, {}, "k")).toMatchObject({ status: 502, type: "api_error" });
    expect(upstreamFailure(401, {}, "k").status).toBe(502);
  });
});
