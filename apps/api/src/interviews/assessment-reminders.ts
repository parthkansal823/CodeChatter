/** Assessment reminder timing and atomic delivery claims, so API timers can share one mail attempt. */
import type { Redis } from "ioredis";

import type { InterviewRow } from "./views.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type ReminderAssessment = Pick<InterviewRow, "id" | "roomId" | "mode" | "status" | "opensAt" | "closesAt" | "createdAt" | "startedAt" | "finishedAt" | "candidateEmail" | "candidateName" | "question" | "durationMinutes">;
export type AssessmentReminderState = { status: "sending" | "sent" | "failed"; attemptedAt: string; sentAt: string | null };
export const assessmentReminderKey = (id: string) => `assessment-reminder:${id}`;
/** Retained until the interview is deleted, so any later deadline still refers to the same attempt. */
export const assessmentReminderReceiptKey = (id: string) => `assessment-reminder-receipt:${id}`;

/** All dates come from the server; a claimed invitation is still eligible until the candidate starts. */
export function isAssessmentReminderDue(row: ReminderAssessment, now: Date): boolean {
  if (row.mode !== "assessment" || row.status !== "scheduled" || row.startedAt || row.finishedAt || !row.candidateEmail?.trim() || !row.closesAt) return false;
  const opens = (row.opensAt ?? row.createdAt).getTime();
  const closes = row.closesAt.getTime();
  const time = now.getTime();
  if (![opens, closes, time].every(Number.isFinite) || closes <= opens || time < opens || closes - time <= 15 * MINUTE) return false;
  const due = closes - opens < 2 * DAY ? opens + (closes - opens) / 2 : closes - DAY;
  return time >= due;
}

/** The state contains only delivery facts, never an address or a candidate's invitation token. */
function parseState(value: string | null): AssessmentReminderState | null | undefined {
  if (value === null) return null;
  try {
    const state = JSON.parse(value) as AssessmentReminderState;
    if (!["sending", "sent", "failed"].includes(state.status) || !Number.isFinite(Date.parse(state.attemptedAt)) ||
      (state.sentAt !== null && !Number.isFinite(Date.parse(state.sentAt)))) return undefined;
    return { status: state.status, attemptedAt: state.attemptedAt, sentAt: state.sentAt };
  } catch {
    return undefined;
  }
}

type Dependencies = {
  reload: (id: string) => Promise<ReminderAssessment | null>;
  send: (row: ReminderAssessment, now: Date) => Promise<void>;
  failed: (id: string, step: "state" | "mail") => void;
};

/** No retry after an ambiguous SMTP result: sending twice is worse than a missed reminder. */
export class AssessmentReminders {
  /** Also suppress repeated ticks after Valkey loses its keys while this API stays alive. */
  private readonly observed = new Map<string, { expires: number; state?: AssessmentReminderState }>();

  constructor(private readonly redis: Pick<Redis, "get" | "set" | "eval" | "del">, private readonly dependencies: Dependencies) {}

  prune(now = new Date()): void {
    for (const [id, claim] of this.observed) if (claim.expires <= now.getTime()) this.observed.delete(id);
  }

  async state(id: string): Promise<AssessmentReminderState | null | undefined> {
    try {
      const state = parseState(await this.redis.get(assessmentReminderReceiptKey(id)));
      return state === null ? this.observed.get(id)?.state ?? null : state;
    } catch {
      return this.observed.get(id)?.state;
    }
  }

  async forget(id: string): Promise<void> {
    this.observed.delete(id);
    await this.redis.del(assessmentReminderKey(id), assessmentReminderReceiptKey(id));
  }

  private async release(id: string, initial: string): Promise<void> {
    await this.redis.eval("for _, key in ipairs(KEYS) do if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) end end return 1", 2, assessmentReminderKey(id), assessmentReminderReceiptKey(id), initial);
    this.observed.delete(id);
  }

  async sendDue(row: ReminderAssessment, now = new Date()): Promise<boolean> {
    if ((this.observed.get(row.id)?.expires ?? Infinity) <= now.getTime()) this.observed.delete(row.id);
    if (!isAssessmentReminderDue(row, now) || this.observed.has(row.id)) return false;
    const key = assessmentReminderKey(row.id);
    const receiptKey = assessmentReminderReceiptKey(row.id);
    const claim = { expires: row.closesAt!.getTime(), state: undefined as AssessmentReminderState | undefined };
    this.observed.set(row.id, claim);
    const sending: AssessmentReminderState = { status: "sending", attemptedAt: now.toISOString(), sentAt: null };
    const initial = JSON.stringify(sending);
    try {
      if (await this.redis.set(key, initial, "PXAT", claim.expires, "NX") !== "OK") {
        // The winner may release its claim without sending if the window or candidate changes.
        this.observed.delete(row.id);
        return false;
      }
      claim.state = sending;
    } catch {
      this.observed.delete(row.id);
      this.dependencies.failed(row.id, "state");
      return false;
    }

    // A candidate may have started, or the interviewer changed the window, while the claim was acquired.
    let current: ReminderAssessment | null;
    try {
      current = await this.dependencies.reload(row.id);
      if (!current || !isAssessmentReminderDue(current, new Date())) {
        await this.release(row.id, initial);
        return false;
      }
      // A receipt outlives the timer claim, including when the interviewer extends the window.
      if (await this.redis.set(receiptKey, initial, "NX") !== "OK") return false;
    } catch {
      this.dependencies.failed(row.id, "state");
      return false;
    }

    const sendNow = new Date();
    if (!isAssessmentReminderDue(current, sendNow)) {
      await this.release(row.id, initial).catch(() => this.dependencies.failed(row.id, "state"));
      return false;
    }
    let sent = false;
    try {
      await this.dependencies.send(current, sendNow);
      claim.state = { ...sending, status: "sent", sentAt: new Date().toISOString() };
      sent = true;
    } catch {
      claim.state = { ...sending, status: "failed" };
      this.dependencies.failed(row.id, "mail");
    }
    try {
      // Compare before updating: an old attempt must not overwrite a new claim after Valkey lost its data.
      await this.redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') end return 0", 1, receiptKey, initial, JSON.stringify(claim.state));
    } catch {
      this.dependencies.failed(row.id, "state");
    }
    return sent;
  }
}
