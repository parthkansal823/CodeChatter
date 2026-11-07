import { describe, expect, it } from "vitest";

import type { HttpSendInput } from "./send.js";
import { emptyAuth, emptyBody, resolveRequest, type RequestAuth, type RequestSpec } from "./request.js";
import { generateSnippet, SNIPPET_LANGUAGES } from "./snippets.js";

const post: HttpSendInput = {
  method: "POST",
  url: "https://api.example.com/items?limit=10",
  headers: [
    { name: "Content-Type", value: "application/json" },
    { name: "Authorization", value: "Bearer {{token}}" },
  ],
  body: '{"name":"O\'Brien","tags":["a"],"ok":true,"none":null}',
};
const get: HttpSendInput = { method: "GET", url: "http://localhost:3000/api/notes", headers: [], body: null };

type AxiosConfig = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: unknown;
  transformRequest?: Array<(data: unknown) => unknown>;
  validateStatus: (status: number) => boolean;
};

/** Execute generated JavaScript against a stub, proving values survive escaping without any network request. */
async function axiosConfig(input: HttpSendInput): Promise<AxiosConfig> {
  let captured: AxiosConfig | undefined;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
  const code = generateSnippet("axios", input).replace(/^import axios from "axios";\n/, "");
  await new AsyncFunction("axios", "console", code)(async (config: AxiosConfig) => {
    captured = config;
    return { status: 400, data: "fixture response" };
  }, { log: () => {} });
  if (!captured) throw new Error("The generated snippet did not call axios.");
  return captured;
}

function resolved(auth: RequestAuth, extra: Partial<RequestSpec> = {}): HttpSendInput {
  return resolveRequest({ method: "GET", url: get.url, headers: [], body: emptyBody(), auth, ...extra }, () => undefined).input;
}

describe("snippets", () => {
  it("writes cURL that quotes safely", () => {
    expect(generateSnippet("curl", post)).toBe(
      [
        "curl -X POST 'https://api.example.com/items?limit=10' \\",
        "  -H 'Content-Type: application/json' \\",
        "  -H 'Authorization: Bearer {{token}}' \\",
        `  --data-raw '{"name":"O'\\''Brien","tags":["a"],"ok":true,"none":null}'`,
      ].join("\n"),
    );
    expect(generateSnippet("curl", get)).toBe("curl 'http://localhost:3000/api/notes'");
    expect(generateSnippet("curl", { ...get, method: "HEAD" })).toBe("curl --head 'http://localhost:3000/api/notes'");
    expect(generateSnippet("curl", { ...get, method: "DELETE" })).toBe("curl -X DELETE 'http://localhost:3000/api/notes'");
  });

  it("writes fetch with a JSON body as an object", () => {
    expect(generateSnippet("fetch", post)).toBe(
      [
        'const response = await fetch("https://api.example.com/items?limit=10", {',
        '  method: "POST",',
        "  headers: {",
        '    "Content-Type": "application/json",',
        '    "Authorization": "Bearer {{token}}",',
        "  },",
        "  body: JSON.stringify({",
        '    "name": "O\'Brien",',
        '    "tags": [',
        '      "a"',
        "    ],",
        '    "ok": true,',
        '    "none": null',
        "  }),",
        "});",
        "console.log(response.status, await response.text());",
      ].join("\n"),
    );
    expect(generateSnippet("fetch", get)).toBe(
      ['const response = await fetch("http://localhost:3000/api/notes", {', '  method: "GET",', "});", "console.log(response.status, await response.text());"].join("\n"),
    );
    expect(generateSnippet("fetch", { ...post, headers: [], body: "a=1&b=2" })).toContain('body: "a=1&b=2",');
  });

  it("writes Python with real Python literals", () => {
    const code = generateSnippet("python", post);
    expect(code).toContain("response = requests.post(");
    expect(code).toContain('    "https://api.example.com/items?limit=10",');
    expect(code).toContain('        "Authorization": "Bearer {{token}}",');
    expect(code).toContain('"ok": True,');
    expect(code).toContain('"none": None,');
    expect(code).toContain("json={");
    expect(generateSnippet("python", get)).toBe(
      ["import requests", "", "response = requests.get(", '    "http://localhost:3000/api/notes",', ")", "print(response.status_code, response.text)"].join("\n"),
    );
  });

  it("writes a Go program that compiles in shape", () => {
    const code = generateSnippet("go", post);
    expect(code).toContain('\t"strings"');
    expect(code).toContain('body := strings.NewReader("{\\"name\\":\\"O\'Brien\\",\\"tags\\":[\\"a\\"],\\"ok\\":true,\\"none\\":null}")');
    expect(code).toContain('http.NewRequest("POST", "https://api.example.com/items?limit=10", body)');
    expect(code).toContain('req.Header.Add("Content-Type", "application/json")');
    const plain = generateSnippet("go", get);
    expect(plain).not.toContain("strings");
    expect(plain).toContain('http.NewRequest("GET", "http://localhost:3000/api/notes", nil)');
  });

  it("offers an axios snippet that displays non-2xx responses too", async () => {
    expect(SNIPPET_LANGUAGES.find((language) => language.id === "axios")?.label).toBe("JavaScript axios");
    const config = await axiosConfig(get);
    expect(config.method).toBe("GET");
    expect(config.url).toBe(get.url);
    expect(config).not.toHaveProperty("data");
    expect(config.validateStatus(200)).toBe(true);
    expect(config.validateStatus(400)).toBe(true);
    expect(generateSnippet("axios", get)).toContain('import axios from "axios";');
  });

  it("keeps JSON exactly as written, including big integers and hostile property names", async () => {
    const body = '{\n  "id": 900719925474099312345, "__proto__": {"polluted":true}, "constructor": "data", "name":"O\'Brien"\n}';
    const config = await axiosConfig({ ...post, body });
    expect(config.data).toBe(body);
    expect(config.transformRequest?.[0]?.(config.data)).toBe(body);
    expect(config.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer {{token}}" });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("does not let axios reinterpret scalar or invalid JSON text", async () => {
    for (const body of ['null', '"hello"', "123456789012345678901234567890", "{not valid JSON"]) {
      const config = await axiosConfig({ ...post, body });
      expect(config.data).toBe(body);
      expect(config.transformRequest?.[0]?.(body)).toBe(body);
    }
  });

  it("escapes URLs, headers and raw bodies as JavaScript data", async () => {
    const url = 'https://api.example.com/quotes?value="\\${notJavaScript}`';
    const value = 'O\'Brien "quoted" \\ ${notJavaScript} `tick`';
    const body = `${value}\nnext line`;
    const config = await axiosConfig({ method: "POST", url, headers: [{ name: "X-Example", value }, { name: "__proto__", value: "a plain header" }], body });
    expect(config.url).toBe(url);
    expect(config.data).toBe(body);
    expect(config.headers?.["X-Example"]).toBe(value);
    expect(Object.hasOwn(config.headers!, "__proto__")).toBe(true);
    expect(config.headers?.["__proto__"]).toBe("a plain header");
    expect(Object.getPrototypeOf(config.headers)).toBe(Object.prototype);
  });

  it("writes urlencoded forms with duplicate fields and disabled fields resolved away", async () => {
    const input = resolved(emptyAuth(), {
      method: "POST",
      body: { ...emptyBody(), mode: "form", form: [
        { key: "tag", value: "a", enabled: true },
        { key: "tag", value: "b", enabled: true },
        { key: "name", value: "O'Brien + spaces", enabled: true },
        { key: "ignored", value: "not sent", enabled: false },
      ] },
    });
    const config = await axiosConfig(input);
    expect(config.data).toBeInstanceOf(URLSearchParams);
    expect((config.data as URLSearchParams).toString()).toBe(input.body);
    expect((config.data as URLSearchParams).getAll("tag")).toEqual(["a", "b"]);
    expect((config.data as URLSearchParams).has("ignored")).toBe(false);
    expect(config.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("keeps resolved bearer, basic and API-key authentication in their actual wire locations", async () => {
    const bearer = await axiosConfig(resolved({ ...emptyAuth(), type: "bearer", token: "{{token}}" }, { headers: [{ key: "Ignored", value: "unused", enabled: false }] }));
    expect(bearer.headers).toEqual({ Authorization: "Bearer {{token}}" });
    const basic = await axiosConfig(resolved({ ...emptyAuth(), type: "basic", username: "fixture-user", password: "fixture-password" }));
    expect(basic.headers?.["Authorization"]).toBe(`Basic ${btoa("fixture-user:fixture-password")}`);
    expect(basic).not.toHaveProperty("auth");
    const headerKey = await axiosConfig(resolved({ ...emptyAuth(), type: "apiKey", key: "X-API-Key", value: "{{key}}", in: "header" }));
    expect(headerKey.headers?.["X-API-Key"]).toBe("{{key}}");
    const queryKey = await axiosConfig(resolved({ ...emptyAuth(), type: "apiKey", key: "api key", value: "fixture value", in: "query" }));
    expect(queryKey.url).toBe(`${get.url}?api%20key=fixture%20value`);
    expect(queryKey).not.toHaveProperty("auth");
  });

  it("omits HEAD bodies while retaining GET bodies allowed by the shared request model", async () => {
    const head = await axiosConfig({ ...post, method: "HEAD" });
    expect(head).not.toHaveProperty("data");
    expect(head).not.toHaveProperty("transformRequest");
    const withBody = await axiosConfig(resolved(emptyAuth(), { body: { ...emptyBody(), mode: "text", text: "a GET body" } }));
    expect(withBody.method).toBe("GET");
    expect(withBody.data).toBe("a GET body");
  });
});
