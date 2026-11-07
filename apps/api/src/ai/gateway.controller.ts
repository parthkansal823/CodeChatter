/**
 * The AI gateway's API side: code in a sandbox calls the room's model through OpenAI's format, reaching here through the agent and
 * the runner. The runner's token says which room; no session, and no key leaves this server.
 */
import { verifyServiceToken } from "@codechatter/auth/service-token";
import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { Public } from "../auth/public.decorator.js";
import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";
import { InterviewsService } from "../interviews/interviews.service.js";
import { AiService } from "./ai.service.js";
import { adapterRequest, errorBody, planChat, planEmbeddings, StreamRelay, upstreamFailure, usageIn, type ChatPlan, type GatewayFailure, type GatewayUsage } from "./gateway.js";
import { describeAiError, type AiProvider } from "./providers.js";
import { messagesAsText, type TraceMessage } from "./traces.js";
import { AiTraces } from "./traces.service.js";

const OPENAI_URL = "https://api.openai.com/v1";
const isFailure = (value: object): value is GatewayFailure => "status" in value;
const fail = (res: Response, failure: GatewayFailure, retryAfter?: number): void => {
  if (retryAfter) res.setHeader("Retry-After", String(retryAfter));
  res.status(failure.status).json(errorBody(failure));
};

type Admitted = { roomId: string; ownerId: string | null; provider: AiProvider; traced: boolean };

@Public()
@Controller("internal/ai-gateway/v1")
export class AiGatewayController {
  private readonly logger = new Logger("AI gateway");

  constructor(
    private readonly ai: AiService,
    private readonly interviews: InterviewsService,
    private readonly traces: AiTraces,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Whether this room's code may use the model now. Answers for itself when it may not. */
  private async admit(req: Request, res: Response): Promise<Admitted | null> {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const claims = verifyServiceToken(this.env.SERVICE_SECRET, token, "api");
    if (!claims) {
      fail(res, { status: 401, message: "This address is only for CodeChatter's own services.", type: "invalid_request_error" });
      return null;
    }
    const refuse = (status: number, message: string) => {
      fail(res, { status, message, type: status === 503 ? "api_error" : "invalid_request_error" });
      return null;
    };
    if (this.env.AI_GATEWAY_RATE_LIMIT === 0) return refuse(403, "This server doesn't let code in rooms use the AI.");
    const provider = this.ai.provider;
    if (!provider) return refuse(503, this.ai.setup.problem ?? "AI isn't set up on this server.");
    const room = await this.ai.gatewayRoom(claims.sub);
    if (!room) return refuse(404, "This room doesn't exist any more.");
    if (room.guest) return refuse(403, "Demo rooms can't use the AI from code.");
    if (room.kind === "interview") {
      // Calling the model from code is using the AI: the interviewer decides, and sees it.
      if (!(await this.interviews.candidateMayUseAi(claims.sub))) return refuse(403, "AI help is off during this interview.");
      void this.interviews.noteAiUse(claims.sub).catch(() => {});
    }
    // An interview keeps its own record: this shouldn't be another about a candidate.
    return { roomId: claims.sub, ownerId: room.ownerId, provider, traced: room.kind !== "interview" };
  }

  /** A loop in someone's code shouldn't get far. It's the room's limit, as anyone's code in it comes through here. */
  private async counted(admitted: Admitted, res: Response): Promise<boolean> {
    const limit = await this.ai.hitGateway(admitted.roomId);
    if (limit.allowed) return true;
    fail(res, { status: 429, message: `This room's code has used its ${this.env.AI_GATEWAY_RATE_LIMIT} AI requests for now. Try again in ${limit.retryAfterSeconds} seconds.`, type: "rate_limit_error", code: "rate_limit_exceeded" }, limit.retryAfterSeconds);
    return false;
  }

  /** It counts towards the room owner's usage, as they're the one answerable for the room. */
  private record(admitted: Admitted, usage: GatewayUsage | null, estimated: { input: number; output: number }): void {
    if (!admitted.ownerId) return;
    const tokens = usage ? { ...usage, estimated: false } : { inputTokens: Math.ceil(estimated.input / 4), outputTokens: Math.ceil(estimated.output / 4), estimated: true };
    void this.ai.record(admitted.ownerId, tokens).catch((error) => this.logger.warn(`AI usage not recorded: ${String(error)}`));
  }

  /** A call from the room's code, for its traces. It isn't anyone's in particular. */
  private trace(admitted: Admitted, detail: { source: "gateway" | "embedding"; model: string; status: "ok" | "cut" | "refused" | "stopped" | "error"; error?: string | null; usage: GatewayUsage | null; estimated: { input: number; output: number }; started: number; firstAt?: number | null; input: TraceMessage[]; output: string }): void {
    if (!admitted.traced) return;
    this.traces.record({
      roomId: admitted.roomId,
      userId: null,
      source: detail.source,
      mode: null,
      model: detail.model,
      provider: admitted.provider.settings.provider,
      status: detail.status,
      error: detail.error ?? null,
      inputTokens: detail.usage?.inputTokens ?? Math.ceil(detail.estimated.input / 4),
      outputTokens: detail.usage?.outputTokens ?? Math.ceil(detail.estimated.output / 4),
      estimated: !detail.usage,
      firstMs: detail.firstAt ? detail.firstAt - detail.started : null,
      totalMs: Date.now() - detail.started,
      input: detail.input,
      output: detail.output,
    });
  }

  private send(path: string, provider: AiProvider, body: unknown, signal: AbortSignal) {
    return fetch(`${provider.settings.baseURL ?? OPENAI_URL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${provider.settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async relayFailure(res: Response, answer: globalThis.Response, provider: AiProvider): Promise<string> {
    const raw = await answer.text().catch(() => "");
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON (a proxy's error page): its text is what there is.
    }
    const failure = upstreamFailure(answer.status, parsed, provider.settings.apiKey);
    fail(res, failure, Number(answer.headers.get("retry-after")) || undefined);
    return failure.message;
  }

  @Get("models")
  async models(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.admit(req, res))) return;
    const { models, embedding } = await this.ai.promptModels();
    res.json({ object: "list", data: [...models, ...(embedding ? [embedding] : [])].map((id) => ({ id, object: "model", created: 0, owned_by: "codechatter" })) });
  }

  @Post("chat/completions")
  @HttpCode(200)
  async chat(@Req() req: Request, @Body() raw: unknown, @Res() res: Response): Promise<void> {
    const admitted = await this.admit(req, res);
    if (!admitted) return;
    const { models } = await this.ai.promptModels();
    const plan = planChat(raw, models, admitted.provider.settings);
    if (isFailure(plan)) return fail(res, plan);
    if (!(await this.counted(admitted, res))) return;
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    const inputChars = JSON.stringify(plan.body.messages).length;
    const started = Date.now();
    const asked = messagesAsText(plan.body.messages);
    try {
      if (admitted.provider.settings.provider === "anthropic") await this.throughAdapter(admitted, plan, res, gone.signal, inputChars, started, asked);
      else await this.passThrough(admitted, plan, res, gone.signal, inputChars, started, asked);
    } catch (error) {
      if (gone.signal.aborted) {
        this.trace(admitted, { source: "gateway", model: plan.model, status: "stopped", usage: null, estimated: { input: inputChars, output: 0 }, started, input: asked, output: "" });
        return;
      }
      this.logger.warn(`AI gateway failed for room ${admitted.roomId}: ${error instanceof Error ? error.message : String(error)}`);
      const message = describeAiError(error, { ...admitted.provider.settings, model: plan.model }, false) ?? "The AI request failed. Try again.";
      this.trace(admitted, { source: "gateway", model: plan.model, status: "error", error: message, usage: null, estimated: { input: inputChars, output: 0 }, started, input: asked, output: "" });
      if (!res.headersSent) fail(res, { status: 502, message, type: "api_error" });
      else res.destroy();
    }
  }

  private async passThrough(admitted: Admitted, plan: ChatPlan, res: Response, signal: AbortSignal, inputChars: number, started: number, asked: TraceMessage[]): Promise<void> {
    const answer = await this.send("/chat/completions", admitted.provider, plan.body, signal);
    if (!answer.ok) {
      const error = await this.relayFailure(res, answer, admitted.provider);
      this.trace(admitted, { source: "gateway", model: plan.model, status: "error", error, usage: null, estimated: { input: inputChars, output: 0 }, started, input: asked, output: "" });
      return;
    }
    if (!plan.stream || !answer.body) {
      const parsed = (await answer.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
      const written = parsed.choices?.[0]?.message?.content ?? "";
      const estimated = { input: inputChars, output: written.length };
      this.record(admitted, usageIn(parsed), estimated);
      this.trace(admitted, { source: "gateway", model: plan.model, status: parsed.choices?.[0]?.finish_reason === "length" ? "cut" : "ok", usage: usageIn(parsed), estimated, started, input: asked, output: written });
      res.status(200).json(parsed);
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.flushHeaders();
    const relay = new StreamRelay(plan.askedForUsage);
    let firstAt: number | null = null;
    let finished = false;
    try {
      const reader = answer.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const out = relay.feed(value);
        if (relay.outputChars > 0) firstAt ??= Date.now();
        if (out) res.write(out);
      }
      const rest = relay.flush();
      if (rest) res.write(rest);
      finished = true;
    } finally {
      // Stopped part way, the provider still did the work.
      const estimated = { input: inputChars, output: relay.outputChars };
      this.record(admitted, relay.usage, estimated);
      this.trace(admitted, { source: "gateway", model: plan.model, status: finished ? "ok" : "stopped", usage: relay.usage, estimated, started, firstAt, input: asked, output: relay.output });
    }
    res.end();
  }

  /** For a provider that doesn't speak OpenAI's format: its text, in that format. */
  private async throughAdapter(admitted: Admitted, plan: ChatPlan, res: Response, signal: AbortSignal, inputChars: number, started: number, asked: TraceMessage[]): Promise<void> {
    const request = adapterRequest(plan);
    if (isFailure(request)) return fail(res, request);
    const id = `chatcmpl-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: plan.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    let text = "";
    let usage: GatewayUsage | null = null;
    let stop = "stop";
    let firstAt: number | null = null;
    let finished = false;
    if (plan.stream) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.flushHeaders();
      res.write(chunk({ role: "assistant", content: "" }, null));
    }
    try {
      for await (const piece of admitted.provider.stream(request, signal)) {
        if (piece.type === "text") {
          firstAt ??= Date.now();
          text += piece.text;
          if (plan.stream) res.write(chunk({ content: piece.text }, null));
        } else {
          usage = piece.usage ?? null;
          stop = piece.stop === "length" ? "length" : piece.stop === "refusal" ? "content_filter" : "stop";
        }
      }
      finished = true;
    } finally {
      const estimated = { input: inputChars, output: text.length };
      this.record(admitted, usage, estimated);
      if (finished) this.trace(admitted, { source: "gateway", model: plan.model, status: stop === "length" ? "cut" : stop === "content_filter" ? "refused" : "ok", usage, estimated, started, firstAt, input: asked, output: text });
    }
    const counted = usage as GatewayUsage | null;
    const reported = counted && { prompt_tokens: counted.inputTokens, completion_tokens: counted.outputTokens, total_tokens: counted.inputTokens + counted.outputTokens };
    if (plan.stream) {
      res.write(chunk({}, stop));
      if (plan.askedForUsage && reported) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: plan.model, choices: [], usage: reported })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.status(200).json({ id, object: "chat.completion", created, model: plan.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: stop }], ...(reported && { usage: reported }) });
    }
  }

  @Post("embeddings")
  @HttpCode(200)
  async embeddings(@Req() req: Request, @Body() raw: unknown, @Res() res: Response): Promise<void> {
    const admitted = await this.admit(req, res);
    if (!admitted) return;
    const { models, embedding } = await this.ai.promptModels();
    const plan = planEmbeddings(raw, models, admitted.provider.settings, embedding);
    if (isFailure(plan)) return fail(res, plan);
    if (!(await this.counted(admitted, res))) return;
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    const started = Date.now();
    const inputs = Array.isArray(plan.body.input) ? plan.body.input.length : 1;
    // What's embedded can be a whole project: how much is what's worth keeping.
    const asked = [{ role: "user", content: `${inputs} ${inputs === 1 ? "text" : "texts"} to embed` }];
    const size = JSON.stringify(plan.body.input).length;
    try {
      const answer = await this.send("/embeddings", admitted.provider, plan.body, gone.signal);
      if (!answer.ok) {
        const error = await this.relayFailure(res, answer, admitted.provider);
        this.trace(admitted, { source: "embedding", model: plan.model, status: "error", error, usage: null, estimated: { input: size, output: 0 }, started, input: asked, output: "" });
        return;
      }
      const parsed: unknown = await answer.json();
      this.record(admitted, usageIn(parsed), { input: size, output: 0 });
      this.trace(admitted, { source: "embedding", model: plan.model, status: "ok", usage: usageIn(parsed), estimated: { input: size, output: 0 }, started, input: asked, output: "" });
      res.status(200).json(parsed);
    } catch (error) {
      if (gone.signal.aborted) return;
      this.logger.warn(`AI gateway failed for room ${admitted.roomId}: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) fail(res, { status: 502, message: describeAiError(error, { ...admitted.provider.settings, model: plan.model }, false) ?? "The AI request failed. Try again.", type: "api_error" });
    }
  }
}
