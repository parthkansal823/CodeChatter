import { Controller, Get, Inject } from "@nestjs/common";

import { Public } from "../auth/public.decorator.js";
import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";

/**
 * What this server can do, for the web client to adapt to — e.g. only show
 * "Continue with GitHub" when GitHub is configured (v1 showed the buttons and
 * then failed silently).
 */
@Controller("meta")
@Public()
export class MetaController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  meta() {
    return {
      auth: {
        emailPassword: true,
        google: Boolean(this.env.GOOGLE_CLIENT_ID),
        github: Boolean(this.env.GITHUB_CLIENT_ID),
      },
      /** "Try the demo" guest rooms. */
      demo: this.env.DEMO_ENABLED,
    };
  }
}
