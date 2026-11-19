import {
  describeAssertion,
  evaluateAssertion,
  evaluateExtraction,
  resolveRequest,
  substituteVariables,
  HttpSendInput,
  type CheckedResponse,
  type CheckResult,
  type HttpSendResult,
} from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import type * as Y from "yjs";

import { api, ApiError } from "@/lib/api";

import { getCookieJar, getSelectedEnvironment, getValues, patchValues, recordHistory, setCookieJar, variableLookup, variableSnapshot } from "./local-store";
import { applySetCookies, redactCookieValues, requestCookies, type CookieChange } from "./cookies";
import { readEnvironments, readRequest } from "./model";
import { runScript } from "./script-sandbox";
import type { CookieScriptInput } from "./script-worker-source";
import { checksOf, logsOf, scriptRequestOf, scriptResponseOf, sentRequestOf, stoppedBecause, withScriptRequest, type RunLog } from "./scripts";

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
  /** What the request's scripts logged (console.log and the rest). */
  logs: RunLog[];
  /** Local response metadata only: never persisted in history or the shared collection. */
  cookieChanges: CookieChange[];
  cookieSensitive: boolean;
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
  logs: [],
  cookieChanges: [],
  cookieSensitive: false,
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

/** Also protect manual duplicate names and malformed Set-Cookie fields that the jar correctly refuses. */
function privateCookieValues(headers: ReadonlyArray<readonly [string, string]>): string[] {
  return headers.flatMap(([name, value]) => {
    const key = name.toLowerCase();
    if (key !== "cookie" && key !== "set-cookie") return [];
    const pairs = key === "set-cookie" ? [value.split(";")[0] ?? ""] : value.split(";");
    return pairs.flatMap((pair) => { const at = pair.indexOf("="); return at < 0 ? [] : [pair.slice(at + 1).trim()]; });
  }).filter(Boolean);
}

/**
 * One send, start to finish. Everything is read fresh from the shared
 * document and local storage, so a collection run sees the variables the
 * previous request just set.
 */
export async function execute({ doc, roomId, userId, requestId, signal }: ExecuteOptions): Promise<RunState> {
  const startedAt = Date.now();
  const cookieSecrets: string[] = [];
  const safe = (text: string) => redactCookieValues(text, cookieSecrets);
  const done = (patch: Partial<RunState>): RunState => {
    const state: RunState = { ...SENDING, phase: "done", startedAt, finishedAt: Date.now(), ...patch };
    return { ...state, problem: state.problem === null ? null : safe(state.problem), warnings: state.warnings.map(safe),
      logs: state.logs.map((log) => ({ ...log, text: safe(log.text) })),
      checks: state.checks.map((check) => ({ ...check, name: safe(check.name), message: safe(check.message) })), sentUrl: safe(state.sentUrl) };
  };

  const written = readRequest(doc, requestId);
  if (!written) return done({ problem: "This request was deleted." });
  const useCookieJar = written.useCookieJar !== false;

  const selected = getSelectedEnvironment(roomId, userId);
  const env = readEnvironments(doc).find((e) => e.id === selected) ?? null;
  const envKey = env?.id ?? "";
  const initialJar = getCookieJar(roomId, userId, envKey);
  let cookieSensitive = useCookieJar && initialJar.length > 0;
  cookieSecrets.push(...initialJar.map((cookie) => cookie.value));
  const logs: RunLog[] = [];
  const scriptChecks: CheckResult[] = [];

  // The script before sending: it can set variables, and change this send's request (as Postman's pre-request script does).
  let request = written;
  if (written.preScript.trim()) {
    const initial = resolveRequest(written, variableLookup(env, getValues(roomId, userId, envKey)));
    cookieSecrets.push(...privateCookieValues(initial.input.headers.map((header) => [header.name, header.value])));
    cookieSensitive ||= initial.input.headers.some((header) => header.name.toLowerCase() === "cookie");
    const input: CookieScriptInput = { kind: "pre", name: written.name, variables: variableSnapshot(env, getValues(roomId, userId, envKey)), request: scriptRequestOf(written),
      cookieJar: initialJar, useCookieJar, cookieSecrets,
      ...(written.auth.type === "apiKey" && written.auth.in === "header" && { cookieAuth: { key: written.auth.key, value: written.auth.value } }) };
    const ran = await runScript(written.preScript, input);
    logs.push(...logsOf(ran, "before"));
    if (Object.keys(ran.variables).length) patchValues(roomId, userId, envKey, ran.variables);
    if (ran.error) return done({ problem: `The script before sending ${stoppedBecause(ran).replace(/^It /, "")}`, logs });
    scriptChecks.push(...checksOf(ran, "before"));
    request = withScriptRequest(written, ran.request);
  }
  if (signal?.aborted) return done({ problem: "Cancelled.", logs });
  const lookup = variableLookup(env, getValues(roomId, userId, envKey));

  const missingInUrl = substituteVariables(request.url, lookup).missing;
  if (missingInUrl.length) {
    const names = missingInUrl.map((n) => `{{${n}}}`).join(", ");
    return done({ problem: `${names} ${missingInUrl.length > 1 ? "have" : "has"} no value. Pick an environment, or add ${missingInUrl.length > 1 ? "them" : "it"} under Environments.`, logs });
  }
  const resolved = resolveRequest(request, lookup);
  if (resolved.problems.length) return done({ problem: resolved.problems.join(" "), logs });
  const warnings = resolved.missing.length ? [`No value for ${resolved.missing.map((n) => `{{${n}}}`).join(", ")}. They were sent as written.`] : [];
  const sendingJar = getCookieJar(roomId, userId, envKey);
  const selectedCookies = requestCookies(sendingJar, resolved.input.url, resolved.input.headers, useCookieJar);
  cookieSecrets.push(...sendingJar.map((cookie) => cookie.value), ...Object.values(selectedCookies.cookies));
  if (selectedCookies.warning) warnings.push(selectedCookies.warning);
  const wire = { ...resolved.input, headers: selectedCookies.headers };
  cookieSecrets.push(...privateCookieValues(wire.headers.map((header) => [header.name, header.value])));
  const validWire = HttpSendInput.safeParse(wire);
  if (!validWire.success) return done({ problem: `${validWire.error.issues.map((issue) => issue.message).join(" ")} Check the request and headers, or reduce the cookie jar.`, warnings, logs });
  cookieSensitive ||= (useCookieJar && sendingJar.length > 0) || wire.headers.some((header) => header.name.toLowerCase() === "cookie");

  let result: HttpSendResult;
  try {
    result = await api<HttpSendResult>(`/api/rooms/${roomId}/http/send`, { method: "POST", json: wire, ...(signal && { signal }) });
  } catch (error) {
    const problem = problemFrom(error);
    recordHistory(roomId, userId, {
      id: randomId(),
      at: Date.now(),
      requestId,
      name: safe(request.name),
      method: request.method,
      url: safe(request.url),
      status: null,
      error: safe(problem),
      timeMs: Date.now() - startedAt,
      size: 0,
    });
    return done({ problem, warnings, sentUrl: resolved.input.url, logs });
  }

  let checks: CheckResult[];
  let cookieChanges: CookieChange[] = [];
  let extracted: ExtractedValue[] = [];
  if (result.ok) {
    cookieSecrets.push(...privateCookieValues(result.headers));
    const received = applySetCookies(getCookieJar(roomId, userId, envKey), result.headers, wire.url);
    cookieChanges = received.changes;
    cookieSecrets.push(...received.changes.map(({ cookie }) => cookie.value));
    warnings.push(...received.warnings);
    if (useCookieJar) setCookieJar(roomId, userId, envKey, received.jar);
    const checked = checkedResponse(result);
    checks = request.assertions.filter((a) => a.enabled).map((a) => evaluateAssertion(a, checked));
    extracted = request.extracts.filter((e) => e.enabled).map((e) => evaluateExtraction(e, checked));
    const changes: Record<string, string> = {};
    for (const item of extracted) if (item.value !== undefined) changes[item.variable] = item.value;
    if (Object.keys(changes).length) patchValues(roomId, userId, envKey, changes);
    // The script after the response: its pm.test results join the checks, and it can set variables for the next request.
    if (request.testScript.trim()) {
      const input: CookieScriptInput = {
        kind: "test",
        name: request.name,
        variables: variableSnapshot(env, getValues(roomId, userId, envKey)),
        request: sentRequestOf(wire),
        response: scriptResponseOf(result),
        cookieJar: sendingJar, useCookieJar, cookieSecrets,
      };
      const ran = await runScript(request.testScript, input);
      logs.push(...logsOf(ran, "after"));
      if (Object.keys(ran.variables).length) patchValues(roomId, userId, envKey, ran.variables);
      checks.push(...checksOf(ran, "after"));
    }
  } else {
    checks = request.assertions.filter((a) => a.enabled).map((a) => ({ id: a.id, name: describeAssertion(a), passed: false, message: "The request got no response." }));
    if (request.testScript.trim()) checks.push({ id: "after-script-error", name: "The script after the response", passed: false, message: "It didn't run: the request got no response." });
  }
  checks = [...scriptChecks, ...checks];

  recordHistory(roomId, userId, {
    id: randomId(),
    at: Date.now(),
    requestId,
    name: safe(request.name),
    method: request.method,
    url: safe(request.url),
    status: result.ok ? result.status : null,
    error: result.ok ? null : safe(result.message),
    timeMs: result.timing.totalMs,
    size: result.ok ? result.size : 0,
  });

  return done({ result, warnings, sentUrl: wire.url, checks, extracted, logs, cookieChanges,
    cookieSensitive: cookieSensitive || (result.ok && result.headers.some(([name]) => name.toLowerCase() === "set-cookie")) });
}
