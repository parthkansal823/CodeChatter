// Recording an assessment, through the real API and the real object store: nothing without consent, nothing from anyone but
// the candidate, nothing that isn't a video, interviewers only to watch, every viewing audited, and everything deleted with
// its room or on request. The page's own recording is in apps/web/test/interview-recording.e2e.mjs.
//   node --env-file=../../.env test/interview-recording.e2e.mjs        (from apps/collab, with the dev stack running)
import { createDb, schema } from "@codechatter/db";
import { and, eq } from "drizzle-orm";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};

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
  return { status: res.status, body: parsed, text, headers: res.headers };
}

/** A clip's first bytes are all the server looks at. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("not really a whole video, but it starts like one")]);
const database = createDb(process.env.DATABASE_URL, { max: 2 });
const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const stamp = Date.now().toString(36);
const TAG = `r${stamp}`;
const bankIds = [];
const batchIds = [];

const send = (cookie, roomId, { stream = "webcam", body = WEBM, type = "video/webm;codecs=vp9", startedAt = new Date().toISOString(), durationMs = 30_000 } = {}) =>
  fetch(`${ORIGIN}/api/rooms/${roomId}/interview/recordings?${new URLSearchParams({ stream, startedAt, durationMs: String(durationMs) })}`, { method: "POST", headers: { origin: ORIGIN, ...(cookie && { cookie }), "content-type": type }, body });
const beat = (cookie, roomId, sessionId) => api(cookie, `/api/rooms/${roomId}/interview/heartbeat`, "POST", { sessionId, events: [] });

try {
  const question = await api(c1, "/api/interview-questions", "POST", { kind: "short", title: `Why ${TAG}`, tags: [TAG] });
  bankIds.push(question.body.id);
  const paper = { random: [{ count: 1, tag: TAG }] };
  const batch = { mode: "assessment", title: `Recorded ${TAG}`, durationMinutes: 30, paper };

  // Scheduling.
  record("anInterviewIsntRecorded", (await api(c1, "/api/interview-batches", "POST", { ...batch, mode: "interview", recordWebcam: true, candidates: [{ name: "A" }] })).status === 400);
  const made = await api(c1, "/api/interview-batches", "POST", { ...batch, recordWebcam: true, recordScreen: true, candidates: [{ name: "Ana" }, { name: "Ben" }] });
  record("anAssessmentCanRecord", made.status === 201, made.text.slice(0, 120));
  batchIds.push(made.body.id);
  const unrecorded = await api(c1, "/api/interview-batches", "POST", { ...batch, candidates: [{ name: "Cy" }] });
  batchIds.push(unrecorded.body.id);
  const [ana, ben] = made.body.links;
  const anaView = (await api(c1, `/api/interviews/${ana.interviewId}`)).body;
  const roomId = anaView.roomId;

  // Telling them first.
  const invitation = (await api(null, `/api/interview-invites/${ana.candidateToken}`)).body;
  record("theLinkSaysWhatsRecorded", invitation.recordWebcam === true && invitation.recordScreen === true && invitation.recordingKeptDays > 0, JSON.stringify(invitation.recordingKeptDays));

  // Consent.
  await api(c2, `/api/interview-invites/${ana.candidateToken}/claim`, "POST");
  record("clipsCantArriveBeforeItStarts", (await send(c2, roomId)).status === 409);
  record("itWontStartWithoutConsent", (await api(c2, `/api/interview-invites/${ana.candidateToken}/start`, "POST")).status === 400);
  record("norIfTheySayNo", (await api(c2, `/api/interview-invites/${ana.candidateToken}/start`, "POST", { consent: false })).status === 400);
  record("itStillHasntStarted", (await api(c1, `/api/interviews/${ana.interviewId}`)).body.status === "scheduled");
  record("anInterviewerCantStartItForThem", (await api(c1, `/api/interviews/${ana.interviewId}/start`, "POST")).status === 409);
  const started = await api(c2, `/api/interview-invites/${ana.candidateToken}/start`, "POST", { consent: true });
  record("itStartsWhenTheyAgree", started.status === 200 && started.body.waiting === false, started.text.slice(0, 100));
  const afterConsent = (await api(c1, `/api/interviews/${ana.interviewId}`)).body;
  record("theirConsentIsKept", Boolean(afterConsent.recordingConsentAt));
  const candidateSees = await api(c2, `/api/rooms/${roomId}/interview`);
  record("thePageKnowsToRecord", candidateSees.body.recordWebcam === true && candidateSees.body.recordScreen === true);

  // What's accepted.
  const first = await send(c2, roomId);
  const firstBody = await first.json().catch(() => null);
  record("aClipIsKept", first.status === 201 && Boolean(firstBody?.id), first.status);
  record("theScreenToo", (await send(c2, roomId, { stream: "screen" })).status === 201);
  record("onlyTheCandidateSends", (await send(c1, roomId)).status === 403);
  record("notSignedOutEither", (await send(null, roomId)).status === 401);
  record("aPageIsntAVideo", (await send(c2, roomId, { body: Buffer.from("<html><script>alert(1)</script></html>"), type: "video/webm" })).status === 400);
  record("noMatterWhatItClaims", (await send(c2, roomId, { body: Buffer.from("<html></html>"), type: "text/html" })).status === 400);
  record("anUnknownStreamIsRefused", (await send(c2, roomId, { stream: "microphone" })).status === 400);
  record("aClipTooBigIsRefused", (await send(c2, roomId, { body: Buffer.concat([WEBM, Buffer.alloc(8 * 1024 * 1024)]) })).status === 413);
  const unrecordedLink = unrecorded.body.links[0];
  await api(c2, `/api/interview-invites/${unrecordedLink.candidateToken}/claim`, "POST");
  await api(c2, `/api/interview-invites/${unrecordedLink.candidateToken}/start`, "POST");
  const unrecordedRoom = (await api(c1, `/api/interviews/${unrecordedLink.interviewId}`)).body.roomId;
  record("aSittingThatDoesntRecordRefusesClips", (await send(c2, unrecordedRoom)).status === 409);
  const wrongTime = await send(c2, roomId, { startedAt: "1999-01-01T00:00:00.000Z" });
  record("aClipFromAnotherTimeIsKeptInsideTheSitting", wrongTime.status === 201);

  // Who can watch.
  const listed = await api(c1, `/api/interviews/${ana.interviewId}/recordings`);
  record("theInterviewerSeesTheClips", listed.status === 200 && listed.body.clips.length === 3 && listed.body.consentAt, listed.text.slice(0, 160));
  record("theyHaveNoStorageAddresses", !/rooms\//.test(listed.text));
  record("everyClipIsInsideTheSitting", listed.body.clips.every((clip) => new Date(clip.startedAt) >= new Date(afterConsent.startedAt)));
  record("theCandidateCantList", (await api(c2, `/api/interviews/${ana.interviewId}/recordings`)).status === 403);
  const clipId = listed.body.clips[0].id;
  const clipUrl = `/api/interviews/${ana.interviewId}/recordings/${clipId}`;
  const watched = await fetch(`${ORIGIN}${clipUrl}`, { headers: { cookie: c1 } });
  const watchedBytes = Buffer.from(await watched.arrayBuffer());
  record("theInterviewerCanWatch", watched.status === 200 && watchedBytes.equals(WEBM), watched.status);
  record("itCantRunAsAPageOrBeKept", watched.headers.get("content-type") === "video/webm" && watched.headers.get("x-content-type-options") === "nosniff" && /no-store/.test(watched.headers.get("cache-control") ?? "") && /sandbox/.test(watched.headers.get("content-security-policy") ?? ""));
  const range = await fetch(`${ORIGIN}${clipUrl}`, { headers: { cookie: c1, range: "bytes=0-3" } });
  record("aVideoPlayerCanAskForPartOfIt", range.status === 206 && (await range.arrayBuffer()).byteLength === 4);
  record("theCandidateCantWatchThemselves", (await api(c2, clipUrl)).status === 403);
  record("strangersCant", (await api(null, clipUrl)).status === 401);
  const otherSitting = await api(c1, `/api/interviews/${ben.interviewId}/recordings/${clipId}`);
  record("aClipOnlyComesFromItsOwnSitting", otherSitting.status === 404);
  const fileRoute = await api(c2, `/api/rooms/${roomId}/blobs/${"0".repeat(64)}`);
  record("theRoomsFileRouteDoesntReachThem", fileRoute.status === 404);

  // On the audit log.
  const audited = await database.db.select({ action: schema.auditEvents.action, actorId: schema.auditEvents.actorId }).from(schema.auditEvents).where(and(eq(schema.auditEvents.targetId, ana.interviewId), eq(schema.auditEvents.action, "interview.recording.view")));
  record("watchingIsAudited", audited.length >= 1);

  // The server notices when clips stop.
  const session = crypto.randomUUID();
  await beat(c2, roomId, session);
  record("clipsArrivingAreFine", !(await api(c1, `/api/interviews/${ana.interviewId}`)).body.integrity.counts["recording-missing"]);
  await database.db.update(schema.interviewRecordings).set({ createdAt: new Date(Date.now() - 300_000) }).where(eq(schema.interviewRecordings.interviewId, ana.interviewId));
  await beat(c2, roomId, session);
  const quiet = (await api(c1, `/api/interviews/${ana.interviewId}`)).body;
  record("clipsStoppingAreNoticed", quiet.integrity.counts["recording-missing"] === 1 && quiet.integrity.level === "look", JSON.stringify(quiet.integrity.counts));
  await beat(c2, roomId, session);
  record("andSaidOnlyOnce", (await api(c1, `/api/interviews/${ana.interviewId}`)).body.integrity.counts["recording-missing"] === 1);
  await database.db.update(schema.interviews).set({ startedAt: new Date(Date.now() - 600_000) }).where(eq(schema.interviews.id, unrecordedLink.interviewId));
  await beat(c2, unrecordedRoom, session);
  record("aSittingThatDoesntRecordIsntChargedWithIt", !(await api(c1, `/api/interviews/${unrecordedLink.interviewId}`)).body.integrity.counts["recording-missing"]);

  // After it ends, the last clip still lands; later ones don't.
  await api(c2, `/api/rooms/${roomId}/interview/submit`, "POST");
  record("theLastClipLandsJustAfter", (await send(c2, roomId)).status === 201);
  await database.db.update(schema.interviews).set({ finishedAt: new Date(Date.now() - 300_000) }).where(eq(schema.interviews.id, ana.interviewId));
  record("laterOnesDont", (await send(c2, roomId)).status === 409);

  // Deleting on request.
  record("theCandidateCantDeleteThem", (await api(c2, `/api/interviews/${ana.interviewId}/recordings`, "DELETE")).status === 403);
  const key = (await database.db.select({ key: schema.interviewRecordings.key }).from(schema.interviewRecordings).where(eq(schema.interviewRecordings.id, clipId)))[0].key;
  const removed = await api(c1, `/api/interviews/${ana.interviewId}/recordings`, "DELETE");
  record("anInterviewerCanDeleteThem", removed.status === 200 && removed.body.removed >= 4, removed.text);
  record("thenThereAreNone", (await api(c1, `/api/interviews/${ana.interviewId}/recordings`)).body.clips.length === 0);
  record("theClipIsGone", (await api(c1, clipUrl)).status === 404);
  record("theKeyWasUnderTheRoom", key.startsWith(`rooms/${roomId}/`), key);
  const deleted = await database.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(and(eq(schema.auditEvents.targetId, ana.interviewId), eq(schema.auditEvents.action, "interview.recording.delete")));
  record("deletingIsAudited", deleted.length === 1);
  record("aListWithNothingIsntAudited", (await database.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(and(eq(schema.auditEvents.targetId, ben.interviewId), eq(schema.auditEvents.action, "interview.recording.view")))).length === 0);

  // Deleted with the room.
  await api(c2, `/api/interview-invites/${ben.candidateToken}/claim`, "POST");
  await api(c2, `/api/interview-invites/${ben.candidateToken}/start`, "POST", { consent: true });
  const benRoom = (await api(c1, `/api/interviews/${ben.interviewId}`)).body.roomId;
  await send(c2, benRoom);
  await api(c1, `/api/interviews/${ben.interviewId}/finish`, "POST");
  record("deletingTheSittingWorks", (await api(c1, `/api/interviews/${ben.interviewId}`, "DELETE")).status === 204);
  record("itsRowsGoWithIt", (await database.db.select({ id: schema.interviewRecordings.id }).from(schema.interviewRecordings).where(eq(schema.interviewRecordings.interviewId, ben.interviewId))).length === 0);
} catch (error) {
  record("noUnexpectedError", false, error?.stack ?? String(error));
} finally {
  for (const id of batchIds) {
    const results = await api(c1, `/api/interview-batches/${id}`);
    for (const row of results.body?.rows ?? []) if (row.status === "live") await api(c1, `/api/interviews/${row.interviewId}/finish`, "POST");
    await api(c1, `/api/interview-batches/${id}`, "DELETE");
  }
  for (const id of bankIds) await api(c1, `/api/interview-questions/${id}`, "DELETE").catch(() => {});
  await database.close?.();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
