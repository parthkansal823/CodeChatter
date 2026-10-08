import { describe, expect, it } from "vitest";

import { emptyAuth, emptyBody, parseQuery, resolveRequest, splitVariables, substituteVariables, withQuery, type RequestSpec } from "./request.js";
import { sandboxTarget } from "./send.js";

const vars = (values: Record<string, string>) => (name: string) => values[name];

const spec = (patch: Partial<RequestSpec> = {}): RequestSpec => ({
  method: "GET",
  url: "https://api.example.com/items",
  headers: [],
  body: emptyBody(),
  auth: emptyAuth(),
  ...patch,
});

describe("variable substitution", () => {
  it("replaces known variables and reports unknown ones", () => {
    const result = substituteVariables("{{base}}/users/{{ id }}?t={{token}}", vars({ base: "https://x.dev", id: "42" }));
    expect(result.text).toBe("https://x.dev/users/42?t={{token}}");
    expect(result.missing).toEqual(["token"]);
  });

  it("substitutes once, so values containing braces are sent as written", () => {
    const result = substituteVariables("{{a}}", vars({ a: "{{b}}", b: "never" }));
    expect(result.text).toBe("{{b}}");
    expect(result.missing).toEqual([]);
  });

  it("offers dynamic values", () => {
    const { text } = substituteVariables("{{$randomUUID}} {{$timestamp}}", vars({}));
    expect(text).toMatch(/^[0-9a-f-]{36} \d{10}$/);
  });

  it("lets an environment value win over a dynamic one", () => {
    expect(substituteVariables("{{$timestamp}}", vars({ $timestamp: "fixed" })).text).toBe("fixed");
  });

  it("leaves text without variables alone", () => {
    expect(substituteVariables("{ \"a\": {} } {{}} {{ }}", vars({})).text).toBe("{ \"a\": {} } {{}} {{ }}");
  });

  it("splits text for highlighting", () => {
    expect(splitVariables("a{{b}}c{{ d }}")).toEqual([{ text: "a" }, { text: "{{b}}", name: "b" }, { text: "c" }, { text: "{{ d }}", name: "d" }]);
    expect(splitVariables("")).toEqual([]);
  });
});

describe("query parameters", () => {
  it("parses the query raw, keeping variables and encoding", () => {
    expect(parseQuery("http://x/a?q={{term}}&page=2&flag&e=%20#top")).toEqual([
      { key: "q", value: "{{term}}", enabled: true },
      { key: "page", value: "2", enabled: true },
      { key: "flag", value: "", enabled: true },
      { key: "e", value: "%20", enabled: true },
    ]);
  });

  it("rewrites only the query, keeping the fragment and leaving disabled rows out", () => {
    const url = withQuery("http://x/a?old=1#top", [
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "2", enabled: false },
      { key: "", value: "", enabled: true },
    ]);
    expect(url).toBe("http://x/a?a=1#top");
    expect(withQuery("http://x/a?old=1", [])).toBe("http://x/a");
  });
});

describe("sandbox targets", () => {
  it("routes localhost to the room's sandbox", () => {
    expect(sandboxTarget("http://localhost:3000/api/notes?x=1")).toEqual({ port: 3000, path: "/api/notes?x=1", secure: false });
    expect(sandboxTarget("http://LOCALHOST./")).toEqual({ port: 80, path: "/", secure: false });
  });

  it("leaves everything else to the internet path", () => {
    expect(sandboxTarget("http://127.0.0.1:3000/")).toBeNull();
    expect(sandboxTarget("http://localhost.evil.com/")).toBeNull();
    expect(sandboxTarget("ftp://localhost/")).toBeNull();
    expect(sandboxTarget("not a url")).toBeNull();
  });
});

describe("request resolution", () => {
  it("substitutes the URL, headers and body", () => {
    const { input, missing } = resolveRequest(
      spec({
        method: "POST",
        url: "{{base}}/items",
        headers: [
          { key: "X-Trace", value: "{{trace}}", enabled: true },
          { key: "X-Off", value: "1", enabled: false },
        ],
        body: { ...emptyBody(), mode: "json", text: '{"name":"{{name}}"}' },
      }),
      vars({ base: "https://api.example.com", name: "Ada" }),
    );
    expect(input.url).toBe("https://api.example.com/items");
    expect(input.headers).toEqual([
      { name: "X-Trace", value: "{{trace}}" },
      { name: "Content-Type", value: "application/json" },
    ]);
    expect(input.body).toBe('{"name":"Ada"}');
    expect(missing).toEqual(["trace"]);
  });

  it("assumes http for a bare host", () => {
    expect(resolveRequest(spec({ url: "example.com/x" }), vars({})).input.url).toBe("http://example.com/x");
  });

  it("builds auth headers and lets the Auth tab replace a typed header", () => {
    const bearer = resolveRequest(
      spec({ headers: [{ key: "authorization", value: "old", enabled: true }], auth: { ...emptyAuth(), type: "bearer", token: "{{t}}" } }),
      vars({ t: "abc" }),
    );
    expect(bearer.input.headers).toEqual([{ name: "Authorization", value: "Bearer abc" }]);

    const basic = resolveRequest(spec({ auth: { ...emptyAuth(), type: "basic", username: "ada", password: "pässword" } }), vars({}));
    expect(basic.input.headers[0]!.value).toBe(`Basic ${Buffer.from("ada:pässword").toString("base64")}`);
  });

  it("puts an API key in the query when asked", () => {
    const { input } = resolveRequest(spec({ url: "https://x.dev/a?b=1#f", auth: { ...emptyAuth(), type: "apiKey", key: "api key", value: "v&1", in: "query" } }), vars({}));
    expect(input.url).toBe("https://x.dev/a?b=1&api%20key=v%261#f");
  });

  it("encodes form bodies and GraphQL", () => {
    const form = resolveRequest(
      spec({ method: "POST", body: { ...emptyBody(), mode: "form", form: [{ key: "a b", value: "c&d", enabled: true }, { key: "x", value: "y", enabled: false }] } }),
      vars({}),
    );
    expect(form.input.body).toBe("a+b=c%26d");
    expect(form.input.headers).toContainEqual({ name: "Content-Type", value: "application/x-www-form-urlencoded" });

    const gql = resolveRequest(spec({ method: "POST", body: { ...emptyBody(), mode: "graphql", query: "{ me { id } }", variables: '{"a":1}' } }), vars({}));
    expect(JSON.parse(gql.input.body!)).toEqual({ query: "{ me { id } }", variables: { a: 1 } });

    const bad = resolveRequest(spec({ method: "POST", body: { ...emptyBody(), mode: "graphql", query: "{}", variables: "{nope" } }), vars({}));
    expect(bad.problems).toEqual(["The GraphQL variables aren't valid JSON."]);
  });

  it("keeps a Content-Type the person set and never sends a body with HEAD", () => {
    const typed = resolveRequest(
      spec({ method: "POST", headers: [{ key: "content-type", value: "application/vnd.api+json", enabled: true }], body: { ...emptyBody(), mode: "json", text: "{}" } }),
      vars({}),
    );
    expect(typed.input.headers).toEqual([{ name: "content-type", value: "application/vnd.api+json" }]);
    expect(resolveRequest(spec({ method: "HEAD", body: { ...emptyBody(), mode: "text", text: "x" } }), vars({})).input.body).toBeNull();
  });
});
