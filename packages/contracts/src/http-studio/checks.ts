/**
 * Response checks without code: assertions (status, JSON path, header,
 * response time, body) and extractions that copy a value from a response
 * into a variable for the next request. Evaluated in the browser.
 */

// JSON paths: $.data.items[0].id, data.items[0].id, $['odd key'], items.length

type Step = string | number;

export function parseJsonPath(input: string): Step[] | null {
  let text = input.trim();
  if (text.startsWith("$")) text = text.slice(1);
  const steps: Step[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      const end = text.indexOf("]", i);
      if (end === -1) return null;
      const inner = text.slice(i + 1, end).trim();
      if (/^\d+$/.test(inner)) steps.push(Number(inner));
      else if (/^(['"]).*\1$/.test(inner)) steps.push(inner.slice(1, -1));
      else return null;
      i = end + 1;
      continue;
    }
    // A name comes first or after a dot, never straight after "]".
    if (text[i] === ".") i++;
    else if (i !== 0) return null;
    const name = /^[^.[\]]+/.exec(text.slice(i));
    if (!name) return null;
    steps.push(name[0]);
    i += name[0].length;
  }
  return steps;
}

export function readJsonPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  const steps = parseJsonPath(path);
  if (!steps) return { found: false };
  let current: unknown = value;
  for (const step of steps) {
    if (Array.isArray(current)) {
      if (step === "length") {
        current = current.length;
        continue;
      }
      const index = typeof step === "number" ? step : /^\d+$/.test(step) ? Number(step) : Number.NaN;
      if (!(index < current.length)) return { found: false };
      current = current[index];
    } else if (typeof current === "string" && step === "length") {
      current = current.length;
    } else if (current !== null && typeof current === "object" && Object.hasOwn(current, String(step))) {
      current = (current as Record<string, unknown>)[String(step)];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

// Assertions

export const ASSERTION_KINDS = ["status", "json", "header", "time", "body"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const ASSERTION_OPS = ["equals", "notEquals", "contains", "exists", "notExists", "below", "above", "matches"] as const;
export type AssertionOp = (typeof ASSERTION_OPS)[number];

/** Which operators make sense for each kind (the first is the default). */
export const OPS_FOR_KIND: Record<AssertionKind, readonly AssertionOp[]> = {
  status: ["equals", "notEquals", "below", "above"],
  json: ["equals", "notEquals", "contains", "exists", "notExists", "below", "above", "matches"],
  header: ["exists", "notExists", "equals", "contains", "matches"],
  time: ["below"],
  body: ["contains", "equals", "matches"],
};

export type Assertion = {
  id: string;
  enabled: boolean;
  kind: AssertionKind;
  /** JSON path for "json", header name for "header"; unused otherwise. */
  target: string;
  op: AssertionOp;
  expected: string;
};

/** What checks need from a response. */
export type CheckedResponse = { status: number; headers: Array<[string, string]>; body: string; timeMs: number };

export type CheckResult = { id: string; name: string; passed: boolean; message: string };

const OP_WORDS: Record<AssertionOp, string> = {
  equals: "equals",
  notEquals: "isn't",
  contains: "contains",
  exists: "exists",
  notExists: "doesn't exist",
  below: "is below",
  above: "is above",
  matches: "matches",
};

export function describeAssertion(a: Pick<Assertion, "kind" | "target" | "op" | "expected">): string {
  const subject =
    a.kind === "status" ? "Status" : a.kind === "time" ? "Response time" : a.kind === "body" ? "Body" : a.kind === "header" ? `Header ${a.target || "(unnamed)"}` : `JSON ${a.target || "$"}`;
  const needsValue = a.op !== "exists" && a.op !== "notExists";
  return `${subject} ${OP_WORDS[a.op]}${needsValue ? ` ${a.kind === "time" ? `${a.expected} ms` : a.expected}` : ""}`;
}

const show = (value: unknown) => (value === undefined ? "nothing" : typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value));

/** Loose equality for typed-in expectations: "200" equals 200, "true" equals true, '{"a":1}' equals {a:1}. */
export function looselyEquals(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") return actual === expected || (expected.startsWith('"') && JSON.stringify(actual) === expected);
  try {
    return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected));
  } catch {
    return String(actual) === expected;
  }
}

function contains(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") return actual.includes(expected);
  if (Array.isArray(actual)) return actual.some((item) => looselyEquals(item, expected));
  if (actual && typeof actual === "object") return Object.hasOwn(actual, expected);
  return String(actual).includes(expected);
}

function compare(actual: unknown, op: AssertionOp, expected: string): boolean {
  switch (op) {
    case "equals":
      return looselyEquals(actual, expected);
    case "notEquals":
      return !looselyEquals(actual, expected);
    case "contains":
      return contains(actual, expected);
    case "below":
    case "above": {
      const a = Number(actual);
      const e = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(e) || actual === null || actual === "") return false;
      return op === "below" ? a < e : a > e;
    }
    case "matches":
      try {
        return new RegExp(expected).test(typeof actual === "string" ? actual : JSON.stringify(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function parseBody(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

export function evaluateAssertion(a: Assertion, response: CheckedResponse, json = parseBody(response.body)): CheckResult {
  const name = describeAssertion(a);
  const result = (passed: boolean, message: string): CheckResult => ({ id: a.id, name, passed, message });

  if (a.op === "matches") {
    try {
      new RegExp(a.expected);
    } catch {
      return result(false, `${a.expected} isn't a valid regular expression.`);
    }
  }
  switch (a.kind) {
    case "status":
      return result(compare(response.status, a.op, a.expected), `Status was ${response.status}.`);
    case "time":
      return result(compare(response.timeMs, "below", a.expected), `It took ${response.timeMs} ms.`);
    case "body":
      return result(compare(response.body, a.op, a.expected), a.op === "equals" ? `The body was ${response.body.length} characters.` : "");
    case "header": {
      const lower = a.target.trim().toLowerCase();
      const values = response.headers.filter(([name]) => name.toLowerCase() === lower).map(([, value]) => value);
      const exists = values.length > 0;
      if (a.op === "exists") return result(exists, exists ? `It was ${values.join(", ")}.` : "The header wasn't sent.");
      if (a.op === "notExists") return result(!exists, exists ? `It was ${values.join(", ")}.` : "");
      if (!exists) return result(false, "The header wasn't sent.");
      return result(compare(values.join(", "), a.op, a.expected), `It was ${values.join(", ")}.`);
    }
    case "json": {
      if (!json.ok) return result(false, "The body isn't JSON.");
      if (!parseJsonPath(a.target)) return result(false, `${a.target} isn't a JSON path like $.data[0].id.`);
      const found = readJsonPath(json.value, a.target);
      if (a.op === "exists") return result(found.found, found.found ? `It was ${show(found.value)}.` : "Nothing is at that path.");
      if (a.op === "notExists") return result(!found.found, found.found ? `It was ${show(found.value)}.` : "");
      if (!found.found) return result(false, "Nothing is at that path.");
      return result(compare(found.value, a.op, a.expected), `It was ${show(found.value)}.`);
    }
  }
}

// Extractions: response value -> variable

export const EXTRACT_SOURCES = ["json", "header", "status", "body"] as const;
export type ExtractSource = (typeof EXTRACT_SOURCES)[number];

export type Extraction = { id: string; enabled: boolean; variable: string; source: ExtractSource; path: string };

export function evaluateExtraction(e: Extraction, response: CheckedResponse): { variable: string; value?: string; error?: string } {
  const variable = e.variable.trim();
  if (!variable) return { variable, error: "Name the variable to set." };
  if (e.source === "status") return { variable, value: String(response.status) };
  if (e.source === "body") return { variable, value: response.body };
  if (e.source === "header") {
    const lower = e.path.trim().toLowerCase();
    const values = response.headers.filter(([name]) => name.toLowerCase() === lower).map(([, v]) => v);
    return values.length ? { variable, value: values.join(", ") } : { variable, error: `The response had no ${e.path} header.` };
  }
  const json = parseBody(response.body);
  if (!json.ok) return { variable, error: "The body isn't JSON." };
  const found = readJsonPath(json.value, e.path);
  if (!found.found) return { variable, error: `Nothing is at ${e.path || "$"}.` };
  const value = found.value;
  return { variable, value: typeof value === "string" ? value : JSON.stringify(value) };
}
