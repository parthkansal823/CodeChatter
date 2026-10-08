import {
  describeAssertion,
  evaluateAssertion,
  evaluateExtraction,
  resolveRequest,
  substituteVariables,
  type CheckedResponse,
  type CheckResult,
  type HttpSendResult,
} from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import type * as Y from "yjs";

import { api, ApiError } from "@/lib/api";

import { getSelectedEnvironment, getValues, patchValues, recordHistory, variableLookup } from "./local-store";
import { readEnvironments, readRequest } from "./model";

export type ExtractedValue = { variable: string; value?: string; error?: string };

/** What the response pane shows for one request: everything that happened on the last send. */
export type RunState = {
  phase: "sending" | "done";
  startedAt: number;
  finishedAt: number;
  /** The API's answer: a response, or the reason there wasn't one. */
  result: HttpSendResult | null;
  /** The send itself didn't happen (permission, rate limit, bad request, offline). */
  problem: string | null;
  /** Things to know that didn't stop the send, like variables with no value. */
  warnings: string[];
  /** The URL as sent, with variables filled in. */
  sentUrl: string;
  checks: CheckResult[];
  extracted: ExtractedValue[];
};

export const SENDING: RunState = {
  phase: "sending",
  startedAt: 0,
  finishedAt: 0,
  result: null,
  problem: null,
  warnings: [],
  sentUrl: "",
  checks: [],
  extracted: [],
};

export type ExecuteOptions = {
  doc: Y.Doc;
  roomId: string;
  userId: string;
  requestId: string;
  signal?: AbortSignal;
};

function problemFrom(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Cancelled.";
  if (error instanceof ApiError) {
    if (error.status === 403) return "You can look at this room but not send requests. Ask the owner for run access.";
    if (error.status === 400 && error.errors?.length) return error.errors.map((e) => e.message).join(" ");
    return error.detail;
  }
  return "Couldn't reach the CodeChatter server. Check your connection and send again.";
}

/** The response as the checks see it (binary bodies have no text to check). */
export function checkedResponse(result: Extract<HttpSendResult, { ok: true }>): CheckedResponse {
  return { status: result.status, headers: result.headers, body: result.bodyEncoding === "text" ? result.body : "", timeMs: result.timing.totalMs };
}

/**
 * One send, start to finish. Everything is read fresh from the shared
 * document and local storage, so a collection run sees the variables the
 * previous request just set.
 */
export async function execute({ doc, roomId, userId, requestId, signal }: ExecuteOptions): Promise<RunState> {
  const startedAt = Date.now();
  const done = (patch: Partial<RunState>): RunState => ({ ...SENDING, phase: "done", startedAt, finishedAt: Date.now(), ...patch });

  const request = readRequest(doc, requestId);
  if (!request) return done({ problem: "This request was deleted." });

  const selected = getSelectedEnvironment(roomId, userId);
  const env = readEnvironments(doc).find((e) => e.id === selected) ?? null;
  const envKey = env?.id ?? "";
  const lookup = variableLookup(env, getValues(roomId, userId, envKey));

  const missingInUrl = substituteVariables(request.url, lookup).missing;
  if (missingInUrl.length) {
    const names = missingInUrl.map((n) => `{{${n}}}`).join(", ");
    return done({ problem: `${names} ${missingInUrl.length > 1 ? "have" : "has"} no value. Pick an environment, or add ${missingInUrl.length > 1 ? "them" : "it"} under Environments.` });
  }
  const resolved = resolveRequest(request, lookup);
  if (resolved.problems.length) return done({ problem: resolved.problems.join(" ") });
  const warnings = resolved.missing.length ? [`No value for ${resolved.missing.map((n) => `{{${n}}}`).join(", ")}. They were sent as written.`] : [];

  let result: HttpSendResult;
  try {
    result = await api<HttpSendResult>(`/api/rooms/${roomId}/http/send`, { method: "POST", json: resolved.input, ...(signal && { signal }) });
  } catch (error) {
    const problem = problemFrom(error);
    recordHistory(roomId, userId, {
      id: randomId(),
      at: Date.now(),
      requestId,
      name: request.name,
      method: request.method,
      url: request.url,
      status: null,
      error: problem,
      timeMs: Date.now() - startedAt,
      size: 0,
    });
    return done({ problem, warnings, sentUrl: resolved.input.url });
  }

  let checks: CheckResult[];
  let extracted: ExtractedValue[] = [];
  if (result.ok) {
    const checked = checkedResponse(result);
    checks = request.assertions.filter((a) => a.enabled).map((a) => evaluateAssertion(a, checked));
    extracted = request.extracts.filter((e) => e.enabled).map((e) => evaluateExtraction(e, checked));
    const changes: Record<string, string> = {};
    for (const item of extracted) if (item.value !== undefined) changes[item.variable] = item.value;
    if (Object.keys(changes).length) patchValues(roomId, userId, envKey, changes);
  } else {
    checks = request.assertions.filter((a) => a.enabled).map((a) => ({ id: a.id, name: describeAssertion(a), passed: false, message: "The request got no response." }));
  }

  recordHistory(roomId, userId, {
    id: randomId(),
    at: Date.now(),
    requestId,
    name: request.name,
    method: request.method,
    url: request.url,
    status: result.ok ? result.status : null,
    error: result.ok ? null : result.message,
    timeMs: result.timing.totalMs,
    size: result.ok ? result.size : 0,
  });

  return done({ result, warnings, sentUrl: resolved.input.url, checks, extracted });
}
