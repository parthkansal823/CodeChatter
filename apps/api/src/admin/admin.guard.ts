/** Hide instance-admin routes from unauthenticated, banned and ordinary users using fresh database authority on every request. */
import type { Auth } from "@codechatter/auth";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, NotFoundException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

import type { AuthedRequest } from "../auth/session.guard.js";
import { AUTH, DB } from "../infra/tokens.js";
import { isBanned, isInstanceAdmin } from "./admin-policy.js";

@Injectable()
export class InstanceAdminGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth, @Inject(DB) private readonly handle: DbHandle) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new NotFoundException();
    const [person] = await this.handle.db.select({ role: schema.user.role, banned: schema.user.banned, banExpires: schema.user.banExpires }).from(schema.user).where(eq(schema.user.id, session.user.id));
    if (!person || !isInstanceAdmin(person.role) || isBanned(person)) throw new NotFoundException();
    request.session = session;
    return true;
  }
}
