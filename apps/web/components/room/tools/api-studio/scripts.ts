/**
 * API Studio's scripts, as Postman has them: one runs before a request is sent (it can set variables and change the request), one after the response (its
 * pm.test results join the Tests tab's). What goes into a script and what comes out; script-sandbox.ts runs them, execute.ts uses them.
 */
import { HTTP_METHODS, type CheckResult, type HttpMethod, type HttpResponseData, type HttpSendInput } from "@codechatter/contracts";

import type { RequestData } from "./model";

export type ScriptKind = "pre" | "test";
export type ScriptRequest = { method: string; url: string; headers: Array<{ key: string; value: string }>; body: string | null };
export type ScriptResponse = { status: number; statusText: string; timeMs: number; size: number; headers: Array<[string, string]>; body: string };
export type ScriptInput = { kind: ScriptKind; name: string; variables: Record<string, string>; request: ScriptRequest; response?: ScriptResponse };
export type ScriptLog = { level: "log" | "info" | "warn" | "error"; text: string };
/** What a script did. `error` is why it stopped, with its line in the script when that's known. */
export type ScriptResult = {
  tests: Array<{ name: string; passed: boolean; error?: string }>;
  logs: ScriptLog[];
  /** Variables it set (a value) or unset (null). */
  variables: Record<string, string | null>;
  error?: string;
  line?: number;
  /** A pre-request script's request, as it left it. */
  request?: ScriptRequest;
};
/** A log line, and which script said it. */
export type RunLog = ScriptLog & { when: "before" | "after" };

const MOST_LOGS = 200;
const MOST_TESTS = 200;
const MOST_TEXT = 2000;

/** The request as a pre-request script sees it: as written, variables still as {{name}}, the body when it's text. */
export function scriptRequestOf(request: RequestData): ScriptRequest {
  const textBody = request.body.mode === "json" || request.body.mode === "text";
  return { method: request.method, url: request.url, headers: request.headers.filter((row) => row.enabled && row.key).map((row) => ({ key: row.key, value: row.value })), body: textBody ? request.body.text : null };
}

/** The request as sent, for a test script. */
export function sentRequestOf(input: HttpSendInput): ScriptRequest {
  return { method: input.method, url: input.url, headers: input.headers.map((header) => ({ key: header.name, value: header.value })), body: input.body };
}

/** The response as a test script sees it: a binary body has no text. */
export function scriptResponseOf(result: HttpResponseData): ScriptResponse {
  return { status: result.status, statusText: result.statusText, timeMs: result.timing.totalMs, size: result.size, headers: result.headers, body: result.bodyEncoding === "text" ? result.body : "" };
}

/**
 * The request to send after a pre-request script: its method, address and headers as the script left them, and its body when the body is text. Nothing
 * changes in the shared request: a script's changes are for this send only, as in Postman.
 */
export function withScriptRequest(request: RequestData, changed: ScriptRequest | undefined): RequestData {
  if (!changed) return request;
  const method = String(changed.method).toUpperCase();
  const textBody = request.body.mode === "json" || request.body.mode === "text";
  return {
    ...request,
    method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : request.method,
    url: typeof changed.url === "string" ? changed.url : String(changed.url ?? request.url),
    headers: (Array.isArray(changed.headers) ? changed.headers : []).slice(0, 100).map((header, index) => ({ id: `script-${index}`, key: String(header.key), value: String(header.value), enabled: true })),
    body: textBody && typeof changed.body === "string" ? { ...request.body, text: changed.body } : request.body,
  };
}

/** A script's tests as the Tests tab shows them, and a failed one for a script that stopped. */
export function checksOf(result: ScriptResult, when: "before" | "after"): CheckResult[] {
  const checks: CheckResult[] = result.tests.slice(0, MOST_TESTS).map((test, index) => ({ id: `${when}-script-${index}`, name: clip(test.name) || "A test", passed: test.passed, message: clip(test.error ?? "") }));
  if (result.error) checks.push({ id: `${when}-script-error`, name: when === "before" ? "The script before sending" : "The script after the response", passed: false, message: stoppedBecause(result) });
  return checks;
}

/** Why a script stopped, with its line when that's known. */
export function stoppedBecause(result: Pick<ScriptResult, "error" | "line">): string {
  return `It stopped${result.line ? ` at line ${result.line}` : ""}: ${clip(result.error ?? "")}`;
}

export function logsOf(result: ScriptResult, when: "before" | "after"): RunLog[] {
  return result.logs.slice(0, MOST_LOGS).map((log) => ({ level: (["log", "info", "warn", "error"] as const).includes(log.level) ? log.level : "log", text: clip(log.text), when }));
}

/** What the worker sent back, made safe to use: it's someone's script's doing, so nothing in it is trusted to be the right shape. */
export function readResult(raw: unknown, userLine: number): ScriptResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (value.timedOut) return { tests: [], logs: [], variables: {}, error: "It took longer than 5 seconds, so it was stopped. A loop that never ends?" };
  const lineOf = (line: unknown) => (typeof line === "number" && line >= userLine ? line - userLine + 1 : undefined);
  if (typeof value.failed === "string") return { tests: [], logs: [], variables: {}, error: value.failed.replace(/^Uncaught /, ""), line: lineOf(value.line) };
  const tests = Array.isArray(value.tests) ? value.tests.map((test: Record<string, unknown>) => ({ name: String(test?.name ?? ""), passed: test?.passed === true, ...(test?.error !== undefined && { error: String(test.error) }) })) : [];
  const logs = Array.isArray(value.logs) ? value.logs.map((log: Record<string, unknown>) => ({ level: String(log?.level ?? "log") as ScriptLog["level"], text: String(log?.text ?? "") })) : [];
  const variables: Record<string, string | null> = {};
  if (value.variables && typeof value.variables === "object")
    for (const [name, set] of Object.entries(value.variables as Record<string, unknown>).slice(0, 200)) if (name && name.length <= 200) variables[name] = set === null ? null : String(set).slice(0, 100_000);
  const request = value.request && typeof value.request === "object" ? (value.request as ScriptRequest) : undefined;
  return { tests, logs, variables, ...(typeof value.error === "string" && { error: value.error, line: lineOf(value.errorLine) }), ...(request && { request }) };
}

const clip = (text: string) => (text.length > MOST_TEXT ? `${text.slice(0, MOST_TEXT)}…` : text);
