import { can, type RoomAction, type RoomRole } from "@codechatter/contracts";
import { ForbiddenException, HttpException } from "@nestjs/common";
import { EventEmitter } from "node:events";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import type { AiSettings } from "./ai.config.js";
import { AiController } from "./ai.controller.js";
import type { CompletionAnswer } from "./providers.js";

// POST /rooms/:roomId/ai/complete, with the services around it stubbed.

const settings: AiSettings = { provider: "ollama", model: "hermes3", apiKey: "ollama", baseURL: "http://localhost:11434/v1", vision: false };
const session = { user: { id: "u1", name: "Test" } } as never;
const input = { path: "calc.py", language: "python", prefix: "def add(a, b):\n    ", suffix: "\n" };

type Options = {
  role?: RoomRole;
  complete?: ((signal: AbortSignal) => Promise<CompletionAnswer>) | null;
  allowed?: boolean;
};

function setup({ role = "editor", complete = async () => ({ text: "```python\nreturn a + b\n```", mode: "chat", truncated: false, usage: { inputTokens: 90, outputTokens: 7 } }), allowed = true }: Options = {}) {
  const rooms = {
    require: vi.fn(async (_roomId: string, _userId: string, action: RoomAction) => {
      if (!can(role, action)) throw new ForbiddenException("You don't have access to do that in this room.");
      return { room: {}, role };
    }),
  };
  const provider = complete && { settings, complete: vi.fn((_request: unknown, signal: AbortSignal) => complete(signal)) };
  const ai = {
    provider,
    setup: { problem: "AI is off on this server." },
    hitCompletion: vi.fn(async () => (allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 12 })),
    completionLimit: 30,
    record: vi.fn(async () => {}),
  };
  const res = Object.assign(new EventEmitter(), { writableFinished: false, setHeader: vi.fn() });
  const controller = new AiController(ai as never, rooms as never, {} as never);
  return { ai, rooms, res, provider, call: (body = input) => controller.complete(session, "E2ETST", body, res as never) };
}

describe("AiController.complete", () => {
  it("answers editors with the cleaned suggestion and counts the usage", async () => {
    const { ai, rooms, call } = setup();
    await expect(call()).resolves.toEqual({ text: "return a + b" });
    expect(rooms.require).toHaveBeenCalledWith("E2ETST", "u1", "files.edit");
    expect(ai.record).toHaveBeenCalledWith("u1", { inputTokens: 90, outputTokens: 7, estimated: false });
  });

  it("refuses people who can't edit the files, before any model is asked", async () => {
    for (const role of ["viewer", "runner"] as const) {
      const { ai, provider, call } = setup({ role });
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(ai.hitCompletion).not.toHaveBeenCalled();
      expect(provider!.complete).not.toHaveBeenCalled();
    }
    await expect(setup({ role: "candidate" }).call()).resolves.toEqual({ text: "return a + b" });
  });

  it("says clearly when AI isn't set up", async () => {
    const { call } = setup({ complete: null });
    await expect(call()).rejects.toMatchObject({ status: 503, message: "AI is off on this server." });
  });

  it("refuses over the limit with Retry-After, without asking the model", async () => {
    const { res, provider, call } = setup({ allowed: false });
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toContain("AI suggestions are paused for about 12 seconds");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "12");
    expect(provider!.complete).not.toHaveBeenCalled();
  });

  it("stops the model when the editor cancels (the person typed on)", async () => {
    let seen: AbortSignal | undefined;
    const { ai, res, call } = setup({
      complete: (signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError()));
        }),
    });
    const pending = call();
    await vi.waitFor(() => expect(seen).toBeDefined());
    res.emit("close");
    await expect(pending).resolves.toEqual({ text: "" });
    expect(seen!.aborted).toBe(true);
    expect(ai.record).not.toHaveBeenCalled();
  });

  it("explains a failed model call in words the person can act on", async () => {
    const { call } = setup({ complete: async () => Promise.reject(new OpenAI.APIConnectionError({ message: "fetch failed" })) });
    await expect(call()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Couldn't reach Ollama") });
  });

  it("estimates the usage when the provider doesn't report it", async () => {
    const { ai, call } = setup({ complete: async () => ({ text: "return a + b", mode: "chat", truncated: false }) });
    await call();
    expect(ai.record).toHaveBeenCalledWith("u1", expect.objectContaining({ estimated: true }));
  });

  it("asks nothing for an empty file", async () => {
    const { ai, call } = setup();
    await expect(call({ ...input, prefix: "  \n", suffix: "" })).resolves.toEqual({ text: "" });
    expect(ai.hitCompletion).not.toHaveBeenCalled();
  });
});
