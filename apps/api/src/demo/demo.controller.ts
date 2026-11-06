import { Controller, HttpCode, HttpException, HttpStatus, NotFoundException, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { Public } from "../auth/public.decorator.js";
import { DemoService } from "./demo.service.js";

@Controller("demo")
@Public()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

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
    await this.demo.signIn(guest, req, res);
    return { roomId: guest.roomId, name: guest.name };
  }
}
