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

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** A plain page for someone who clicked a link: no scripts, no styles from elsewhere. */
const page = (title: string, words: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5}</style></head><body><h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(words)}</p></body></html>`;

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
    // Someone clicking an approval's link in a browser is told, in a page, what happened; anything else gets JSON.
    const person = request.method === "GET" && request.accepts(["json", "html"]) === "html";
    try {
      const answer = await this.triggers.resumeHook(roomId, runId, token, callOf(request), false);
      if (person) return void response.status(200).type("html").send(page("Thanks", `Your answer${typeof request.query.action === "string" ? ` (${escapeHtml(request.query.action)})` : ""} has been passed on. You can close this page.`));
      response.status(answer.status).json(answer.body);
    } catch (error) {
      if (!person) throw error;
      response.status(404).type("html").send(page("Nothing is waiting here", "This has been answered already, or the link isn't right."));
    }
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
