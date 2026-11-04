// Notifications and room activity against a second API of its own on :4012 (from the dev watcher's dist), whose email
// digest looks every 2 seconds and doesn't wait an hour first, so the test sees one arrive in Mailpit. test1 makes a
// room, test2 joins with its invite link and test1 hears of it; test1 tells test2 about a comment reply (someone not in
// the room is left out) and test2's inbox has it, with how many are unread; marking read and the digest setting; the
// digest email, sent once (to Mailpit: the test's API sends there whatever .env says); the room's members and
// activity. The room is deleted and both people's notifications are marked read.
//   node test/notifications.e2e.mjs        (from apps/api, with the dev stack running)
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const API = "http://127.0.0.1:4012";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};

const api = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  env: {
    ...process.env,
    API_PORT: "4012",
    LOG_LEVEL: "warn",
    NOTIFICATION_DIGEST_CHECK_MS: "2000",
    NOTIFICATION_DIGEST_AFTER_MS: "0",
    NOTIFICATION_DIGEST_EVERY_MS: "0",
    // Mail goes to Mailpit, whatever .env sends through: the test's accounts aren't real.
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASS: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiErrors = "";
api.stderr.on("data", (chunk) => (apiErrors += chunk));
// The digest's and the mail's own words, shown if a check fails.
let apiLog = "";
api.stdout.on("data", (chunk) => (apiLog += `${String(chunk).split("\n").filter((line) => /digest|mail/i.test(line)).join("\n")}\n`));

/** A signed-in person: their own cookies. */
function person() {
  const jar = new Map();
  return async function call(path, { method = "GET", body } = {}) {
    const response = await fetch(API + path, {
      method,
      headers: {
        origin: ORIGIN,
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
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
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text };
  };
}
const one = person();
const two = person();
const mails = async () => (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:test2@codechatter.local subject:missed")}`).then((r) => r.json())).messages ?? [];

let roomId = null;
try {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${API}/api/healthz`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  const signIn = (call, email) => call("/api/auth/sign-in/email", { method: "POST", body: { email, password: "codechatter123" } });
  check("signedIn", (await signIn(one, "test1@codechatter.local")).status === 200 && (await signIn(two, "test2@codechatter.local")).status === 200);
  const test2 = (await two("/api/me")).json;
  const test2Id = test2.user?.id ?? test2.id;
  await two("/api/me/notifications/read", { method: "POST", body: { all: true } });
  await two("/api/me/notification-settings", { method: "PUT", body: { emailDigest: true } });
  const baseline = (await mails()).length;

  // A room of test1's; test2 joins with the invite link and test1 hears of it.
  const created = await one("/api/rooms", { method: "POST", body: { name: "Notifications e2e" } });
  roomId = created.json?.id ?? null;
  const joined = await two("/api/rooms/join", { method: "POST", body: { code: roomId, inviteToken: created.json?.inviteToken } });
  await sleep(300);
  const inbox1 = (await one("/api/me/notifications")).json;
  const join = inbox1?.items?.find((item) => item.type === "room.joined" && item.room?.id === roomId);
  check("ownerHearsOfJoin", joined.json?.status === "joined" && join?.actor?.name === "test2" && join.payload?.role === "editor", JSON.stringify(join));

  const members = (await one(`/api/rooms/${roomId}/members`)).json?.members ?? [];
  check("members", ["test1", "test2"].every((name) => members.some((m) => m.name === name)), JSON.stringify(members.map((m) => m.name)));

  // A comment reply for test2 (and for someone not in the room, who is left out).
  const notify = await one(`/api/rooms/${roomId}/notifications/comment`, {
    method: "POST",
    body: { kind: "reply", threadId: "t-e2e", recipients: [test2Id, "not-a-member"], path: "src/app.py", line: 12, excerpt: "Looks good to me" },
  });
  const inbox2 = (await two("/api/me/notifications")).json;
  const reply = inbox2?.items?.find((item) => item.type === "comment.reply" && item.room?.id === roomId);
  check("commentNotified", notify.status === 204 && reply?.payload?.path === "src/app.py" && reply.payload.line === 12 && reply.actor?.name === "test1", notify.text || JSON.stringify(reply));
  check("unreadCounted", inbox2?.unread >= 1, inbox2?.unread);
  const outsider = await two(`/api/rooms/E2ETST/notifications/comment`, { method: "POST", body: { kind: "new", threadId: "x", recipients: ["a"], path: "a", line: 1, excerpt: "x" } });
  check("roomMembersOnly", outsider.status === 204 || outsider.status === 403, outsider.status);

  // The digest: test2's unread notification arrives by email, once (counted from what Mailpit held before).
  let digests = [];
  for (let i = 0; i < 20 && digests.length <= baseline; i++) {
    await sleep(1000);
    digests = await mails();
  }
  const before = digests.length;
  check("digestEmailed", before > baseline && /thing(s)? you missed/.test(digests[0]?.Subject ?? ""), digests[0]?.Subject);
  await sleep(5_000);
  check("digestOnce", (await mails()).length === before, `${before} then ${(await mails()).length}`);

  // Read: one, then all; and the digest setting.
  await two("/api/me/notifications/read", { method: "POST", body: { ids: [reply.id] } });
  const afterOne = (await two("/api/me/notifications")).json;
  check("markedRead", afterOne?.items?.find((item) => item.id === reply.id)?.readAt !== null);
  await two("/api/me/notifications/read", { method: "POST", body: { all: true } });
  check("allRead", (await two("/api/me/notifications")).json?.unread === 0);
  const off = await two("/api/me/notification-settings", { method: "PUT", body: { emailDigest: false } });
  check("digestSetting", off.json?.emailDigest === false && (await two("/api/me/notification-settings")).json?.emailDigest === false);
  await two("/api/me/notification-settings", { method: "PUT", body: { emailDigest: true } });

  // The activity feed: who joined.
  const activity = (await one(`/api/rooms/${roomId}/activity`)).json?.items ?? [];
  check("activityFeed", activity.some((item) => item.kind === "joined" && item.who === "test2"), JSON.stringify(activity.slice(0, 3)));
  const stranger = await person()(`/api/rooms/${roomId}/activity`);
  check("activityNeedsSignIn", stranger.status === 401, stranger.status);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  if (roomId) await one(`/api/rooms/${roomId}`, { method: "DELETE" });
  // Nothing of the test's left unread, so the dev API's digest has nothing of it to send.
  await one("/api/me/notifications/read", { method: "POST", body: { all: true } }).catch(() => {});
  await two("/api/me/notifications/read", { method: "POST", body: { all: true } }).catch(() => {});
  api.kill();
}
if (apiErrors.includes("Error")) console.log(apiErrors.slice(0, 2000));
if (results.includes(false) && apiLog) console.log(apiLog.slice(0, 2000));
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
