/** Read bounded Postman v2 collections as plain import data, excluding scripts, files and shared credential values. */
import type { KeyValue, RequestAuth, RequestBody } from "@codechatter/contracts";

import { ImportBuilder, array, emptyImportAuth, emptyImportBody, encodeStructuredQuery, importUrl, multipartBody, parseImportInput, record, safeExample, string, type ImportPlan } from "./import-openapi";

type Obj = Record<string, unknown>;

/** Collection/folder auth is inherited only when a child does not explicitly override it. */
export function parsePostman(text: string): ImportPlan {
  const document = record(parseImportInput(text));
  const info = record(document?.info);
  if (!document || !info || !/\/v2\.(?:0|1)\.\d+\//.test(string(info.schema))) throw new Error("Choose a Postman Collection v2.0 or v2.1 JSON file.");
  const builder = new ImportBuilder(info.name, "postman");
  for (const raw of array(document.variable)) {
    const variable = record(raw);
    if (!variable) continue;
    const key = string(variable.key ?? variable.id);
    builder.variable(key, variable.value, variable.type === "secret");
  }
  const authFields = (auth: Obj, kind: string): Map<string, unknown> => {
    // v2.0 stores auth as an object; v2.1 uses an attribute array.
    const fields = record(auth[kind]);
    if (fields) return new Map(Object.entries(fields));
    return new Map(array(auth[kind]).map((item) => record(item)).filter((item): item is Obj => Boolean(item)).map((item) => [string(item.key), item.value]));
  };
  const inheritedAuth = (value: unknown, previous: Obj | undefined): Obj | undefined => {
    const obj = record(value);
    return !obj || obj.type === "inherit" ? previous : obj;
  };
  const requestAuth = (auth: Obj | undefined): RequestAuth => {
    const out = emptyImportAuth();
    if (!auth || auth.type === "noauth") return out;
    if (auth.type === "bearer") { out.type = "bearer"; out.token = builder.credential(authFields(auth, "bearer").get("token"), "token"); }
    else if (auth.type === "basic") {
      const fields = authFields(auth, "basic");
      out.type = "basic"; out.username = builder.credential(fields.get("username"), "username"); out.password = builder.credential(fields.get("password"), "password");
    } else if (auth.type === "apikey") {
      const fields = authFields(auth, "apikey");
      out.type = "apiKey"; out.key = builder.clip(fields.get("key"), 256); out.value = builder.credential(fields.get("value"), "apiKey"); out.in = fields.get("in") === "query" ? "query" : "header";
    } else builder.unsupported("Unsupported authentication was skipped. Configure it manually before sending.");
    return out;
  };
  const hasScript = (value: unknown): boolean => array(value).some((event) => Boolean(record(event)?.script));
  const rowList = (values: unknown, kind: "header" | "query" | "form"): KeyValue[] => {
    const rows: KeyValue[] = [];
    // The v2.0 header-list also accepts newline-separated header text.
    const source = kind === "header" && typeof values === "string" ? values.split(/\r?\n/, 64).map((line) => { const at = line.indexOf(":"); return at < 1 ? null : { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }; }) : array(values);
    for (const raw of source) {
      const item = record(raw);
      if (!item) continue;
      if (kind === "form" && item.type === "file") { builder.plan.counts.files++; continue; }
      const row = builder.row(item.key, item.value, item.disabled !== true);
      if (!row) continue;
      if (kind === "header") row.value = row.value.replace(/[\r\n]/g, "");
      rows.push(kind === "query" ? encodeStructuredQuery(row) : row);
      if (rows.length >= (kind === "header" ? 63 : 256)) { if (source.length > rows.length) builder.unsupported("Extra parameter rows were skipped."); break; }
    }
    return rows;
  };
  const makeUrl = (value: unknown): { url: string; params: KeyValue[] } => {
    if (typeof value === "string") return importUrl(builder, value.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (whole, key: string, offset: number) => offset > 0 && value[offset - 1] === "/" ? builder.variable(key) : whole));
    const url = record(value);
    if (!url) return { url: "", params: [] };
    for (const raw of array(url.variable)) {
      const variable = record(raw);
      if (variable) builder.variable(variable.key, variable.value);
    }
    let raw = string(url.raw);
    if (!raw) {
      const host = Array.isArray(url.host) ? url.host.map(string).join(".") : string(url.host);
      const path = Array.isArray(url.path) ? url.path.map(string).join("/") : string(url.path);
      raw = `${string(url.protocol) || "http"}://${host}${url.port ? `:${string(url.port)}` : ""}${path ? `/${path.replace(/^\//, "")}` : ""}`;
    }
    raw = raw.replace(/(^|\/):([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (_whole, prefix: string, key: string) => `${prefix}${builder.variable(key)}`);
    const parsed = importUrl(builder, raw);
    return { url: parsed.url, params: Array.isArray(url.query) ? rowList(url.query, "query") : parsed.params };
  };
  const makeBody = (input: unknown, headers: KeyValue[]): RequestBody => {
    const body = record(input);
    const out = emptyImportBody();
    if (!body || body.disabled === true) return out;
    if (body.mode === "raw") {
      const raw = builder.clip(body.raw, 512 * 1024);
      const json = record(record(body.options)?.raw)?.language === "json" || /^[\s]*[\[{]/.test(raw) || headers.some((row) => row.key.toLowerCase() === "content-type" && /(?:application\/json|\+json)/i.test(row.value));
      if (json) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw); }
        catch { builder.unsupported("An invalid or truncated JSON body was skipped. Add a valid body before sending."); return out; }
        // Expansion errors must propagate, not fall back to the unsanitized raw body.
        return { ...out, mode: "json", text: JSON.stringify(safeExample(builder, parsed), null, 2) };
      }
      return { ...out, mode: "text", text: builder.publicText(raw, 512 * 1024) };
    }
    if (body.mode === "urlencoded") return { ...out, mode: "form", form: rowList(body.urlencoded, "form") };
    if (body.mode === "formdata") {
      const multipart = multipartBody(builder, rowList(body.formdata, "form"));
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i]!.key.toLowerCase() === "content-type") headers.splice(i, 1);
      headers.push(multipart.header);
      return multipart.body;
    }
    if (body.mode === "file") { builder.plan.counts.files++; builder.warn("Binary request bodies were skipped."); }
    else builder.unsupported("Unsupported body formats were skipped.");
    return out;
  };
  const stack: Array<{ items: unknown[]; parentId: string | null; auth: Obj | undefined; scripts: boolean; depth: number }> = [{ items: array(document.item), parentId: null, auth: record(document.auth), scripts: hasScript(document.event), depth: 0 }];
  while (stack.length) {
    const group = stack.pop()!;
    if (group.depth > 200) throw new Error("That collection is nested more than 200 levels. Split or simplify it.");
    // Reverse-push folders only; requests retain their file order within a folder.
    const children: typeof stack = [];
    for (const raw of group.items) {
      builder.tick();
      const item = record(raw);
      if (!item) continue;
      const auth = inheritedAuth(item.auth, group.auth);
      const scripts = group.scripts || hasScript(item.event);
      if (Array.isArray(item.item)) {
        const id = builder.folder(item.name, group.parentId);
        children.push({ items: item.item, parentId: id, auth, scripts, depth: group.depth + 1 });
        continue;
      }
      const req = typeof item.request === "string" ? { url: item.request, method: "GET" } : record(item.request);
      if (!req) { builder.unsupported(); continue; }
      const method = builder.method(req.method ?? "GET");
      if (!method) continue;
      if (scripts || hasScript(req.event)) builder.plan.counts.scripts++;
      const headers = rowList(req.header, "header");
      const url = makeUrl(req.url);
      const body = makeBody(req.body, headers);
      const finalAuth = requestAuth(inheritedAuth(req.auth, auth));
      if (!url.url) { builder.unsupported("Requests without a URL were skipped."); continue; }
      builder.add({ folderId: group.parentId, name: builder.clip(item.name, 120) || `${method} ${url.url}`.slice(0, 120), method, url: url.url, params: url.params, headers, body, auth: finalAuth });
    }
    stack.push(...children.reverse());
  }
  if (!builder.plan.requests.length) throw new Error("No supported HTTP requests were found in that collection.");
  return builder.finish();
}
