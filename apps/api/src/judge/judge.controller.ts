import type { AuthSession } from "@codechatter/auth";
import { JudgeInput, RoomCode } from "@codechatter/contracts";
import { BadRequestException, Body, Controller, HttpCode, Inject, Logger, Optional, Param, Post, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { queueRoomEvent, TestsWatcher } from "../automations/room-activity.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { VALKEY } from "../infra/tokens.js";
import { RunnerClient } from "../runner/runner.client.js";
import { isImportableUrl, parseProblem, type ImportedProblem } from "./samples.js";

const ImportInput = z.object({ url: z.string().max(500) });

/** Test cases for competitive programming: run them in the sandbox, import samples from problem pages. */
@Controller()
export class JudgeController {
  private readonly logger = new Logger(JudgeController.name);

  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    @Optional() @Inject(VALKEY) private readonly redis?: Redis,
  ) {}

  /** Streams one JSON line per event (compiling, each case's verdict, done) straight from the runner. */
  @Post("rooms/:roomId/judge")
  async judge(
    @CurrentSession() session: AuthSession,
    @Param("roomId") roomId: string,
    @Body(new ZodPipe(JudgeInput)) input: JudgeInput,
    @Res() res: Response,
  ): Promise<void> {
    const room = RoomCode.safeParse(roomId);
    if (!room.success) throw new BadRequestException("Unknown room.");
    await this.rooms.require(room.data, session.user.id, "code.run");
    const upstream = await this.runner.judge(room.data, session.user, input);
    res.status(200).setHeader("content-type", "application/x-ndjson").setHeader("cache-control", "no-store");
    res.flushHeaders();
    // For automations listening for tests: what they came to, read as it goes past.
    const watcher = new TestsWatcher(input.path, input.cases.length);
    try {
      for await (const chunk of upstream) {
        if (res.destroyed) break;
        res.write(chunk);
        watcher.feed(chunk as Buffer | string);
      }
    } catch (error) {
      this.logger.warn(`judge ${room.data}: ${String(error)}`);
      res.write(`${JSON.stringify({ type: "error", message: "The sandbox stopped answering." })}\n`);
    }
    res.end();
    const tests = watcher.result();
    if (tests && this.redis)
      void queueRoomEvent(this.redis, { room: room.data, event: "tests.finished", at: Date.now(), by: [session.user.id], data: tests }).catch((error) => this.logger.warn(`tests event: ${String(error)}`));
  }

  /** Sample tests from a Codeforces, AtCoder or CSES problem page. */
  @Post("judge/import")
  @HttpCode(200)
  async import(@Body(new ZodPipe(ImportInput)) input: z.infer<typeof ImportInput>): Promise<ImportedProblem> {
    const url = isImportableUrl(input.url.trim());
    if (!url) throw new BadRequestException("Paste a problem link from codeforces.com, atcoder.jp or cses.fi.");
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (CodeChatter sample import)", accept: "text/html" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new UnprocessableEntityException("That page couldn't be read right now. Paste the samples instead.");
    const html = (await response.text()).slice(0, 2_000_000);
    const problem = parseProblem(url, html);
    if (problem.samples.length === 0) throw new UnprocessableEntityException("No sample tests were found on that page. Paste them instead.");
    return { title: problem.title, samples: problem.samples.slice(0, 20) };
  }
}
