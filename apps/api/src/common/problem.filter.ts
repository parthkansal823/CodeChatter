import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Every error leaves the API as RFC 9457 `application/problem+json`, so the
 * web client handles one shape. Unexpected errors are logged in full and
 * returned without internals (v1 leaked paths and hosts via /health/full).
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("Problem");

  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = "Something went wrong on our side.";
    let errors: unknown;
    let secrets: unknown;

    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === "string") detail = body;
      else if (body && typeof body === "object") {
        const b = body as { message?: unknown; errors?: unknown; secrets?: unknown };
        detail = Array.isArray(b.message) ? b.message.join("; ") : String(b.message ?? error.message);
        errors = b.errors;
        // The secret scan's findings (github/secret-scan.ts), for the browser to show.
        secrets = b.secrets;
      }
    } else {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }

    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: (HttpStatus[status] ?? "error").replaceAll("_", " ").toLowerCase(),
        status,
        detail,
        instance: request.originalUrl,
        ...(errors !== undefined && { errors }),
        ...(secrets !== undefined && { secrets }),
      });
  }
}
