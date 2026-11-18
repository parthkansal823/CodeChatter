/**
 * A webhook's address: no session, as the services calling it have none. The token in the address is the secret (automation-triggers.service.ts), and a
 * trigger can ask for a header, basic auth or a signature of the body besides (hook-auth.ts). Any method
 * is taken, with JSON, a form or plain text; the flow gets the body, the headers (without cookies) and the query, as Activepieces' webhook trigger gives them.
 */
import { RoomCode } from "@codechatter/contracts";
import { All, Controller, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { Public } from "../auth/public.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AutomationTriggersService, type HookCall } from "./automation-triggers.service.js";

const Token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, "There's no automation at this address.");
const RunId = z.string().regex(/^[\w-]{1,64}$/, "Nothing is waiting at this address.");
/** What a flow isn't given of a call: a browser's cookies, and what the proxies in front add. */
const LEFT_OUT = new Set(["cookie", "connection", "host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via"]);

function callOf(request: Request & { rawBody?: Buffer }): HookCall {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) if (!LEFT_OUT.has(name) && value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.query)) query[name] = Array.isArray(value) ? value.map(String).join(",") : String(value);
  const parsed = request.body as unknown;
  const body = typeof parsed === "string" || (parsed && typeof parsed === "object" && Object.keys(parsed).length) ? parsed : (request.rawBody?.toString("utf8") ?? {});
  return { method: request.method, body, headers, query, raw: request.rawBody ?? Buffer.alloc(0) };
}

@Controller("hooks/automations")
export class AutomationHooksController {
  constructor(private readonly triggers: AutomationTriggersService) {}

  /** A waiting run's address (an approval's link, the next call a flow waits for): it carries on with what was sent. */
  @Public()
  @All("resume/:roomId/:runId/:token")
  async resume(@Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("runId", new ZodPipe(RunId)) runId: string, @Param("token", new ZodPipe(Token)) token: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const answer = await this.triggers.resumeHook(roomId, runId, token, callOf(request), false);
    response.status(answer.status).json(answer.body);
  }

  /** The same, the caller waiting for the run's answer. */
  @Public()
  @All("resume/:roomId/:runId/:token/sync")
  async resumeSync(@Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("runId", new ZodPipe(RunId)) runId: string, @Param("token", new ZodPipe(Token)) token: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const answer = await this.triggers.resumeHook(roomId, runId, token, callOf(request), true);
    response.status(answer.status).json(answer.body);
  }

  @Public()
  @All(":roomId/:token")
  async live(@Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("token", new ZodPipe(Token)) token: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const answer = await this.triggers.hook(roomId, token, callOf(request), false);
    response.status(answer.status).json(answer.body);
  }

  @Public()
  @All(":roomId/:token/test")
  async test(@Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("token", new ZodPipe(Token)) token: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const answer = await this.triggers.hook(roomId, token, callOf(request), true);
    response.status(answer.status).json(answer.body);
  }
}
