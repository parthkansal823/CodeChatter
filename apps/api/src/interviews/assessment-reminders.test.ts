/** Check reminder deadlines and delivery claims, especially overlapping timers and uncertain mail results. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssessmentReminders, assessmentReminderKey, assessmentReminderReceiptKey, isAssessmentReminderDue, type ReminderAssessment } from "./assessment-reminders.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-18T12:00:00Z");
const at = (offset: number) => new Date(NOW.getTime() + offset);
const assessment = (changes: Partial<ReminderAssessment> = {}): ReminderAssessment => ({
  id: "assessment-1", roomId: "ROOM22", mode: "assessment", status: "scheduled",
  opensAt: at(-3 * DAY), closesAt: at(23 * HOUR), startedAt: null, finishedAt: null,
  createdAt: at(-3 * DAY),
  candidateEmail: "candidate@example.invalid", candidateName: "Candidate", durationMinutes: 45,
  question: { title: "A paper", prompt: "", file: "", starterFiles: [], tests: [], rubric: [], timeLimitMs: 2000 },
  ...changes,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("isAssessmentReminderDue", () => {
  it("becomes due exactly 24 hours before a long assessment closes", () => {
    const row = assessment({ closesAt: at(DAY) });
    expect(isAssessmentReminderDue(row, at(-1))).toBe(false);
    expect(isAssessmentReminderDue(row, NOW)).toBe(true);
    expect(isAssessmentReminderDue(row, at(HOUR))).toBe(true);
  });

  it("waits until halfway through a window shorter than two days", () => {
    const row = assessment({ opensAt: at(-6 * HOUR), closesAt: at(6 * HOUR) });
    expect(isAssessmentReminderDue(row, at(-1))).toBe(false);
    expect(isAssessmentReminderDue(row, NOW)).toBe(true);
    expect(isAssessmentReminderDue(assessment({ opensAt: at(-DAY), closesAt: at(DAY) }), NOW)).toBe(true);
    expect(isAssessmentReminderDue(assessment({ opensAt: at(-22 * HOUR), closesAt: at(23 * HOUR) }), NOW)).toBe(false);
  });

  it("never sends in the last 15 minutes, including the boundary and a late sweep", () => {
    expect(isAssessmentReminderDue(assessment({ closesAt: at(15 * MINUTE + 1) }), NOW)).toBe(true);
    for (const remaining of [15 * MINUTE, MINUTE, 0, -MINUTE]) {
      expect(isAssessmentReminderDue(assessment({ closesAt: at(remaining) }), NOW)).toBe(false);
    }
    const tooShort = assessment({ opensAt: at(-15 * MINUTE), closesAt: at(15 * MINUTE) });
    expect(isAssessmentReminderDue(tooShort, NOW)).toBe(false);
  });

  it("treats an omitted opening date as open from creation", () => {
    expect(isAssessmentReminderDue(assessment({ opensAt: null }), NOW)).toBe(true);
    expect(isAssessmentReminderDue(assessment({ opensAt: null, createdAt: at(-HOUR), closesAt: at(2 * HOUR) }), NOW)).toBe(false);
  });

  it.each([
    { mode: "interview" as const }, { status: "live" as const }, { status: "finished" as const },
    { status: "cancelled" as const }, { status: "missed" as const }, { startedAt: at(-MINUTE) },
    { finishedAt: at(-MINUTE) }, { candidateEmail: null }, { candidateEmail: "  " },
    { opensAt: at(HOUR) }, { closesAt: null },
    { opensAt: at(2 * DAY) }, { closesAt: new Date("invalid") },
  ])("excludes an ineligible assessment: %j", (changes) => {
    expect(isAssessmentReminderDue(assessment(changes), NOW)).toBe(false);
  });
});

/** An atomic in-memory Valkey stand-in shared by independent API service instances. */
function setup() {
  const values = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._options: unknown[]) => {
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) if (values.delete(key)) deleted++;
      return deleted;
    }),
    eval: vi.fn(async (script: string, n: number, ...args: string[]) => {
      const keys = args.slice(0, n);
      const expected = args[n];
      for (const key of keys) {
        if (values.get(key) !== expected) continue;
        if (script.includes("'DEL'")) values.delete(key);
        else values.set(key, args[n + 1]!);
      }
      return 1;
    }),
  };
  const reload = vi.fn(async (): Promise<ReminderAssessment | null> => assessment());
  const send = vi.fn(async () => {});
  const failed = vi.fn();
  const instance = () => new AssessmentReminders(redis as never, { reload, send, failed });
  return { redis, values, reload, send, failed, instance };
}

describe("AssessmentReminders", () => {
  it("sends once across simultaneous sweeps, instances and API restarts", async () => {
    const { instance, send, redis } = setup();
    const one = instance();
    const two = instance();
    await Promise.all([one.sendDue(assessment()), one.sendDue(assessment()), two.sendDue(assessment())]);
    await instance().sendDue(assessment());
    expect(send).toHaveBeenCalledTimes(1);
    expect(await one.state("assessment-1")).toEqual({ status: "sent", attemptedAt: NOW.toISOString(), sentAt: NOW.toISOString() });
    expect(redis.set).toHaveBeenCalledWith(assessmentReminderKey("assessment-1"), expect.any(String), "PXAT", at(23 * HOUR).getTime(), "NX");
  });

  it("allows at most one extra after Valkey forgets, even across fresh APIs", async () => {
    const { instance, values, send } = setup();
    const one = instance();
    const two = instance();
    await Promise.all([one.sendDue(assessment()), two.sendDue(assessment())]);
    values.clear();
    await Promise.all([one.sendDue(assessment()), two.sendDue(assessment())]);
    expect(send).toHaveBeenCalledTimes(2);
    const fresh = instance();
    await Promise.all([fresh.sendDue(assessment()), instance().sendDue(assessment())]);
    await fresh.sendDue(assessment());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("lets a losing API try again when the winner released a changed window without sending", async () => {
    const { instance, reload, send } = setup();
    const winner = instance();
    const loser = instance();
    reload.mockResolvedValueOnce(assessment({ closesAt: at(3 * DAY) }));
    await Promise.all([winner.sendDue(assessment()), loser.sendDue(assessment())]);
    expect(send).not.toHaveBeenCalled();
    await loser.sendDue(assessment());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains the claim when SMTP fails, including after a restart", async () => {
    const { instance, send, failed } = setup();
    send.mockRejectedValue(new Error("SMTP result uncertain"));
    const one = instance();
    expect(await one.sendDue(assessment())).toBe(false);
    await instance().sendDue(assessment());
    expect(send).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("assessment-1", "mail");
    expect(await one.state("assessment-1")).toMatchObject({ status: "failed", sentAt: null });
  });

  it("sends no mail when Valkey cannot establish a claim", async () => {
    const { instance, redis, send, failed } = setup();
    redis.set.mockRejectedValue(new Error("Valkey unavailable"));
    await instance().sendDue(assessment());
    expect(send).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith("assessment-1", "state");
  });

  it("rechecks a candidate starting or a window changing while the claim is acquired", async () => {
    const { instance, reload, values, send } = setup();
    reload.mockResolvedValueOnce(assessment({ status: "live", startedAt: NOW }));
    await instance().sendDue(assessment());
    expect(send).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
    reload.mockResolvedValueOnce(assessment({ closesAt: at(3 * DAY) }));
    await instance().sendDue(assessment());
    expect(send).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it("keeps an uncertain claim if the database reread fails", async () => {
    const { instance, reload, values, send } = setup();
    reload.mockRejectedValue(new Error("Database unavailable"));
    await instance().sendDue(assessment());
    expect(send).not.toHaveBeenCalled();
    expect(values.size).toBe(1);
  });

  it("rechecks the 15-minute cutoff after waiting for the receipt reservation", async () => {
    const { instance, redis, values, send } = setup();
    const reserve = redis.set.getMockImplementation()!;
    redis.set.mockImplementation(async (...args) => {
      const result = await reserve(...args);
      if (args[0] === assessmentReminderReceiptKey("assessment-1")) vi.setSystemTime(at(23 * HOUR - 15 * MINUTE));
      return result;
    });
    await instance().sendDue(assessment());
    expect(send).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it("does not resend after a deadline extension, even once the original claim expired", async () => {
    const { instance, send, reload, values } = setup();
    await instance().sendDue(assessment());
    values.delete(assessmentReminderKey("assessment-1"));
    vi.setSystemTime(at(40 * DAY));
    const changed = assessment({ closesAt: at(40 * DAY + 23 * HOUR) });
    reload.mockResolvedValue(changed);
    await instance().sendDue(changed);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("removes both the expiring claim and lasting receipt when the interview is deleted", async () => {
    const { instance, values } = setup();
    const one = instance();
    await one.sendDue(assessment());
    expect(values.size).toBe(2);
    await one.forget("assessment-1");
    expect(values.size).toBe(0);
    expect(await one.state("assessment-1")).toBeNull();
  });

  it("keeps an accepted send suppressed if saving its receipt fails", async () => {
    const { instance, send, redis } = setup();
    redis.eval.mockRejectedValue(new Error("Valkey unavailable after SMTP"));
    await instance().sendDue(assessment());
    await instance().sendDue(assessment());
    expect(send).toHaveBeenCalledTimes(1);
    expect(await instance().state("assessment-1")).toMatchObject({ status: "sending" });
  });

  it("distinguishes no receipt from unavailable or malformed state", async () => {
    const { instance, redis, values } = setup();
    expect(await instance().state("assessment-1")).toBeNull();
    values.set(assessmentReminderReceiptKey("assessment-1"), "bad JSON");
    expect(await instance().state("assessment-1")).toBeUndefined();
    redis.get.mockRejectedValue(new Error("Valkey unavailable"));
    expect(await instance().state("assessment-1")).toBeUndefined();
  });
});
