// Interviews and assessments through the real API, with real editor connections and the real judge. The question bank's
// kinds, random papers for many candidates, an assessment's window and self-start, a live interview's questions asked on the
// spot and its AI switch, marking, the integrity record, the results table, and above all what a candidate must never see.
//   node --env-file=../../.env test/interview-papers.e2e.mjs        (from apps/collab, with the dev stack running)
import { createDb, schema } from "@codechatter/db";
import { flatten, listTree } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const WS = `${ORIGIN.replace(/^http/, "ws")}/collab`;
const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

async function signIn(email) {
  const res = await fetch(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ email, password: "codechatter123" }) });
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}
async function api(cookie, path, method = "GET", body) {
  const res = await fetch(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, ...(cookie && { cookie }), ...(body !== undefined && { "content-type": "application/json" }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: parsed, text };
}

const open = [];
function filesOf(roomId, cookie) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: 5 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${roomId}:files`, document: doc, token: "cookie" });
  provider.attach();
  const connection = { doc, synced: 0, close: () => (provider.destroy(), socket.destroy()), paths: () => flatten(listTree(doc)).filter((node) => node.kind === "file").map((node) => node.path).sort() };
  provider.on("synced", () => (connection.synced += 1));
  open.push(connection);
  return connection;
}

const database = createDb(process.env.DATABASE_URL, { max: 2 });
const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const stamp = Date.now().toString(36);
const TAG = `t${stamp}`;
const bankIds = [];
const interviewIds = [];
const batchIds = [];

const mcq = (i, extra = {}) => ({ kind: "mcq", title: `Q${i} ${TAG}`, prompt: `SEEN-PROMPT ${i}`, tags: [TAG], marks: 2, difficulty: "easy", choices: [{ id: "right", text: `RIGHT-${i}`, correct: true }, { id: "wrong", text: `WRONG-${i}`, correct: false }], ...extra });
const addQuestion = async (input) => {
  const res = await api(c1, "/api/interview-questions", "POST", input);
  if (res.status !== 201) throw new Error(`question: ${res.status} ${res.text}`);
  bankIds.push(res.body.id);
  return res.body;
};
const CODING = {
  kind: "coding",
  title: `Add one ${TAG}`,
  prompt: "Print the number plus one.",
  tags: [TAG],
  marks: 10,
  file: "main.py",
  starterFiles: [{ path: "main.py", content: "print(int(input().split()[-1]) + 1)\n" }],
  tests: [
    { id: "seen", input: "1", expected: "2", hidden: false },
    { id: "secret", input: "HIDDEN-INPUT 41", expected: "42", hidden: true },
  ],
  rubric: [{ id: "c1", label: "Problem solving" }],
};
const SECRETS = /"correct"|"awarded"|modelAnswer|MODEL-ANSWER|HIDDEN-INPUT|"integrity"|"scorecard"|starterFiles|"rubric"/;
const schedule = (body) => api(c1, "/api/interview-batches", "POST", body);
const paperOf = async (id) => (await api(c1, `/api/interviews/${id}`)).body;
const seenBy = async (cookie, roomId) => api(cookie, `/api/rooms/${roomId}/interview`);
const beat = (cookie, roomId, sessionId, events = []) => api(cookie, `/api/rooms/${roomId}/interview/heartbeat`, "POST", { sessionId, events });

try {
  // The bank.
  record("aMultipleChoiceNeedsARightAnswer", (await api(c1, "/api/interview-questions", "POST", { kind: "mcq", title: "x", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: false }] })).status === 400);
  for (let i = 1; i <= 10; i++) await addQuestion(mcq(i));
  const short = await addQuestion({ kind: "short", title: `Why ${TAG}`, tags: [TAG], marks: 5, modelAnswer: "MODEL-ANSWER" });
  const design = await addQuestion({ kind: "design", title: `Design a queue ${TAG}`, tags: [TAG], marks: 20, modelAnswer: "MODEL-ANSWER" });
  const coding = await addQuestion(CODING);
  const listed = (await api(c1, "/api/interview-questions")).body;
  const inBank = listed.filter((item) => item.tags.includes(TAG));
  record("theBankKnowsEachKind", new Set(inBank.map((item) => item.kind)).size === 4 && inBank.length === 13, `${inBank.length} questions`);
  record("theBankListHidesTheAnswers", !JSON.stringify(inBank).includes("RIGHT-"));

  // Filling the bank in one go.
  const importTag = `i${stamp}`;
  const importing = await api(c1, "/api/interview-questions/import", "POST", { questions: [mcq(101, { tags: [importTag] }), { kind: "short", title: `Imported short ${TAG}`, tags: [importTag] }] });
  record("questionsImportInBulk", importing.status === 201 && importing.body.imported === 2, importing.text.slice(0, 100));
  const beforeBad = (await api(c1, "/api/interview-questions")).body.length;
  const badImport = await api(c1, "/api/interview-questions/import", "POST", { questions: [mcq(102, { tags: [importTag] }), { kind: "mcq", title: "No choices" }] });
  record("oneBadQuestionStopsTheWholeImport", badImport.status === 400 && (await api(c1, "/api/interview-questions")).body.length === beforeBad);
  record("candidatesCantFillSomeoneElsesBank", (await api(null, "/api/interview-questions/import", "POST", { questions: [{ kind: "short", title: "x" }] })).status === 401);
  for (const item of (await api(c1, "/api/interview-questions")).body.filter((question) => question.tags.includes(importTag))) bankIds.push(item.id);

  // Scheduling an assessment for many people.
  const rules = { fixed: [], random: [{ count: 5, kind: "mcq", tag: TAG }, { count: 1, kind: "short", tag: TAG }, { count: 1, kind: "coding", tag: TAG }] };
  const assessment = { mode: "assessment", title: `Screening ${TAG}`, durationMinutes: 30, paper: rules };
  const before = (await api(c1, "/api/interview-batches")).body.length;
  const tooMany = await schedule({ ...assessment, paper: { random: [{ count: 50, kind: "mcq", tag: TAG }] }, candidates: [{ name: "Nobody" }] });
  record("aBankTooSmallSaysSo", tooMany.status === 400 && /50 wanted, 10 left/.test(tooMany.body?.detail ?? ""), tooMany.body?.detail);
  record("andNothingIsLeftBehind", (await api(c1, "/api/interview-batches")).body.length === before);
  record("theSameEmailTwiceIsRefused", (await schedule({ ...assessment, candidates: [{ name: "A", email: "a@x.com" }, { name: "B", email: "A@X.COM" }] })).status === 400);
  record("anAssessmentNeedsQuestions", (await schedule({ ...assessment, paper: {}, candidates: [{ name: "A" }] })).status === 400);

  const made = await schedule({ ...assessment, candidates: [{ name: "Ana", email: `ana.${stamp}@example.com` }, { name: "Ben" }, { name: "Cy" }] });
  record("everyoneGetsALink", made.status === 201 && made.body.links.length === 3 && new Set(made.body.links.map((link) => link.candidateToken)).size === 3, made.text.slice(0, 120));
  batchIds.push(made.body.id);
  for (const link of made.body.links) interviewIds.push(link.interviewId);
  const [ana, ben, cy] = made.body.links;
  const anaView = await paperOf(ana.interviewId);
  const benView = await paperOf(ben.interviewId);
  record("everyoneGetsAWholePaper", anaView.paper.length === 7 && benView.paper.length === 7);
  record("papersAreDrawnSeparately", JSON.stringify(anaView.paper.map((question) => question.bankId)) !== JSON.stringify(benView.paper.map((question) => question.bankId)));
  record("theQuickQuestionsComeFirst", anaView.paper.map((question) => question.kind).join() === "mcq,mcq,mcq,mcq,mcq,short,coding");
  const roomId = anaView.roomId;

  // The link, before it's used.
  const invitation = await api(null, `/api/interview-invites/${ana.candidateToken}`);
  record("theLinkSaysWhatItIs", invitation.body?.mode === "assessment" && invitation.body?.title === `Screening ${TAG}` && invitation.body?.questions?.mcq === 5 && invitation.body?.questions?.coding === 1);
  record("theLinkGivesNoQuestionAway", !/SEEN-PROMPT|RIGHT-|Add one/.test(invitation.text));
  record("onlyTheOwnerOfTheLinkCanStart", (await api(c2, `/api/interview-invites/${ana.candidateToken}/start`, "POST")).status === 403);
  const joined = await api(c2, `/api/interview-invites/${ana.candidateToken}/claim`, "POST");
  record("usingTheLinkOnlyWaits", joined.body?.waiting === true);
  record("whileWaitingTheRoomIsClosed", (await api(c2, `/api/rooms/${roomId}`)).status === 404);

  // Starting it.
  const started = await api(c2, `/api/interview-invites/${ana.candidateToken}/start`, "POST");
  record("theCandidateStartsIt", started.status === 200 && started.body.waiting === false, started.text.slice(0, 100));
  record("thenTheyreTheCandidate", (await api(c2, `/api/rooms/${roomId}`)).body?.role === "candidate");

  // What they can see.
  const seen = await seenBy(c2, roomId);
  record("theySeeTheirPaper", seen.status === 200 && seen.body.role === "candidate" && seen.body.paper.length === 7);
  record("neverARightAnswerOrAHiddenTest", !SECRETS.test(seen.text), SECRETS.exec(seen.text)?.[0]);
  const firstMcq = anaView.paper.find((question) => question.kind === "mcq");
  const secondMcq = anaView.paper.filter((question) => question.kind === "mcq")[1];
  const shortOnPaper = anaView.paper.find((question) => question.kind === "short");
  const codingOnPaper = anaView.paper.find((question) => question.kind === "coding");
  record("theyAreNotToldItsOneAnswer", seen.body.paper[0].multiple === false && seen.body.paper[0].choices.every((choice) => Object.keys(choice).sort().join() === "id,text"));
  record("theyCantSeeTheInterviewersPage", (await api(c2, `/api/interviews/${ana.interviewId}`)).status === 403);
  record("norTheResults", (await api(c2, `/api/interview-batches/${made.body.id}`)).status === 403);
  const files = filesOf(roomId, c2);
  await until(() => files.synced > 0);
  record("theRoomHasTheCodeFiles", files.paths().join() === "main.py", files.paths().join());
  files.close();

  // Answering.
  const answers = `/api/rooms/${roomId}/interview/answers`;
  const right = await api(c2, `${answers}/${firstMcq.id}`, "PUT", { choiceIds: ["right"] });
  record("anAnswerSaves", right.status === 200 && right.body.questionId === firstMcq.id);
  record("withoutSayingIfItWasRight", !SECRETS.test(right.text));
  record("aWrongAnswerSavesTooAndCountsForNothing", (await api(c2, `${answers}/${secondMcq.id}`, "PUT", { choiceIds: ["wrong"] })).status === 200);
  record("aChoiceThatIsntThereIsRefused", (await api(c2, `${answers}/${firstMcq.id}`, "PUT", { choiceIds: ["nope"] })).status === 400);
  record("twoChoicesOnASingleAnswerAreRefused", (await api(c2, `${answers}/${firstMcq.id}`, "PUT", { choiceIds: ["right", "wrong"] })).status === 400);
  record("aQuestionThatIsntOnThePaperIsRefused", (await api(c2, `${answers}/q99`, "PUT", { text: "x" })).status === 404);
  record("theCodeIsntAnAnswer", (await api(c2, `${answers}/${codingOnPaper.id}`, "PUT", { text: "x" })).status === 400);
  record("onlyTheCandidateAnswers", (await api(c1, `${answers}/${firstMcq.id}`, "PUT", { choiceIds: ["right"] })).status === 403);
  await api(c2, `${answers}/${shortOnPaper.id}`, "PUT", { text: "Because of reasons." });
  const backAgain = await seenBy(c2, roomId);
  record("theirAnswersComeBackOnReload", backAgain.body.answers.length === 3 && !SECRETS.test(backAgain.text));

  // The tests, on the paper's coding question.
  const run = await api(c2, `/api/rooms/${roomId}/interview/run-tests`, "POST", { stateVector: "", questionId: codingOnPaper.id });
  record("theirCodeRuns", run.status === 200 && run.body.run.questionId === codingOnPaper.id && run.body.run.total === 2, run.text.slice(0, 160));
  record("hiddenTestsStayHidden", !run.text.includes("HIDDEN-INPUT") && run.body.run.hidden?.total === 1);
  const unknownRun = await api(c2, `/api/rooms/${roomId}/interview/run-tests`, "POST", { stateVector: "", questionId: firstMcq.id });
  record("aMultipleChoiceQuestionHasNoTests", unknownRun.status === 404);

  // Marking.
  const interviewerSees = await paperOf(ana.interviewId);
  record("theRightAnswerScored", interviewerSees.answers.find((answer) => answer.questionId === firstMcq.id)?.awarded === 2);
  record("theWrongOneDidnt", interviewerSees.answers.find((answer) => answer.questionId === secondMcq.id)?.awarded === 0);
  record("theShortAnswerWaitsForAPerson", interviewerSees.answers.find((answer) => answer.questionId === shortOnPaper.id)?.awarded === null && interviewerSees.score.unmarked === 1);
  const marksAt = `/api/interviews/${ana.interviewId}/answers`;
  record("marksCantBeMoreThanItsWorth", (await api(c1, `${marksAt}/${shortOnPaper.id}/marks`, "PUT", { marks: 6 })).status === 400);
  record("multipleChoiceMarksItself", (await api(c1, `${marksAt}/${firstMcq.id}/marks`, "PUT", { marks: 1 })).status === 400);
  const marked = await api(c1, `${marksAt}/${shortOnPaper.id}/marks`, "PUT", { marks: 4 });
  record("theInterviewerMarksIt", marked.status === 200 && marked.body.score.unmarked === 0);
  record("itAddsUp", marked.body.score.marks === 2 + 4 + 10 && marked.body.score.max === 10 + 5 + 10, `${marked.body.score.marks}/${marked.body.score.max}`);
  record("theCandidateCantMark", (await api(c2, `${marksAt}/${shortOnPaper.id}/marks`, "PUT", { marks: 5 })).status === 403);

  // The integrity record.
  const now = new Date().toISOString();
  const tab = randomUUID();
  record("thePageReportsIn", (await beat(c2, roomId, tab, [{ kind: "tab-hidden", at: now }, { kind: "pasted", at: now, length: 900 }])).body?.status === "live");
  const reload = randomUUID();
  await beat(c2, roomId, reload);
  const afterReload = await paperOf(ana.interviewId);
  record("reloadingIsntASecondTab", !afterReload.integrity.counts["second-session"]);
  await beat(c2, roomId, tab);
  const afterSecond = await paperOf(ana.interviewId);
  record("twoTabsTakingTurnsAreNoticed", afterSecond.integrity.counts["second-session"] === 1, JSON.stringify(afterSecond.integrity.counts));
  await beat(c2, roomId, reload);
  await beat(c2, roomId, tab);
  record("andSaidOnlyOnce", (await paperOf(ana.interviewId)).integrity.counts["second-session"] === 1);
  await database.db.update(schema.interviews).set({ beatAt: new Date(Date.now() - 180_000) }).where(eq(schema.interviews.id, ana.interviewId));
  await beat(c2, roomId, tab);
  const report = await paperOf(ana.interviewId);
  record("aPageGoingQuietIsNoticed", report.integrity.counts["page-silent"] === 1 && report.integrity.events.some((event) => event.kind === "page-silent" && event.seconds >= 170));
  record("pastingIsRecordedWithItsSize", report.integrity.events.some((event) => event.kind === "pasted" && event.length === 900));
  record("itsAConcern", report.integrity.level === "concern");
  record("aMadeUpKindIsRefused", (await beat(c2, roomId, tab, [{ kind: "made-up", at: now }])).status === 400);
  record("anotherPersonCantReport", (await beat(c1, roomId, tab)).status === 403);
  record("theCandidateDoesntSeeTheRecord", !/"integrity"|tab-hidden/.test((await seenBy(c2, roomId)).text));

  // Handing in.
  record("theResultsShowEveryone", (await api(c1, `/api/interview-batches/${made.body.id}`)).body?.rows?.length === 3);
  record("itCantBeDeletedWhileSomeonesInIt", (await api(c1, `/api/interview-batches/${made.body.id}`, "DELETE")).status === 409);
  record("anotherPersonCantHandIn", (await api(c1, `/api/rooms/${roomId}/interview/submit`, "POST")).status === 403);
  record("theCandidateHandsIn", (await api(c2, `/api/rooms/${roomId}/interview/submit`, "POST")).status === 204);
  record("thenTheyCanOnlyLook", (await api(c2, `/api/rooms/${roomId}`)).body?.role === "viewer");
  record("andNoMoreAnswersSave", (await api(c2, `${answers}/${firstMcq.id}`, "PUT", { choiceIds: ["wrong"] })).status === 409);
  record("andTheFinishedPageTellsThePage", (await beat(c2, roomId, tab)).body?.status === "finished");
  const table = (await api(c1, `/api/interview-batches/${made.body.id}`)).body;
  const row = table.rows.find((item) => item.interviewId === ana.interviewId);
  record("theTableHasTheirResult", row.status === "finished" && row.score.marks === 16 && row.answered === 4 && row.integrity.level === "concern", JSON.stringify({ status: row.status, marks: row.score.marks, answered: row.answered, level: row.integrity.level }));
  record("andCounts", table.candidates === 3 && table.started === 1 && table.finished === 1);

  // The window.
  const later = new Date(Date.now() + 3600_000).toISOString();
  const windowed = await schedule({ ...assessment, startsAt: later, candidates: [{ name: "Early" }] });
  batchIds.push(windowed.body.id);
  interviewIds.push(windowed.body.links[0].interviewId);
  const early = windowed.body.links[0];
  await api(c2, `/api/interview-invites/${early.candidateToken}/claim`, "POST");
  record("itCantStartBeforeItOpens", (await api(c2, `/api/interview-invites/${early.candidateToken}/start`, "POST")).status === 409);
  await database.db.update(schema.interviews).set({ opensAt: null, closesAt: new Date(Date.now() - 1000) }).where(eq(schema.interviews.id, early.interviewId));
  record("itCantStartAfterItCloses", [409, 410].includes((await api(c2, `/api/interview-invites/${early.candidateToken}/start`, "POST")).status));
  record("nobodyStartingInTimeIsMissed", await until(async () => (await paperOf(early.interviewId)).status === "missed", 15_000));
  record("thenTheLinkSaysSo", (await api(c2, `/api/interview-invites/${early.candidateToken}/claim`, "POST")).status === 410);

  // A live interview: nothing prepared.
  const live = await api(c1, "/api/interviews", "POST", { candidateName: "Dee" });
  record("anInterviewNeedsNoQuestionToStart", live.status === 201, live.text.slice(0, 120));
  interviewIds.push(live.body.id);
  const liveRoom = live.body.roomId;
  const liveLink = live.body.candidateToken;
  await api(c2, `/api/interview-invites/${liveLink}/claim`, "POST");
  record("theCandidateCantStartAnInterview", (await api(c2, `/api/interview-invites/${liveLink}/start`, "POST")).status === 409);
  record("theInterviewerDoes", (await api(c1, `/api/interviews/${live.body.id}/start`, "POST")).status === 200);
  record("itStartsWithNoQuestions", (await seenBy(c2, liveRoom)).body.paper.length === 0);
  const asks = `/api/interviews/${live.body.id}/questions`;
  record("theCandidateCantAsk", (await api(c2, asks, "POST", { adhoc: { title: "x" } })).status === 403);

  const adhoc = await api(c1, asks, "POST", { adhoc: { kind: "coding", title: "Reverse a string", prompt: "SPOKEN-PROMPT", file: "rev.py" } });
  record("aQuestionMadeUpOnTheSpot", adhoc.status === 201 && adhoc.body.question.file === "q1/rev.py" && adhoc.body.question.askedAt, adhoc.text.slice(0, 120));
  const afterAdhoc = await seenBy(c2, liveRoom);
  record("theCandidateSeesItAtOnce", afterAdhoc.body.paper[0]?.prompt === "SPOKEN-PROMPT");
  const fromBank = await api(c1, asks, "POST", { bankId: coding.id });
  record("orOneFromTheBank", fromBank.status === 201 && fromBank.body.question.file === "q2/main.py" && fromBank.body.question.starterFiles[0].path === "q2/main.py");
  const drawn = await api(c1, asks, "POST", { random: { kind: "mcq", tag: TAG } });
  record("orOneAtRandom", drawn.status === 201 && drawn.body.question.kind === "mcq");
  const designAsked = await api(c1, asks, "POST", { bankId: design.id });
  record("orASystemDesign", designAsked.status === 201 && designAsked.body.question.kind === "design" && designAsked.body.question.file === "");
  const nothingLeft = await api(c1, asks, "POST", { random: { kind: "short", tag: "no-such-tag" } });
  record("anEmptyDrawSaysSo", nothingLeft.status === 400 && /Not enough/.test(nothingLeft.body?.detail ?? ""), nothingLeft.body?.detail);
  const afterAsks = await seenBy(c2, liveRoom);
  record("theCandidateSeesEachAsItsAsked", afterAsks.body.paper.length === 4);
  record("stillNoSecrets", !SECRETS.test(afterAsks.text), SECRETS.exec(afterAsks.text)?.[0]);
  await api(c2, `/api/rooms/${liveRoom}/interview/answers/${designAsked.body.question.id}`, "PUT", { text: "Boxes and arrows." });
  const liveMarked = await api(c1, `/api/interviews/${live.body.id}/answers/q1/marks`, "PUT", { marks: 8 });
  record("theInterviewerMarksCodeWithNoTests", liveMarked.status === 200 && liveMarked.body.score.byKind.coding.marks === 8);
  record("aDesignWaitsForAMark", liveMarked.body.score.unmarked >= 1);
  record("itKnowsWhoSaidWhatAboutTheAnswer", liveMarked.body.answers.some((answer) => answer.text === "Boxes and arrows."));

  // The interviewer decides about the AI.
  const complete = (cookie) => api(cookie, `/api/rooms/${liveRoom}/ai/complete`, "POST", { path: "a.py", language: "python", prefix: "print(", suffix: "" });
  const chat = async () => {
    const controller = new AbortController();
    const res = await fetch(`${ORIGIN}/api/rooms/${liveRoom}/ai/chat`, { method: "POST", signal: controller.signal, headers: { origin: ORIGIN, cookie: c2, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], mode: "assistant", context: {} }) }).catch(() => null);
    controller.abort();
    return res?.status ?? 0;
  };
  record("theAiIsOffToStartWith", (await complete(c2)).status === 403 && (await seenBy(c2, liveRoom)).body.aiAllowed === false);
  record("theCandidateCantTurnItOn", (await api(c2, `/api/interviews/${live.body.id}/ai`, "POST", { allowed: true })).status === 403);
  const switched = await api(c1, `/api/interviews/${live.body.id}/ai`, "POST", { allowed: true });
  record("theInterviewerTurnsItOn", switched.status === 200 && switched.body.aiAllowed === true);
  record("theCandidateIsToldSo", (await seenBy(c2, liveRoom)).body.aiAllowed === true);
  record("thenItsNoLongerRefused", (await complete(c2)).status !== 403);
  const chatStatus = await chat();
  record("norIsChat", chatStatus !== 403 && chatStatus !== 0, String(chatStatus));
  record("theInterviewerSeesThemUseIt", await until(async () => (await paperOf(live.body.id)).integrity.counts["ai-used"] >= 1));
  await api(c1, `/api/interviews/${live.body.id}/ai`, "POST", { allowed: false });
  record("andCanTurnItOffAgain", (await complete(c2)).status === 403);
  const liveRecord = await paperOf(live.body.id);
  record("whichGoesOnTheRecord", liveRecord.integrity.counts["ai-on"] === 1 && liveRecord.integrity.counts["ai-off"] === 1);
  record("usingAllowedAiIsntACharge", liveRecord.integrity.level === "clear", liveRecord.integrity.level);
  await api(c1, `/api/interviews/${live.body.id}/finish`, "POST");
  record("afterwardsTheRoomIsReadOnly", (await complete(c2)).status === 403);

  // Interviews for many people, with questions ready but not shown.
  const interviewsMade = await schedule({ mode: "interview", title: `Round one ${TAG}`, durationMinutes: 45, paper: { random: [{ count: 2, kind: "mcq", tag: TAG }, { count: 1, kind: "coding", tag: TAG }] }, candidates: [{ name: "Eli" }, { name: "Fay" }] });
  record("manyInterviewsAtOnce", interviewsMade.status === 201 && interviewsMade.body.links.length === 2, interviewsMade.text.slice(0, 120));
  batchIds.push(interviewsMade.body.id);
  for (const link of interviewsMade.body.links) interviewIds.push(link.interviewId);
  const eli = interviewsMade.body.links[0];
  const eliBefore = await paperOf(eli.interviewId);
  record("eachHasQuestionsReady", eliBefore.paper.length === 3 && eliBefore.paper.every((question) => question.askedAt === null));
  const eliRoom = eliBefore.roomId;
  await api(c2, `/api/interview-invites/${eli.candidateToken}/claim`, "POST");
  record("theInvitationDoesntListThem", (await api(null, `/api/interview-invites/${eli.candidateToken}`)).body?.questions === null);
  record("aQuestionCantBeAskedBeforeItStarts", (await api(c1, `/api/interviews/${eli.interviewId}/questions/q1/ask`, "POST")).status === 409);
  await api(c1, `/api/interviews/${eli.interviewId}/start`, "POST");
  const eliFiles = filesOf(eliRoom, c2);
  await until(() => eliFiles.synced > 0);
  record("theirFilesDontGiveTheQuestionsAway", eliFiles.paths().join() === "notes.md", eliFiles.paths().join());
  const eliSeen = await seenBy(c2, eliRoom);
  record("theCandidateSeesNoneOfThem", eliSeen.body.paper.length === 0 && !eliSeen.text.includes("SEEN-PROMPT") && !eliSeen.text.includes("Add one"), eliSeen.text.slice(0, 80));
  record("noAnswerToAnUnaskedQuestion", (await api(c2, `/api/rooms/${eliRoom}/interview/answers/q1`, "PUT", { choiceIds: ["right"] })).status === 404);
  record("noRunOfAnUnaskedQuestion", (await api(c2, `/api/rooms/${eliRoom}/interview/run-tests`, "POST", { stateVector: "", questionId: eliBefore.paper.find((question) => question.kind === "coding").id })).status === 404);
  const prepared = await api(c1, `/api/interviews/${eli.interviewId}/questions/q1/ask`, "POST");
  record("thenTheInterviewerAsksOne", prepared.status === 200 && prepared.body.question.askedAt);
  const eliAfter = await seenBy(c2, eliRoom);
  record("andOnlyThatOneAppears", eliAfter.body.paper.length === 1 && eliAfter.body.paper[0].id === "q1");
  eliFiles.close();
  const assessmentAsk = await api(c1, `/api/interviews/${ben.interviewId}/questions`, "POST", { adhoc: { title: "Extra" } });
  record("anAssessmentsPaperIsFixed", assessmentAsk.status === 409);
  await api(c1, `/api/interviews/${eli.interviewId}/finish`, "POST");

  // Deleting takes everything with it.
  const gone = await api(c1, `/api/interview-batches/${made.body.id}`, "DELETE");
  record("aBatchCanBeDeleted", gone.status === 204, gone.text.slice(0, 120));
  record("itsRoomsGoToo", (await api(c1, `/api/rooms/${roomId}`)).status === 404);
  record("andItsGoneFromTheList", !(await api(c1, "/api/interview-batches")).body.some((item) => item.id === made.body.id));
  const [left] = await database.db.select().from(schema.interviews).where(eq(schema.interviews.id, ana.interviewId));
  record("nothingStaysInTheDatabase", !left);
} catch (error) {
  record("noUnexpectedError", false, error?.stack ?? String(error));
} finally {
  for (const item of open) item.close();
  for (const id of interviewIds) {
    await api(c1, `/api/interviews/${id}/finish`, "POST").catch(() => {});
    await api(c1, `/api/interviews/${id}`, "DELETE").catch(() => {});
  }
  if (batchIds.length) await database.db.delete(schema.interviewBatches).where(inArray(schema.interviewBatches.id, batchIds));
  for (const id of bankIds) await api(c1, `/api/interview-questions/${id}`, "DELETE").catch(() => {});
  await database.close?.();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
