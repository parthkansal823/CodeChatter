// End-to-end auth flow through Caddy (same origin), Better Auth, Postgres,
// Valkey and Mailpit. Run with infra up and the API listening:
//   node apps/api/test/auth-flow.e2e.mjs
const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const email = `e2e-${Date.now()}@example.test`;
const password = "correct horse battery staple";
const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const jar = new Map();
async function call(path, { method = "GET", body, redirect = "manual" } = {}) {
  const response = await fetch(new URL(path, ORIGIN), {
    method,
    redirect,
    headers: {
      origin: ORIGIN,
      ...(body && { "content-type": "application/json" }),
      ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
    },
    body: body && JSON.stringify(body),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, value] = pair.split("=");
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, json, text, location: response.headers.get("location") };
}

async function waitForMail(to) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    if (list.messages?.length) {
      return (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${to}`);
}

// 1. Sign up: account created, but no session until the email is verified.
const signUp = await call("/api/auth/sign-up/email", { method: "POST", body: { name: "E2E Tester", email, password } });
record("signUpAccepted", signUp.status === 200, `status ${signUp.status}`);
const early = await call("/api/me");
record("noSessionBeforeVerification", early.status === 401);

// 2. Unverified sign-in is refused (requireEmailVerification).
const unverified = await call("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
record("unverifiedSignInRefused", unverified.status === 403, `status ${unverified.status} ${unverified.json?.code ?? ""}`);

// 3. Verification email arrives in Mailpit, rendered by React Email.
const mail = await waitForMail(email);
const link = mail.HTML.match(/href="([^"]*verify-email[^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
record("verificationEmailDelivered", Boolean(link), mail.Subject);

// 4. Following the link verifies and signs in (autoSignInAfterVerification).
const verified = await call(new URL(link).pathname + new URL(link).search);
record("verificationSetsSessionCookie", [...jar.keys()].some((k) => k.includes("session_token")), `status ${verified.status}`);

// 5. The guarded API sees the session, and a personal org exists.
const me = await call("/api/me");
record("sessionReachesGuardedApi", me.status === 200 && me.json?.user?.email === email);
record("personalOrgCreatedAtSignUp", me.json?.organizations?.length === 1 && me.json.organizations[0].role === "owner",
  me.json?.organizations?.[0]?.slug);

// 6. Sign out, then sign in again with the password (argon2id verify).
await call("/api/auth/sign-out", { method: "POST", body: {} });
record("signOutClearsSession", (await call("/api/me")).status === 401);
const signIn = await call("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
record("passwordSignIn", signIn.status === 200 && (await call("/api/me")).status === 200);

// 7. Wrong password is rejected; repeated failures hit the Valkey rate limit.
jar.clear();
const statuses = [];
for (let i = 0; i < 12; i++) {
  statuses.push((await call("/api/auth/sign-in/email", { method: "POST", body: { email, password: "wrong password!!" } })).status);
}
record("wrongPasswordRejected", statuses[0] === 401, `first=${statuses[0]}`);
record("signInRateLimited", statuses.includes(429), `statuses: ${statuses.join(",")}`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
