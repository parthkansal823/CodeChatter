/** Exercise real API documents and hostile inputs without creating a browser, network request or shared Yjs document. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRequest, withQuery } from "../../../../../../packages/contracts/src/http-studio/request";
import { IMPORT_TEXT_LIMIT, ImportBuilder, importUrl, parseOpenApi } from "./import-openapi";

const openApi = (extra: Record<string, unknown> = {}) => ({ openapi: "3.1.0", info: { title: "Pet service", version: "1" }, paths: { "/health": { get: { summary: "Health" } } }, ...extra });
const parse = (value: unknown) => parseOpenApi(JSON.stringify(value));

test("OpenAPI 3.1: tags, server defaults, path/query rows, local schemas and security", () => {
  const plan = parse(openApi({
    servers: [{ url: "https://{region}.example.test/{version}", variables: { region: { default: "api" }, version: { default: "v1" } } }],
    tags: [{ name: "Pets" }, { name: "Admin" }],
    security: [{ Bearer: [] }],
    components: {
      securitySchemes: { Bearer: { type: "http", scheme: "bearer" }, Key: { type: "apiKey", in: "header", name: "X-API-Key" } },
      parameters: { Limit: { in: "query", name: "limit", required: false, schema: { type: "integer", default: 10 } } },
      schemas: { Pet: { type: "object", properties: { name: { type: "string", example: "Milo" }, age: { type: "integer" }, active: { type: "boolean" }, password: { type: "string", example: "must-not-survive" }, id: { type: "string", readOnly: true } } } },
    },
    paths: {
      "/pets/{petId}": {
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string", default: "42" } }, { $ref: "#/components/parameters/Limit" }],
        get: { summary: "Read a pet", tags: ["Pets"], parameters: [{ name: "filter", in: "query", required: true, example: "active" }] },
        post: { operationId: "updatePet", tags: ["Pets", "Admin"], security: [{ Key: [] }], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  }));
  assert.equal(plan.format, "openapi");
  assert.deepEqual(plan.folders.map((folder) => folder.name), ["Pets", "Admin"]);
  assert.equal(plan.requests.length, 2);
  const [get, post] = plan.requests;
  assert.equal(get!.name, "Read a pet");
  assert.equal(get!.url, "{{baseUrl}}/pets/{{petId}}");
  assert.deepEqual(get!.params, [{ key: "limit", value: "10", enabled: false }, { key: "filter", value: "active", enabled: true }]);
  assert.equal(get!.auth.type, "bearer");
  assert.equal(get!.auth.token, "{{token}}");
  assert.equal(post!.name, "updatePet");
  assert.equal(post!.body.mode, "json");
  assert.deepEqual(JSON.parse(post!.body.text), { name: "Milo", age: 0, active: false, password: "{{password}}" });
  assert.deepEqual(post!.headers, [{ key: "X-API-Key", value: "{{Key}}", enabled: true }]);
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "https://api.example.test/v1");
  assert.equal(plan.variables.find((variable) => variable.key === "petId")!.value, "42");
  assert.equal(plan.variables.find((variable) => variable.key === "token")!.secret, true);
  assert.ok(!JSON.stringify(plan).includes("must-not-survive"));
});

test("OpenAPI 3.0: examples precede schema, operation parameters override path defaults and noauth clears inheritance", () => {
  const plan = parse(openApi({ openapi: "3.0.3", security: [{ Basic: [] }], components: { securitySchemes: { Basic: { type: "http", scheme: "basic" } }, examples: { Pet: { value: { name: "example", token: "discard-me" } } } }, paths: {
    "/pets": { parameters: [{ in: "query", name: "q", required: true, example: "old" }], post: { security: [], parameters: [{ in: "query", name: "q", example: "new" }], requestBody: { content: { "application/json": { examples: { first: { $ref: "#/components/examples/Pet" } }, schema: { type: "object", properties: { ignored: { type: "boolean" } } } } } } } },
  } }));
  const request = plan.requests[0]!;
  assert.equal(request.name, "POST /pets");
  assert.equal(request.auth.type, "none");
  assert.deepEqual(request.params, [{ key: "q", value: "new", enabled: false }]);
  assert.deepEqual(JSON.parse(request.body.text), { name: "example", token: "{{token}}" });
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "");
  assert.ok(!JSON.stringify(plan).includes("discard-me"));
});

test("Swagger 2.0: base URL, basic auth, body references, URL-encoded and multipart text fields", () => {
  const plan = parse({ swagger: "2.0", info: { title: "Legacy pets", version: "1" }, host: "legacy.example.test", basePath: "/v2", schemes: ["https"], securityDefinitions: { Basic: { type: "basic" } }, security: [{ Basic: [] }], definitions: { Pet: { type: "object", properties: { name: { type: "string", default: "Nora" } } } }, paths: {
    "/pets": { post: { parameters: [{ in: "body", name: "pet", schema: { $ref: "#/definitions/Pet" } }] } },
    "/form": { post: { parameters: [{ in: "formData", name: "name", type: "string", default: "Nora" }] } },
    "/upload": { post: { consumes: ["multipart/form-data"], parameters: [{ in: "formData", name: "caption", type: "string", default: "Photo" }, { in: "formData", name: "file", type: "file" }] } },
  } });
  assert.equal(plan.format, "swagger");
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "https://legacy.example.test/v2");
  assert.equal(plan.requests[0]!.auth.type, "basic");
  assert.equal(plan.requests[0]!.auth.username, "{{username}}");
  assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { name: "Nora" });
  assert.deepEqual(plan.requests[1]!.body.form, [{ key: "name", value: "Nora", enabled: true }]);
  assert.equal(plan.requests[2]!.body.mode, "text");
  assert.match(plan.requests[2]!.body.text, /name="caption"\r\n\r\nPhoto/);
  assert.match(plan.requests[2]!.headers[0]!.value, /^multipart\/form-data; boundary=/);
  assert.equal(plan.counts.files, 1);
});

test("YAML uses the existing pure parser and rejects aliases, duplicate keys, tags and extra documents", () => {
  const plan = parseOpenApi("openapi: 3.1.0\ninfo:\n  title: YAML pets\npaths:\n  /pets:\n    get:\n      summary: Read pets\n");
  assert.equal(plan.name, "YAML pets");
  assert.equal(plan.requests[0]!.name, "Read pets");
  for (const input of ["openapi: 3.1.0\n---\npaths: {}", "a: &a [*a]", "a: !arbitrary value", "openapi: 3.1.0\nopenapi: 3.0.0"]) assert.throws(() => parseOpenApi(input), /not valid JSON or YAML/);
});

test("BOM-prefixed JSON parses and a server template without defaults leaves baseUrl wholly blank", () => {
  const plan = parseOpenApi("\uFEFF" + JSON.stringify(openApi({ servers: [{ url: "https://{region}.example.test/v1", variables: {} }] })));
  assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "");
  assert.ok(plan.warnings.some((warning) => /no default/.test(warning)));
});

test("a small local-reference DAG cannot expand huge leaf strings before the output budget is checked", () => {
  const schemas: Record<string, unknown> = { S16: { type: "string", example: "x".repeat(65_536) } };
  for (let i = 15; i >= 0; i--) schemas[`S${i}`] = { type: "object", properties: { left: { $ref: `#/components/schemas/S${i + 1}` }, right: { $ref: `#/components/schemas/S${i + 1}` } } };
  const input = openApi({ components: { schemas }, paths: { "/huge": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/S0" } } } } } } } });
  assert.throws(() => parse(input), /too much expansion/);
});

test("local cycles and deep reference chains stop; remote refs and examples are counted without fetching", () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Import performed network IO"); }) as typeof fetch;
  try {
    const plan = parse(openApi({ components: { schemas: { Loop: { type: "object", properties: { next: { $ref: "#/components/schemas/Loop" } } }, A: { $ref: "#/components/schemas/B" }, B: { $ref: "#/components/schemas/A" } } }, paths: {
      "/loop": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Loop" } } } } } },
      "/remote": { $ref: "https://never-fetch.invalid/api.json#/paths/pet" },
      "/remote-body": { post: { requestBody: { content: { "application/json": { examples: { remote: { externalValue: "https://never-fetch.invalid/example" } }, schema: { $ref: "https://never-fetch.invalid/schema.json" } } } } } },
      "/pure-cycle": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } } } },
    } }));
    assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { next: null });
    assert.ok(plan.counts.cycles >= 2);
    assert.equal(plan.counts.remoteRefs, 3);
    assert.ok(plan.warnings.some((warning) => /never fetches/.test(warning)));
    const schemas: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) schemas[`S${i}`] = i === 99 ? { type: "string" } : { $ref: `#/components/schemas/S${i + 1}` };
    const deep = parse(openApi({ components: { schemas }, paths: { "/deep": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/S0" } } } } } } } }));
    assert.equal(deep.requests[0]!.body.text, "null");
    assert.ok(deep.counts.cycles > 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("prototype-shaped names and refs do not mutate prototypes; examples stay plain data", () => {
  const input = '{"openapi":"3.1.0","info":{"title":"<img src=x onerror=alert(1)>"},"__proto__":{"polluted":true},"components":{"schemas":{"constructor":{"type":"string"}}},"paths":{"/pets":{"post":{"requestBody":{"content":{"application/json":{"example":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"name":"<script>text</script>"}}}}}},"/unsafe":{"$ref":"#/__proto__"}}}';
  const plan = parseOpenApi(input);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.deepEqual(JSON.parse(plan.requests[0]!.body.text), { name: "<script>text</script>" });
  assert.equal(plan.name, "<img src=x onerror=alert(1)>");
  assert.ok(plan.counts.unsupported >= 3);
});

test("size, nesting, request-count and expansion limits have safe actionable errors", () => {
  assert.throws(() => parseOpenApi(" ".repeat(IMPORT_TEXT_LIMIT + 1)), /over 5 MB/);
  assert.throws(() => parseOpenApi("界".repeat(Math.floor(IMPORT_TEXT_LIMIT / 3) + 1)), /over 5 MB/);
  assert.throws(() => parseOpenApi("[".repeat(201) + "0" + "]".repeat(201)), /more than 200 levels/);
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < 2001; i++) paths[`/p${i}`] = { get: {} };
  assert.throws(() => parse(openApi({ paths })), /more than 2,000 requests/);
  const schema = { type: "object", properties: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`field${i}`, { type: "string" }])) };
  const repeated = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`/p${i}`, { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Huge" } } } } } }]));
  assert.throws(() => parse(openApi({ components: { schemas: { Huge: schema } }, paths: repeated })), /too much expansion|expanded import is too large/);
  assert.throws(() => parseOpenApi("{ secret-input-sentinel"), (error: unknown) => error instanceof Error && !error.message.includes("secret-input-sentinel"));
});

test("URL credentials and known secret query/header values are discarded, not copied into a plan", () => {
  const builder = new ImportBuilder("URLs", "openapi");
  const parsed = importUrl(builder, "https://alice:literal-password@example.test/path?token=literal-token&q=public#fragment");
  assert.equal(parsed.url, "https://example.test/path");
  assert.deepEqual(parsed.params, [{ key: "token", value: "{{token}}", enabled: true }, { key: "q", value: "public", enabled: true }]);
  assert.ok(!JSON.stringify(builder.finish()).includes("literal-"));
  const encoded = importUrl(builder, "https://example.test?%61%70%69%5f%6b%65%79=encoded-private&%74oken=encoded-token");
  assert.deepEqual(encoded.params.map((row) => row.value), ["{{api_key}}", "{{token}}"]);
  assert.ok(!JSON.stringify(builder.finish()).includes("encoded-private"));
  const server = parse(openApi({ servers: [{ url: "https://example.test/{apiKey}", variables: { apiKey: { default: "private-server-key" } } }] }));
  assert.equal(server.variables.find((variable) => variable.key === "baseUrl")!.value, "");
  assert.ok(!JSON.stringify(server).includes("private-server-key"));
});

test("invalid versions, missing operations, unsupported methods and missing refs are explicit", () => {
  assert.throws(() => parse({ openapi: "4.0", paths: {} }), /OpenAPI 3.0 or 3.1/);
  assert.throws(() => parse(openApi({ paths: {} })), /No supported HTTP operations/);
  const plan = parse(openApi({ paths: { "/health": { get: {} }, "/trace": { trace: {} }, "/missing": { $ref: "#/not-found" } } }));
  assert.equal(plan.requests.length, 1);
  assert.equal(plan.counts.unsupported, 2);
});

test("structured OpenAPI query literals retain delimiter, Unicode and percent semantics through the actual resolver", () => {
  const plan = parse(openApi({ servers: [{ url: "https://example.test" }], components: { securitySchemes: { Credential: { type: "apiKey", in: "query", name: "api key&=#" } } }, security: [{ Credential: [] }], paths: { "/pets": { get: { parameters: [
    { in: "query", name: "q", required: true, example: "a&b#c" },
    { in: "query", name: "name&= #界", required: true, example: "a&{{phrase}}#界%2F" },
  ] } } } }));
  const request = plan.requests[0]!;
  const resolved = resolveRequest({ ...request, url: withQuery(request.url, request.params) }, (key) => key === "phrase" ? "ready" : key === "Credential" ? "safe-api-value" : plan.variables.find((variable) => variable.key === key)?.value);
  const url = new URL(resolved.input.url);
  assert.equal(url.searchParams.get("q"), "a&b#c");
  assert.equal(url.searchParams.get("name&= #界"), "a&ready#界%2F");
  assert.equal(url.searchParams.get("api key&=#"), "safe-api-value");
  assert.equal(url.hash, "");
  assert.equal([...url.searchParams].length, 3);
  assert.equal(resolved.missing.length, 0);
  assert.match(request.params[1]!.value, /\{\{phrase\}\}/);
});

test("path baseUrl uses a unique alias without replacing the server variable", () => {
  for (const occupied of [false, true]) {
    const plan = parse(openApi({ servers: [{ url: "https://example.test" }], paths: {
      "/pets/{baseUrl}": { get: { parameters: [{ in: "path", name: "baseUrl", required: true, example: "abc", schema: { type: "string" } }] } },
      ...(occupied ? { "/other/{pathBaseUrl}/{pathBaseUrl2}": { get: {} } } : {}),
    } }));
    const request = plan.requests[0]!;
    const alias = occupied ? "pathBaseUrl3" : "pathBaseUrl";
    assert.equal(request.url, `{{baseUrl}}/pets/{{${alias}}}`);
    assert.equal(plan.variables.find((variable) => variable.key === "baseUrl")!.value, "https://example.test");
    assert.equal(plan.variables.find((variable) => variable.key === alias)!.value, "abc");
    const result = resolveRequest({ ...request, url: withQuery(request.url, request.params) }, (key) => plan.variables.find((variable) => variable.key === key)?.value);
    assert.equal(result.input.url, "https://example.test/pets/abc");
    assert.ok(plan.warnings.some((warning) => warning.includes(`renamed to ${alias}`)));
  }
});
