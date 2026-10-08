import { describe, expect, it } from "vitest";

import type { HttpSendInput } from "./send.js";
import { generateSnippet } from "./snippets.js";

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
});
