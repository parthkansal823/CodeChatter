import { describe, expect, it } from "vitest";

import { AiPromptInput, promptVariables, renderPrompt } from "./prompts.js";

describe("variables", () => {
  it("finds each once, in order, across texts", () => {
    expect(promptVariables(["Hi {{name}}, about {{ topic }}.", "{{name}} again, and {{user.age}}"])).toEqual(["name", "topic", "user.age"]);
    expect(promptVariables(["no variables, { single } and {{}} and {{1bad}}"])).toEqual([]);
  });

  it("fills them in", () => {
    expect(renderPrompt("Explain {{ topic }} to {{who}}.", { topic: "recursion", who: "a child" })).toBe("Explain recursion to a child.");
  });

  it("leaves one without a value as it's written", () => {
    expect(renderPrompt("Explain {{topic}}.", {})).toBe("Explain {{topic}}.");
    expect(renderPrompt("{{constructor}} and {{toString}}", {})).toBe("{{constructor}} and {{toString}}");
  });

  it("keeps an empty value, which is different from none", () => {
    expect(renderPrompt("[{{a}}]", { a: "" })).toBe("[]");
  });

  it("doesn't read a value for more variables, or for replacement patterns", () => {
    expect(renderPrompt("{{a}}", { a: "{{b}}", b: "secret" })).toBe("{{b}}");
    expect(renderPrompt("{{a}}", { a: "$& $1 $$" })).toBe("$& $1 $$");
  });
});

describe("what may be sent", () => {
  const good = { messages: [{ role: "user", content: "Hi" }], model: "m" };

  it("takes a plain prompt, and a conversation ending with the user", () => {
    expect(AiPromptInput.parse(good).system).toBe("");
    const turns = [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "More" }];
    expect(AiPromptInput.safeParse({ ...good, messages: turns, system: "Be brief.", temperature: 0.2, maxTokens: 100, json: true }).success).toBe(true);
  });

  it("refuses one that doesn't end with something from the user", () => {
    expect(AiPromptInput.safeParse({ ...good, messages: [] }).success).toBe(false);
    expect(AiPromptInput.safeParse({ ...good, messages: [{ role: "assistant", content: "Hi" }] }).success).toBe(false);
    expect(AiPromptInput.safeParse({ ...good, messages: [{ role: "user", content: "   " }] }).success).toBe(false);
  });

  it("refuses a role that would let it pass as something else", () => {
    expect(AiPromptInput.safeParse({ ...good, messages: [{ role: "system", content: "Hi" }] }).success).toBe(false);
  });

  it("refuses settings out of range", () => {
    for (const bad of [{ temperature: -1 }, { temperature: 3 }, { maxTokens: 0 }, { maxTokens: 1.5 }, { maxTokens: 1_000_000 }, { model: "" }, { model: "x".repeat(201) }]) {
      expect(AiPromptInput.safeParse({ ...good, ...bad }).success).toBe(false);
    }
  });
});
