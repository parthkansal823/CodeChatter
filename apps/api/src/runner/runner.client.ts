import { signServiceToken } from "@codechatter/auth/service-token";
import type { DatabaseKind, DatabaseStatus, DevServerStatus, JudgeInput, KubeRequest, KubeResponse, RoomCheck, RunnerEvent, RunSnapshot, SandboxStatus } from "@codechatter/contracts";
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

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
  /** Each room's sandbox image, as its settings say (RoomsService notes it on every check of a room). */
  private readonly images = new Map<string, "base" | "full" | "default">();

  constructor(@Inject(ENV) private readonly env: Env) {}

  noteImage(roomId: string, image: "base" | "full" | "default"): void {
    this.images.set(roomId, image);
  }

  headers(roomId: string, user: RunnerUser): Record<string, string> {
    // The room's image goes with every call: the runner starts its sandbox from it.
    const token = signServiceToken(this.env.SERVICE_SECRET, { aud: "runner", sub: roomId, uid: user.id, name: user.name, img: this.images.get(roomId) });
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }

  terminalUrl(roomId: string, session: string, cols: number, rows: number): string {
    const url = new URL(`/rooms/${roomId}/terminal`, this.env.RUNNER_URL.replace(/^http/, "ws"));
    url.search = new URLSearchParams({ session, cols: String(cols), rows: String(rows) }).toString();
    return url.toString();
  }

  /** A language server for one editor (the runner's lsp.ts). */
  lspUrl(roomId: string, language: string): string {
    const url = new URL(`/rooms/${roomId}/lsp`, this.env.RUNNER_URL.replace(/^http/, "ws"));
    url.searchParams.set("language", language);
    return url.toString();
  }

  /** The room's shared debug session; `drive` lets this person start, step and evaluate. */
  debugUrl(roomId: string, drive: boolean): string {
    const url = new URL(`/rooms/${roomId}/debug`, this.env.RUNNER_URL.replace(/^http/, "ws"));
    url.searchParams.set("mode", drive ? "drive" : "watch");
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

  /** Let the room's sandbox reach package registries for `minutes` (ADR 0007). */
  async allowInstalls(roomId: string, user: RunnerUser, minutes: number): Promise<NonNullable<SandboxStatus["installs"]>> {
    const response = await this.call(`/rooms/${roomId}/sandbox/installs`, { method: "PUT", headers: this.headers(roomId, user), body: JSON.stringify({ minutes }) });
    // The runner explains a proxy that can't start; pass that on.
    if (response.status === 503) throw new ServiceUnavailableException(((await response.json().catch(() => ({}))) as { error?: string }).error);
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as NonNullable<SandboxStatus["installs"]>;
  }

  /** The room's databases, with their connections (the caller decides who sees those). */
  async databases(roomId: string, user: RunnerUser): Promise<DatabaseStatus[]> {
    const response = await this.call(`/rooms/${roomId}/databases`, { headers: this.headers(roomId, user) });
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as DatabaseStatus[];
  }

  /** Start, stop, reset or delete one of the room's databases; answers with all of them. */
  async changeDatabase(roomId: string, user: RunnerUser, kind: DatabaseKind, change: "start" | "stop" | "reset" | "delete"): Promise<DatabaseStatus[]> {
    const path = `/rooms/${roomId}/databases/${kind}${change === "stop" || change === "reset" ? `/${change}` : ""}`;
    const response = await this.call(path, { method: change === "delete" ? "DELETE" : "POST", headers: this.headers(roomId, user), ...(change !== "delete" && { body: "{}" }) });
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as DatabaseStatus[];
  }

  /**
   * The query console and table browser for one database. A database that
   * isn't running, or a request it can't take, comes back as the runner's own
   * words.
   */
  async databaseTool<T>(roomId: string, user: RunnerUser, kind: DatabaseKind, action: "query" | "tables" | "preview", body?: unknown): Promise<T> {
    const response = await this.call(`/rooms/${roomId}/databases/${kind}/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: this.headers(roomId, user),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (response.status === 400 || response.status === 409) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw response.status === 400 ? new BadRequestException(message) : new ConflictException(message);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as T;
  }

  /**
   * Backups out and files in, streamed: the runner's own response, or what
   * went wrong in its words.
   */
  async databaseStream(roomId: string, user: RunnerUser, kind: DatabaseKind, action: string, init: RequestInit & { duplex?: "half" }): Promise<Response> {
    const response = await this.call(`/rooms/${roomId}/databases/${kind}/${action}`, { ...init, headers: { ...this.headers(roomId, user), ...(init.headers as Record<string, string>) } });
    if ([400, 404, 409, 411, 413].includes(response.status)) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw new HttpException(message ?? "The database couldn't do that.", response.status);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return response;
  }

  /** The dev server from .codechatter/room.json: its status (GET), (re)start it (POST) or stop it (DELETE). */
  async dev(roomId: string, user: RunnerUser, method: "GET" | "POST" | "DELETE"): Promise<DevServerStatus> {
    const response = await this.call(`/rooms/${roomId}/dev`, { method, headers: this.headers(roomId, user), ...(method === "POST" && { body: "{}" }) });
    if (response.status === 409) throw new ConflictException(((await response.json().catch(() => ({}))) as { error?: string }).error);
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as DevServerStatus;
  }

  /**
   * A notebook's kernel: run cells, interrupt, restart or shut down. Answers with the
   * kernel's status; the cells' outputs arrive in the room's files document.
   */
  async notebook(roomId: string, user: RunnerUser, fileId: string, action: "run" | "interrupt" | "restart" | "shutdown", body: object = {}): Promise<unknown> {
    const response = await this.call(`/rooms/${roomId}/notebooks/${fileId}/${action}`, { method: "POST", headers: this.headers(roomId, user), body: JSON.stringify(body) });
    if (response.status === 400 || response.status === 409) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw response.status === 400 ? new BadRequestException(message) : new ConflictException(message);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return response.json();
  }

  /** A file's text through its language's formatter in the sandbox; a formatter's refusal comes back in its words. */
  async format(roomId: string, user: RunnerUser, body: { path: string; language: string; text: string; tabSize: number; insertSpaces: boolean }): Promise<{ text: string }> {
    const response = await this.call(`/rooms/${roomId}/format`, { method: "POST", headers: this.headers(roomId, user), body: JSON.stringify(body) });
    if (response.status === 400 || response.status === 409) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw response.status === 400 ? new BadRequestException(message) : new ConflictException(message);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as { text: string };
  }

  /** The room's SQLite or DuckDB files (runner: sqlite.ts, duckdb.ts): the list, or a file's tables, a query or a table's first rows. */
  async fileDatabase<T>(engine: "sqlite" | "duckdb", roomId: string, user: RunnerUser, action: "files" | "tables" | "query" | "preview", body?: unknown): Promise<T> {
    const response = await this.call(`/rooms/${roomId}/${engine}${action === "files" ? "" : `/${action}`}`, {
      method: body === undefined ? "GET" : "POST",
      headers: this.headers(roomId, user),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (response.status === 400 || response.status === 409) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw response.status === 400 ? new BadRequestException(message) : new ConflictException(message);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as T;
  }

  /** A SQLite file's backup or load, streamed as for the servers' (`action` carries its query string). */
  async sqliteStream(roomId: string, user: RunnerUser, action: string, init: RequestInit & { duplex?: "half" }): Promise<Response> {
    const response = await this.call(`/rooms/${roomId}/sqlite/${action}`, { ...init, headers: { ...this.headers(roomId, user), ...(init.headers as Record<string, string>) } });
    if ([400, 404, 409, 411, 413].includes(response.status)) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw new HttpException(message ?? "SQLite couldn't do that.", response.status);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return response;
  }

  /** Check the whole room with the project-wide checkers in its sandbox (runner: check.ts). */
  async check(roomId: string, user: RunnerUser): Promise<RoomCheck> {
    const response = await this.call(`/rooms/${roomId}/check`, { method: "POST", headers: this.headers(roomId, user), body: "{}" });
    if (response.status === 409) throw new ConflictException(((await response.json().catch(() => ({}))) as { error?: string }).error);
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as RoomCheck;
  }

  /** The Kubernetes panel's requests, to the playground in the room's sandbox (runner: kube.ts). */
  async kube(roomId: string, user: RunnerUser, body: KubeRequest): Promise<KubeResponse> {
    const response = await this.call(`/rooms/${roomId}/kube`, { method: "POST", headers: this.headers(roomId, user), body: JSON.stringify(body) });
    if (response.status === 400 || response.status === 409) {
      const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      throw response.status === 400 ? new BadRequestException(message) : new ConflictException(message);
    }
    if (!response.ok) throw new RunnerUnavailableError();
    return (await response.json()) as KubeResponse;
  }

  /** The room was deleted: the runner removes its containers, volumes and network. */
  async destroyRoom(roomId: string, user: RunnerUser): Promise<void> {
    const response = await this.call(`/rooms/${roomId}`, { method: "DELETE", headers: this.headers(roomId, user) });
    if (!response.ok) throw new RunnerUnavailableError();
  }

  /** Housekeeping: the rooms that exist, so the runner removes what's left of any others. Answers with the rooms it cleared. */
  async prune(rooms: string[]): Promise<string[]> {
    const token = signServiceToken(this.env.SERVICE_SECRET, { aud: "runner", sub: "maintenance" });
    const response = await this.call("/maintenance/prune", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ rooms }),
    });
    if (!response.ok) throw new RunnerUnavailableError();
    return ((await response.json()) as { removed: string[] }).removed;
  }

  async stopInstalls(roomId: string, user: RunnerUser): Promise<void> {
    const response = await this.call(`/rooms/${roomId}/sandbox/installs`, { method: "DELETE", headers: this.headers(roomId, user) });
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
