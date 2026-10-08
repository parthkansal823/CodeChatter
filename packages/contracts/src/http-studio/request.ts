import type { HttpHeaderInput, HttpMethod, HttpSendInput } from "./send.js";

// The request model (stored in the room's Yjs `api` document)

export type KeyValue = { key: string; value: string; enabled: boolean };

export const BODY_MODES = ["none", "json", "text", "form", "graphql"] as const;
export type BodyMode = (typeof BODY_MODES)[number];

/** Every mode's fields are kept, so switching modes back and forth loses nothing. */
export type RequestBody = { mode: BodyMode; text: string; form: KeyValue[]; query: string; variables: string };

export const AUTH_TYPES = ["none", "bearer", "basic", "apiKey"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export type RequestAuth = {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  /** API key name and value, sent as a header or a query parameter. */
  key: string;
  value: string;
  in: "header" | "query";
};

/** What resolution needs. Enabled query parameters live in the URL itself. */
export type RequestSpec = { method: HttpMethod; url: string; headers: KeyValue[]; body: RequestBody; auth: RequestAuth };

export const emptyBody = (): RequestBody => ({ mode: "none", text: "", form: [], query: "", variables: "" });
export const emptyAuth = (): RequestAuth => ({ type: "none", token: "", username: "", password: "", key: "", value: "", in: "header" });

// ---------------------------------------------------------------------------
// Variables: {{name}}

const VARIABLE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export type VariableLookup = (name: string) => string | undefined;

/** Postman-style dynamic values, fresh on every send. */
function dynamicVariable(name: string): string | undefined {
  switch (name) {
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomUUID":
    case "$guid":
      return crypto.randomUUID();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1001));
    default:
      return undefined;
  }
}

/**
 * Replace every {{name}} in one pass. Values are not substituted again, so a
 * value that happens to contain braces is sent as written. Unknown names stay
 * as they are and are reported, so the UI can point at them.
 */
export function substituteVariables(text: string, lookup: VariableLookup): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(VARIABLE, (whole, name: string) => {
    const value = lookup(name) ?? dynamicVariable(name);
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}

/** Text split into plain runs and {{variable}} runs, for highlighting. */
export function splitVariables(text: string): Array<{ text: string; name?: string }> {
  const parts: Array<{ text: string; name?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], name: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export const isDynamicVariable = (name: string) => dynamicVariable(name) !== undefined;

// ---------------------------------------------------------------------------
// Query string <-> parameter rows (kept raw: {{vars}} and encoding stay as typed)

function splitUrl(url: string): { base: string; query: string | null; hash: string } {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const rest = hashAt === -1 ? url : url.slice(0, hashAt);
  const q = rest.indexOf("?");
  return q === -1 ? { base: rest, query: null, hash } : { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
}

export function parseQuery(url: string): KeyValue[] {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? { key: pair, value: "", enabled: true } : { key: pair.slice(0, eq), value: pair.slice(eq + 1), enabled: true };
    });
}

/** The URL with its query replaced by the enabled rows. */
export function withQuery(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const pairs = params.filter((p) => p.enabled && (p.key !== "" || p.value !== "")).map((p) => (p.value === "" && p.key !== "" ? p.key : `${p.key}=${p.value}`));
  return `${base}${pairs.length ? `?${pairs.join("&")}` : ""}${hash}`;
}

function appendQuery(url: string, key: string, value: string): string {
  const { base, query, hash } = splitUrl(url);
  const pair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return `${base}?${query ? `${query}&` : ""}${pair}${hash}`;
}

// ---------------------------------------------------------------------------
// Resolution: model + variables -> the request the API sends

function base64Utf8(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type ResolvedRequest = {
  input: HttpSendInput;
  /** Variables that had no value (left as {{name}}). */
  missing: string[];
  /** Reasons the request can't be sent as it is. */
  problems: string[];
};

export function resolveRequest(spec: RequestSpec, lookup: VariableLookup): ResolvedRequest {
  const missing = new Set<string>();
  const problems: string[] = [];
  const sub = (text: string) => {
    const result = substituteVariables(text, lookup);
    for (const name of result.missing) missing.add(name);
    return result.text;
  };

  let url = sub(spec.url).trim();
  // Like Postman and curl: a bare host means http.
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;

  const headers: HttpHeaderInput[] = [];
  const setHeader = (name: string, value: string) => {
    const lower = name.toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) if (headers[i]!.name.toLowerCase() === lower) headers.splice(i, 1);
    headers.push({ name, value });
  };
  for (const row of spec.headers) {
    const name = sub(row.key).trim();
    if (row.enabled && name) headers.push({ name, value: sub(row.value) });
  }

  // The Auth tab owns its header: it replaces one typed by hand.
  const { auth } = spec;
  if (auth.type === "bearer") setHeader("Authorization", `Bearer ${sub(auth.token).trim()}`);
  if (auth.type === "basic") setHeader("Authorization", `Basic ${base64Utf8(`${sub(auth.username)}:${sub(auth.password)}`)}`);
  if (auth.type === "apiKey") {
    const key = sub(auth.key).trim();
    if (!key) problems.push("The API key has no name. Add one in the Auth tab.");
    else if (auth.in === "query") url = appendQuery(url, key, sub(auth.value));
    else setHeader(key, sub(auth.value));
  }

  let body: string | null = null;
  let contentType = "";
  const { body: b } = spec;
  if (spec.method !== "HEAD" && b.mode !== "none") {
    if (b.mode === "json" || b.mode === "text") {
      body = sub(b.text);
      contentType = b.mode === "json" ? "application/json" : "text/plain; charset=utf-8";
    } else if (b.mode === "form") {
      const form = new URLSearchParams();
      for (const field of b.form) if (field.enabled && field.key) form.append(sub(field.key), sub(field.value));
      body = form.toString();
      contentType = "application/x-www-form-urlencoded";
    } else {
      const variables = sub(b.variables).trim();
      let parsed: unknown;
      if (variables) {
        try {
          parsed = JSON.parse(variables);
        } catch {
          problems.push("The GraphQL variables aren't valid JSON.");
        }
      }
      body = JSON.stringify({ query: sub(b.query), ...(parsed !== undefined && { variables: parsed }) });
      contentType = "application/json";
    }
  }
  if (body !== null && !headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push({ name: "Content-Type", value: contentType });

  return { input: { method: spec.method, url, headers, body }, missing: [...missing], problems };
}
