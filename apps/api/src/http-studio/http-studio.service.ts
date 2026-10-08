import {
  HTTP_STUDIO_LIMITS,
  sandboxTarget,
  type HttpSendErrorCode,
  type HttpSendInput,
  type HttpSendResult,
  type HttpSendTarget,
} from "@codechatter/contracts";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { lookup } from "node:dns/promises";
import { performance } from "node:perf_hooks";

import type { Env } from "../config/env.js";
import { ENV, VALKEY } from "../infra/tokens.js";
import { RunnerClient, type RunnerUser } from "../runner/runner.client.js";
import { encodeBody } from "./response-body.js";
import {
  BlockedTargetError,
  InvalidTargetError,
  outgoingHeaders,
  sandboxRunnerPath,
  UnresolvedHostError,
  vetTarget,
  type Resolver,
} from "./ssrf-guard.js";
import { transport, TransportError, type TransportResponse } from "./transport.js";

const DNS_TIMEOUT_MS = 10_000;

/** Every address for a name, from the system resolver (hosts file included). */
const resolveAll: Resolver = (host) =>
  Promise.race([
    lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT_MS).unref()),
  ]);

/**
 * Sends API Studio requests: to the public internet through the SSRF guard,
 * or to a dev server in the room's sandbox through the runner's preview
 * route (the same tunnel live previews use).
 */
@Injectable()
export class HttpStudioService {
  private readonly logger = new Logger("HttpStudio");

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly redis: Redis,
    private readonly runner: RunnerClient,
  ) {}

  /** A one-minute window per person, shared by every API instance. */
  async allow(userId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = Date.now();
    const key = `http-studio:sends:${userId}:${Math.floor(now / 60_000)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 90);
    return { allowed: count <= HTTP_STUDIO_LIMITS.sendsPerMinute, retryAfterSeconds: Math.max(1, 60 - Math.floor((now % 60_000) / 1000)) };
  }

  async send(roomId: string, user: RunnerUser, input: HttpSendInput): Promise<HttpSendResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const body = input.body === null ? null : Buffer.from(input.body, "utf8");
    if (body && body.length > HTTP_STUDIO_LIMITS.requestBodyBytes) throw new BadRequestException("The request body is over 512 KB.");

    const sandbox = sandboxTarget(input.url);
    const target: HttpSendTarget = sandbox ? "sandbox" : "internet";
    const failure = (code: HttpSendErrorCode, message: string): HttpSendResult => {
      this.logger.debug(`${user.id} ${roomId} ${input.method} ${target} failed: ${code}`);
      return { ok: false, target, code, message, timing: { totalMs: elapsed() } };
    };

    try {
      const headers = outgoingHeaders(input.headers, HTTP_STUDIO_LIMITS.headerBytes);
      let notice: string | undefined;
      let response: TransportResponse;
      if (sandbox) {
        if (sandbox.secure) throw new InvalidTargetError("The sandbox is reached over plain http. Use http://localhost:<port>.");
        // The runner's preview route takes Authorization for its own token and
        // drops it before the dev server, so the person's can't ride along.
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === "authorization") {
            delete headers[name];
            notice = "The Authorization header isn't passed to servers in the sandbox yet, so this request went without it. Use an API key header to test auth for now.";
          }
        }
        headers.authorization = this.runner.headers(roomId, user).authorization!;
        response = await this.viaSandbox(roomId, sandbox.port, sandbox.path, input.method, headers, body);
      } else {
        const vetted = await vetTarget(input.url, resolveAll);
        response = await transport({
          url: vetted.url,
          method: input.method,
          headers,
          body,
          address: { address: vetted.address, family: vetted.family },
          timeoutMs: Math.max(1000, HTTP_STUDIO_LIMITS.timeoutMs - elapsed()),
          maxBytes: HTTP_STUDIO_LIMITS.responseBytes,
        });
      }

      const contentType = response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
      this.logger.debug(`${user.id} ${roomId} ${input.method} ${target} ${response.status} ${response.body.length}B ${elapsed()}ms`);
      return {
        ok: true,
        target,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        ...encodeBody(response.body, contentType),
        size: response.body.length,
        truncated: response.truncated,
        timing: { totalMs: elapsed(), firstByteMs: response.firstByteMs },
        ...(notice && { notice }),
      };
    } catch (error) {
      if (error instanceof BlockedTargetError) return failure("blocked", error.message);
      if (error instanceof InvalidTargetError) return failure("invalid_request", error.message);
      if (error instanceof UnresolvedHostError) return failure("dns", error.message);
      if (error instanceof TransportError) return failure(error.code, error.message);
      throw error;
    }
  }

  private async viaSandbox(
    roomId: string,
    port: number,
    path: string,
    method: string,
    headers: Record<string, string | string[]>,
    body: Buffer | null,
  ): Promise<TransportResponse> {
    const url = new URL(sandboxRunnerPath(roomId, port, path), this.env.RUNNER_URL);
    let response: TransportResponse;
    try {
      response = await transport({ url, method, headers, body, timeoutMs: HTTP_STUDIO_LIMITS.timeoutMs, maxBytes: HTTP_STUDIO_LIMITS.responseBytes });
    } catch (error) {
      if (error instanceof TransportError && error.code === "timeout") {
        throw new TransportError("timeout", `Port ${port} in the sandbox didn't answer within ${HTTP_STUDIO_LIMITS.timeoutMs / 1000} seconds.`);
      }
      throw new TransportError(
        "sandbox_unavailable",
        "The room's sandbox isn't reachable right now. In development, keep pnpm dev running with Docker Desktop started.",
      );
    }
    // The runner answers for a port nobody listens on with its own waiting page.
    const refresh = response.headers.some(([name]) => name.toLowerCase() === "refresh");
    if (response.status === 502 && refresh && response.body.includes("Nothing is answering on port")) {
      throw new TransportError(
        "sandbox_not_listening",
        `Nothing is listening on port ${port} in this room's sandbox. Start your server (press Run or use a terminal) and check it listens on port ${port}.`,
      );
    }
    return response;
  }
}
