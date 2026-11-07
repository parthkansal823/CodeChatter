/** Verify Postman inheritance, representation and bounded handling of untrusted collections without executing anything. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRequest, withQuery } from "../../../../../../packages/contracts/src/http-studio/request";
import { IMPORT_TEXT_LIMIT } from "./import-openapi";
import { parsePostman } from "./import-postman";

const collection = (extra: Record<string, unknown> = {}) => ({ info: { name: "Pet collection", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [{ name: "Health", request: { method: "GET", url: "https://api.example.test/health" } }], ...extra });
const parse = (value: unknown) => parsePostman(JSON.stringify(value));

test("Postman 2.1 imports nested folders, structured URL rows, inherited auth and variables, not credential values", () => {
  const plan = parse(collection({ variable: [{ key: "baseUrl", value: "https://api.example.test" }, { key: "token", value: "private-collection-token" }, { key: "special", value: "private-explicit-secret", type: "secret" }], auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] }, item: [
    { name: "Pets", item: [
      { name: "Read pet", request: { method: "GET", url: { raw: "{{baseUrl}}/pets/:petId?limit=5", variable: [{ key: "petId", value: "42" }], query: [{ key: "limit", value: "5" }, { key: "filter", value: "active", disabled: true }] }, header: [{ key: "Accept", value: "application/json" }, { key: "X-API-Key", value: "private-header-key", disabled: true }] } },
      { name: "Admin", auth: { type: "basic", basic: [{ key: "username", value: "private-user" }, { key: "password", value: "private-pass" }] }, item: [
        { name: "Create pet", request: { method: "POST", auth: { type: "inherit" }, url: "{{baseUrl}}/pets", body: { mode: "raw", raw: '{"name":"Nora","password":"private-body-pass"}', options: { raw: { language: "json" } } } } },
        { name: "Public", request: { method: "GET", auth: { type: "noauth" }, url: "{{baseUrl}}/public" } },
      ] },
    ] },
  ] }));
  assert.equal(plan.format, "postman");
  assert.deepEqual(plan.folders.map((folder) => [folder.name, folder.parentId]), [["Pets", null], ["Admin", "folder-1"]]);
  assert.equal(plan.requests.length, 3);
  const [get, post, publicRequest] = plan.requests;
  assert.equal(get!.folderId, "folder-1");
  assert.equal(get!.url, "{{baseUrl}}/pets/{{petId}}");
  assert.deepEqual(get!.params, [{ key: "limit", value: "5", enabled: true }, { key: "filter", value: "active", enabled: false }]);
  assert.equal(get!.headers[1]!.value, "{{X-API-Key}}");
  assert.equal(get!.headers[1]!.enabled, false);
  assert.equal(get!.auth.type, "bearer");
  assert.equal(post!.folderId, "folder-2");
  assert.equal(post!.auth.type, "basic");
  assert.equal(post!.auth.username, "{{username}}");
  assert.deepEqual(JSON.parse(post!.body.text), { name: "Nora", password: "{{password}}" });
  assert.equal(publicRequest!.auth.type, "none");
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "https://api.example.test");
  assert.equal(plan.variables.find((variable) => variable.key === "petId")!.value, "42");
  assert.equal(plan.variables.find((variable) => variable.key === "special")!.secret, true);
  assert.ok(plan.variables.filter((variable) => variable.secret).every((variable) => variable.value === ""));
  assert.ok(!JSON.stringify(plan).includes("private-"));
});

test("Postman 2.0 accepts string requests and URLs, URL-encoded rows and raw text without executing scripts", () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Unexpected network request"); }) as typeof fetch;
  try {
    const plan = parse(collection({ info: { name: "Old collection", schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" }, event: [{ listen: "prerequest", script: { exec: ["fetch('https://never-fetch.invalid')"] } }], item: [
      { name: "Plain URL", request: "https://example.test/pets?q=all&token=private-query-token" },
      { name: "Text", request: { method: "POST", url: "https://example.test/text", body: { mode: "raw", raw: "hello world" } } },
      { name: "Form", request: { method: "POST", url: "https://example.test/form", body: { mode: "urlencoded", urlencoded: [{ key: "name", value: "Milo" }, { key: "secret", value: "private-form-secret", disabled: true }] } } },
    ] }));
    assert.equal(plan.requests[0]!.method, "GET");
    assert.equal(plan.requests[0]!.url, "https://example.test/pets");
    assert.deepEqual(plan.requests[0]!.params, [{ key: "q", value: "all", enabled: true }, { key: "token", value: "{{token}}", enabled: true }]);
    assert.equal(plan.requests[1]!.body.mode, "text");
    assert.equal(plan.requests[1]!.body.text, "hello world");
    assert.deepEqual(plan.requests[2]!.body.form, [{ key: "name", value: "Milo", enabled: true }, { key: "secret", value: "{{secret}}", enabled: false }]);
    assert.equal(plan.counts.scripts, 3);
    assert.ok(!JSON.stringify(plan).includes("fetch("));
    assert.ok(!JSON.stringify(plan).includes("private-"));
  } finally { globalThis.fetch = oldFetch; }
});

test("Postman 2.0 object auth and text header-list use their real schema shapes", () => {
  const plan = parsePostman("\uFEFF" + JSON.stringify(collection({ info: { name: "Old auth", schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" }, auth: { type: "basic", basic: { username: "{{account}}", password: "private-old-password" } }, variable: [{ key: "account", value: "private-old-user" }], item: [
    { request: { method: "GET", url: "https://example.test", header: "Accept: application/json\r\nAuthorization: private-old-header\r\nX-URL: https://example.test/a:b" } },
    { name: "Bearer folder", auth: { type: "bearer", bearer: { token: "{{oldBearer}}" } }, item: [{ request: { method: "GET", url: "https://example.test", auth: { type: "inherit" } } }] },
    { request: { method: "GET", url: "https://example.test", auth: { type: "apikey", apikey: { key: "X-Key", value: "private-old-api-key", in: "header" } } } },
  ] })));
  assert.equal(plan.requests[0]!.auth.type, "basic");
  assert.equal(plan.requests[0]!.auth.username, "{{account}}");
  assert.deepEqual(plan.requests[0]!.headers, [{ key: "Accept", value: "application/json", enabled: true }, { key: "Authorization", value: "{{Authorization}}", enabled: true }, { key: "X-URL", value: "https://example.test/a:b", enabled: true }]);
  assert.equal(plan.requests.find((request) => request.folderId !== null)!.auth.token, "{{oldBearer}}");
  assert.equal(plan.requests.find((request) => request.auth.type === "apiKey")!.auth.value, "{{apiKey}}");
  assert.ok(!JSON.stringify(plan).includes("private-"));
});

test("JSON without a language hint is sanitized; invalid JSON is skipped and expansion errors cannot reveal raw credentials", () => {
  const plan = parse(collection({ item: [
    { request: { method: "POST", url: "https://example.test", body: { mode: "raw", raw: '{"token":"private-implicit-json"}' } } },
    { request: { method: "POST", url: "https://example.test", body: { mode: "raw", raw: '{"password":"private-invalid-json",', options: { raw: { language: "json" } } } } },
  ] }));
  assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { token: "{{token}}" });
  assert.equal(plan.requests[1]!.body.mode, "none");
  assert.ok(!JSON.stringify(plan).includes("private-"));
  const raw = JSON.stringify({ password: "private-raw-password", values: Array.from({ length: 100 }, () => "x".repeat(4096)) });
  assert.throws(() => parse(collection({ item: Array.from({ length: 10 }, () => ({ request: { method: "POST", url: "https://example.test", body: { mode: "raw", raw, options: { raw: { language: "json" } } } } })) })), /too much expansion/);
});

test("URL-shaped public variables and examples discard credentials without nested secret placeholders", () => {
  const plan = parse(collection({ variable: [{ key: "baseUrl", value: "https://alice:private-url-pass@example.test?api%5Fkey=private-url-key&q=public" }], item: [{ request: { method: "POST", url: "{{baseUrl}}/pets", body: { mode: "raw", raw: JSON.stringify({ link: "https://alice:private-example-pass@example.test?token=private-example-token&q=ok" }) } } }] }));
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "https://example.test?q=public");
  assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { link: "https://example.test?q=ok" });
  assert.ok(!JSON.stringify(plan).includes("private-"));
});

test("multipart remains genuine multipart text; files are counted, disabled fields excluded and boundary collisions avoided", () => {
  const plan = parse(collection({ item: [{ name: "Upload", event: [{ script: { exec: ["dangerous-code()"] } }], request: { method: "POST", url: "https://example.test/upload", header: [{ key: "Content-Type", value: "multipart/form-data" }], body: { mode: "formdata", formdata: [
    { key: "caption", type: "text", value: "photo\r\n--CodeChatterImport0" }, { key: "hidden", type: "text", value: "excluded", disabled: true }, { key: "attachment", type: "file", src: "C:/private/photo.png" },
  ] } } }] }));
  const request = plan.requests[0]!;
  assert.equal(request.body.mode, "text");
  assert.equal(request.body.form.length, 0);
  assert.equal(request.headers.filter((row) => row.key.toLowerCase() === "content-type").length, 1);
  assert.match(request.headers[0]!.value, /boundary=CodeChatterImport1$/);
  assert.match(request.body.text, /^--CodeChatterImport1\r\n/);
  assert.match(request.body.text, /--CodeChatterImport1--\r\n$/);
  assert.ok(!request.body.text.includes("excluded"));
  assert.ok(!JSON.stringify(plan).includes("C:/private"));
  assert.equal(plan.counts.files, 1);
  assert.equal(plan.counts.scripts, 1);
  assert.ok(plan.warnings.some((warning) => /raw multipart/.test(warning)));
});

test("structured URLs work without raw, inherit collection auth and redact literals from all supported auth kinds", () => {
  const plan = parse(collection({ auth: { type: "bearer", bearer: [{ key: "token", value: "private-bearer" }] }, item: [
    { request: { method: "GET", url: { protocol: "https", host: ["api", "example", "test"], port: "8443", path: ["pets", ":id"], variable: [{ key: "id", value: "10" }] } } },
    { request: { method: "GET", url: "https://example.test", auth: { type: "apikey", apikey: [{ key: "key", value: "X-Key" }, { key: "value", value: "private-api-key" }, { key: "in", value: "query" }] } } },
    { request: { method: "GET", url: "https://private-user:private-pass@example.test", auth: { type: "basic", basic: [{ key: "username", value: "private-user" }, { key: "password", value: "private-pass" }] } } },
  ] }));
  assert.equal(plan.requests[0]!.url, "https://api.example.test:8443/pets/{{id}}");
  assert.equal(plan.requests[0]!.auth.token, "{{token}}");
  assert.deepEqual(plan.requests[1]!.auth, { type: "apiKey", token: "", username: "", password: "", key: "X-Key", value: "{{apiKey}}", in: "query" });
  assert.equal(plan.requests[2]!.url, "https://example.test");
  assert.ok(!JSON.stringify(plan).includes("private-"));
});

test("prototype properties cannot pollute globals and long names are clipped as literal data", () => {
  const input = '{"info":{"name":"<script>literal</script>","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"__proto__":{"polluted":true},"variable":[{"key":"constructor","value":"bad"},{"key":"__proto__","value":"bad"}],"item":[{"name":"__proto__","request":{"method":"POST","url":"https://example.test","body":{"mode":"raw","raw":"{\\"__proto__\\":{\\"polluted\\":true},\\"constructor\\":1,\\"name\\":\\"safe\\"}","options":{"raw":{"language":"json"}}}}}]}';
  const plan = parsePostman(input);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.equal(plan.name, "<script>literal</script>");
  assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { name: "safe" });
  const long = parse(collection({ item: [{ name: "x".repeat(1000), request: { method: "GET", url: "https://example.test" } }] }));
  assert.equal(long.requests[0]!.name.length, 120);
  assert.ok(long.counts.truncated > 0);
});

test("invalid and oversized collections fail plainly; excessive requests, nesting and fields are bounded", () => {
  assert.throws(() => parsePostman(" ".repeat(IMPORT_TEXT_LIMIT + 1)), /over 5 MB/);
  assert.throws(() => parsePostman("[".repeat(201) + "0" + "]".repeat(201)), /more than 200 levels/);
  assert.throws(() => parse(collection({ item: Array.from({ length: 2001 }, (_, i) => ({ name: `${i}`, request: "https://example.test" })) })), /more than 2,000 requests/);
  assert.throws(() => parse({ info: { schema: "https://schema.getpostman.com/json/collection/v1.0.0/collection.json" }, item: [] }), /v2.0 or v2.1/);
  assert.throws(() => parse(collection({ item: [] })), /No supported HTTP requests/);
  assert.throws(() => parsePostman("{ secret-input-sentinel"), (error: unknown) => error instanceof Error && !error.message.includes("secret-input-sentinel"));
  const plan = parse(collection({ item: [{ request: { method: "TRACE", url: "https://example.test" } }, { request: "https://example.test" }] }));
  assert.equal(plan.requests.length, 1);
  assert.equal(plan.counts.unsupported, 1);
});

test("structured Postman query fields encode literal spans and preserve variable placeholders through resolution", () => {
  const plan = parse(collection({ item: [{ request: { method: "GET", url: { raw: "https://example.test/pets", query: [
    { key: "q", value: "a&b#c" }, { key: "name&= #界", value: "a&{{phrase}}#界%2F" }, { key: "off", value: "not included", disabled: true },
  ] } } }] }));
  const request = plan.requests[0]!;
  const result = resolveRequest({ ...request, url: withQuery(request.url, request.params) }, (key) => key === "phrase" ? "ready" : undefined);
  const url = new URL(result.input.url);
  assert.equal(url.searchParams.get("q"), "a&b#c");
  assert.equal(url.searchParams.get("name&= #界"), "a&ready#界%2F");
  assert.equal(url.searchParams.has("off"), false);
  assert.equal(url.hash, "");
  assert.equal([...url.searchParams].length, 2);
  assert.match(request.params[1]!.value, /\{\{phrase\}\}/);
});

test("raw URL-derived query rows keep their existing URI encoding", () => {
  const original = "https://example.test/pets?q=a%26b%23c&name%26%3D%20%23%E7%95%8C=%E7%95%8C%252F";
  const plan = parse(collection({ item: [{ request: { method: "GET", url: original } }] }));
  const request = plan.requests[0]!;
  const result = resolveRequest({ ...request, url: withQuery(request.url, request.params) }, () => undefined);
  assert.equal(result.input.url, original);
  const url = new URL(result.input.url);
  assert.equal(url.searchParams.get("q"), "a&b#c");
  assert.equal(url.searchParams.get("name&= #界"), "界%2F");
});
