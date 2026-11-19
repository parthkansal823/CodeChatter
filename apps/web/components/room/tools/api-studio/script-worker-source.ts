/**
 * Source of the Web Worker that runs pre-request and test scripts, with
 * Postman's `pm` (environment, request, response, test, expect). It is a
 * string (not bundled code) because it runs inside the sandboxed page
 * /frames/script (app/frames/script/route.ts), from a blob: URL, started by
 * script-sandbox.ts.
 *
 * The first part removes every way out (network, storage, nested workers);
 * the iframe's Content-Security-Policy blocks them as well, so a script
 * that finds a way around this list still has no network.
 */
import type { StudioCookie } from "./cookies";
import type { ScriptInput } from "./scripts";

/** Private worker input extends the existing script protocol without changing saved requests. */
export type CookieScriptInput = ScriptInput & { cookieJar: StudioCookie[]; useCookieJar: boolean; cookieSecrets: string[]; cookieAuth?: { key: string; value: string } };

const BOOTSTRAP = String.raw`"use strict";
(function lockDown() {
  var names = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches",
    "BroadcastChannel", "Worker", "SharedWorker", "WebTransport", "RTCPeerConnection", "FileReaderSync", "navigator"];
  var scopes = [self, Object.getPrototypeOf(self), self.WorkerGlobalScope && self.WorkerGlobalScope.prototype];
  for (var s = 0; s < scopes.length; s++) {
    var scope = scopes[s];
    if (!scope) continue;
    for (var i = 0; i < names.length; i++) {
      try { delete scope[names[i]]; } catch (e) {}
      try { Object.defineProperty(scope, names[i], { value: undefined, configurable: false, writable: false }); } catch (e) {}
    }
  }
})();

function __show(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

// In what an assertion says, a string is shown in quotes, as chai does: expected "GET" to equal "DELETE".
function __said(value) { return typeof value === "string" ? JSON.stringify(value) : __show(value); }

function __deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !__deepEqual(a[ka[i]], b[ka[i]])) return false;
  return true;
}

function __headers(list) {
  var rows = list.map(function (h) { return { key: h.key, value: h.value }; });
  var find = function (name) { name = String(name).toLowerCase(); return rows.filter(function (h) { return h.key.toLowerCase() === name; }); };
  // Postman's own form is an object, { key, value }; a name and a value work too.
  var pair = function (name, value) { return name && typeof name === "object" ? { key: String(name.key), value: String(name.value) } : { key: String(name), value: String(value) }; };
  return {
    get: function (name) { var found = find(name); return found.length ? found.map(function (h) { return h.value; }).join(", ") : undefined; },
    has: function (name) { return find(name).length > 0; },
    set: function (name, value) { var row = pair(name, value); this.remove(row.key); rows.push(row); },
    upsert: function (name, value) { this.set(name, value); },
    add: function (name, value) { rows.push(pair(name, value)); },
    remove: function (name) { name = String(name && typeof name === "object" ? name.key : name).toLowerCase(); rows = rows.filter(function (h) { return h.key.toLowerCase() !== name; }); },
    toObject: function () { var out = {}; rows.forEach(function (h) { out[h.key] = h.value; }); return out; },
    all: function () { return rows.slice(); }
  };
}

function __expect(actual) {
  function Assertion(value, negate, deep) { this._v = value; this._not = !!negate; this._deep = !!deep; }
  var P = Assertion.prototype;
  ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same", "does"].forEach(function (word) {
    Object.defineProperty(P, word, { get: function () { return this; } });
  });
  Object.defineProperty(P, "not", { get: function () { return new Assertion(this._v, !this._not, this._deep); } });
  Object.defineProperty(P, "deep", { get: function () { return new Assertion(this._v, this._not, true); } });
  P._check = function (ok, message) {
    if (this._not ? ok : !ok) throw new Error("expected " + __said(this._v) + (this._not ? " not " : " ") + message);
    return this;
  };
  P.equal = P.equals = P.eq = function (expected) {
    return this._check(this._deep ? __deepEqual(this._v, expected) : this._v === expected, "to equal " + __said(expected));
  };
  P.eql = function (expected) { return this._check(__deepEqual(this._v, expected), "to deeply equal " + __said(expected)); };
  P.above = P.greaterThan = P.gt = function (n) { return this._check(this._v > n, "to be above " + n); };
  P.below = P.lessThan = P.lt = function (n) { return this._check(this._v < n, "to be below " + n); };
  P.least = P.gte = function (n) { return this._check(this._v >= n, "to be at least " + n); };
  P.most = P.lte = function (n) { return this._check(this._v <= n, "to be at most " + n); };
  P.within = function (a, b) { return this._check(this._v >= a && this._v <= b, "to be within " + a + ".." + b); };
  P.include = P.includes = P.contain = P.contains = function (item) {
    var v = this._v, ok = false;
    if (typeof v === "string") ok = v.indexOf(String(item)) !== -1;
    else if (Array.isArray(v)) ok = v.some(function (x) { return __deepEqual(x, item); });
    else if (v && typeof v === "object") ok = typeof item === "object" && item !== null
      ? Object.keys(item).every(function (k) { return __deepEqual(v[k], item[k]); })
      : Object.prototype.hasOwnProperty.call(v, item);
    return this._check(ok, "to include " + __said(item));
  };
  P.property = function (name, value) {
    var has = this._v !== null && this._v !== undefined && Object.prototype.hasOwnProperty.call(Object(this._v), name);
    if (arguments.length < 2) return this._check(has, "to have property " + __said(name));
    return this._check(has && __deepEqual(this._v[name], value), "to have property " + __said(name) + " of " + __said(value));
  };
  P.lengthOf = P.length = function (n) { return this._check(this._v != null && this._v.length === n, "to have length " + n); };
  P.a = P.an = function (type) {
    var t = String(type).toLowerCase(), v = this._v;
    var actualType = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    return this._check(actualType === t, "to be a" + (/^[aeiou]/.test(t) ? "n " : " ") + t);
  };
  P.match = function (re) { return this._check(new RegExp(re).test(String(this._v)), "to match " + String(re)); };
  P.oneOf = function (list) { var v = this._v; return this._check(list.some(function (x) { return __deepEqual(x, v); }), "to be one of " + __said(list)); };
  P.status = function (code) {
    var v = this._v && typeof this._v === "object" && "code" in this._v ? this._v.code : this._v;
    if (this._not ? v === code : v !== code) throw new Error("expected status " + (this._not ? "not " : "") + code + ", got " + v);
    return this;
  };
  P.header = function (name, value) {
    var headers = this._v && this._v.headers;
    var got = headers && headers.get ? headers.get(name) : undefined;
    if (arguments.length < 2) return this._check(got !== undefined, "to have header " + name);
    return this._check(got === value, "to have header " + name + ": " + value);
  };
  // pm.response.to.be.ok: a status from 200 to 299, as Postman has it.
  [["ok", function (v) { return v && typeof v === "object" && v.__isResponse ? v.code >= 200 && v.code < 300 : !!v; }, "to be ok"], ["true", function (v) { return v === true; }, "to be true"],
   ["false", function (v) { return v === false; }, "to be false"], ["null", function (v) { return v === null; }, "to be null"],
   ["undefined", function (v) { return v === undefined; }, "to be undefined"],
   ["exist", function (v) { return v !== null && v !== undefined; }, "to exist"],
   ["empty", function (v) { return v != null && (typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length === 0 : v.length === 0); }, "to be empty"]
  ].forEach(function (entry) {
    Object.defineProperty(P, entry[0], { get: function () { return this._check(entry[1](this._v), entry[2]); } });
  });
  return new Assertion(actual, false, false);
}

self.onmessage = async function (event) {
  var input = event.data;
  var logs = [], tests = [], changes = {}, pending = [];
  var vars = Object.assign({}, input.variables);
  var secretValues = (input.cookieSecrets || []).concat((input.cookieJar || []).map(function (cookie) { return cookie.value; }));
  var secretPatterns = [];
  secretValues.forEach(function (value) {
    if (typeof value !== "string" || !value) return;
    var variants = [value, value.replace(/^"|"$/g, ""), JSON.stringify(value).slice(1, -1)];
    try { variants.push(encodeURIComponent(value)); } catch (e) {}
    variants.forEach(function (variant) {
      if (variant && secretPatterns.indexOf(variant) === -1) secretPatterns.push(variant);
    });
  });
  var secretRegex = secretPatterns.length ? new RegExp(secretPatterns.sort(function (a, b) { return b.length - a.length; }).map(function (value) {
    return value.split("").map(function (ch) { return "\\^$.*+?()[]{}|".indexOf(ch) >= 0 ? "\\" + ch : ch; }).join("");
  }).join("|"), "g") : null;
  var safe = function (value) { var text = String(value); return secretRegex ? text.replace(secretRegex, "[redacted]") : text; };
  var log = function (level) { return function () { logs.push({ level: level, text: safe(Array.prototype.map.call(arguments, __show).join(" ")) }); }; };
  var console = { log: log("log"), info: log("info"), debug: log("log"), warn: log("warn"), error: log("error") };
  var env = {
    get: function (k) { return vars[k]; },
    set: function (k, v) { var s = typeof v === "string" ? v : __show(v); vars[k] = s; changes[k] = s; },
    unset: function (k) { delete vars[k]; changes[k] = null; },
    has: function (k) { return Object.prototype.hasOwnProperty.call(vars, k); },
    replaceIn: function (text) { return String(text).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, function (all, name) { return name in vars ? vars[name] : all; }); },
    toObject: function () { return Object.assign({}, vars); }
  };
  var request = {
    method: input.request.method, url: input.request.url, body: input.request.body,
    headers: __headers(input.request.headers)
  };
  var response = input.response ? {
    code: input.response.status, status: input.response.statusText, statusText: input.response.statusText,
    responseTime: input.response.timeMs, responseSize: input.response.size,
    headers: __headers(input.response.headers.map(function (h) { return { key: h[0], value: h[1] }; })),
    text: function () { return input.response.body; },
    json: function () { return JSON.parse(input.response.body); }
  } : undefined;
  if (response) {
    Object.defineProperty(response, "__isResponse", { value: true });
    // pm.response.to.have.status(200), pm.response.to.be.ok, pm.response.to.have.header("x").
    Object.defineProperty(response, "to", { get: function () { return __expect(response); } });
  }
  var test = function (name, fn) {
    var record = function (error) { tests.push(error ? { name: String(name), passed: false, error: __show(error) } : { name: String(name), passed: true }); };
    try {
      var result = fn();
      if (result && typeof result.then === "function") pending.push(result.then(function () { record(); }, record));
      else record();
    } catch (error) { record(error || new Error("failed")); }
  };
  var pm = { environment: env, variables: env, env: env, globals: env, collectionVariables: env, request: request, response: response, test: test, expect: __expect,
    info: { requestName: input.name, eventName: input.kind === "pre" ? "prerequest" : "test" },
    sendRequest: function () { throw new Error("pm.sendRequest isn't available: scripts here have no network. Send that request from its own tab, and save what you need with a test script."); } };
  // Resolve on every read: URL, variables and a manual Cookie header may change in a pre-request script.
  var cookiesForRequest = function () {
    var out = Object.create(null), pairs = [];
    var resolve = input.kind === "pre" ? env.replaceIn : String;
    var manual = request.headers.all().filter(function (h) { return resolve(h.key).toLowerCase() === "cookie"; });
    if (input.kind === "pre" && input.cookieAuth && resolve(input.cookieAuth.key).toLowerCase() === "cookie") manual = [input.cookieAuth];
    if (manual.length) {
      manual.forEach(function (h) { resolve(h.value).split(";").forEach(function (part) {
        var at = part.indexOf("="); if (at <= 0) return;
        var name = part.slice(0, at).replace(/^[\t ]+|[\t ]+$/g, "");
        if (/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)) pairs.push({ name: name, value: part.slice(at + 1).replace(/^[\t ]+|[\t ]+$/g, "") });
      }); });
    } else if (input.useCookieJar) {
      var url;
      try { url = new URL(resolve(request.url)); } catch (e) { return out; }
      var host = url.hostname.toLowerCase().replace(/\.$/, ""), path = url.pathname || "/";
      if (url.protocol !== "http:" && url.protocol !== "https:") return out;
      pairs = (input.cookieJar || []).filter(function (cookie) {
        var domain = cookie.domain, ip = domain.indexOf(":") >= 0 || /^[0-9.]+$/.test(domain);
        var domainMatch = host === domain || (!cookie.hostOnly && !ip && host.endsWith("." + domain));
        var pathMatch = path === cookie.path || (path.startsWith(cookie.path) && (cookie.path.endsWith("/") || path.charAt(cookie.path.length) === "/"));
        return domainMatch && pathMatch && (!cookie.secure || url.protocol === "https:" || host === "localhost") && (cookie.expiresAt === null || cookie.expiresAt > Date.now());
      }).sort(function (a, b) { return b.path.length - a.path.length || a.createdAt - b.createdAt; });
    }
    pairs.forEach(function (cookie) { if (cookie.name && !Object.prototype.hasOwnProperty.call(out, cookie.name)) out[cookie.name] = cookie.value; });
    return out;
  };
  Object.defineProperty(pm, "cookies", { enumerable: true, value: Object.freeze({
    get: function (name) { return cookiesForRequest()[String(name)]; },
    has: function (name) { return Object.prototype.hasOwnProperty.call(cookiesForRequest(), String(name)); }
  }) });
  var error, errorLine;
  try {
    await __run(pm, env, request, response, test, __expect, console);
    await Promise.all(pending);
  } catch (e) {
    error = __show(e);
    // Where in the script: the first place in this worker's own code that the stack names.
    var at = e && typeof e.stack === "string" ? /blob:[^\s)]*:(\d+):\d+/.exec(e.stack) : null;
    if (at) errorLine = Number(at[1]);
  }
  postMessage({
    tests: tests.map(function (test) { return Object.assign({}, test, { name: safe(test.name) }, test.error ? { error: safe(test.error) } : {}); }), logs: logs, variables: changes, error: error === undefined ? undefined : safe(error), errorLine: errorLine,
    request: input.kind === "pre" ? { method: String(request.method), url: String(request.url), headers: request.headers.all(), body: request.body == null ? null : String(request.body) } : undefined
  });
};
`;

/** The worker script for one run; `userLine` maps error line numbers back to the person's code. */
export function workerSource(code: string): { source: string; userLine: number } {
  const head = `${BOOTSTRAP}\nasync function __run(pm, env, request, response, test, expect, console) {\n`;
  return { source: `${head}${code}\n}\n`, userLine: head.split("\n").length };
}
