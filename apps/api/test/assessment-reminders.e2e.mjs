/**
 * Check assessment reminders through two isolated APIs and Mailpit, including concurrent
 * sweeps and an API restart. IPC exposes the real sweep to this test without a test route.
 * Run from apps/api: node --env-file=../../.env test/assessment-reminders.e2e.mjs
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createDb, schema } from "@codechatter/db";
import { eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";

// Import the ordinary entry point, capturing its Nest application so only the parent
// process can ask for simultaneous sweeps. All HTTP/auth configuration stays real.
if (process.argv.includes("--api-worker")) {
  let startupStage = "metadata";
  try {
    await import("reflect-metadata");
    startupStage = "factory";
    const { NestFactory } = await import("@nestjs/core");
    startupStage = "service";
    const { InterviewsService } = await import("../dist/interviews/interviews.service.js");
    const create = NestFactory.create.bind(NestFactory);
    let app;
    NestFactory.create = async (...args) => (app = await create(...args));
    startupStage = "entrypoint";
    await import("../dist/main.js");
    NestFactory.create = create;
    const interviews = app.get(InterviewsService);
    process.on("message", async (message) => {
      if (message?.action !== "sweep") return;
      try {
        await Promise.all([interviews.sweep(), interviews.sweep()]);
        process.send?.({ id: message.id, ok: true });
      } catch (error) {
        const name = /^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "Error";
        const cause = /^[A-Za-z]+$/.test(error?.cause?.name ?? "") ? error.cause.name : "Unknown";
        const code = /^[A-Z0-9_]+$/.test(error?.cause?.code ?? error?.code ?? "") ? (error.cause?.code ?? error.code) : "UNKNOWN";
        process.send?.({ id: message.id, ok: false, name, cause, code });
      }
    });
    process.send?.({ ready: true });
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "UNKNOWN";
    process.send?.({ startupFailed: true, stage: startupStage, code });
    process.exit(1);
  }
} else {
  await run();
}

async function run() {
  const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
  const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
  const ports = [4023, 4024];
  const API = `http://127.0.0.1:${ports[0]}`;
  const tag = `reminders-${randomUUID()}`;
  const title = `Assessment ${tag}`;
  const results = [];
  const children = new Set();
  const interviewIds = [];
  const roomIds = [];
  const batchIds = [];
  let questionId;
  let stage = "configuration";
  let database;
  let redis;
  let first;
  let second;

  function check(name, condition) {
    results.push(Boolean(condition));
    console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
    if (!condition) throw new Error("CheckFailed");
  }

  async function start(port) {
    const child = spawn(process.execPath, ["--env-file-if-exists=../../.env", fileURLToPath(import.meta.url), "--api-worker"], {
      env: {
        ...process.env,
        API_PORT: String(port),
        LOG_LEVEL: "silent",
        ASSESSMENT_REMINDER_SWEEP_MS: "500",
        SMTP_HOST: "localhost",
        SMTP_PORT: "1025",
        SMTP_USER: "",
        SMTP_PASS: "",
      },
      // Child logs can contain request paths; never forward candidate tokens.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    children.add(child);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("ApiStartupTimeout")), 30_000);
      const onExit = () => finish(new Error("ApiStartupFailed"));
      const onMessage = (message) => {
        if (message?.ready) finish();
        else if (message?.startupFailed) finish(new Error("ApiStartupFailed"));
      };
      function finish(error) {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onExit);
        child.off("message", onMessage);
        if (error) reject(error);
        else resolve();
      }
      child.once("exit", onExit);
      child.once("error", onExit);
      child.on("message", onMessage);
    });
    return child;
  }

  async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("exit", () => {
        clearTimeout(timer);
        children.delete(child);
        resolve();
      });
      child.kill();
    });
  }

  async function sweep(child) {
    const id = randomUUID();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("SweepTimeout")), 20_000);
      const onExit = () => finish(new Error("ApiStopped"));
      const onMessage = (message) => {
        if (message?.id !== id) return;
        if (!message.ok) console.error(`FAIL  sweep rejected (${message.name}/${message.cause}/${message.code})`);
        finish(message.ok ? undefined : new Error("SweepFailed"));
      };
      function finish(error) {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve();
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.send({ id, action: "sweep" }, (error) => { if (error) finish(new Error("IpcFailed")); });
    });
  }

  function person() {
    const cookies = new Map();
    return async (path, method = "GET", body) => {
      const response = await fetch(API + path, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          origin: ORIGIN,
          ...(cookies.size && { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }),
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0];
        const split = pair.indexOf("=");
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, json };
    };
  }
  const owner = person();
  const candidate = person();
  const publicCall = person();
  const reminderKeys = (id) => [`assessment-reminder:${id}`, `assessment-reminder-receipt:${id}`];

  async function mails() {
    const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:${tag}`)}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("MailpitUnavailable");
    return (await response.json()).messages ?? [];
  }

  async function until(probe, milliseconds = 15_000) {
    const deadline = Date.now() + milliseconds;
    do {
      if (await probe()) return true;
      await sleep(200);
    } while (Date.now() < deadline);
    return false;
  }

  try {
    if (!process.env.DATABASE_URL || !process.env.VALKEY_URL) throw new Error("MissingConfiguration");
    database = createDb(process.env.DATABASE_URL, { max: 2 });
    redis = new Redis(process.env.VALKEY_URL, { maxRetriesPerRequest: 2 });
    redis.on("error", () => {});
    stage = "isolated API startup";
    [first, second] = await Promise.all(ports.map(start));
    stage = "sign in";
    check("owner and candidate sign in", (await owner("/api/auth/sign-in/email", "POST", { email: "test1@codechatter.local", password: "codechatter123" })).status === 200
      && (await candidate("/api/auth/sign-in/email", "POST", { email: "test2@codechatter.local", password: "codechatter123" })).status === 200);

    stage = "assessment fixtures";
    const question = await owner("/api/interview-questions", "POST", { kind: "short", title: `Question ${tag}`, prompt: "Explain a queue.", marks: 1 });
    questionId = question.json?.id;
    check("a disposable question is created", question.status === 201 && Boolean(questionId));
    const candidates = [
      { name: "Due", email: `due-${tag}@codechatter.local` },
      { name: "Started", email: `started-${tag}@codechatter.local` },
      { name: "No email" },
      { name: "Claimed", email: `claimed-${tag}@codechatter.local` },
    ];
    const created = await owner("/api/interview-batches", "POST", {
      mode: "assessment", title, durationMinutes: 30, paper: { fixed: [questionId], random: [] }, candidates,
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      closesAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      sendEmail: false,
    });
    if (created.json?.id) batchIds.push(created.json.id);
    const links = created.json?.links ?? [];
    for (const link of links) interviewIds.push(link.interviewId);
    // Save cleanup IDs before checking a partially successful scheduling response.
    if (interviewIds.length) {
      const rows = await database.db.select({ roomId: schema.interviews.roomId }).from(schema.interviews).where(inArray(schema.interviews.id, interviewIds));
      roomIds.push(...rows.map((row) => row.roomId));
    }
    check("four assessments are created without invitation mail", created.status === 201 && links.length === 4 && links.every((link) => !link.emailed));
    const [due, started, withoutEmail, claimed] = links;
    const defaultOpening = await owner("/api/interview-batches", "POST", {
      mode: "assessment", title: `${title} default opening`, durationMinutes: 30,
      paper: { fixed: [questionId], random: [] },
      candidates: [{ name: "Default opening", email: `default-${tag}@codechatter.local` }],
      closesAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), sendEmail: false,
    });
    if (defaultOpening.json?.id) batchIds.push(defaultOpening.json.id);
    const defaultOpened = defaultOpening.json?.links?.[0];
    if (defaultOpened) {
      interviewIds.push(defaultOpened.interviewId);
      const [row] = await database.db.select({ roomId: schema.interviews.roomId }).from(schema.interviews).where(eq(schema.interviews.id, defaultOpened.interviewId));
      if (row) roomIds.push(row.roomId);
    }
    check("an assessment can be created without an opening time", defaultOpening.status === 201 && Boolean(defaultOpened));
    check("one candidate starts before reminders are due", (await candidate(`/api/interview-invites/${started.candidateToken}/claim`, "POST")).status === 200
      && (await candidate(`/api/interview-invites/${started.candidateToken}/start`, "POST")).status === 200);
    check("another candidate claims the invitation on a device", (await candidate(`/api/interview-invites/${claimed.candidateToken}/claim`, "POST")).status === 200);
    stage = "pre-due sweeps";
    await Promise.all([sweep(first), sweep(second)]);
    stage = "pre-due Mailpit check";
    check("nothing is sent before the halfway point", (await mails()).length === 0);

    stage = "simultaneous sweeps";
    const closesAt = new Date(Date.now() + 3_600_000);
    // Move the four-hour window past halfway immediately before racing both APIs.
    // The shared development API can also sweep; use Mailpit for dev mail as well.
    await database.db.update(schema.interviews).set({ opensAt: new Date(Date.now() - 3 * 3_600_000), closesAt }).where(inArray(schema.interviews.id, links.map((link) => link.interviewId)));
    await database.db.update(schema.interviews).set({ opensAt: null, createdAt: new Date(Date.now() - 3 * 3_600_000), closesAt }).where(eq(schema.interviews.id, defaultOpened.interviewId));
    await Promise.all([sweep(first), sweep(second)]);
    check("exactly the three eligible candidates get a reminder", await until(async () => (await mails()).length === 3));
    let messages = await mails();
    const forCandidate = (email) => messages.filter((message) => message.To?.some((recipient) => recipient.Address === email));
    check("an unclaimed candidate gets exactly one reminder", forCandidate(due.candidateEmail).length === 1);
    check("a claimed but unstarted candidate gets exactly one reminder", forCandidate(claimed.candidateEmail).length === 1);
    check("an omitted opening time uses when the assessment was created", forCandidate(defaultOpened.candidateEmail).length === 1);
    check("a started candidate gets none", forCandidate(started.candidateEmail).length === 0);
    check("the assessment without an email has no reminder state", (await owner(`/api/interviews/${withoutEmail.interviewId}`)).json?.assessmentReminder === null);

    const message = await fetch(`${MAILPIT}/api/v1/message/${encodeURIComponent(forCandidate(due.candidateEmail)[0].ID)}`).then((response) => response.json());
    const body = `${message.Text ?? ""}\n${message.HTML ?? ""}`;
    check("the email has its title, relative and UTC deadline, and duration", body.includes(title) && /closes in \d+ (?:hours?|minutes?)/i.test(body) && /UTC/.test(body) && /30 minutes/.test(body));
    check("the reminder points to the original invitation without exposing a token", /original invitation/i.test(body) && !/\/interview\//.test(body) && !links.some((link) => body.includes(link.candidateToken)));
    await until(async () => (await owner(`/api/interviews/${due.interviewId}`)).json?.assessmentReminder?.status === "sent");
    const receipt = (await owner(`/api/interviews/${due.interviewId}`)).json?.assessmentReminder;
    check("the interviewer sees when delivery succeeded", receipt?.status === "sent" && Number.isFinite(Date.parse(receipt.sentAt)) && Number.isFinite(Date.parse(receipt.attemptedAt)));
    check("the original invitation still works", (await publicCall(`/api/interview-invites/${due.candidateToken}`)).status === 200);
    check("the candidate's already-claimed device can still start", (await candidate(`/api/interview-invites/${claimed.candidateToken}/start`, "POST")).status === 200);
    await Promise.all([sweep(first), sweep(second)]);
    await sleep(1_200);
    check("repeated and overlapping timers send no duplicates", (await mails()).length === 3);

    stage = "API restart and changed closing time";
    await Promise.all([stop(first), stop(second)]);
    [first, second] = await Promise.all(ports.map(start));
    await database.db.update(schema.interviews).set({ closesAt: new Date(closesAt.getTime() + 3_600_000) }).where(eq(schema.interviews.id, due.interviewId));
    await Promise.all([sweep(first), sweep(second)]);
    await sleep(1_200);
    check("API restarts and a later deadline do not send again", (await mails()).length === 3);
    check("the receipt survives API restarts", (await owner(`/api/interviews/${due.interviewId}`)).json?.assessmentReminder?.sentAt === receipt.sentAt);

    stage = "Valkey forgetting on running instances";
    await redis.del(...reminderKeys(due.interviewId));
    await Promise.all([sweep(first), sweep(second)]);
    await Promise.all([sweep(first), sweep(second)]);
    await sleep(1_200);
    messages = await mails();
    check("running instances do not flood after Valkey forgets", messages.length <= 4 && forCandidate(due.candidateEmail).length <= 2);
  } catch {
    results.push(false);
    // Error messages, response bodies and child logs may hold candidate credentials.
    console.error(`FAIL  assessment reminder workflow (${stage})`);
  } finally {
    stage = "cleanup";
    try {
      if (database && interviewIds.length) {
        await database.db.update(schema.interviews).set({ status: "cancelled" }).where(inArray(schema.interviews.id, interviewIds));
        for (const id of interviewIds) await owner(`/api/interviews/${id}`, "DELETE").catch(() => {});
      }
      await Promise.all([owner("/api/auth/sign-out", "POST", {}).catch(() => {}), candidate("/api/auth/sign-out", "POST", {}).catch(() => {})]);
      await Promise.all([...children].map(stop));
      if (database) {
        if (roomIds.length) await database.db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds));
        if (batchIds.length) await database.db.delete(schema.interviewBatches).where(inArray(schema.interviewBatches.id, batchIds));
        if (questionId) await database.db.delete(schema.interviewQuestions).where(eq(schema.interviewQuestions.id, questionId));
      }
      if (redis && interviewIds.length) await redis.del(...interviewIds.flatMap(reminderKeys));
      const ids = (await mails()).map((message) => message.ID);
      if (ids.length) {
        const response = await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("MailCleanupFailed");
      }
      const remaining = database && interviewIds.length
        ? await database.db.select({ id: schema.interviews.id }).from(schema.interviews).where(inArray(schema.interviews.id, interviewIds))
        : [];
      const remainingKeys = redis && interviewIds.length ? await redis.exists(...interviewIds.flatMap(reminderKeys)) : 0;
      check("disposable assessments, mail and reminder keys are removed", remaining.length === 0 && remainingKeys === 0 && (await mails()).length === 0);
    } catch {
      console.error("FAIL  exact fixture cleanup");
      results.push(false);
    }
    // Always stop the private APIs, even when fixture cleanup fails.
    await Promise.all([...children].map(stop));
    await Promise.allSettled([database?.close(), redis?.quit().catch(() => redis.disconnect())]);
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
