/** Parse bounded, untrusted OpenAPI JSON/YAML into plain import data without fetching or touching the shared document. */
import { parseDocument } from "../../../../../../node_modules/.pnpm/node_modules/yaml/dist/index.js";
import type { HttpMethod, KeyValue, RequestAuth, RequestBody } from "@codechatter/contracts";

export type ImportFolder = { id: string; name: string; parentId: string | null };
export type ImportVariable = { key: string; value: string; secret: boolean; enabled: boolean };
export type ImportRequest = { folderId: string | null; name: string; method: HttpMethod; url: string; headers: KeyValue[]; params: KeyValue[]; body: RequestBody; auth: RequestAuth };
export type ImportCounts = { remoteRefs: number; files: number; scripts: number; unsupported: number; secretValues: number; truncated: number; cycles: number };
export type ImportPlan = { name: string; format: "openapi" | "swagger" | "postman"; folders: ImportFolder[]; requests: ImportRequest[]; variables: ImportVariable[]; warnings: string[]; counts: ImportCounts };
type Obj = Record<string, unknown>;
const BAD = new Set(["__proto__", "constructor", "prototype"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export const IMPORT_TEXT_LIMIT = 5 * 1024 * 1024;
const MAX_DEPTH = 200;
const SECRET = /token|key|secret|password|authorization|cookie/i;
const has = (value: Obj, key: string) => Object.hasOwn(value, key);
export const record = (value: unknown): Obj | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : undefined;
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
export const emptyImportBody = (): RequestBody => ({ mode: "none", text: "", form: [], query: "", variables: "" });
export const emptyImportAuth = (): RequestAuth => ({ type: "none", token: "", username: "", password: "", key: "", value: "", in: "header" });
export const secretName = (key: string) => SECRET.test(key);
const decodedQueryKey = (key: string): string => { try { return decodeURIComponent(key.replace(/\+/g, " ")); } catch { return key; } };

/** Structured query fields are literals; the collection's row model stores raw URI spans. */
export function encodeStructuredQuery(row: KeyValue): KeyValue {
  const encode = (value: string): string => {
    const literal = (part: string): string => {
      try { return encodeURIComponent(part); }
      catch { return encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(part))); }
    };
    let text = "", previous = 0;
    for (const match of value.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
      text += literal(value.slice(previous, match.index)) + match[0];
      previous = match.index + match[0].length;
    }
    return text + literal(value.slice(previous));
  };
  return { key: encode(row.key), value: encode(row.value), enabled: row.enabled };
}

/** Limit text before parsing; JSON/YAML exception messages never reveal input excerpts. */
export function parseImportInput(text: string, yaml = false): unknown {
  if (text.length > IMPORT_TEXT_LIMIT || new TextEncoder().encode(text).length > IMPORT_TEXT_LIMIT) throw new Error("That file is over 5 MB. Split it into smaller files.");
  text = text.replace(/^\uFEFF/, "");
  let value: unknown;
  if (!text.trim()) throw new Error("Paste a document or choose a file first.");
  try { value = JSON.parse(text); }
  catch {
    if (!yaml) throw new Error("That is not valid JSON. Choose a Postman collection JSON file.");
    try {
      // yaml already belongs to monaco-yaml. The workspace's pnpm virtual-store
      // path avoids adding a package or importing Monaco's networked worker.
      const doc = parseDocument(text, { schema: "core", version: "1.2", strict: true, uniqueKeys: true, prettyErrors: false });
      if (doc.errors.length || doc.warnings.length) throw new Error("InvalidYaml");
      value = doc.toJS({ maxAliasCount: 0 });
    } catch { throw new Error("That is not valid JSON or YAML. YAML aliases, custom tags and multiple documents are not supported."); }
  }
  // Iterate instead of recursing so deeply nested JSON cannot overflow our stack.
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > MAX_DEPTH) throw new Error("That document is nested more than 200 levels. Split or simplify it.");
    if (++nodes > 150_000) throw new Error("That document has too many fields. Split it into smaller files.");
    if (!item.value || typeof item.value !== "object") continue;
    if (visited.has(item.value)) throw new Error("That document contains a cycle or repeated YAML alias. Remove its aliases.");
    visited.add(item.value);
    if (!Array.isArray(item.value) && Object.getPrototypeOf(item.value) !== Object.prototype && Object.getPrototypeOf(item.value) !== null) throw new Error("Use only plain document data.");
    for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
  }
  return value;
}

/** Shared safety and description builder; it holds no browser, React or Yjs state. */
export class ImportBuilder {
  readonly plan: ImportPlan;
  private readonly variables = new Map<string, ImportVariable>();
  private readonly warned = new Set<string>();
  private output = 0;
  private expanded = 0;
  private requestsSeen = 0;
  steps = 0;
  constructor(name: unknown, format: ImportPlan["format"]) {
    this.plan = { name: this.clip(name, 120) || "Imported API", format, folders: [], requests: [], variables: [], warnings: [], counts: { remoteRefs: 0, files: 0, scripts: 0, unsupported: 0, secretValues: 0, truncated: 0, cycles: 0 } };
  }
  private charge(size: number) {
    this.expanded += size;
    if (this.expanded > 24 * 1024 * 1024) throw new Error("That import needs too much expansion. Split or simplify it.");
  }
  tick() { this.charge(16); if (++this.steps > 200_000) throw new Error("That import needs too much expansion. Split or simplify it."); }
  clip(value: unknown, limit = 8192): string {
    const raw = string(value).replace(/\0/g, "");
    const clipped = raw.slice(0, limit);
    // A JSON code unit can occupy six escaped characters. Charge before the
    // example is assembled/stringified so a small reference DAG stays bounded.
    this.charge(clipped.length * 6);
    if (raw.length > limit && this.plan) this.plan.counts.truncated++;
    return clipped;
  }
  warn(message: string) { this.warned.add(message); }
  unsupported(message = "Unsupported fields or request methods were skipped.") { this.plan.counts.unsupported++; this.warn(message); }
  publicText(value: unknown, limit = 8192): string {
    let raw = this.clip(value, limit);
    if (!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) return raw;
    raw = raw.replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)([^/?#]*)@/i, (_all, prefix: string) => { this.plan.counts.secretValues++; this.warn("Credentials embedded in URLs were discarded."); return prefix; });
    const at = raw.indexOf("?");
    if (at < 0) return raw;
    const params: string[] = [];
    // A URL stored inside a variable cannot depend on recursively resolved
    // secret placeholders. Remove its credential query rows altogether.
    for (const part of raw.slice(at + 1).split("&")) {
      if (secretName(decodedQueryKey(part.split("=", 1)[0]!))) { this.plan.counts.secretValues++; this.warn("Credential query fields in URL values were removed. Configure them on the request before sending."); }
      else params.push(part);
    }
    return raw.slice(0, at) + (params.length ? `?${params.join("&")}` : "");
  }
  folder(name: unknown, parentId: string | null): string {
    if (this.plan.folders.length >= 2000) throw new Error("That file has more than 2,000 folders. Split it into smaller files.");
    const id = `folder-${this.plan.folders.length + 1}`;
    this.plan.folders.push({ id, name: this.clip(name, 120) || "Folder", parentId });
    return id;
  }
  variable(key: unknown, value: unknown = "", secret = false): string {
    const name = this.clip(key, 128).replace(/\s/g, "_");
    if (!name || BAD.has(name) || /[{}]/.test(name)) { this.unsupported("Unsafe or unsupported variable names were skipped."); return ""; }
    const sensitive = secret || secretName(name);
    const raw = sensitive ? this.clip(value) : this.publicText(value);
    if (sensitive && raw) this.plan.counts.secretValues++;
    const previous = this.variables.get(name);
    if (previous) {
      if (sensitive) { previous.secret = true; previous.value = ""; }
      else if (!previous.secret && !previous.value) previous.value = raw;
    } else this.variables.set(name, { key: name, value: sensitive ? "" : raw, secret: sensitive, enabled: true });
    return `{{${name}}}`;
  }
  credential(value: unknown, fallback: string): string {
    const raw = this.clip(value);
    const placeholder = /^\{\{\s*([^{}\s]+)\s*\}\}$/.exec(raw);
    return this.variable(placeholder?.[1] ?? fallback, placeholder ? "" : raw, true);
  }
  value(key: string, value: unknown): string {
    return secretName(key) ? this.credential(value, key) : this.publicText(value);
  }
  row(key: unknown, value: unknown, enabled = true): KeyValue | undefined {
    const name = this.clip(key, 256).replace(/[\r\n]/g, "");
    if (!name || BAD.has(name)) { this.unsupported(); return undefined; }
    return { key: name, value: this.value(name, value), enabled };
  }
  method(value: unknown): HttpMethod | undefined {
    if (++this.requestsSeen > 2000) throw new Error("That file has more than 2,000 requests. Split it into smaller files.");
    const name = string(value).toUpperCase();
    if (!METHODS.has(name)) { this.unsupported(); return undefined; }
    return name as HttpMethod;
  }
  add(request: ImportRequest) {
    this.output += JSON.stringify(request).length;
    if (this.output > 12 * 1024 * 1024) throw new Error("The expanded import is too large. Split it into smaller collections.");
    this.plan.requests.push(request);
  }
  finish(): ImportPlan {
    this.plan.variables = [...this.variables.values()];
    // Every unresolved placeholder gets a visible row in the new environment.
    for (const request of this.plan.requests) {
      for (const match of JSON.stringify(request).matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
        const name = match[1]!;
        if (["$timestamp", "$isoTimestamp", "$randomUUID", "$guid", "$randomInt"].includes(name)) {
          this.warn("Supported dynamic variables get fresh values when you send a request.");
          continue;
        }
        const existing = this.variables.has(name);
        this.variable(name);
        if (name.startsWith("$") && !existing) {
          const variable = this.variables.get(name);
          if (variable) variable.enabled = false;
          this.warn("Unsupported dynamic variables need manual values. Configure and enable their environment rows before sending.");
        }
      }
    }
    this.plan.variables = [...this.variables.values()];
    if (this.plan.counts.remoteRefs) this.warn("Remote references were skipped. Import never fetches them.");
    if (this.plan.counts.cycles) this.warn("Cyclic or very deep references were stopped.");
    if (this.plan.counts.files) this.warn("File fields were skipped; only text form fields were imported.");
    if (this.plan.counts.scripts) this.warn("Scripts were not imported.");
    if (this.plan.counts.secretValues) this.warn("Imported credential values were discarded. Add secret values on your own device.");
    if (this.plan.counts.truncated) this.warn("Long names or values were shortened. Review the imported requests.");
    this.plan.warnings = [...this.warned];
    return this.plan;
  }
}

/** Remove URL user-info and separate raw query rows without making a network request. */
export function importUrl(builder: ImportBuilder, input: unknown): { url: string; params: KeyValue[]; credentials: boolean } {
  let url = builder.clip(input, 8192);
  let credentials = false;
  url = url.replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)([^/?#]*)@/i, (_all, protocol: string) => { credentials = true; builder.plan.counts.secretValues++; return protocol; });
  if (credentials) builder.warn("Credentials embedded in URLs were discarded.");
  const hashAt = url.indexOf("#");
  if (hashAt !== -1) { url = url.slice(0, hashAt); builder.unsupported("URL fragments were removed."); }
  const queryAt = url.indexOf("?");
  if (queryAt === -1) return { url, params: [], credentials };
  const params: KeyValue[] = [];
  for (const entry of url.slice(queryAt + 1).split("&").slice(0, 256)) {
    if (!entry) continue;
    const eq = entry.indexOf("=");
    const key = eq === -1 ? entry : entry.slice(0, eq);
    const row = builder.row(key, eq === -1 ? "" : entry.slice(eq + 1));
    const decodedKey = decodedQueryKey(key);
    if (row && secretName(decodedKey) && !secretName(key)) row.value = builder.credential(eq === -1 ? "" : entry.slice(eq + 1), decodedKey);
    if (row) params.push(row);
  }
  return { url: url.slice(0, queryAt), params, credentials };
}

/** Build a genuine multipart text body when the row model has no multipart mode. */
export function multipartBody(builder: ImportBuilder, rows: KeyValue[]): { body: RequestBody; header: KeyValue } {
  const names = new Set<string>();
  for (const row of rows) for (const match of row.value.matchAll(/(?:^|\r?\n)--(CodeChatterImport[0-9]+)/g)) names.add(match[1]!);
  let suffix = 0;
  while (names.has(`CodeChatterImport${suffix}`)) suffix++;
  const boundary = `CodeChatterImport${suffix}`;
  const parts = rows.filter((row) => row.enabled).map((row) => `--${boundary}\r\nContent-Disposition: form-data; name="${row.key.replace(/[\r\n"\\]/g, "_")}"\r\n\r\n${row.value}\r\n`);
  builder.warn("Multipart text fields use a raw multipart body because the form editor is URL-encoded.");
  return { body: { ...emptyImportBody(), mode: "text", text: `${parts.join("")}--${boundary}--\r\n` }, header: { key: "Content-Type", value: `multipart/form-data; boundary=${boundary}`, enabled: true } };
}

/** JSON examples remain data; credential-shaped fields become empty secret-variable references. */
export function safeExample(builder: ImportBuilder, value: unknown, depth = 0, seen = new Set<unknown>()): unknown {
  builder.tick();
  if (depth > 64 || seen.has(value)) { builder.plan.counts.cycles++; return null; }
  if (typeof value === "string") return builder.publicText(value, 65_536);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (!value || typeof value !== "object") return null;
  const next = new Set(seen).add(value);
  if (Array.isArray(value)) { if (value.length > 256) builder.plan.counts.truncated++; return value.slice(0, 256).map((item) => safeExample(builder, item, depth + 1, next)); }
  const out: Obj = Object.create(null) as Obj;
  for (const [key, item] of Object.entries(value)) {
    if (BAD.has(key)) { builder.unsupported("Prototype-shaped fields were skipped."); continue; }
    const name = builder.clip(key, 256);
    out[name] = secretName(name) ? builder.credential(item, name) : safeExample(builder, item, depth + 1, next);
  }
  return out;
}

/** OpenAPI3.0/3.1 and Swagger2.0 import with local-only, cycle-bounded reference resolution. */
export function parseOpenApi(text: string): ImportPlan {
  const document = record(parseImportInput(text, true));
  if (!document) throw new Error("Choose an OpenAPI or Swagger document object.");
  const swagger = document.swagger === "2.0";
  if (!swagger && !/^3\.(?:0|1)(?:\.|$)/.test(string(document.openapi))) throw new Error("Use OpenAPI 3.0 or 3.1, or Swagger 2.0.");
  const builder = new ImportBuilder(record(document.info)?.title, swagger ? "swagger" : "openapi");
  const remoteRefs = new Set<string>();
  const resolve = (input: unknown, depth = 0, refs = new Set<string>()): Obj | undefined => {
    builder.tick();
    const obj = record(input);
    if (!obj) return undefined;
    const ref = obj.$ref;
    if (typeof ref !== "string") return obj;
    if (!ref.startsWith("#/")) {
      if (ref === "#") builder.plan.counts.cycles++;
      else if (!remoteRefs.has(ref)) { remoteRefs.add(ref); builder.plan.counts.remoteRefs++; }
      return undefined;
    }
    if (depth >= 64 || refs.has(ref)) { builder.plan.counts.cycles++; return undefined; }
    let target: unknown = document;
    for (const encoded of ref.slice(2).split("/")) {
      let key: string;
      try { key = decodeURIComponent(encoded).replace(/~1/g, "/").replace(/~0/g, "~"); } catch { builder.unsupported("Invalid local references were skipped."); return undefined; }
      const container = record(target);
      if (!container || BAD.has(key) || !has(container, key)) { builder.unsupported("Missing local references were skipped."); return undefined; }
      target = container[key];
    }
    const result = resolve(target, depth + 1, new Set(refs).add(ref));
    if (!result) return undefined;
    const siblings = Object.entries(obj).filter(([key]) => key !== "$ref" && !BAD.has(key));
    return siblings.length ? Object.assign(Object.create(null), result, Object.fromEntries(siblings)) as Obj : result;
  };
  // Inventory all remote refs, including ones outside the selected first example.
  const inventory: unknown[] = [document];
  while (inventory.length) {
    const item = inventory.pop();
    if (!item || typeof item !== "object") continue;
    const ref = record(item)?.$ref;
    if (typeof ref === "string" && !ref.startsWith("#") && !remoteRefs.has(ref)) { remoteRefs.add(ref); builder.plan.counts.remoteRefs++; }
    for (const child of Object.values(item)) inventory.push(child);
  }
  const example = (raw: unknown, depth = 0, seen = new Set<unknown>()): unknown => {
    builder.tick();
    if (depth >= 64 || seen.has(raw)) { builder.plan.counts.cycles++; return null; }
    const schema = resolve(raw);
    if (!schema) return null;
    if (seen.has(schema)) { builder.plan.counts.cycles++; return null; }
    const next = new Set(seen).add(raw).add(schema);
    if (has(schema, "example")) return safeExample(builder, schema.example);
    if (has(schema, "default")) return safeExample(builder, schema.default);
    if (has(schema, "const")) return safeExample(builder, schema.const);
    if (array(schema.enum).length) return safeExample(builder, array(schema.enum)[0]);
    if (array(schema.examples).length) return safeExample(builder, array(schema.examples)[0]);
    const choice = array(schema.oneOf)[0] ?? array(schema.anyOf)[0];
    if (choice) return example(choice, depth + 1, next);
    if (array(schema.allOf).length) {
      const combined: Obj = Object.create(null) as Obj;
      for (const branch of array(schema.allOf).slice(0, 64)) { const value = record(example(branch, depth + 1, next)); if (value) for (const [key, item] of Object.entries(value)) if (!BAD.has(key)) combined[key] = item; }
      return combined;
    }
    const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
    if (type === "object" || record(schema.properties)) {
      const value: Obj = Object.create(null) as Obj;
      for (const [key, property] of Object.entries(record(schema.properties) ?? {})) {
        if (BAD.has(key)) { builder.unsupported("Prototype-shaped fields were skipped."); continue; }
        if (resolve(property)?.readOnly === true) continue;
        value[builder.clip(key, 256)] = secretName(key) ? builder.variable(key, "", true) : example(property, depth + 1, next);
      }
      return value;
    }
    if (type === "array") return schema.items ? [example(schema.items, depth + 1, next)] : [];
    if (type === "integer" || type === "number") return 0;
    if (type === "boolean") return false;
    if (type === "null") return null;
    return "";
  };
  const explicitExample = (obj: Obj): unknown => {
    if (has(obj, "example")) return safeExample(builder, obj.example);
    for (const value of Object.values(record(obj.examples) ?? {})) {
      const chosen = resolve(value);
      if (chosen && has(chosen, "value")) return safeExample(builder, chosen.value);
      if (chosen?.externalValue) { builder.plan.counts.remoteRefs++; builder.warn("Remote examples were skipped and never fetched."); }
    }
    return example(obj.schema);
  };
  let baseUrl = "";
  if (swagger) {
    const host = builder.clip(document.host, 2048);
    const scheme = array(document.schemes).map(string).find((item) => item === "http" || item === "https") ?? "https";
    baseUrl = host ? `${scheme}://${host}${builder.clip(document.basePath, 4096)}` : "";
  } else {
    const server = record(array(document.servers)[0]);
    let missingDefault = false;
    baseUrl = builder.clip(server?.url, 8192).replace(/\{([^{}]+)\}/g, (_whole, key: string) => {
      const value = record(record(server?.variables)?.[key]);
      if (value && has(value, "default")) {
        if (secretName(key)) { builder.credential(value.default, key); missingDefault = true; builder.warn("A server URL template contains a credential; baseUrl needs a value."); return ""; }
        return builder.publicText(value.default);
      }
      missingDefault = true;
      builder.warn("A server URL template has no default; baseUrl needs a value.");
      return "";
    });
    if (missingDefault) baseUrl = "";
  }
  const serverUrl = importUrl(builder, baseUrl);
  if (serverUrl.params.length) builder.unsupported("A server URL query was removed; add it to the request parameters if needed.");
  baseUrl = serverUrl.url.replace(/\/$/, "");
  builder.variable("baseUrl", baseUrl);
  const folders = new Map<string, string>();
  const folder = (name: unknown) => { const label = builder.clip(name, 120) || "Untagged"; let id = folders.get(label); if (!id) { id = builder.folder(label, null); folders.set(label, id); } return id; };
  for (const tag of array(document.tags)) if (record(tag)?.name) folder(record(tag)!.name);
  const securitySchemes = swagger ? record(document.securityDefinitions) ?? {} : record(record(document.components)?.securitySchemes) ?? {};
  // Reserve aliases against every path placeholder before processing operations,
  // including names that appear later in the file.
  const pathNames = new Set<string>(["baseUrl"]);
  for (const path of Object.keys(record(document.paths) ?? {})) {
    for (const match of path.replace(/\0/g, "").slice(0, 7000).matchAll(/\{([^{}]+)\}/g)) pathNames.add(match[1]!.replace(/\0/g, "").slice(0, 128).replace(/\s/g, "_"));
  }
  let baseUrlPathAlias = "pathBaseUrl";
  for (let suffix = 2; pathNames.has(baseUrlPathAlias); suffix++) baseUrlPathAlias = `pathBaseUrl${suffix}`;
  const applySecurity = (requirements: unknown, headers: KeyValue[], params: KeyValue[]): RequestAuth => {
    const auth = emptyImportAuth();
    const alternatives = array(requirements);
    if (!alternatives.length) return auth;
    if (alternatives.length > 1) builder.warn("Only the first security alternative was imported.");
    for (const name of Object.keys(record(alternatives[0]) ?? {})) {
      if (BAD.has(name)) continue;
      const scheme = resolve(securitySchemes[name]);
      if (!scheme) continue;
      if (scheme.type === "http" && string(scheme.scheme).toLowerCase() === "bearer") { auth.type = "bearer"; auth.token = builder.variable("token", "", true); }
      else if (scheme.type === "basic" || (scheme.type === "http" && string(scheme.scheme).toLowerCase() === "basic")) { auth.type = "basic"; auth.username = builder.variable("username", "", true); auth.password = builder.variable("password", "", true); }
      else if (scheme.type === "apiKey" && (scheme.in === "header" || scheme.in === "query")) {
        const row = builder.row(scheme.name, builder.variable(name, "", true));
        if (row) (scheme.in === "header" ? headers : params).push(scheme.in === "query" ? encodeStructuredQuery(row) : row);
      } else builder.unsupported("Unsupported security schemes were skipped; add their credentials manually.");
    }
    return auth;
  };
  for (const [path, rawItem] of Object.entries(record(document.paths) ?? {})) {
    if (!path.startsWith("/")) continue;
    const item = resolve(rawItem);
    if (!item) continue;
    for (const [verb, rawOperation] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete", "head", "options", "trace", "connect"].includes(verb)) continue;
      const method = builder.method(verb);
      const operation = resolve(rawOperation);
      if (!method || !operation) continue;
      const tags = array(operation.tags);
      for (const tag of tags) folder(tag);
      if (tags.length > 1) builder.warn("Operations with several tags are placed in their first tag folder.");
      const folderId = folder(tags[0]);
      const parameters = new Map<string, Obj>();
      for (const rawParameter of [...array(item.parameters), ...array(operation.parameters)]) {
        const parameter = resolve(rawParameter);
        if (parameter) parameters.set(`${string(parameter.in)}:${string(parameter.name)}`, parameter);
      }
      const headers: KeyValue[] = [], params: KeyValue[] = [], form: KeyValue[] = [];
      let body = emptyImportBody();
      const templatePath = builder.clip(path, 7000).replace(/\{([^{}]+)\}/g, (_whole, key: string) => {
        const parameter = parameters.get(`path:${key}`);
        const schema = resolve(parameter?.schema) ?? parameter;
        const normalized = key.replace(/\0/g, "").slice(0, 128).replace(/\s/g, "_");
        if (normalized === "baseUrl") builder.warn(`Path parameter baseUrl was renamed to ${baseUrlPathAlias} to keep the server URL.`);
        return builder.variable(normalized === "baseUrl" ? baseUrlPathAlias : key, parameter?.example ?? schema?.example ?? schema?.default ?? "", secretName(key));
      });
      for (const parameter of parameters.values()) {
        const key = builder.clip(parameter.name, 256);
        const schema = resolve(parameter.schema) ?? parameter;
        const value = parameter.example ?? schema.example ?? schema.default ?? "";
        if (parameter.in === "query" || parameter.in === "header") {
          if ((parameter.in === "query" ? params : headers).length >= (parameter.in === "query" ? 256 : 63)) { builder.unsupported("Extra parameter rows were skipped."); continue; }
          const row = builder.row(key, typeof value === "object" ? JSON.stringify(safeExample(builder, value)) : value, parameter.required === true);
          if (row) { if (parameter.in === "header") row.value = row.value.replace(/[\r\n]/g, ""); (parameter.in === "query" ? params : headers).push(parameter.in === "query" ? encodeStructuredQuery(row) : row); }
        } else if (swagger && parameter.in === "body") { body = { ...body, mode: "json", text: JSON.stringify(explicitExample(parameter), null, 2) }; }
        else if (swagger && parameter.in === "formData") {
          if (parameter.type === "file") builder.plan.counts.files++;
          else { const row = builder.row(key, value, true); if (row) form.push(row); }
        }
      }
      if (swagger && form.length) {
        if (array(operation.consumes ?? document.consumes).includes("multipart/form-data")) { const multipart = multipartBody(builder, form); body = multipart.body; headers.push(multipart.header); }
        else body = { ...body, mode: "form", form };
      }
      const requestBody = resolve(operation.requestBody);
      if (requestBody) {
        const content = record(requestBody.content) ?? {};
        const jsonType = Object.keys(content).find((key) => key === "application/json" || key.endsWith("+json"));
        const media = resolve(jsonType ? content[jsonType] : content["application/x-www-form-urlencoded"] ?? content["multipart/form-data"]);
        if (media && jsonType) body = { ...body, mode: "json", text: JSON.stringify(explicitExample(media), null, 2) };
        else if (media) {
          const schema = resolve(media.schema);
          for (const [key, rawProperty] of Object.entries(record(schema?.properties) ?? {})) {
            const property = resolve(rawProperty);
            if (property?.format === "binary" || property?.format === "base64") { builder.plan.counts.files++; continue; }
            const row = builder.row(key, property?.example ?? property?.default ?? "", true); if (row) form.push(row);
          }
          if (content["application/x-www-form-urlencoded"]) body = { ...body, mode: "form", form };
          else { const multipart = multipartBody(builder, form); body = multipart.body; headers.push(multipart.header); }
        } else builder.unsupported("Unsupported request body media types were skipped.");
      }
      if (body.text.length > 512 * 1024) { body = emptyImportBody(); builder.unsupported("A body over 512 KB was skipped. Add a smaller example before sending."); }
      const auth = applySecurity(has(operation, "security") ? operation.security : document.security, headers, params);
      const requestUrl = importUrl(builder, `{{baseUrl}}${templatePath}`);
      params.push(...requestUrl.params);
      builder.add({ folderId, name: builder.clip(operation.summary || operation.operationId || `${method} ${path}`, 120), method, url: requestUrl.url, headers, params, body, auth });
    }
  }
  if (!builder.plan.requests.length) throw new Error("No supported HTTP operations were found in that document.");
  return builder.finish();
}
