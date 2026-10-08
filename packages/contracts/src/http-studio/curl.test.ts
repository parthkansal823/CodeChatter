import { describe, expect, it } from "vitest";

import { parseCurl, shellWords } from "./curl.js";

describe("shell words", () => {
  it("handles quotes, escapes and line continuations", () => {
    expect(shellWords(`curl 'a b' "c \\"d\\" $e" f\\ g \\\n  -H $'x\\ty'`)).toEqual(["curl", "a b", 'c "d" $e', "f g", "-H", "x\ty"]);
  });

  it("reads Windows cmd escaping", () => {
    expect(shellWords('curl ^"https://x.dev/?a=1^&b=2^" ^\n  -H ^"accept: */*^"')).toEqual(["curl", "https://x.dev/?a=1&b=2", "-H", "accept: */*"]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => shellWords("curl 'oops")).toThrow(/isn't closed/);
  });
});

describe("cURL import", () => {
  it("imports a devtools-style command", () => {
    const req = parseCurl(`curl 'https://api.example.com/v1/items?limit=10' \\
      -H 'accept: application/json' \\
      -H 'authorization: Bearer secret-token' \\
      -H 'content-type: application/json' \\
      -H 'content-length: 99' \\
      --data-raw '{"name":"Ada","tags":["x"]}' \\
      --compressed`);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.example.com/v1/items?limit=10");
    expect(req.headers).toEqual([
      { key: "accept", value: "application/json", enabled: true },
      { key: "content-type", value: "application/json", enabled: true },
    ]);
    expect(req.auth).toMatchObject({ type: "bearer", token: "secret-token" });
    expect(req.body.mode).toBe("json");
    expect(JSON.parse(req.body.text)).toEqual({ name: "Ada", tags: ["x"] });
    expect(req.warnings).toEqual([]);
  });

  it("reads methods, short clusters, basic auth and form data", () => {
    const req = parseCurl("curl -sSL -XPUT -u ada:s3cret:x https://x.dev/a -d 'a=1' -d 'b=two%20words'");
    expect(req.method).toBe("PUT");
    expect(req.auth).toMatchObject({ type: "basic", username: "ada", password: "s3cret:x" });
    expect(req.body.mode).toBe("form");
    expect(req.body.form).toEqual([
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "two words", enabled: true },
    ]);
  });

  it("moves data into the query with -G and knows HEAD", () => {
    expect(parseCurl("curl -G https://x.dev/s --data-urlencode 'q=a b' -d page=2")).toMatchObject({ method: "GET", url: "https://x.dev/s?q=a%20b&page=2" });
    expect(parseCurl("curl -I example.com")).toMatchObject({ method: "HEAD", url: "http://example.com" });
  });

  it("recognises GraphQL and --json", () => {
    const gql = parseCurl(`curl https://x.dev/graphql --json '{"query":"query($id: ID!) { user(id: $id) { name } }","variables":{"id":"1"}}'`);
    expect(gql.body).toMatchObject({ mode: "graphql", query: "query($id: ID!) { user(id: $id) { name } }" });
    expect(JSON.parse(gql.body.variables)).toEqual({ id: "1" });
    expect(gql.headers.map((h) => h.key)).toEqual(["Content-Type", "Accept"]);
  });

  it("keeps plain text bodies and warns about what it can't carry over", () => {
    const req = parseCurl("curl https://x.dev -H 'Content-Type: text/plain' --data-binary 'hello world' -F 'file=@a.png' --frobnicate -o out.txt");
    expect(req.body).toMatchObject({ mode: "text", text: "hello world" });
    expect(req.warnings).toEqual(["Skipped the file field file: file uploads aren't supported.", "Ignored --frobnicate."]);
  });

  it("explains what's wrong with input that isn't a command", () => {
    expect(() => parseCurl("wget https://x.dev")).toThrow(/start with curl/);
    expect(() => parseCurl("curl -H 'a: b'")).toThrow(/no URL/);
    expect(() => parseCurl("curl https://x.dev -H")).toThrow(/needs a value/);
  });
});
