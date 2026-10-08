import type { AuthSession } from "@codechatter/auth";
import { AiChatInput, RoomCode, type AiStatus, type AiStreamEvent, type AiTokenCount, type AiUsage } from "@codechatter/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";
import { AiService } from "./ai.service.js";
import type { RunContext, SummaryContext } from "./context.js";
import { buildModelRequest } from "./prompts.js";
import { describeAiError, type StreamPiece } from "./providers.js";
import { rateLimitMessage } from "./rate-limit.js";
import { formatActivity, formatChat } from "./summary.js";
import { estimateUsage } from "./usage.js";

// A comment line now and then keeps idle proxies from closing the stream
// while a model thinks before its first word.
const HEARTBEAT_MS = 15_000;

@Controller()
export class AiController {
  private readonly logger = new Logger("AI");

  constructor(
    private readonly ai: AiService,
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
  ) {}

  /** Whether AI is set up, for the panel to show the chat or the setup help. Never includes keys. */
  @Get("ai/status")
  status(): AiStatus {
    return this.ai.status();
  }

  /** Your own request and token counts, and where you stand against the rate limit. */
  @Get("ai/usage")
  usage(@CurrentSession() session: AuthSession): Promise<AiUsage> {
    return this.ai.usage(session.user.id);
  }

  /** Streams one answer as Server-Sent Events (AiStreamEvent per `data:` line). */
  @Post("rooms/:roomId/ai/chat")
  async chat(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(AiChatInput)) input: AiChatInput,
    @Res() res: Response,
  ): Promise<void> {
    await this.rooms.require(roomId, session.user.id, "room.chat");
    const provider = this.ai.provider;
    if (!provider) throw new ServiceUnavailableException(this.ai.setup.problem ?? "AI isn't set up on this server.");
    if (input.context.image && !provider.settings.vision) {
      throw new BadRequestException("This AI model can't read images. Remove the image and ask in words.");
    }

    const limit = await this.ai.hit(session.user.id);
    if (!limit.allowed) {
      const { requests, windowSeconds } = this.ai.status().limit;
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      throw new HttpException(rateLimitMessage(requests, windowSeconds, limit.retryAfterSeconds), HttpStatus.TOO_MANY_REQUESTS);
    }

    let run: RunContext | undefined;
    if (input.context.runOutput) {
      run = await this.runner.snapshot(roomId, session.user).then(
        (snapshot): RunContext => ({ status: "ok", snapshot }),
        (): RunContext => ({ status: "unavailable" }),
      );
    }
    let summary: SummaryContext | undefined;
    if (input.mode === "summary") {
      const minutes = input.context.summary?.minutes ?? 60;
      const since = new Date(Date.now() - minutes * 60_000);
      const [chat, activity] = await Promise.all([this.ai.chatSince(roomId, since), this.ai.activitySince(roomId, since)]);
      const now = Date.now();
      summary = {
        minutes,
        chat: formatChat(chat, now, Math.floor(this.ai.contextChars * 0.4)),
        activity: formatActivity(activity, roomId, now),
        changes: input.context.summary?.changes ?? "",
      };
    }
    const request = buildModelRequest(input, { ...(run && { run }), ...(summary && { summary }), contextChars: this.ai.contextChars });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    // no-transform: compression by a proxy would hold chunks back.
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abort = new AbortController();
    // The person pressed Stop or left: stop paying for tokens nobody reads.
    res.on("close", () => abort.abort());
    const send = (event: AiStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);

    let outputChars = 0;
    let recorded = false;
    const record = async (tokens: AiTokenCount): Promise<AiTokenCount> => {
      recorded = true;
      await this.ai.record(session.user.id, tokens).catch((error) => this.logger.warn(`AI usage not recorded: ${String(error)}`));
      return tokens;
    };

    try {
      let end: Extract<StreamPiece, { type: "stop" }> | null = null;
      for await (const piece of provider.stream(request, abort.signal)) {
        if (piece.type === "text") {
          outputChars += piece.text.length;
          send({ type: "delta", text: piece.text });
        } else {
          end = piece;
        }
      }
      const usage = await record(end?.usage ? { ...end.usage, estimated: false } : estimateUsage(request, outputChars));
      send({ type: "done", stop: end?.stop ?? "end", usage });
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = describeAiError(error, provider.settings, Boolean(request.image));
        this.logger.warn(`AI request failed in room ${roomId}: ${error instanceof Error ? error.message : String(error)}`);
        if (message) send({ type: "error", message });
      }
    } finally {
      // Stopped or cut off after some output: the provider still did the work, so count what was produced.
      if (!recorded && outputChars > 0) await record(estimateUsage(request, outputChars));
      clearInterval(heartbeat);
      res.end();
    }
  }
}
