/**
 * Source of the Web Worker that runs pre-request and test scripts. It is a
 * string (not bundled code) because it runs inside the sandboxed iframe
 * built by script-sandbox.ts, from a blob: URL.
 *
 * The first part removes every way out (network, storage, nested workers);
 * the iframe's Content-Security-Policy blocks them as well, so a script
 * that finds a way around this list still has no network.
 */
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
  return {
    get: function (name) { var found = find(name); return found.length ? found.map(function (h) { return h.value; }).join(", ") : undefined; },
    has: function (name) { return find(name).length > 0; },
    set: function (name, value) { this.remove(name); rows.push({ key: String(name), value: String(value) }); },
    upsert: function (name, value) { this.set(name, value); },
    add: function (name, value) { rows.push({ key: String(name), value: String(value) }); },
    remove: function (name) { name = String(name).toLowerCase(); rows = rows.filter(function (h) { return h.key.toLowerCase() !== name; }); },
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
    if (this._not ? ok : !ok) throw new Error("expected " + __show(this._v) + (this._not ? " not " : " ") + message);
    return this;
  };
  P.equal = P.equals = P.eq = function (expected) {
    return this._check(this._deep ? __deepEqual(this._v, expected) : this._v === expected, "to equal " + __show(expected));
  };
  P.eql = function (expected) { return this._check(__deepEqual(this._v, expected), "to deeply equal " + __show(expected)); };
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
    return this._check(ok, "to include " + __show(item));
  };
  P.property = function (name, value) {
    var has = this._v !== null && this._v !== undefined && Object.prototype.hasOwnProperty.call(Object(this._v), name);
    if (arguments.length < 2) return this._check(has, "to have property " + __show(name));
    return this._check(has && __deepEqual(this._v[name], value), "to have property " + __show(name) + " of " + __show(value));
  };
  P.lengthOf = P.length = function (n) { return this._check(this._v != null && this._v.length === n, "to have length " + n); };
  P.a = P.an = function (type) {
    var t = String(type).toLowerCase(), v = this._v;
    var actualType = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    return this._check(actualType === t, "to be a" + (/^[aeiou]/.test(t) ? "n " : " ") + t);
  };
  P.match = function (re) { return this._check(new RegExp(re).test(String(this._v)), "to match " + String(re)); };
  P.oneOf = function (list) { var v = this._v; return this._check(list.some(function (x) { return __deepEqual(x, v); }), "to be one of " + __show(list)); };
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
  [["ok", function (v) { return !!v; }, "to be truthy"], ["true", function (v) { return v === true; }, "to be true"],
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
  var log = function (level) { return function () { logs.push({ level: level, text: Array.prototype.map.call(arguments, __show).join(" ") }); }; };
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
  var test = function (name, fn) {
    var record = function (error) { tests.push(error ? { name: String(name), passed: false, error: __show(error) } : { name: String(name), passed: true }); };
    try {
      var result = fn();
      if (result && typeof result.then === "function") pending.push(result.then(function () { record(); }, record));
      else record();
    } catch (error) { record(error || new Error("failed")); }
  };
  var pm = { environment: env, variables: env, env: env, request: request, response: response, test: test, expect: __expect,
    info: { requestName: input.name, eventName: input.kind === "pre" ? "prerequest" : "test" } };
  var error;
  try {
    await __run(pm, env, request, response, test, __expect, console);
    await Promise.all(pending);
  } catch (e) {
    error = __show(e);
  }
  postMessage({
    tests: tests, logs: logs, variables: changes, error: error,
    request: input.kind === "pre" ? { method: String(request.method), url: String(request.url), headers: request.headers.all(), body: request.body == null ? null : String(request.body) } : undefined
  });
};
`;

/** The worker script for one run; `userLine` maps error line numbers back to the person's code. */
export function workerSource(code: string): { source: string; userLine: number } {
  const head = `${BOOTSTRAP}\nasync function __run(pm, env, request, response, test, expect, console) {\n`;
  return { source: `${head}${code}\n}\n`, userLine: head.split("\n").length };
}
