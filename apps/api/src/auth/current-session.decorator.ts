import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { AuthedRequest } from "./session.guard.js";

export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().session,
);
