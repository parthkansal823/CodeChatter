import { describe, expect, it } from "vitest";

import { cleanTrace, clipText, messagesAsText, MOST_TRACE_CHARS, otlpBody, type NewAiTrace } from "./traces.js";

const SECRET = "AKIAIOSFODNN7EXAMPLE";
const trace: NewAiTrace = { roomId: "E2ETST", userId: "u1", source: "chat", mode: "assistant", model: "gemma", provider: "ollama", status: "ok", error: null, inputTokens: 5, outputTokens: 7, estimated: false, firstMs: 100, totalMs: 900, input: [{ role: "user", content: "Hi" }], output: "Hello" };
const attributes = (body: ReturnType<typeof otlpBody>) => Object.fromEntries(body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.map((item) => [item.key, Object.values(item.value)[0]]));

describe("what's kept", () => {
  it("has no secrets, in either direction", () => {
    const clean = cleanTrace([{ role: "system", content: `key ${SECRET}` }, { role: "user", content: `and ${SECRET}` }], `here: ${SECRET}`);
    expect(JSON.stringify(clean)).not.toContain(SECRET);
  });

  it("is cut to size, keeping both ends", () => {
    const long = `start${"x".repeat(MOST_TRACE_CHARS * 2)}end`;
    const out = clipText(long);
    expect(out.length).toBeLessThan(MOST_TRACE_CHARS + 60);
    expect(out.startsWith("start")).toBe(true);
    expect(out.endsWith("end")).toBe(true);
    expect(out).toContain("characters left out");
    expect(clipText("short")).toBe("short");
  });

  it("keeps the newest messages when there are too many", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ role: "user", content: String(index) }));
    const { input } = cleanTrace(many, "");
    expect(input).toHaveLength(20);
    expect(input.at(-1)!.content).toBe("29");
  });
});

describe("messages from code", () => {
  it("read as text, whatever their shape", () => {
    expect(messagesAsText([{ role: "user", content: "Hi" }])).toEqual([{ role: "user", content: "Hi" }]);
    expect(messagesAsText([{ role: "user", content: [{ type: "text", text: "Look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }])).toEqual([{ role: "user", content: "Look\n[image_url]" }]);
  });

  it("don't keep an image's data", () => {
    expect(JSON.stringify(messagesAsText([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,SECRETDATA" } }] }]))).not.toContain("SECRETDATA");
  });

  it("cope with what isn't messages", () => {
    expect(messagesAsText("nope")).toEqual([]);
    expect(messagesAsText([null, 5, { role: 7 }])).toEqual([{ role: "unknown", content: "" }]);
  });
});

describe("sending it on", () => {
  it("uses OpenTelemetry's names for an AI call", () => {
    const said = attributes(otlpBody(trace, { withContent: false }));
    expect(said).toMatchObject({ "gen_ai.operation.name": "chat", "gen_ai.provider.name": "ollama", "gen_ai.request.model": "gemma", "gen_ai.usage.input_tokens": "5", "gen_ai.usage.output_tokens": "7", "codechatter.room": "E2ETST" });
  });

  it("leaves out prompts and answers unless asked", () => {
    expect(JSON.stringify(otlpBody(trace, { withContent: false }))).not.toContain("Hello");
    expect(attributes(otlpBody(trace, { withContent: true }))["gen_ai.output.messages"]).toContain("Hello");
  });

  it("gives the time it took, and a failure as one", () => {
    const span = otlpBody({ ...trace, status: "error", error: "It broke" }, { withContent: false, now: 10_000 }).resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.startTimeUnixNano).toBe("9100000000");
    expect(span.endTimeUnixNano).toBe("10000000000");
    expect(span.status).toEqual({ code: 2, message: "It broke" });
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("names an embedding as one", () => {
    expect(attributes(otlpBody({ ...trace, source: "embedding" }, { withContent: false }))["gen_ai.operation.name"]).toBe("embeddings");
  });
});
