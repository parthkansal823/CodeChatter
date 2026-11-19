/** Cookie semantics and private script projections stay deterministic, bounded and separate from shared request data. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import { applySetCookies, cookieHeader, cookieKey, COOKIE_LIMITS, COOKIE_PSL_VERSION, normalizeCookieJar, parseSetCookie, redactCookieValues, requestCookies, type StudioCookie } from "./cookies";
import { workerSource, type CookieScriptInput } from "./script-worker-source";
import { getCookieJar, setCookieJar } from "./local-store";
import type { ScriptResult } from "./scripts";

const NOW = Date.UTC(2026, 10, 19, 12);
const ORIGIN = "https://api.example.com/account/login";
const parsed = (raw: string, url = ORIGIN, now = NOW) => {
  const result = parseSetCookie(raw, url, now);
  assert.ok(result.cookie, result.warning ?? "Expected a cookie");
  return result.cookie;
};
const stored = (name: string, patch: Partial<StudioCookie> = {}) => ({ ...parsed(`${name}=fixture; Path=/`), ...patch });
const receive = (jar: readonly StudioCookie[], values: string[], url = ORIGIN, now = NOW) => applySetCookies(jar, values.map((value) => ["Set-Cookie", value]), url, now);

describe("Set-Cookie parsing", () => {
  it("reads every attribute and makes Max-Age take precedence over Expires", () => {
    const c = parsed("sid=fixture-token; Domain=.EXAMPLE.com; Path=/account; Expires=Wed, 09 Jun 2021 10:18:14 GMT; Max-Age=90; Secure; HttpOnly; SameSite=Strict");
    assert.equal(c.name, "sid"); assert.equal(c.value, "fixture-token");
    assert.equal(c.domain, "example.com"); assert.equal(c.hostOnly, false); assert.equal(c.path, "/account");
    assert.equal(c.secure, true); assert.equal(c.httpOnly, true); assert.equal(c.sameSite, "Strict");
    assert.equal(c.expires, Date.UTC(2021, 5, 9, 10, 18, 14)); assert.equal(c.maxAge, 90); assert.equal(c.expiresAt, NOW + 90_000);
  });

  it("defaults to host only, the request directory and a session expiry", () => {
    const c = parsed("sid=fixture");
    assert.equal(c.domain, "api.example.com"); assert.equal(c.hostOnly, true); assert.equal(c.path, "/account");
    assert.equal(c.expiresAt, null); assert.equal(c.expires, null); assert.equal(c.maxAge, null);
    assert.equal(c.secure, false); assert.equal(c.httpOnly, false); assert.equal(c.sameSite, null);
    assert.equal(parsed("sid=fixture", "https://example.com/login").path, "/");
    assert.equal(parsed("sid=fixture", "https://example.com/a/b/").path, "/a/b");
  });

  it("preserves quoted wire values, empty values and equals signs", () => {
    assert.equal(parsed('q="quoted=="').value, '"quoted=="');
    assert.equal(parsed("empty=").value, "");
    assert.equal(parsed("token=a=b=c").value, "a=b=c");
    assert.equal(parsed("\t name = value \t; Path=/").value, "value");
    assert.equal(cookieHeader([parsed('q="quoted=="')], ORIGIN, NOW), 'q="quoted=="');
  });

  it("skips malformed names, values and line breaks without echoing their contents", () => {
    for (const raw of ["no-separator-fixture", "=fixture-secret", "bad name=fixture-secret", 'q="unfinished', "q=has space", "q=a,b", "q=bad\\value", "sid=fixture\r\nX-Other: bad", "q=nonascii-\u00e9"]) {
      const result = parseSetCookie(raw, ORIGIN, NOW);
      assert.equal(result.cookie, null); assert.ok(result.warning); assert.ok(!result.warning.includes("fixture-secret")); assert.ok(!result.warning.includes(raw));
    }
    assert.equal(parseSetCookie("a=b", "not a URL", NOW).cookie, null);
    assert.doesNotThrow(() => parseSetCookie(undefined as unknown as string, ORIGIN, NOW));
  });

  it("parses obsolete RFC cookie dates and validates real calendar dates", () => {
    assert.equal(parsed("a=b; Expires=Sunday, 06-Nov-94 08:49:37 GMT").expiresAt, Date.UTC(1994, 10, 6, 8, 49, 37));
    assert.equal(parsed("a=b; Expires=Sun Nov 6 08:49:37 2069").expiresAt, Date.UTC(2069, 10, 6, 8, 49, 37));
    assert.equal(parsed("a=b; Expires=06 Nov 70 08:49:37 GMT").expiresAt, Date.UTC(1970, 10, 6, 8, 49, 37));
    for (const date of ["31 Feb 2030 00:00:00 GMT", "01 Jan 1600 00:00:00 GMT", "06 Nov 2030 24:00:00 GMT", "nonsense", "06 Nov 2030 00:00:60 GMT"]) {
      const result = parseSetCookie(`a=b; Expires=${date}`, ORIGIN, NOW);
      assert.equal(result.cookie?.expiresAt, null); assert.match(result.warning ?? "", /invalid Expires/);
    }
  });

  it("rejects a Path containing an embedded tab without echoing its value", () => {
    const result = parseSetCookie("sid=private-fixture; Path=/account\tprivate", ORIGIN, NOW);
    assert.equal(result.cookie, null); assert.match(result.warning ?? "", /Path/);
    assert.ok(!result.warning?.includes("private-fixture"));
  });

  it("ignores invalid attributes, uses the last valid expiry and clamps large Max-Age", () => {
    const result = parseSetCookie("a=b; Expires=01 Jan 2030 00:00:00 GMT; Expires=bad; Max-Age=+2; Path=relative; SameSite=unknown", ORIGIN, NOW);
    assert.equal(result.cookie?.expiresAt, Date.UTC(2030, 0, 1)); assert.equal(result.cookie?.path, "/account");
    assert.equal(result.cookie?.sameSite, null); assert.match(result.warning ?? "", /Max-Age/);
    assert.equal(parsed("a=b; Max-Age=0").expiresAt, 0);
    assert.equal(parsed("a=b; Max-Age=-20").expiresAt, 0);
    assert.equal(parsed("a=b; Max-Age=999999999999999999999999999999999").expiresAt, 8_640_000_000_000_000);
    assert.equal(parsed("a=b; Max-Age=2; Max-Age=3").expiresAt, NOW + 3000);
  });

  it("canonicalises IDN domains and rejects unrelated, malformed and port-bearing domains", () => {
    assert.equal(parsed("a=b; Domain=.b\u00fccher.example", "https://api.b\u00fccher.example/").domain, "xn--bcher-kva.example");
    for (const domain of ["other.example.com", "example.com.evil.test", "example.com.", "..example.com", "example.com:80", "example.com:443", "https://example.com", "user@example.com", "bad domain"])
      assert.equal(parseSetCookie(`a=b; Domain=${domain}`, ORIGIN, NOW).cookie, null, domain);
    assert.equal(parsed("a=b; Domain=other.test; Domain=example.com").domain, "example.com");
    assert.equal(parsed("a=b; Domain=; Path=/").hostOnly, true);
  });

  it("uses the full public suffix snapshot, including PRIVATE, wildcard and exception rules", () => {
    assert.ok(COOKIE_PSL_VERSION);
    for (const [domain, host] of [["com", "example.com"], ["co.uk", "example.co.uk"], ["github.io", "alice.github.io"], ["appspot.com", "app.appspot.com"], ["a.ck", "www.a.ck"], ["foo.kawasaki.jp", "a.foo.kawasaki.jp"]])
      assert.equal(parseSetCookie(`a=b; Domain=.${domain}`, `https://${host}/`, NOW).cookie, null, domain);
    assert.equal(parsed("a=b; Domain=example.co.uk", "https://api.example.co.uk/").domain, "example.co.uk");
    assert.equal(parsed("a=b; Domain=www.ck", "https://api.www.ck/").domain, "www.ck");
    assert.equal(parsed("a=b; Domain=city.kawasaki.jp", "https://api.city.kawasaki.jp/").domain, "city.kawasaki.jp");
    assert.equal(parsed("a=b; Domain=github.io", "https://github.io/").hostOnly, true);
  });

  it("accepts Secure on HTTPS or localhost and enforces SameSite=None/prefix invariants", () => {
    assert.equal(parsed("a=b; Secure; SameSite=None").sameSite, "None");
    assert.equal(parsed("a=b; Secure", "http://localhost:8081/").secure, true);
    assert.equal(parseSetCookie("a=b; Secure", "http://example.com/", NOW).cookie, null);
    assert.equal(parseSetCookie("a=b; SameSite=None", ORIGIN, NOW).cookie, null);
    assert.equal(parseSetCookie("__Secure-a=b", ORIGIN, NOW).cookie, null);
    assert.equal(parseSetCookie("__Host-a=b; Secure", ORIGIN, NOW).cookie, null);
    assert.equal(parseSetCookie("__Host-a=b; Secure; Path=/; Domain=example.com", ORIGIN, NOW).cookie, null);
    assert.ok(parsed("__Host-a=b; Secure; Path=/"));
    assert.equal(parseSetCookie("__Http-a=b; Secure", ORIGIN, NOW).cookie, null);
    assert.ok(parsed("__Host-Http-a=b; Secure; HttpOnly; Path=/"));
  });
});

describe("cookie matching and replacement", () => {
  it("matches host-only and Domain cookies at DNS label boundaries", () => {
    const jar = receive([], ["host=one; Path=/", "domain=two; Domain=example.com; Path=/"]).jar;
    assert.equal(cookieHeader(jar, "https://api.example.com/", NOW), "host=one; domain=two");
    assert.equal(cookieHeader(jar, "https://child.api.example.com/", NOW), "domain=two");
    assert.equal(cookieHeader(jar, "https://example.com/", NOW), "domain=two");
    assert.equal(cookieHeader(jar, "https://evilexample.com/", NOW), null);
    assert.equal(cookieHeader(jar, "https://example.com.evil.test/", NOW), null);
  });

  it("matches directory prefixes on slash boundaries and orders duplicate names by longest path", () => {
    const jar = receive([], ["sid=root; Path=/", "sid=account; Path=/account", "tail=end; Path=/account/"]).jar;
    assert.equal(cookieHeader(jar, "https://api.example.com/account/me", NOW), "tail=end; sid=account; sid=root");
    assert.equal(cookieHeader(jar, "https://api.example.com/account", NOW), "sid=account; sid=root");
    assert.equal(cookieHeader(jar, "https://api.example.com/accounting", NOW), "sid=root");
    assert.equal(requestCookies(jar, "https://api.example.com/account/me", [], true, NOW).cookies.sid, "account");
  });

  it("does not send Secure over public HTTP, but localhost remains a secure exception", () => {
    const jar = receive([], ["secret=fixture; Path=/; Secure"]).jar;
    assert.equal(cookieHeader(jar, "http://api.example.com/", NOW), null);
    assert.equal(cookieHeader(jar, "https://api.example.com/", NOW), "secret=fixture");
    const local = receive([], ["local=fixture; Secure; Path=/"], "http://localhost:9000/login").jar;
    assert.equal(cookieHeader(local, "http://localhost:9001/me", NOW), "local=fixture");
    assert.equal(cookieHeader(local, "http://localhost.evil.test/me", NOW), null);
  });

  it("keeps localhost and public hosts separate regardless of ports or redirect Location", () => {
    const jar = receive([], ["internet=one; Path=/"], "https://example.com/login").jar;
    const redirected = applySetCookies(jar, [["Location", "http://localhost:9000/"], ["Set-Cookie", "redirect=two; Path=/"]], "https://example.com/login", NOW).jar;
    assert.equal(cookieHeader(redirected, "http://localhost:9000/", NOW), null);
    const both = receive(redirected, ["local=three; Path=/"], "http://localhost:9000/").jar;
    assert.equal(cookieHeader(both, "https://example.com/", NOW), "internet=one; redirect=two");
    assert.equal(cookieHeader(both, "http://localhost:9002/", NOW), "local=three");
  });

  it("matches IPv4 and IPv6 exactly and never treats an IP suffix as a domain", () => {
    const v4 = receive([], ["ip=one; Domain=127.0.0.1; Path=/"], "http://127.0.0.1:9000/").jar;
    assert.equal(cookieHeader(v4, "http://127.0.0.1:8000/", NOW), "ip=one");
    assert.equal(cookieHeader(v4, "http://x.127.0.0.1/", NOW), null);
    assert.equal(parseSetCookie("ip=one; Domain=0.0.1", "http://127.0.0.1/", NOW).cookie, null);
    const v6 = receive([], ["ip=six; Path=/"], "http://[::1]:9000/").jar;
    assert.equal(cookieHeader(v6, "http://[::1]:8000/", NOW), "ip=six");
    assert.equal(cookieHeader(v6, "http://[::2]/", NOW), null);
  });

  it("expires at the boundary and records deletion events without storing expired cookies", () => {
    const first = receive([], ["a=old; Path=/; Max-Age=1", "b=session; Path=/"]);
    assert.equal(cookieHeader(first.jar, "https://api.example.com/", NOW + 999), "a=old; b=session");
    assert.equal(cookieHeader(first.jar, "https://api.example.com/", NOW + 1000), "b=session");
    const gone = receive(first.jar, ["a=; Path=/; Max-Age=0", "b=; Path=/; Expires=01 Jan 1970 00:00:00 GMT"]);
    assert.equal(gone.jar.length, 0); assert.deepEqual(gone.changes.map((change) => change.deleted), [true, true]);
  });

  it("replaces by name/domain/path, retains creation order and leaves other paths alone", () => {
    const jar = receive([], ["sid=root; Path=/", "sid=private; Path=/account"]).jar;
    const replaced = receive(jar, ["sid=new; Domain=api.example.com; Path=/"], ORIGIN, NOW + 10);
    assert.equal(replaced.jar.length, 2); assert.equal(replaced.jar[0]!.createdAt, jar[0]!.createdAt);
    assert.equal(cookieKey(replaced.jar[0]!), cookieKey(jar[0]!));
    assert.equal(cookieHeader(replaced.jar, ORIGIN, NOW + 10), "sid=private; sid=new");
    assert.equal(jar[0]!.value, "root");
  });

  it("does not let an insecure response overwrite or delete a stored Secure cookie", () => {
    const original = receive([], ["sid=secure; Secure; Path=/"]).jar;
    const result = receive(original, ["sid=plain; Path=/", "sid=; Path=/; Max-Age=0"], "http://api.example.com/", NOW + 1);
    assert.equal(result.jar[0]!.value, "secure"); assert.equal(result.changes.length, 0); assert.equal(result.warnings.length, 2);
  });

  it("honours a manual Cookie header, including an empty one, and never mutates the input", () => {
    const jar = receive([], ["jar=private; Path=/"]).jar;
    const input = [{ name: "Accept", value: "application/json" }, { name: "cOoKiE", value: "manual=own; other=a=b" }];
    const result = requestCookies(jar, ORIGIN, input, true, NOW);
    assert.deepEqual(result.headers, input); assert.notEqual(result.headers, input); assert.match(result.warning ?? "", /takes precedence/);
    assert.deepEqual(result.cookies, { manual: "own", other: "a=b" });
    const empty = requestCookies(jar, ORIGIN, [{ name: "Cookie", value: "" }], true, NOW);
    assert.deepEqual(empty.cookies, {}); assert.equal(empty.headers.length, 1);
    assert.equal(requestCookies(jar, ORIGIN, input, false, NOW).cookies.manual, "own");
  });

  it("disables only automatic jar injection and uses one header when enabled", () => {
    const jar = receive([], ["a=one; Path=/", "b=two; Path=/"]).jar;
    const off = requestCookies(jar, ORIGIN, [], false, NOW);
    assert.deepEqual(off.cookies, {}); assert.equal(off.headers.length, 0); assert.match(off.warning ?? "", /off/);
    const on = requestCookies(jar, ORIGIN, [], true, NOW);
    assert.deepEqual(on.headers, [{ name: "Cookie", value: "a=one; b=two" }]);
  });
});

describe("jar bounds and corrupt local data", () => {
  it("caps original UTF-8 header size at 4 KB including attributes", () => {
    const exact = `a=${"v".repeat(COOKIE_LIMITS.bytes - 2)}`;
    assert.ok(parseSetCookie(exact, ORIGIN, NOW).cookie);
    assert.equal(parseSetCookie(`${exact}x`, ORIGIN, NOW).cookie, null);
    assert.equal(parseSetCookie(`a=b; Unused=${"\u00e9".repeat(2050)}`, ORIGIN, NOW).cookie, null);
    assert.equal(parseSetCookie(`a=${"x".repeat(4090)}; HttpOnly`, ORIGIN, NOW).cookie, null);
  });

  it("evicts oldest cookies after fifty entries for one domain", () => {
    const result = receive([], Array.from({ length: 52 }, (_, i) => `c${i}=fixture; Path=/`));
    assert.equal(result.jar.length, 50); assert.equal(result.jar[0]!.name, "c2"); assert.equal(result.jar.at(-1)!.name, "c51");
    assert.ok(result.warnings.some((warning) => /limits/.test(warning)));
  });

  it("evicts oldest globally after three thousand, without breaking per-domain limits", () => {
    const input = Array.from({ length: 3005 }, (_, i) => stored(`c${i}`, { domain: `d${Math.floor(i / 45)}.example.com`, createdAt: i }));
    const jar = normalizeCookieJar(input, NOW);
    assert.equal(jar.length, 3000); assert.equal(jar[0]!.name, "c5"); assert.equal(jar.at(-1)!.name, "c3004");
    assert.ok([...new Set(jar.map((cookie) => cookie.domain))].every((domain) => jar.filter((cookie) => cookie.domain === domain).length <= 50));
  });

  it("assigns monotonic creation order on tied timestamps, including after partition reordering", () => {
    const jar = receive([], ["first=session; Path=/", "second=persistent; Max-Age=30; Path=/"]).jar;
    assert.ok(jar[1]!.createdAt > jar[0]!.createdAt);
    const reversed = normalizeCookieJar([...jar].reverse(), NOW);
    assert.equal(cookieHeader(reversed, ORIGIN, NOW), "first=session; second=persistent");
    const next = receive(reversed, ["third=fixture; Path=/"]).jar;
    assert.ok(next[2]!.createdAt > next[1]!.createdAt);
  });

  it("drops corrupt entries and expired cookies without retaining unknown fields or invoking unsafe data", () => {
    const good = stored("good");
    const hostile = Object.defineProperty({}, "name", { get() { throw new Error("bad local object"); } });
    assert.deepEqual(normalizeCookieJar(null, NOW), []);
    const result = normalizeCookieJar([null, 2, {}, hostile, { ...good, name: "bad name" }, { ...good, value: "bad\r\nheader" }, { ...good, expiresAt: NOW }, { ...good, size: Infinity }, { ...good, hostOnly: false, domain: "com" }, { ...good, other: "not retained" }], NOW);
    assert.equal(result.length, 1); assert.equal(result[0]!.name, "good"); assert.equal(Object.hasOwn(result[0]!, "other"), false);
  });

  it("handles duplicate and prototype-like cookie names as ordinary keys", () => {
    const jar = receive([], ["__proto__=prototype-fixture; Path=/", "constructor=constructor-fixture; Path=/"]).jar;
    const result = requestCookies(jar, ORIGIN, [], true, NOW);
    assert.equal(Object.getPrototypeOf(result.cookies), Object.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(result.cookies, "__proto__")?.value, "prototype-fixture");
    assert.equal(result.cookies.constructor, "constructor-fixture");
  });

  it("discards corrupt dates, Max-Age and inconsistent stored expiry metadata", () => {
    const future = NOW + 60_000;
    const invalid: Partial<StudioCookie>[] = [
      { expires: 8_640_000_000_000_001, expiresAt: 8_640_000_000_000_001 },
      { expires: future + 0.5, expiresAt: future + 0.5 },
      { expires: Infinity, expiresAt: Infinity }, { expiresAt: future },
      { maxAge: 1.5, expiresAt: future }, { maxAge: Number.MAX_SAFE_INTEGER + 1, expiresAt: future },
      { maxAge: 10, expiresAt: null }, { maxAge: -1, expiresAt: future },
      { createdAt: -1 }, { createdAt: Infinity }, { size: 20.5 }, { path: "/bad\tpath" },
    ];
    for (const patch of invalid) assert.deepEqual(normalizeCookieJar([stored("bad", patch)], NOW), [], JSON.stringify(patch));
    assert.equal(normalizeCookieJar([stored("valid", { expires: future, expiresAt: future })], NOW).length, 1);
  });

  it("rechecks secure, host and HttpOnly prefix invariants in stored data", () => {
    for (const [raw, patch] of [
      ["__Secure-token=fixture; Secure; Path=/", { secure: false }],
      ["__Host-token=fixture; Secure; Path=/", { hostOnly: false }],
      ["__Host-token=fixture; Secure; Path=/", { path: "/account" }],
      ["__Http-token=fixture; Secure; HttpOnly; Path=/", { httpOnly: false }],
      ["__Host-Http-token=fixture; Secure; HttpOnly; Path=/", { httpOnly: false }],
      ["none=fixture; Secure; SameSite=None; Path=/", { secure: false }],
    ] as const) assert.deepEqual(normalizeCookieJar([{ ...parsed(raw), ...patch }], NOW), [], raw);
  });

  it("redacts private values longest-first without reinterpreting regular expression characters", () => {
    assert.equal(redactCookieValues("a.b a.b-long unrelated", ["a.b", "a.b-long", ""]), "[cookie] [cookie] unrelated");
  });

  it("redacts quoted, JSON-escaped and URI-encoded values and tolerates lone surrogates", () => {
    const quoted = '"private=="';
    const variants = [quoted, "private==", JSON.stringify(quoted).slice(1, -1), encodeURIComponent(quoted)];
    for (const variant of variants) assert.equal(redactCookieValues(variant, [quoted]), "[cookie]", variant);
    const malformed = "private-\ud800";
    assert.equal(redactCookieValues(`${malformed} ${JSON.stringify(malformed).slice(1, -1)}`, [malformed]), "[cookie] [cookie]");
  });
});

const scriptInput = (patch: Partial<CookieScriptInput> = {}): CookieScriptInput => ({
  kind: "pre", name: "Cookie script", variables: {},
  request: { method: "GET", url: "https://api.example.com/account/me", headers: [], body: null },
  cookieJar: [parsed("sid=private-fixture; Path=/account; Secure; HttpOnly"), parsed("root=root-fixture; Path=/")],
  useCookieJar: true, cookieSecrets: [], ...patch,
});

/** Match the existing script worker harness, adding the web URL global used by cookie matching. */
async function runCookieScript(code: string, patch: Partial<CookieScriptInput> = {}, nativeCalls: unknown[][] = []): Promise<ScriptResult> {
  let posted: unknown;
  const nativeConsole = Object.fromEntries(["log", "info", "debug", "warn", "error"].map((level) => [level, (...args: unknown[]) => { nativeCalls.push(args); }]));
  const listeners = new Map<string, (event: unknown) => void>();
  const context = vm.createContext({
    URL, console: nativeConsole,
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
    dispatchEvent: (event: { type: string }) => { listeners.get(event.type)?.(event); },
    postMessage: (message: unknown) => { posted = JSON.parse(JSON.stringify(message)); },
  });
  context.self = context;
  vm.runInContext(workerSource(code).source, context);
  await (context.onmessage as (event: { data: CookieScriptInput }) => Promise<void>)({ data: scriptInput(patch) });
  return posted as ScriptResult;
}

describe("read-only private script cookies", () => {
  it("projects matching HttpOnly cookies and updates after URL and environment changes", async () => {
    const result = await runCookieScript(`
      pm.test("initial", () => { pm.expect(pm.cookies.has("sid")).to.equal(true); pm.expect(pm.cookies.get("sid")).to.equal("private-fixture"); });
      pm.request.url = "https://other.example.com/account/me";
      pm.test("host changes", () => pm.expect(pm.cookies.has("sid")).to.equal(false));
      pm.env.set("base", "https://api.example.com"); pm.request.url = "{{base}}/elsewhere";
      pm.test("path changes", () => { pm.expect(pm.cookies.has("sid")).to.equal(false); pm.expect(pm.cookies.has("root")).to.equal(true); });
    `);
    assert.equal(result.error, undefined); assert.equal(result.tests.length, 3); assert.ok(result.tests.every((test) => test.passed));
  });

  it("lets a manual header and its variable substitutions override a disabled jar", async () => {
    const result = await runCookieScript(`
      pm.test("jar is off", () => pm.expect(pm.cookies.has("sid")).to.equal(false));
      pm.env.set("own", "manual-fixture"); pm.request.headers.set("Cookie", "sid={{own}}");
      pm.test("manual wins", () => { pm.expect(pm.cookies.get("sid")).to.equal("manual-fixture"); pm.expect(pm.cookies.has("root")).to.equal(false); });
      pm.request.headers.set("Cookie", "");
      pm.test("empty manual", () => pm.expect(pm.cookies.has("sid")).to.equal(false));
    `, { useCookieJar: false });
    assert.equal(result.error, undefined); assert.ok(result.tests.every((test) => test.passed));
  });

  it("resolves changing header names and whitespace on every cookie read", async () => {
    const result = await runCookieScript(`
      pm.test("initial jar", () => pm.expect(pm.cookies.get("sid")).to.equal("private-fixture"));
      pm.env.set("header", " cOoKiE "); pm.env.set("value", "first");
      pm.test("resolved name and value", () => pm.expect(pm.cookies.get("sid")).to.equal("first"));
      pm.env.set("value", "second");
      pm.test("changed value", () => pm.expect(pm.cookies.get("sid")).to.equal("second"));
      pm.env.set("header", "X-Other");
      pm.test("restored jar", () => pm.expect(pm.cookies.get("sid")).to.equal("private-fixture"));
    `, { variables: { header: "X-Other", value: "initial" }, request: { method: "GET", url: ORIGIN, body: null, headers: [{ key: "{{header}}", value: "sid={{value}}" }] } });
    assert.equal(result.error, undefined); assert.equal(result.tests.length, 4); assert.ok(result.tests.every((test) => test.passed), JSON.stringify(result.tests));
  });

  it("gives a substituted Cookie auth header precedence over entered headers and the jar", async () => {
    const result = await runCookieScript(`
      pm.test("entered header", () => pm.expect(pm.cookies.get("sid")).to.equal("entered"));
      pm.env.set("authHeader", " Cookie "); pm.env.set("authValue", "auth-fixture");
      pm.test("auth wins", () => { pm.expect(pm.cookies.get("sid")).to.equal("auth-fixture"); pm.expect(pm.cookies.has("root")).to.equal(false); });
      pm.env.set("authValue", "");
      pm.test("empty auth cookie", () => pm.expect(pm.cookies.get("sid")).to.equal(""));
    `, { variables: { authHeader: "X-Key", authValue: "initial" }, cookieAuth: { key: "{{authHeader}}", value: "sid={{authValue}}" }, request: { method: "GET", url: ORIGIN, body: null, headers: [{ key: "Cookie", value: "sid=entered" }] } });
    assert.equal(result.error, undefined); assert.equal(result.tests.length, 3); assert.ok(result.tests.every((test) => test.passed), JSON.stringify(result.tests));
  });

  it("keeps literal braces in the sent Cookie header during an after-response script", async () => {
    const result = await runCookieScript(`
      pm.env.set("secret", "new-value");
      pm.test("literal sent value", () => pm.expect(pm.cookies.get("sid")).to.equal("{{secret}}"));
      pm.test("auth does not rewrite sent headers", () => pm.expect(pm.cookies.has("auth")).to.equal(false));
    `, { kind: "test", variables: { secret: "old-value" }, cookieAuth: { key: "Cookie", value: "auth=ignored" }, request: { method: "GET", url: ORIGIN, body: null, headers: [{ key: "Cookie", value: "sid={{secret}}" }] } });
    assert.equal(result.error, undefined); assert.equal(result.tests.length, 2); assert.ok(result.tests.every((test) => test.passed), JSON.stringify(result.tests));
  });

  it("keeps cookie methods read-only and does not return the jar or cookie metadata", async () => {
    const result = await runCookieScript(`
      let rejected = false;
      try { pm.cookies.get = () => "changed"; } catch (error) { rejected = true; }
      pm.test("readonly", () => { pm.expect(rejected).to.equal(true); pm.expect(pm.cookies.get("sid")).to.equal("private-fixture"); pm.expect(pm.cookies.set).to.equal(undefined); });
    `);
    assert.equal(result.error, undefined); assert.ok(result.tests.every((test) => test.passed));
    assert.equal(Object.hasOwn(result, "cookieJar"), false);
  });

  it("matches protocol, expiry, duplicate paths and localhost consistently with the send helper", async () => {
    const expiredAt = Date.now() - 1;
    const input = scriptInput({ cookieJar: [parsed("sid=root; Path=/"), parsed("sid=narrow; Path=/account; Secure"), stored("expired", { expires: expiredAt, expiresAt: expiredAt })] });
    const result = await runCookieScript(`
      pm.test("longest path", () => pm.expect(pm.cookies.get("sid")).to.equal("narrow"));
      pm.test("expired", () => pm.expect(pm.cookies.has("expired")).to.equal(false));
      pm.request.url = "http://api.example.com/account/me";
      pm.test("secure", () => pm.expect(pm.cookies.get("sid")).to.equal("root"));
    `, input);
    assert.equal(result.error, undefined); assert.ok(result.tests.every((test) => test.passed));
    const local = await runCookieScript(`pm.test("localhost", () => pm.expect(pm.cookies.get("local")).to.equal("fixture"));`, { request: { method: "GET", url: "http://localhost:9000/me", headers: [], body: null }, cookieJar: [parsed("local=fixture; Secure; Path=/", "http://localhost:8000/")] });
    assert.ok(local.tests.every((test) => test.passed));
  });

  it("redacts cookie values from logs, failed test names/errors and top-level errors", async () => {
    const result = await runCookieScript(`
      console.log(pm.cookies.get("sid")); console.warn("hidden-fixture");
      pm.test(pm.cookies.get("sid"), () => pm.expect(pm.cookies.get("sid")).to.equal("wrong"));
      throw new Error("hidden-fixture " + pm.cookies.get("sid"));
    `, { cookieSecrets: ["hidden-fixture"] });
    const publicText = JSON.stringify({ logs: result.logs, tests: result.tests, error: result.error });
    assert.ok(!publicText.includes("private-fixture")); assert.ok(!publicText.includes("hidden-fixture")); assert.match(publicText, /redacted/);
    assert.equal(result.tests[0]!.passed, false); assert.ok(result.error);
  });

  it("redirects global console aliases to redacted Run logs without native output", async () => {
    const nativeCalls: unknown[][] = [];
    const result = await runCookieScript(`
      globalThis.console.log(pm.cookies.get("sid"));
      self.console.warn(pm.cookies.get("sid"));
      globalThis.console.debug("safe message");
    `, {}, nativeCalls);
    assert.equal(result.error, undefined); assert.deepEqual(nativeCalls, []);
    assert.deepEqual(result.logs.map((log) => log.level), ["log", "warn", "log"]);
    assert.equal(result.logs[2]!.text, "safe message");
    assert.ok(!JSON.stringify(result.logs).includes("private-fixture"));
    assert.match(result.logs[0]!.text, /redacted/); assert.match(result.logs[1]!.text, /redacted/);
  });

  it("redacts encoded worker output even when a private value has a lone surrogate", async () => {
    const secret = '"private=="', malformed = "private-\ud800";
    const result = await runCookieScript(`
      const secret = ${JSON.stringify(secret)}, malformed = ${JSON.stringify(malformed)};
      console.log(secret, secret.slice(1, -1), JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret));
      console.log(malformed, JSON.stringify(malformed).slice(1, -1));
    `, { cookieSecrets: [secret, malformed] });
    assert.equal(result.error, undefined); assert.equal(result.logs.length, 2);
    assert.equal(result.logs[0]!.text, "[redacted] [redacted] [redacted] [redacted]");
    assert.equal(result.logs[1]!.text, "[redacted] [redacted]");
  });

  it("prevents native unhandled-rejection reporting and records its redacted reason", async () => {
    const nativeCalls: unknown[][] = [];
    const result = await runCookieScript(`
      let prevented = false;
      self.dispatchEvent({ type: "unhandledrejection", reason: pm.cookies.get("sid"), preventDefault() { prevented = true; } });
      pm.test("native report suppressed", () => pm.expect(prevented).to.equal(true));
    `, {}, nativeCalls);
    assert.equal(result.error, undefined); assert.deepEqual(nativeCalls, []);
    assert.equal(result.tests[0]!.passed, true);
    assert.deepEqual(result.logs, [{ level: "error", text: "Unhandled promise rejection: [redacted]" }]);
  });
});

describe("private local cookie storage", () => {
  const withWindow = (storage: object, check: () => void) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: storage, configurable: true });
    try { check(); } finally {
      if (prior) Object.defineProperty(globalThis, "window", prior);
      else Reflect.deleteProperty(globalThis, "window");
    }
  };
  const memoryStorage = () => {
    const items = new Map<string, string>();
    return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
  };

  it("stores session and persistent cookies separately for each room, person and environment", () => {
    const localStorage = memoryStorage(), sessionStorage = memoryStorage();
    withWindow({ localStorage, sessionStorage }, () => {
      const current = Date.now();
      const jar = [parsed("session=fixture; Path=/", ORIGIN, current), parsed("persistent=fixture; Path=/; Max-Age=3600", ORIGIN, current)];
      setCookieJar("storage-room", "storage-person", "storage-env", jar);
      assert.deepEqual(getCookieJar("storage-room", "storage-person", "storage-env").map((cookie) => cookie.name).sort(), ["persistent", "session"]);
      const key = "cc:api-studio:storage-person:storage-room:cookies:storage-env";
      assert.deepEqual(JSON.parse(localStorage.items.get(key)!).map((cookie: StudioCookie) => cookie.name), ["persistent"]);
      assert.deepEqual(JSON.parse(sessionStorage.items.get(`${key}:session`)!).map((cookie: StudioCookie) => cookie.name), ["session"]);
      for (const [room, person, env] of [["other-room", "storage-person", "storage-env"], ["storage-room", "other-person", "storage-env"], ["storage-room", "storage-person", "other-env"]]) {
        assert.deepEqual(getCookieJar(room!, person!, env!), []);
        setCookieJar(room!, person!, env!, [parsed("isolated=fixture; Path=/", ORIGIN, current)]);
        assert.deepEqual(getCookieJar(room!, person!, env!).map((cookie) => cookie.name), ["isolated"]);
      }
      assert.deepEqual(getCookieJar("storage-room", "storage-person", "storage-env").map((cookie) => cookie.name).sort(), ["persistent", "session"]);
      setCookieJar("storage-room", "storage-person", "storage-env", []);
      assert.deepEqual(getCookieJar("storage-room", "storage-person", "storage-env"), []);
    });
  });

  it("keeps a usable memory jar when storage is blocked or full", () => {
    for (const mode of ["blocked", "full"] as const) {
      let writes = 0;
      const storage = {
        getItem: () => { if (mode === "blocked") throw new Error("storage blocked"); return null; },
        setItem: () => { writes++; throw new Error("storage unavailable"); },
        removeItem: () => { throw new Error("storage unavailable"); },
      };
      withWindow({ localStorage: storage, sessionStorage: storage }, () => {
        const room = `fallback-${mode}`;
        assert.deepEqual(getCookieJar(room, "person", "env"), []);
        const current = Date.now();
        setCookieJar(room, "person", "env", [parsed("session=fixture; Path=/", ORIGIN, current), parsed("persistent=fixture; Path=/; Max-Age=3600", ORIGIN, current)]);
        assert.deepEqual(getCookieJar(room, "person", "env").map((cookie) => cookie.name).sort(), ["persistent", "session"]);
        assert.equal(writes, 2);
        setCookieJar(room, "person", "env", []);
        assert.deepEqual(getCookieJar(room, "person", "env"), []);
      });
    }
  });
});
