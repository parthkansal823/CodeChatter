import type { Auth, AuthSession } from "@codechatter/auth";
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { AUTH } from "../infra/tokens.js";
import { IS_PUBLIC } from "./public.decorator.js";

export type AuthedRequest = Request & { session: AuthSession };

/**
 * Global guard: every route needs a valid Better Auth session cookie unless
 * marked @Public(). Deny by default, so a new controller never ships open by
 * accident.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // APP_GUARD also runs on WebSocket gateway messages. Sockets are
    // authenticated once, in the gateway's connection middleware
    // (realtime/events.gateway.ts), so this guard handles HTTP only.
    if (context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException("Sign in to continue.");
    request.session = session;
    return true;
  }
}
