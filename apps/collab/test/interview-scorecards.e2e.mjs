/** Exercise independent blind scorecards through the real API and the legacy-data migration in disposable fixtures; never change seeded memberships. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { hashPassword } from "@codechatter/auth";
import { createDb, schema } from "@codechatter/db";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const requireDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
const postgres = requireDb("postgres");
const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const database = createDb(process.env.DATABASE_URL, { max: 3 });
const signedIn = [];
let passed = 0;
function check(name, ok) {
  assert.ok(ok, name);
  passed++;
  console.log(`PASS  ${name}`);
}

/** Run the actual Drizzle migrator, including a forced failure, in isolated schemas. */
async function migrationChecks() {
  const folder = await mkdtemp(join(tmpdir(), "codechatter-scorecard-migration-"));
  const migration = await readFile(new URL("../../../packages/db/drizzle/0016_curly_sasquatch.sql", import.meta.url), "utf8");
  const sample = { scores: [{ id: "clarity", score: 4, note: "Preserved note" }], overall: 4, recommendation: "yes", notes: "Preserved legacy judgement" };
  try {
    for (const fail of [false, true]) {
      const space = `scorecards_${randomBytes(8).toString("hex")}`;
      const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, connection: { search_path: `${space},public` } });
      try {
        await client.unsafe(`CREATE SCHEMA "${space}"`);
        await client.unsafe(`CREATE TABLE "${space}"."user" (id text PRIMARY KEY); CREATE TABLE "${space}".rooms (id text PRIMARY KEY, created_by text); CREATE TABLE "${space}".interviews (id uuid PRIMARY KEY DEFAULT uuidv7(), room_id text, interviewer_id text, scorecard jsonb, updated_at timestamptz NOT NULL DEFAULT now());`);
        await client`INSERT INTO "user" (id) VALUES ('creator'), ('assigned')`;
        await client`INSERT INTO rooms (id, created_by) VALUES ('creator-room','creator'), ('fallback-room',NULL), ('anonymous-room',NULL), ('empty-room','creator'), ('notes-room','creator')`;
        for (const [room, author, card] of [["creator-room", "assigned", sample], ["fallback-room", "assigned", sample], ["anonymous-room", null, sample], ["empty-room", "assigned", { scores: [{ id: "clarity", score: null, note: " " }], overall: null, recommendation: null, notes: " " }], ["notes-room", "assigned", { scores: [], overall: null, recommendation: null, notes: "Notes only" }]]) {
          await client`INSERT INTO interviews (room_id, interviewer_id, scorecard) VALUES (${room},${author},${client.json(card)})`;
        }
        await mkdir(join(folder, "meta"), { recursive: true });
        await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: Date.now(), tag: "migration", breakpoints: true }] }));
        await writeFile(join(folder, "migration.sql"), migration.replaceAll('"public".', `"${space}".`) + (fail ? "\n--> statement-breakpoint\nSELECT 1 / 0;" : ""));
        let failed = false;
        try { await migrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: space }); } catch { failed = true; }
        const [column] = await client`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=${space} AND table_name='interviews' AND column_name='scorecard'`;
        if (fail) {
          const [table] = await client`SELECT to_regclass(${`${space}.interview_scorecards`}) AS name`;
          check("a migration failure rolls back both the backfill and legacy-column drop", failed && column.n === 1 && table.name === null);
          continue;
        }
        check("the migration drops the shared column only after preserving meaningful cards", !failed && column.n === 0);
        const cards = await client`SELECT c.*, i.room_id FROM interview_scorecards c JOIN interviews i ON i.id=c.interview_id`;
        check("empty normalised cards are skipped; notes-only cards are kept", cards.length === 4 && !cards.some((c) => c.room_id === "empty-room") && cards.some((c) => c.notes === "Notes only"));
        check("legacy author is the creator, then assigned interviewer, then unattributed", cards.find((c) => c.room_id === "creator-room").interviewer_id === "creator" && cards.find((c) => c.room_id === "fallback-room").interviewer_id === "assigned" && cards.find((c) => c.room_id === "anonymous-room").interviewer_id === null);
        const card = cards.find((c) => c.room_id === "creator-room");
        check("legacy fields and submission time survive the migration", isDeepStrictEqual(card.scores, sample.scores) && card.overall === 4 && card.recommendation === "yes" && card.notes === sample.notes && new Date(card.submitted_at).getTime() === new Date(card.updated_at).getTime());
        await client`DELETE FROM "user" WHERE id='creator'`;
        check("deleting an author retains their historical card", (await client`SELECT interviewer_id FROM interview_scorecards WHERE id=${card.id}`)[0].interviewer_id === null);
        await client`DELETE FROM interviews WHERE id=${card.interview_id}`;
        check("deleting an interview cascades its cards", (await client`SELECT count(*)::int AS n FROM interview_scorecards WHERE interview_id=${card.interview_id}`)[0].n === 0);
      } finally {
        await client.unsafe(`DROP SCHEMA IF EXISTS "${space}" CASCADE`);
        await client.end({ timeout: 5 });
      }
    }
  } finally {
    if (!resolve(folder).startsWith(`${resolve(tmpdir())}${sep}codechatter-scorecard-migration-`)) throw new Error("Unexpected migration fixture path");
    await rm(folder, { recursive: true, force: true });
  }
}

function person() {
  const cookies = new Map();
  return async (path, method = "GET", json) => {
    const response = await fetch(`${ORIGIN}/api/${path}`, { method, signal: AbortSignal.timeout(45_000), headers: { origin: ORIGIN, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...(json !== undefined && { "content-type": "application/json" }) }, ...(json !== undefined && { body: JSON.stringify(json) }) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
}
async function signIn(email) {
  const call = person();
  const response = await call("auth/sign-in/email", "POST", { email, password: "codechatter123" });
  check(`fixture account signs in (HTTP ${response.status})`, response.status === 200);
  signedIn.push(call);
  return call;
}

const tag = `scorecards-${randomUUID()}`;
const orgId = tag;
const extraIds = [randomUUID(), randomUUID()];
const roomId = `SC${randomBytes(2).toString("hex").toUpperCase()}`;
let interviewId, batchId;
async function apiChecks() {
  const users = await database.db.select().from(schema.user).where(inArray(schema.user.email, ["test1@codechatter.local", "test2@codechatter.local"]));
  const firstId = users.find((u) => u.email === "test1@codechatter.local")?.id;
  const secondId = users.find((u) => u.email === "test2@codechatter.local")?.id;
  assert.ok(firstId && secondId, "seed accounts exist");
  const [adminId, candidateId] = extraIds;
  const password = await hashPassword("codechatter123");
  try {
    await database.db.transaction(async (tx) => {
      await tx.insert(schema.user).values(extraIds.map((id, i) => ({ id, name: i ? "Scorecard Candidate" : "Scorecard Admin", email: `${tag}-${i}@codechatter.local`, emailVerified: true })));
      await tx.insert(schema.account).values(extraIds.map((id) => ({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password })));
      await tx.insert(schema.organization).values({ id: orgId, name: tag, slug: tag, createdAt: new Date() });
      await tx.insert(schema.member).values([[firstId, "owner"], [secondId, "member"], [adminId, "admin"], [candidateId, "admin"]].map(([userId, role]) => ({ id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() })));
      await tx.insert(schema.rooms).values({ id: roomId, orgId, kind: "interview", name: tag, createdBy: firstId, templateId: "blank" });
      await tx.insert(schema.roomMembers).values([{ roomId, userId: firstId, role: "owner" }, { roomId, userId: secondId, role: "interviewer" }, { roomId, userId: candidateId, role: "candidate" }]);
      const [batch] = await tx.insert(schema.interviewBatches).values({ orgId, createdBy: firstId, mode: "interview", title: tag, durationMinutes: 30, paper: { fixed: [], random: [] } }).returning();
      batchId = batch.id;
      const [row] = await tx.insert(schema.interviews).values({ orgId, roomId, batchId, interviewerId: firstId, candidateUserId: candidateId, candidateName: "Scorecard Candidate", candidateTokenHash: tag, status: "finished", finishedAt: new Date(), durationMinutes: 30, question: { title: tag, prompt: "A disposable interview", file: "main.py", starterFiles: [], tests: [], timeLimitMs: 2000, rubric: [{ id: "clarity", label: "Clarity" }] } }).returning();
      interviewId = row.id;
    });
    const [one, two, admin, candidate] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local"), signIn(`${tag}-0@codechatter.local`), signIn(`${tag}-1@codechatter.local`)]);
    const path = `interviews/${interviewId}`;
    const draft = (notes, score = 4) => ({ scores: [{ id: "clarity", score, note: `criterion ${notes}` }], overall: score, recommendation: score === 4 ? "yes" : "maybe", notes });
    const a = draft("FIRST PRIVATE JUDGEMENT");
    const b = draft("SECOND PRIVATE JUDGEMENT", 2);
    const saved = await Promise.all([one(`${path}/scorecard`, "PUT", { ...a, interviewerId: secondId }), two(`${path}/scorecard`, "PUT", b)]);
    check("simultaneous drafts each save under the authenticated author", saved.every((r) => r.status === 200));
    const rows = await database.db.select().from(schema.interviewScorecards).where(eq(schema.interviewScorecards.interviewId, interviewId));
    check("both drafts survive; a supplied author cannot overwrite another", rows.length === 2 && rows.find((r) => r.interviewerId === firstId).notes === a.notes && rows.find((r) => r.interviewerId === secondId).notes === b.notes);
    for (const [caller, own, other] of [[one, a, b], [two, b, a]]) {
      const view = (await caller(path)).body;
      check("a draft author sees only their own judgement", view.scorecards.own.notes === own.notes && view.scorecards.locked && view.scorecards.summary === null && view.scorecards.submitted.length === 0 && !JSON.stringify(view).includes(other.notes));
    }
    const lockedBatch = await one(`interview-batches/${batchId}`);
    check("batch ownership cannot bypass blind review", lockedBatch.body.rows[0].scorecards.summary === null && lockedBatch.body.rows[0].scorecards.submitted.length === 0 && !JSON.stringify(lockedBatch).includes(b.notes));
    const rejected = await one(`${path}/scorecard`, "PUT", { ...a, scores: [{ id: "unknown", score: 4, note: "" }] });
    check("an unknown criterion and duplicate criteria are rejected", rejected.status === 400 && (await one(`${path}/scorecard`, "PUT", { ...a, scores: [a.scores[0], a.scores[0]] })).status === 400);
    const first = await one(`${path}/scorecard`, "PUT", { ...a, submit: true });
    check("submitting a personal card succeeds", first.status === 200);
    check("the first submit unlocks only submitted cards and names pending interviewers", first.body.scorecards.submitted.length === 1 && first.body.scorecards.summary.pending.some((p) => p.id === secondId));
    const blind = (await two(path)).body.scorecards;
    check("an unsubmitted interviewer gets only the other submission count", blind.otherSubmittedCount === 1 && blind.submitted.length === 0 && blind.summary === null && blind.locked);
    const blindBatch = (await one(`interview-batches/${batchId}`)).body;
    check("batch results use the submitting viewer's policy", blindBatch.rows[0].scorecards.summary.submitted === 1 && !JSON.stringify(blindBatch).includes(b.notes));
    await two(`${path}/scorecard`, "PUT", { ...b, submit: true });
    for (const caller of [one, two, admin]) {
      const response = await caller(path);
      const view = response.body.scorecards;
      check("submitted interviewers and a nonparticipant admin see both reviews and averages", response.status === 200 && view.submitted.length === 2 && view.summary.criteria[0].average === 3 && view.summary.recommendations.yes === 1 && view.summary.recommendations.maybe === 1 && view.summary.pending.length === 0);
    }
    check("a nonparticipant organisation admin cannot write a card", (await admin(`${path}/scorecard`, "PUT", { ...a, submit: true })).status === 403 && (await admin(path)).body.scorecards.own === null);
    check("a nonparticipant admin sees both submitted cards in batch results", (await admin(`interview-batches/${batchId}`)).body.rows[0].scorecards.submitted.length === 2);
    const candidateView = await candidate(`rooms/${roomId}/interview`);
    check("a candidate who is also an org admin gets no scorecard fields", candidateView.status === 200 && candidateView.body.role === "candidate" && !Object.keys(candidateView.body).some((k) => /scorecard|rubric|recommendation|summary/.test(k)) && !JSON.stringify(candidateView).includes(a.notes));
    check("a candidate cannot use interviewer read or write endpoints", (await candidate(path)).status === 403 && (await candidate(`${path}/scorecard`, "PUT", { ...a, submit: true })).status === 403);
    check("even a candidate/admin cannot read batch scorecards", (await candidate(`interview-batches/${batchId}`)).status === 403);
    const old = (await one(path)).body.scorecards.own.submittedAt;
    const again = await one(`${path}/scorecard`, "PUT", { ...a, notes: "REVISED FIRST JUDGEMENT", submit: true });
    check("resubmitting updates only the caller and moves the submission timestamp", again.body.scorecards.own.submittedAt > old && again.body.scorecards.submitted.find((c) => c.interviewer.id === secondId).notes === b.notes);
    const withdrawn = (await one(`${path}/scorecard`, "PUT", a)).body.scorecards;
    check("saving as draft withdraws the submission and restores blindness", withdrawn.locked && withdrawn.summary === null && withdrawn.submitted.length === 0 && withdrawn.own.submittedAt === null && (await admin(path)).body.scorecards.submitted.length === 1);
    await one(`${path}/scorecard`, "PUT", { ...a, submit: true });
    await database.db.update(schema.roomMembers).set({ status: "removed" }).where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, secondId)));
    check("removed interviewers keep their historical submission but lose access", (await two(path)).status === 403 && (await admin(path)).body.scorecards.submitted.some((c) => c.interviewer.id === secondId));
    await database.db.delete(schema.rooms).where(eq(schema.rooms.id, roomId));
    check("room deletion removes the interview and every scorecard", (await database.db.select().from(schema.interviewScorecards).where(eq(schema.interviewScorecards.interviewId, interviewId))).length === 0);
  } finally {
    await Promise.all(signedIn.map((caller) => caller("auth/sign-out", "POST", {}).catch(() => {})));
    await database.db.delete(schema.rooms).where(eq(schema.rooms.id, roomId));
    await database.db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    await database.db.delete(schema.user).where(inArray(schema.user.id, extraIds));
    check("all disposable users and organisation are cleaned up", !(await database.db.select().from(schema.organization).where(eq(schema.organization.id, orgId))).length && !(await database.db.select().from(schema.user).where(inArray(schema.user.id, extraIds))).length);
  }
}

try {
  await migrationChecks();
  if (!process.argv.includes("--migration-only")) await apiChecks();
  console.log(`\n${passed}/${passed} passed`);
} catch (error) {
  // SQL errors may embed connection details; print only our assertion or a safe class name.
  console.error(`FAIL  ${error instanceof assert.AssertionError ? error.message : error.name}`);
  process.exitCode = 1;
} finally { await database.close(); }
