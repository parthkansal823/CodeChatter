// Interview mode from end to end, in disposable interview rooms: the question bank, the single-use link, who sees what,
// tests with hidden cases, the server's timer really taking rights away (an open editor connection included), the
// scorecard and the replay. It lives here because it needs a real collab connection.
//   node --env-file=../../.env test/interviews.e2e.mjs        (from apps/collab, with the dev stack running)
import { createDb, schema } from "@codechatter/db";
import { findByPath, setFileText, textOf } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const WS = `${ORIGIN.replace(/^http/, "ws")}/collab`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > end) return value;
    await sleep(250);
  }
}

/** A browser of sorts: keeps its cookies, and answers { status, body, text, bytes }. */
function person() {
  const cookies = new Map();
  const call = async (path, { method = "GET", json } = {}) => {
    const response = await fetch(`${ORIGIN}/api${path}`, {
      method,
      signal: AbortSignal.timeout(120_000),
      headers: {
        origin: ORIGIN,
        ...(json !== undefined && { "content-type": "application/json" }),
        ...(cookies.size && { cookie: call.cookie() }),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    let body;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body, text, bytes };
  };
  call.cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  return call;
}

async function signIn(email) {
  const call = person();
  const res = await call("/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`);
  return call;
}

function connect(roomId, call, attempts = 1) {
  const cookie = call.cookie();
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: attempts });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${roomId}:files`, document: doc, token: "cookie" });
  const state = { doc, closed: 0, synced: 0, close: () => (provider.destroy(), socket.destroy()) };
  provider.on("close", () => (state.closed += 1));
  provider.on("synced", () => (state.synced += 1));
  provider.attach();
  state.outcome = new Promise((resolve) => {
    provider.on("synced", () => resolve("synced"));
    provider.on("authenticationFailed", ({ reason }) => resolve(`denied: ${reason}`));
    setTimeout(() => resolve("timeout"), 10_000);
  });
  return state;
}

const stateVector = (doc) => Buffer.from(Y.encodeStateVector(doc)).toString("base64");
const fileText = (doc, path) => {
  const node = findByPath(doc, path);
  return node ? textOf(doc, node.id)?.toString() : undefined;
};

const STARTER = "# STARTER-MARK\n";
const SOLUTION = "a, b = input().split()\nprint(int(a) + int(b))\n";
const QUESTION = {
  title: "TITLE-SECRET add two numbers",
  prompt: "PROMPT-SECRET: read two numbers, print their sum.",
  file: "main.py",
  starterFiles: [{ path: "main.py", content: STARTER }],
  tests: [
    { id: "v1", input: "1 2\n", expected: "3\n", hidden: false },
    { id: "h1", input: "7001 7002\n", expected: "14003\n", hidden: true },
  ],
  rubric: [{ id: "c1", label: "RUBRIC-SECRET clarity" }],
  durationMinutes: 30,
  timeLimitMs: 4000,
};
const SECRETS = ["7001 7002", "14003", "RUBRIC-SECRET", "NOTES-SECRET", "candidateTokenHash"];
const leaks = (text, secrets = SECRETS) => secrets.filter((secret) => text.includes(secret));

const db = createDb(process.env.DATABASE_URL, { max: 2 });
const open = [];
const made = [];
const questions = [];
const [interviewer, candidate] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);

try {
  // The bank.
  const noFile = await interviewer("/interview-questions", { method: "POST", json: { ...QUESTION, file: "other.py" } });
  check("a question's file must be a starter file", noFile.status === 400, noFile.status);
  const created = await interviewer("/interview-questions", { method: "POST", json: QUESTION });
  check("a question is added", created.status === 201 && created.body.tests.length === 2, created.status);
  const questionId = created.body.id;
  questions.push(questionId);
  const listed = await interviewer("/interview-questions");
  const item = listed.body.find((question) => question.id === questionId);
  check("the list counts tests without their contents", item?.tests === 2 && item?.hiddenTests === 1 && item?.criteria === 1 && !leaks(JSON.stringify(item)).length);
  check("another organisation can't read it", (await candidate(`/interview-questions/${questionId}`)).status === 404);
  const renamed = await interviewer(`/interview-questions/${questionId}`, { method: "PUT", json: { ...QUESTION, durationMinutes: 45 } });
  check("a question can be edited", renamed.status === 200 && renamed.body.durationMinutes === 45);

  // Scheduling, and the link before it starts.
  const scheduled = await interviewer("/interviews", { method: "POST", json: { questionId, candidateName: "Ana Candidate", durationMinutes: 30 } });
  check("an interview is scheduled, with a link", scheduled.status === 201 && scheduled.body.candidateToken?.length > 16 && scheduled.body.status === "scheduled", scheduled.status);
  const { id, roomId, candidateToken: token } = scheduled.body;
  made.push(id);
  // Edits to the bank don't change an interview: it keeps its snapshot.
  await interviewer(`/interview-questions/${questionId}`, { method: "PUT", json: { ...QUESTION, prompt: "CHANGED LATER" } });
  check("the interview keeps its own copy of the question", (await interviewer(`/interviews/${id}`)).body.prompt === QUESTION.prompt);

  const stranger = person();
  const landing = await stranger(`/interview-invites/${token}`);
  check("the link works without an account", landing.status === 200 && landing.body.candidateName === "Ana Candidate" && landing.body.durationMinutes === 30, landing.status);
  check("the landing page shows nothing of the question", !leaks(landing.text, [...SECRETS, "TITLE-SECRET", "PROMPT-SECRET"]).length, landing.text);
  check("a wrong link is refused", (await stranger(`/interview-invites/${"x".repeat(32)}`)).status === 404);
  check("the API needs a session for the rest", (await stranger(`/interviews/${id}`)).status === 401);
  check("a stranger can't read the interview", (await candidate(`/interviews/${id}`)).status === 403);
  // A private room doesn't confirm it exists to someone outside it.
  check("or the room's view of it", (await candidate(`/rooms/${roomId}/interview`)).status === 404);

  check("the interviewer can't use the candidate's link", (await interviewer(`/interview-invites/${token}/claim`, { method: "POST" })).status === 409);
  const claimed = await candidate(`/interview-invites/${token}/claim`, { method: "POST" });
  check("the candidate uses the link and waits", claimed.status === 200 && claimed.body.waiting === true && claimed.body.roomId === roomId, claimed.text);
  check("using it again is fine for them", (await candidate(`/interview-invites/${token}/claim`, { method: "POST" })).status === 200);
  check("a second person is refused", (await stranger(`/interview-invites/${token}/guest`, { method: "POST" })).status === 409);
  check("waiting, they can't read the room's view", (await candidate(`/rooms/${roomId}/interview`)).status === 404);
  const early = connect(roomId, candidate);
  open.push(early);
  const earlyResult = await early.outcome;
  check("waiting, they can't open the files", earlyResult.startsWith("denied"), earlyResult);
  check("waiting, they can't run anything", (await candidate(`/rooms/${roomId}/interview/run-tests`, { method: "POST", json: {} })).status === 404);
  check("the list shows they've joined", (await interviewer("/interviews")).body.find((row) => row.id === id)?.candidateJoined === true);

  // It starts.
  check("only an interviewer can start it", (await candidate(`/interviews/${id}/start`, { method: "POST" })).status === 403);
  const started = await interviewer(`/interviews/${id}/start`, { method: "POST" });
  const ends = new Date(started.body.endsAt).getTime() - new Date(started.body.startedAt).getTime();
  check("it starts, on the server's clock", started.status === 200 && started.body.status === "live" && ends === 30 * 60_000, started.text);
  check("it can't start twice", (await interviewer(`/interviews/${id}/start`, { method: "POST" })).status === 409);

  const seen = await candidate(`/rooms/${roomId}/interview`);
  check("the candidate reads the question", seen.status === 200 && seen.body.role === "candidate" && seen.body.prompt === QUESTION.prompt && seen.body.visibleTests.length === 1, seen.status);
  check("and sees the hidden tests only as a count", seen.body.hiddenTestCount === 1 && !leaks(seen.text).length, leaks(seen.text));
  check("the clock comes from the server", typeof seen.body.now === "string" && seen.body.endsAt === started.body.endsAt);
  const members = await candidate(`/rooms/${roomId}`);
  check("they're the room's candidate", members.body?.role === "candidate", members.body?.role);

  // Their editor, and an interviewer's beside it.
  const hers = connect(roomId, candidate, 10);
  const his = connect(roomId, interviewer, 10);
  open.push(hers, his);
  check("the candidate's editor opens", (await hers.outcome) === "synced");
  await his.outcome;
  check("the starter file is there", fileText(hers.doc, "main.py") === STARTER, fileText(hers.doc, "main.py"));
  setFileText(hers.doc, findByPath(hers.doc, "main.py").id, SOLUTION);
  check("their edits reach the interviewer", await until(() => fileText(his.doc, "main.py") === SOLUTION, 5000));

  // What's off during an interview.
  const chat = await candidate(`/rooms/${roomId}/ai/chat`, { method: "POST", json: { mode: "assistant", messages: [{ role: "user", content: "solve it" }], context: {} } });
  check("AI chat is off for the candidate", chat.status === 403 && chat.text.includes("off during an interview"), `${chat.status} ${chat.text}`);
  const complete = await candidate(`/rooms/${roomId}/ai/complete`, { method: "POST", json: { path: "main.py", prefix: "a = " } });
  check("AI completion is off too", complete.status === 403, complete.status);
  check("an interview room can't be forked", (await candidate(`/rooms/${roomId}/fork`, { method: "POST", json: { name: "copy" } })).status === 403);
  check("the candidate can't read the scorecard's route", (await candidate(`/interviews/${id}`)).status === 403);
  check("or the replay", (await candidate(`/interviews/${id}/replay`)).status === 403 && (await candidate(`/interviews/${id}/replay/updates`)).status === 403);
  check("or save a scorecard", (await candidate(`/interviews/${id}/scorecard`, { method: "PUT", json: { scores: [], overall: 5, recommendation: "yes", notes: "" } })).status === 403);
  check("or extend the time", (await candidate(`/interviews/${id}/extend`, { method: "POST", json: { minutes: 60 } })).status === 403);
  check("or end it", (await candidate(`/interviews/${id}/finish`, { method: "POST" })).status === 403);

  // The tests.
  const ran = await candidate(`/rooms/${roomId}/interview/run-tests`, { method: "POST", json: { stateVector: stateVector(hers.doc) } });
  check("the tests run", ran.status === 200 && ran.body.run?.passed === 2 && ran.body.run?.total === 2, ran.text);
  check("the candidate gets visible results, hidden ones counted", ran.body.run?.visible?.[0]?.stdout?.trim() === "3" && ran.body.run?.hidden?.passed === 1 && ran.body.run?.hidden?.total === 1);
  check("no hidden input or output in their answer", !leaks(ran.text).length && !("hiddenCases" in (ran.body.run ?? {})), leaks(ran.text));
  const later = await candidate(`/rooms/${roomId}/interview`);
  check("nor in their view afterwards", later.body.runs.length === 1 && !leaks(later.text).length, leaks(later.text));
  const full = await interviewer(`/rooms/${roomId}/interview`);
  check("the interviewer sees every case", full.body.role === "interviewer" && full.body.runs[0].hiddenCases[0].input === "7001 7002\n" && full.body.runs[0].hiddenCases[0].stdout.trim() === "14003" && full.body.runs[0].by !== null, full.body.role);

  setFileText(hers.doc, findByPath(hers.doc, "main.py").id, "print(");
  const broken = await candidate(`/rooms/${roomId}/interview/run-tests`, { method: "POST", json: { stateVector: stateVector(hers.doc) } });
  check("a broken answer fails, and hidden cases stay counted", broken.status === 200 && broken.body.run.passed === 0 && !leaks(broken.text).length, broken.text);
  setFileText(hers.doc, findByPath(hers.doc, "main.py").id, SOLUTION);

  // Interviewer's tools.
  const extended = await interviewer(`/interviews/${id}/extend`, { method: "POST", json: { minutes: 10 } });
  check("the time can be extended", new Date(extended.body.endsAt).getTime() - new Date(started.body.endsAt).getTime() === 10 * 60_000, extended.body.endsAt);
  const badScore = await interviewer(`/interviews/${id}/scorecard`, { method: "PUT", json: { scores: [{ id: "nope", score: 3, note: "" }], overall: null, recommendation: null, notes: "" } });
  check("a score must be for one of the criteria", badScore.status === 400, badScore.status);
  const scored = await interviewer(`/interviews/${id}/scorecard`, { method: "PUT", json: { scores: [{ id: "c1", score: 4, note: "ok" }], overall: 4, recommendation: "yes", notes: "NOTES-SECRET" } });
  check("the scorecard saves", scored.status === 200 && scored.body.scorecard.overall === 4 && scored.body.scorecard.scores[0].score === 4, scored.status);
  const stillPrivate = await candidate(`/rooms/${roomId}/interview`);
  check("and stays private", !leaks(stillPrivate.text).length, leaks(stillPrivate.text));

  // The server's timer ends it.
  await until(() => fileText(his.doc, "main.py") === SOLUTION, 5000);
  const synced = hers.synced;
  await db.db.update(schema.interviews).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.interviews.id, id));
  const finished = await until(async () => {
    const now = await interviewer(`/interviews/${id}`);
    return now.body.status === "finished" ? now : null;
  }, 25_000);
  check("the server's timer ends it", finished?.body?.status === "finished" && Boolean(finished?.body?.finishedAt), finished?.body?.status);
  check("the candidate's open editor was disconnected", await until(() => hers.closed > 0, 5000), `closed ${hers.closed}`);
  check("and it reconnected", await until(() => hers.synced > synced, 10_000), `synced ${hers.synced}`);
  const after = await candidate(`/rooms/${roomId}`);
  check("they're a viewer now", after.body?.role === "viewer", after.body?.role);
  const LATE = "print('written after the end')\n";
  setFileText(hers.doc, findByPath(hers.doc, "main.py").id, LATE);
  await sleep(1500);
  check("a write after the end reaches nobody", fileText(his.doc, "main.py") === SOLUTION, fileText(his.doc, "main.py"));
  const fresh = connect(roomId, interviewer);
  open.push(fresh);
  await fresh.outcome;
  check("and isn't kept", fileText(fresh.doc, "main.py") === SOLUTION, fileText(fresh.doc, "main.py"));
  check("they can't run the tests now", (await candidate(`/rooms/${roomId}/interview/run-tests`, { method: "POST", json: {} })).status === 403);
  check("the link is closed", (await candidate(`/interview-invites/${token}/claim`, { method: "POST" })).status === 410);
  check("they can still read the question", (await candidate(`/rooms/${roomId}/interview`)).body.prompt === QUESTION.prompt);
  check("the interviewer's tests refuse after the end", (await interviewer(`/rooms/${roomId}/interview/run-tests`, { method: "POST", json: {} })).status === 409);
  check("finishing again does no harm", (await interviewer(`/interviews/${id}/finish`, { method: "POST" })).status === 200);
  check("a finished interview can't be cancelled", (await interviewer(`/interviews/${id}/cancel`, { method: "POST" })).status === 409);

  // The replay.
  const replay = await interviewer(`/interviews/${id}/replay`);
  check("the replay has moments, runs in order", replay.status === 200 && replay.body.moments.length > 0 && replay.body.events.filter((event) => event.kind === "run").length === 2, replay.text);
  const frames = await interviewer(`/interviews/${id}/replay/updates`);
  const updates = [];
  for (let at = 0; at < frames.bytes.length; ) {
    const ts = frames.bytes.readDoubleBE(at);
    const length = frames.bytes.readUInt32BE(at + 8);
    updates.push({ ts, update: frames.bytes.subarray(at + 12, at + 12 + length) });
    at += 12 + length;
  }
  const rebuild = (upTo) => {
    const doc = new Y.Doc();
    for (const { ts, update } of updates) if (ts <= upTo) Y.applyUpdate(doc, update);
    return fileText(doc, "main.py");
  };
  // The first moment: nobody had opened the files before it started, so that's when they were seeded.
  const first = new Date(replay.body.moments[0]).getTime();
  check("rebuilt at the first moment, it's the starter file", rebuild(first) === STARTER, rebuild(first));
  check("rebuilt at the end, it's their answer", rebuild(new Date(replay.body.finishedAt).getTime()) === SOLUTION, rebuild(new Date(replay.body.finishedAt).getTime()));

  // Joining without an account.
  const second = await interviewer("/interviews", { method: "POST", json: { questionId, candidateName: "Guest Candidate" } });
  made.push(second.body.id);
  const guest = person();
  const joined = await guest(`/interview-invites/${second.body.candidateToken}/guest`, { method: "POST" });
  check("a candidate can join without an account", joined.status === 200 && joined.body.waiting === true, joined.text);
  const session = await guest("/auth/get-session");
  check("signed in under their own name", session.body?.user?.name === "Guest Candidate", session.body?.user?.name);
  check("the link is theirs now", (await candidate(`/interview-invites/${second.body.candidateToken}/claim`, { method: "POST" })).status === 409);
  check("no account is given a question early", (await guest(`/rooms/${second.body.roomId}/interview`)).status === 404);
  await interviewer(`/interviews/${second.body.id}/start`, { method: "POST" });
  const inRoom = await guest(`/rooms/${second.body.roomId}/interview`);
  check("once it starts, they're in", inRoom.status === 200 && inRoom.body.role === "candidate", inRoom.status);
  const ended = await interviewer(`/interviews/${second.body.id}/finish`, { method: "POST" });
  check("finishing by hand works", ended.body.status === "finished" && (await guest(`/rooms/${second.body.roomId}`)).body?.role === "viewer");

  // A new link, and cancelling.
  const third = await interviewer("/interviews", { method: "POST", json: { questionId, candidateName: "Third" } });
  made.push(third.body.id);
  const rotated = await interviewer(`/interviews/${third.body.id}/rotate-link`, { method: "POST" });
  check("a link can be replaced", rotated.status === 200 && rotated.body.candidateToken !== third.body.candidateToken);
  check("the old one stops working", (await stranger(`/interview-invites/${third.body.candidateToken}`)).status === 404);
  check("the new one works", (await stranger(`/interview-invites/${rotated.body.candidateToken}`)).status === 200);
  const cancelled = await interviewer(`/interviews/${third.body.id}/cancel`, { method: "POST" });
  check("an interview can be cancelled", cancelled.status === 200 && cancelled.body.status === "cancelled");
  check("its link is closed", (await candidate(`/interview-invites/${rotated.body.candidateToken}/claim`, { method: "POST" })).status === 410);
  check("and it can't start", (await interviewer(`/interviews/${third.body.id}/start`, { method: "POST" })).status === 409);
} catch (error) {
  check("the flow completes", false, error instanceof Error ? error.stack : String(error));
} finally {
  open.forEach((connection) => connection.close());
  for (const id of made) {
    const res = await interviewer(`/interviews/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.status !== 204) check(`interview ${id} is removed`, false, res?.status);
  }
  for (const id of questions) await interviewer(`/interview-questions/${id}`, { method: "DELETE" }).catch(() => {});
  if (made.length) check("deleted interviews are gone", (await interviewer(`/interviews/${made[0]}`)).status === 404);
  if (questions.length) check("archived questions leave the bank", !(await interviewer("/interview-questions")).body.some((question) => question.id === questions[0]));
  await db.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
