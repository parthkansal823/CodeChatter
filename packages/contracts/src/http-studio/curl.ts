import { emptyAuth, emptyBody, type KeyValue, type RequestAuth, type RequestBody } from "./request.js";
import { HTTP_METHODS, type HttpMethod } from "./send.js";

export type CurlImport = {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body: RequestBody;
  auth: RequestAuth;
  /** Parts of the command that couldn't be carried over. */
  warnings: string[];
};

/** Shell-style words: quotes, backslash escapes, $'…' strings and line continuations. */
export function shellWords(command: string): string[] {
  let text = command.replace(/\\\r?\n/g, " ").replace(/`\r?\n/g, " ");
  // Windows cmd ("Copy as cURL (cmd)") escapes with carets: ^" ^& ^^ and ^ at line ends.
  if (/\^"/.test(text)) text = text.replace(/\^\r?\n/g, " ").replace(/\^(.)/g, "$1");
  const words: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new Error("A quote in the command isn't closed.");
      word += text.slice(i + 1, end);
      i = end;
    } else if (ch === "$" && text[i + 1] === "'") {
      i += 2;
      for (; i < text.length && text[i] !== "'"; i++) {
        if (text[i] !== "\\") {
          word += text[i];
          continue;
        }
        const next = text[++i];
        const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
        if (next === "x" || next === "u") {
          const len = next === "x" ? 2 : 4;
          word += String.fromCharCode(parseInt(text.slice(i + 1, i + 1 + len), 16));
          i += len;
        } else word += next !== undefined ? (simple[next] ?? `\\${next}`) : "";
      }
      if (i >= text.length) throw new Error("A quote in the command isn't closed.");
    } else if (ch === '"') {
      i++;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\" && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1]!)) i++;
        word += text[i];
      }
      if (i >= text.length) throw new Error("A quote in the command isn't closed.");
    } else if (ch === "\\" && i + 1 < text.length) {
      word += text[++i];
    } else {
      word += ch;
    }
  }
  if (inWord) words.push(word);
  return words;
}

// Options that take a value and are safe to drop (output, timing, TLS files…).
const IGNORED_WITH_VALUE = new Set([
  "-o", "--output", "-m", "--max-time", "--connect-timeout", "--retry", "--retry-delay", "--retry-max-time", "-w", "--write-out",
  "-x", "--proxy", "--cacert", "--capath", "-E", "--cert", "--key", "-c", "--cookie-jar", "-D", "--dump-header", "--resolve",
  "--limit-rate", "--max-redirs", "-y", "--speed-time", "-Y", "--speed-limit", "--interface", "--local-port", "--trace", "--trace-ascii",
  "--connect-to", "-K", "--config", "--proto", "--proto-redir", "--ciphers", "--tls-max", "--aws-sigv4",
]);
const FLAGS = new Set([
  "-L", "--location", "-k", "--insecure", "-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-i", "--include", "--compressed",
  "-N", "--no-buffer", "-f", "--fail", "--fail-with-body", "--http1.0", "--http1.1", "--http2", "--http2-prior-knowledge", "--http3", "-#",
  "--progress-bar", "-g", "--globoff", "-q", "--disable", "--no-keepalive", "--location-trusted", "--path-as-is", "-0", "-1", "-2", "-3",
  "-4", "-6", "--ipv4", "--ipv6", "--tlsv1.2", "--tlsv1.3", "--raw", "-Z", "--parallel", "--no-progress-meter",
]);
const WITH_VALUE = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-ascii", "--data-binary", "--data-raw", "--data-urlencode", "--json",
  "-F", "--form", "--form-string", "-u", "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "--url", "--oauth2-bearer",
  "-T", "--upload-file", "-r", "--range",
]);
const SHORT_WITH_VALUE = new Set(["X", "H", "d", "F", "u", "A", "e", "b", "T", "r", "o", "m", "w", "x", "E", "c", "D", "y", "Y", "K"]);

function decodeFormPart(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function urlencodeData(spec: string, warnings: string[]): string {
  if (spec.startsWith("@") || /^[^=]*@/.test(spec.split("=")[0] ?? "")) {
    warnings.push(`Skipped --data-urlencode ${spec}: files can't be read here.`);
    return "";
  }
  const eq = spec.indexOf("=");
  if (eq === -1) return encodeURIComponent(spec);
  const name = spec.slice(0, eq);
  return name ? `${name}=${encodeURIComponent(spec.slice(eq + 1))}` : encodeURIComponent(spec.slice(eq + 1));
}

/** A curl command (as copied from browser devtools or docs) as a request. */
export function parseCurl(command: string): CurlImport {
  const words = shellWords(command.trim().replace(/^\$\s+/, ""));
  if (!/^curl(\.exe)?$/i.test(words[0] ?? "")) throw new Error("That doesn't look like a curl command. It should start with curl.");

  const warnings: string[] = [];
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: KeyValue[] = [];
  const auth = emptyAuth();
  let method: string | null = null;
  let url = "";
  let getMode = false;
  let head = false;
  let json = false;

  // Expand short clusters: -sSL, -XPOST, -H'Accept: x'.
  const args: Array<[string, string | undefined]> = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      const name = eq === -1 ? w : w.slice(0, eq);
      if (eq !== -1 && (WITH_VALUE.has(name) || IGNORED_WITH_VALUE.has(name))) args.push([name, w.slice(eq + 1)]);
      else if (WITH_VALUE.has(w) || IGNORED_WITH_VALUE.has(w)) args.push([w, words[++i]]);
      else args.push([w, undefined]);
    } else if (w.startsWith("-") && w.length > 1) {
      for (let j = 1; j < w.length; j++) {
        const flag = `-${w[j]}`;
        if (SHORT_WITH_VALUE.has(w[j]!)) {
          args.push([flag, j + 1 < w.length ? w.slice(j + 1) : words[++i]]);
          break;
        }
        args.push([flag, undefined]);
      }
    } else {
      args.push(["", w]);
    }
  }

  for (const [name, value] of args) {
    if (name === "") {
      if (!url) url = value!;
      else warnings.push(`Ignored the extra argument ${value}.`);
      continue;
    }
    if ((WITH_VALUE.has(name) || IGNORED_WITH_VALUE.has(name)) && value === undefined) throw new Error(`${name} needs a value.`);
    const v = value ?? "";
    switch (name) {
      case "-X":
      case "--request":
        method = v.toUpperCase();
        break;
      case "-H":
      case "--header": {
        const colon = v.indexOf(":");
        if (colon > 0) headers.push({ key: v.slice(0, colon).trim(), value: v.slice(colon + 1).trim(), enabled: true });
        break;
      }
      case "-d":
      case "--data":
      case "--data-ascii":
      case "--data-binary":
      case "--data-raw":
        if (v.startsWith("@") && name !== "--data-raw") warnings.push(`Skipped ${name} ${v}: files can't be read here.`);
        else data.push(v);
        break;
      case "--data-urlencode":
        data.push(urlencodeData(v, warnings));
        break;
      case "--json":
        json = true;
        data.push(v);
        break;
      case "-F":
      case "--form":
      case "--form-string": {
        const eq = v.indexOf("=");
        const field = eq === -1 ? { key: v, value: "" } : { key: v.slice(0, eq), value: v.slice(eq + 1) };
        if (name !== "--form-string" && /^[@<]/.test(field.value)) warnings.push(`Skipped the file field ${field.key}: file uploads aren't supported.`);
        else form.push({ ...field, enabled: true });
        break;
      }
      case "-u":
      case "--user": {
        const colon = v.indexOf(":");
        auth.type = "basic";
        auth.username = colon === -1 ? v : v.slice(0, colon);
        auth.password = colon === -1 ? "" : v.slice(colon + 1);
        break;
      }
      case "--oauth2-bearer":
        auth.type = "bearer";
        auth.token = v;
        break;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: v, enabled: true });
        break;
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: v, enabled: true });
        break;
      case "-b":
      case "--cookie":
        if (v.includes("=")) headers.push({ key: "Cookie", value: v, enabled: true });
        else warnings.push(`Skipped the cookie file ${v}.`);
        break;
      case "--url":
        url = v;
        break;
      case "-G":
      case "--get":
        getMode = true;
        break;
      case "-I":
      case "--head":
        head = true;
        break;
      case "-r":
      case "--range":
        headers.push({ key: "Range", value: `bytes=${v}`, enabled: true });
        break;
      case "-T":
      case "--upload-file":
        warnings.push(`Skipped ${name} ${v}: file uploads aren't supported.`);
        break;
      default:
        if (!FLAGS.has(name) && !IGNORED_WITH_VALUE.has(name)) warnings.push(`Ignored ${name}.`);
    }
  }

  if (!url) throw new Error("The command has no URL.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;

  // Headers the API computes itself.
  const dropped = new Set(["content-length", "host", "connection"]);
  const kept = headers.filter((h) => !dropped.has(h.key.toLowerCase()));
  const headerValue = (key: string) => kept.find((h) => h.key.toLowerCase() === key)?.value;

  // Authorization headers become the Auth tab, so the token can move into a variable.
  const authHeader = headerValue("authorization");
  if (authHeader && auth.type === "none") {
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (bearer) {
      auth.type = "bearer";
      auth.token = bearer[1]!.trim();
      kept.splice(kept.findIndex((h) => h.key.toLowerCase() === "authorization"), 1);
    }
  }

  const body = emptyBody();
  const joined = data.join("&");
  if (getMode && data.length) {
    url = `${url}${url.includes("?") ? "&" : "?"}${joined}`;
  } else if (form.length) {
    body.mode = "form";
    body.form = form;
    warnings.push("The multipart form was imported as a URL-encoded form.");
  } else if (data.length) {
    if (json && !headerValue("content-type")) kept.push({ key: "Content-Type", value: "application/json", enabled: true });
    if (json && !headerValue("accept")) kept.push({ key: "Accept", value: "application/json", enabled: true });
    const type = (headerValue("content-type") ?? "").toLowerCase();
    const raw = json ? data.join("") : joined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const looksJson = parsed !== undefined && typeof parsed === "object" && parsed !== null;
    const graphql =
      looksJson &&
      !Array.isArray(parsed) &&
      typeof (parsed as { query?: unknown }).query === "string" &&
      Object.keys(parsed as object).every((k) => ["query", "variables", "operationName"].includes(k));
    if (graphql) {
      const g = parsed as { query: string; variables?: unknown };
      body.mode = "graphql";
      body.query = g.query;
      body.variables = g.variables === undefined ? "" : JSON.stringify(g.variables, null, 2);
    } else if (type.includes("json") || (!type && looksJson)) {
      body.mode = "json";
      body.text = looksJson ? JSON.stringify(parsed, null, 2) : raw;
    } else if ((!type || type.includes("x-www-form-urlencoded")) && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(raw)) {
      body.mode = "form";
      body.form = raw.split("&").map((pair) => {
        const eq = pair.indexOf("=");
        return { key: decodeFormPart(pair.slice(0, eq)), value: decodeFormPart(pair.slice(eq + 1)), enabled: true };
      });
    } else {
      body.mode = "text";
      body.text = raw;
    }
  }

  const upper = (method ?? (head ? "HEAD" : getMode ? "GET" : data.length || form.length ? "POST" : "GET")).toUpperCase();
  const known = (HTTP_METHODS as readonly string[]).includes(upper);
  if (!known) warnings.push(`The method ${upper} isn't supported; using GET.`);

  return { method: known ? (upper as HttpMethod) : "GET", url, headers: kept, body, auth, warnings };
}
