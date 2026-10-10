// Inline completions (POST /api/rooms/:roomId/ai/complete) against the running stack and its AI,
// normally the local Ollama: a suggestion comes back clean and is counted in your usage, bad input
// is refused, a cancelled request leaves the server fine, and the per-person limit answers 429.
//   node test/complete.e2e.mjs        (from apps/api, with the dev stack running)
// Signs in as test2, so the browser test (test1) keeps its own limit. After the limit check,
// test2's suggestions stay paused for a minute or two.
const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const ROOM = process.env.E2E_ROOM ?? "E2ETST";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};

const jar = new Map();
async function call(path, { method = "GET", body, signal, cookies = true } = {}) {
  const response = await fetch(new URL(path, ORIGIN), {
    method,
    signal,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(cookies && jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, value] = pair.split("=");
    if (value) jar.set(name, value);
  }
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, json, text, retryAfter: response.headers.get("retry-after") };
}
const complete = (body, options = {}) => call(`/api/rooms/${ROOM}/ai/complete`, { method: "POST", body, ...options });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signIn = await call("/api/auth/sign-in/email", { method: "POST", body: { email: "test2@codechatter.local", password: "codechatter123" } });
check("signIn", signIn.status === 200, signIn.status);

const status = (await call("/api/ai/status")).json;
const python = { path: "complete_e2e.py", language: "python", prefix: "def add(a, b):\n    ", suffix: "\n\nprint(add(2, 3))\n" };

if (!status?.configured) {
  // AI off: the endpoint says why instead of failing.
  const off = await complete(python);
  check("notConfiguredIsClear", off.status === 503 && off.json?.detail === status?.problem, off.text);
} else {
  console.log(`AI: ${status.provider} (${status.model})`);
  // A previous run may have used up the limit: wait it out.
  let first = await complete(python);
  if (first.status === 429) {
    console.log(`limit still in use from an earlier run; waiting ${first.retryAfter}s`);
    await sleep((Number(first.retryAfter) + 1) * 1000);
    first = await complete(python);
  }
  const before = (await call("/api/ai/usage")).json;
  const started = Date.now();
  const answer = await complete(python);
  const ms = Date.now() - started;
  const text = answer.json?.text ?? "";
  check("suggests", answer.status === 200 && typeof text === "string" && text.trim().length > 0, `${answer.status} ${ms}ms ${JSON.stringify(text)}`);
  check("cleanAnswer", !text.includes("```") && !text.includes("<CURSOR>") && text.split("\n").length <= 6 && !text.startsWith("def add"), JSON.stringify(text));
  const after = (await call("/api/ai/usage")).json;
  check(
    "usageCounted",
    after?.today.requests === before?.today.requests + 1 && after.today.inputTokens > before.today.inputTokens,
    `${before?.today.requests} → ${after?.today.requests} requests`,
  );

  // In the middle of a line: one line, and not the ; the line already ends with.
  const mid = await complete({ path: "complete_e2e.js", language: "javascript", prefix: 'const names = ["ada", "linus"];\nconsole.log(', suffix: ");\n" });
  const midText = mid.json?.text ?? "";
  check("midLineStaysOnLine", mid.status === 200 && !midText.includes("\n") && !midText.trimEnd().endsWith(";"), JSON.stringify(midText));

  // Typing on cancels the request; the server carries on.
  const cancel = new AbortController();
  const cancelled = complete({ ...python, prefix: "def sub(a, b):\n    " }, { signal: cancel.signal }).then(() => "answered", (e) => e.name);
  await sleep(300);
  cancel.abort();
  const afterCancel = await complete({ ...python, prefix: "def neg(a):\n    " });
  check("cancelLeavesServerFine", (await cancelled) === "AbortError" && afterCancel.status === 200, `${await cancelled}, then ${afterCancel.status}`);

  // The per-person limit: requests over it are refused at once, with Retry-After.
  let refused = null;
  let sent = 0;
  for (let round = 0; round < 5 && !refused; round++) {
    const batch = Array.from({ length: 20 }, (_, i) => {
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 1500);
      sent++;
      return complete({ ...python, prefix: `def f${round}_${i}(x):\n    ` }, { signal: stop.signal }).catch(() => null);
    });
    refused = (await Promise.all(batch)).find((r) => r?.status === 429) ?? null;
  }
  check("limitRefuses", refused !== null && Number(refused.retryAfter) > 0, refused ? `${refused.retryAfter}s: ${refused.json?.detail}` : `no 429 after ${sent}`);
  check("limitMessagePlain", /AI suggestions are paused for about \d+ (second|minute)s?/.test(refused?.json?.detail ?? ""), refused?.json?.detail);
}

// Refused input.
const long = await complete({ ...python, prefix: "x".repeat(4001) });
check("prefixCapped", long.status === 400, long.text);
const longSuffix = await complete({ ...python, suffix: "y".repeat(1001) });
check("suffixCapped", longSuffix.status === 400, longSuffix.text);
const badPath = await complete({ ...python, path: "../../etc/passwd" });
check("pathChecked", badPath.status === 400, badPath.text);
const unknownRoom = await call("/api/rooms/ZZZZZ9/ai/complete", { method: "POST", body: python });
check("unknownRoomRefused", unknownRoom.status === 404 || unknownRoom.status === 403, unknownRoom.status);
const anonymous = await complete(python, { cookies: false });
check("needsSignIn", anonymous.status === 401, anonymous.status);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
