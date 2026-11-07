/** Keeps a room's AI calls for a while, shows them to the room, and sends them on to a tracing tool if the server's owner has set one. */
import type { AiTrace, AiTraceSource, AiTraceStatus } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { desc, eq, lt } from "drizzle-orm";

import type { Env } from "../config/env.js";
import { DB, ENV } from "../infra/tokens.js";
import { cleanTrace, otlpBody, type NewAiTrace } from "./traces.js";

const MOST_LISTED = 200;
const SWEEP_MS = 60 * 60 * 1000;
const EXPORT_TIMEOUT_MS = 3000;

@Injectable()
export class AiTraces implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("AI traces");
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /** Never in the way of the call itself: a failure here is only logged. */
  record(trace: NewAiTrace): void {
    const clean = { ...trace, ...cleanTrace(trace.input, trace.output) };
    if (this.env.AI_TRACES_DAYS > 0) void this.save(clean).catch((error) => this.logger.warn(`A trace wasn't kept: ${String(error)}`));
    if (this.env.AI_TRACES_OTLP_URL) void this.send(clean).catch((error) => this.logger.warn(`A trace wasn't sent on: ${String(error)}`));
  }

  private async save(trace: NewAiTrace): Promise<void> {
    await this.handle.db.insert(schema.aiTraces).values({
      roomId: trace.roomId,
      userId: trace.userId,
      source: trace.source,
      mode: trace.mode,
      model: trace.model,
      status: trace.status,
      error: trace.error,
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
      estimated: trace.estimated,
      firstMs: trace.firstMs,
      totalMs: trace.totalMs,
      input: trace.input,
      output: trace.output,
    });
  }

  private async send(trace: NewAiTrace): Promise<void> {
    const url = `${this.env.AI_TRACES_OTLP_URL.replace(/\/+$/, "")}/v1/traces`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(otlpBody(trace, { withContent: this.env.AI_TRACES_OTLP_CONTENT === "true" })),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the tracing tool answered ${response.status}`);
  }

  /**
   * Newest first. Someone's conversation with the AI is theirs, as it is in the panel: anyone in the room can see that it happened and
   * what it cost, but only they can read it. Code in the sandbox isn't anyone's, so whoever can run code there can read its calls.
   */
  async list(roomId: string, viewer: { userId: string; canRunCode: boolean }): Promise<AiTrace[]> {
    const { aiTraces, user } = schema;
    const rows = await this.handle.db
      .select({ trace: aiTraces, by: user.name })
      .from(aiTraces)
      .leftJoin(user, eq(aiTraces.userId, user.id))
      .where(eq(aiTraces.roomId, roomId))
      .orderBy(desc(aiTraces.id))
      .limit(MOST_LISTED);
    return rows.map(({ trace, by }) => {
      const mine = trace.userId === viewer.userId;
      // By where it came from, not by having no person: someone who has left has no person either, and their conversation is still theirs.
      const fromCode = trace.source === "gateway" || trace.source === "embedding";
      const visible = mine || (fromCode && viewer.canRunCode);
      return {
        id: trace.id,
        at: trace.createdAt.toISOString(),
        source: trace.source as AiTraceSource,
        mode: trace.mode,
        by: fromCode ? null : (by ?? "Someone who has left"),
        mine,
        model: trace.model,
        status: trace.status as AiTraceStatus,
        // A failure can quote what was sent.
        error: visible ? trace.error : trace.error && "It failed.",
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        estimated: trace.estimated,
        firstMs: trace.firstMs,
        totalMs: trace.totalMs,
        input: visible ? trace.input : null,
        output: visible ? trace.output : null,
        hidden: !visible,
      };
    });
  }

  private async sweep(): Promise<void> {
    const before = new Date(Date.now() - Math.max(1, this.env.AI_TRACES_DAYS) * 24 * 60 * 60 * 1000);
    await this.handle.db
      .delete(schema.aiTraces)
      .where(lt(schema.aiTraces.createdAt, before))
      .catch((error: unknown) => this.logger.warn(`Old traces weren't removed: ${String(error)}`));
  }
}
