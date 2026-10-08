import { signServiceToken } from "@codechatter/auth/service-token";
import type { JudgeInput, RunnerEvent, RunSnapshot, SandboxStatus } from "@codechatter/contracts";
import { Inject, Injectable } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";

export type RunnerUser = { id: string; name: string };

export class RunnerUnavailableError extends Error {
  constructor() {
    super("Run isn't available right now: the runner service isn't reachable. In development, keep `pnpm dev` running with Docker Desktop started.");
  }
}

/**
 * The API's client for apps/runner. The runner trusts nothing from browsers:
 * every call carries a 60-second service token for one room and one person,
 * minted here after the API has checked that person's room permissions.
 */
@Injectable()
export class RunnerClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  headers(roomId: string, user: RunnerUser): Record<string, string> {
    const token = signServiceToken(this.env.SERVICE_SECRET, { aud: "runner", sub: roomId, uid: user.id, name: user.name });
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }

  terminalUrl(roomId: string, session: string, cols: number, rows: number): string {
    const url = new URL(`/rooms/${roomId}/terminal`, this.env.RUNNER_URL.replace(/^http/, "ws"));
    url.search = new URLSearchParams({ session, cols: String(cols), rows: String(rows) }).toString();
    return url.toString();
  }

  /** Start a run; yields the runner's events until the run exits. */
  async *start(roomId: string, user: RunnerUser, body: { path: string; stateVector: string }): AsyncGenerator<RunnerEvent> {
    const response = await this.call(`/rooms/${roomId}/runs`, { method: "POST", headers: this.headers(roomId, user), body: JSON.stringify(body) });
    if (!response.ok || !response.body) throw new RunnerUnavailableError();
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim()) yield JSON.parse(line) as RunnerEvent;
      }
    }
  }

  async stop(roomId: string, user: RunnerUser): Promise<void> {
    await this.call(`/rooms/${roomId}/runs/stop`, { method: "POST", headers: this.headers(roomId, user), body: "{}" });
  }

  async input(roomId: string, user: RunnerUser, runId: string, data: string): Promise<boolean> {
    const response = await this.call(`/rooms/${roomId}/runs/input`, {
      method: "POST",
      headers: this.headers(roomId, user),
      body: JSON.stringify({ runId, data }),
    });
    return response.ok;
  }

  async snapshot(roomId: string, user: RunnerUser): Promise<RunSnapshot> {
    const response = await this.call(`/rooms/${roomId}/runs/current`, { headers: this.headers(roomId, user) });
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as RunSnapshot;
  }

  /** Run test cases; the response body streams NDJSON JudgeEvents. */
  async judge(roomId: string, user: RunnerUser, input: JudgeInput): Promise<AsyncIterable<Uint8Array>> {
    const response = await this.call(`/rooms/${roomId}/judge`, { method: "POST", headers: this.headers(roomId, user), body: JSON.stringify(input) });
    if (!response.ok || !response.body) throw new RunnerUnavailableError();
    return response.body as unknown as AsyncIterable<Uint8Array>;
  }

  async status(roomId: string, user: RunnerUser): Promise<SandboxStatus> {
    const response = await this.call(`/rooms/${roomId}/sandbox`, { headers: this.headers(roomId, user) });
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as SandboxStatus;
  }

  async restart(roomId: string, user: RunnerUser): Promise<void> {
    const response = await this.call(`/rooms/${roomId}/sandbox/restart`, { method: "POST", headers: this.headers(roomId, user), body: "{}" });
    if (!response.ok) throw new RunnerUnavailableError();
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.env.RUNNER_URL), init);
    } catch {
      throw new RunnerUnavailableError();
    }
  }
}
