import type { Auth } from "@codechatter/auth";
import { Controller, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Post, Req, Res } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";

import { Public } from "../auth/public.decorator.js";
import { AUTH } from "../infra/tokens.js";
import { DemoService } from "./demo.service.js";

@Controller("demo")
@Public()
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  /**
   * One click from the landing page: a guest account, signed in, with a
   * guided-tour room. Answers { roomId } and sets the session cookie.
   */
  @Post("start")
  @HttpCode(200)
  async start(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ roomId: string; name: string }> {
    if (!this.demo.enabled) throw new NotFoundException("The demo isn't available on this server.");
    if (!(await this.demo.allow(req.ip ?? "unknown"))) {
      throw new HttpException("Too many demo rooms from your network. Try again in an hour, or create an account.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const guest = await this.demo.createGuest();
    // Sign in exactly like the sign-in form does, and pass Better Auth's
    // session cookies through to the browser.
    const signIn = await this.auth.api.signInEmail({
      body: { email: guest.email, password: guest.password },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (!signIn.ok) throw new HttpException("The demo couldn't start. Try again.", HttpStatus.SERVICE_UNAVAILABLE);
    for (const cookie of signIn.headers.getSetCookie()) res.append("set-cookie", cookie);
    return { roomId: guest.roomId, name: guest.name };
  }
}
