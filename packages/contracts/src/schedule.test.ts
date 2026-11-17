import { describe, expect, it } from "vitest";

import { dueRun, nextRun, nextRuns, parseCron, scheduleOf, scheduleProblem } from "./schedule.js";

const at = (iso: string) => Date.parse(iso);
const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

describe("reading cron", () => {
  it("takes lists, ranges, steps and names", () => {
    const rule = parseCron("*/15 9-17 1,15 JAN-mar MON-FRI");
    expect([...rule.minutes]).toEqual([0, 15, 30, 45]);
    expect([...rule.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...rule.days]).toEqual([1, 15]);
    expect([...rule.months]).toEqual([1, 2, 3]);
    expect([...rule.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0/20 * * * *").minutes]).toEqual([0, 20, 40]);
    expect([...parseCron("5-20/5 * * * *").minutes]).toEqual([5, 10, 15, 20]);
  });

  it("counts 7 as Sunday, and knows the shorthands", () => {
    expect([...parseCron("0 0 * * 5-7").weekdays].sort()).toEqual([0, 5, 6]);
    expect(parseCron("@daily")).toEqual(parseCron("0 0 * * *"));
    expect(parseCron("@hourly")).toEqual(parseCron("0 * * * *"));
  });

  it("says plainly what's wrong", () => {
    expect(() => parseCron("* * * *")).toThrow("five parts");
    expect(() => parseCron("60 * * * *")).toThrow("A minute is from 0 to 59, not 60.");
    expect(() => parseCron("* 24 * * *")).toThrow("from 0 to 23");
    expect(() => parseCron("* * 0 * *")).toThrow("day of the month");
    expect(() => parseCron("*/0 * * * *")).toThrow("isn't a step");
    expect(() => parseCron("10-5 * * * *")).toThrow("goes backwards");
    expect(() => parseCron("* * * * FUNDAY")).toThrow("isn't a day of the week");
    expect(() => parseCron("1,,2 * * * *")).toThrow();
  });
});

describe("when it next runs", () => {
  it("finds the next whole minute after, never the same one", () => {
    expect(iso(nextRun("* * * * *", "UTC", at("2026-11-17T10:00:00Z")))).toBe("2026-11-17T10:01:00.000Z");
    expect(iso(nextRun("* * * * *", "UTC", at("2026-11-17T10:00:30Z")))).toBe("2026-11-17T10:01:00.000Z");
    expect(iso(nextRun("*/15 * * * *", "UTC", at("2026-11-17T10:16:00Z")))).toBe("2026-11-17T10:30:00.000Z");
    expect(iso(nextRun("0 9 * * *", "UTC", at("2026-11-17T09:00:00Z")))).toBe("2026-11-18T09:00:00.000Z");
  });

  it("goes by the timezone's own clock", () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC; in New York in November (UTC-5), 14:00 UTC.
    expect(iso(nextRun("0 9 * * *", "Asia/Kolkata", at("2026-11-17T00:00:00Z")))).toBe("2026-11-17T03:30:00.000Z");
    expect(iso(nextRun("0 9 * * *", "America/New_York", at("2026-11-17T00:00:00Z")))).toBe("2026-11-17T14:00:00.000Z");
  });

  it("matches weekdays, and either day field when both are given", () => {
    // 17 November 2026 is a Tuesday.
    expect(iso(nextRun("0 9 * * MON", "UTC", at("2026-11-17T00:00:00Z")))).toBe("2026-11-23T09:00:00.000Z");
    expect(iso(nextRun("0 9 * * 1-5", "UTC", at("2026-11-20T10:00:00Z")))).toBe("2026-11-23T09:00:00.000Z");
    // The 1st, or any Saturday: Saturday the 21st comes first.
    expect(iso(nextRun("0 0 1 * 6", "UTC", at("2026-11-17T00:00:00Z")))).toBe("2026-11-21T00:00:00.000Z");
    // With the weekday left as *, only the day of the month counts.
    expect(iso(nextRun("0 0 1 * *", "UTC", at("2026-11-17T00:00:00Z")))).toBe("2026-12-01T00:00:00.000Z");
  });

  it("finds the 29th of February, and says when there's never one", () => {
    expect(iso(nextRun("0 12 29 2 *", "UTC", at("2026-11-17T00:00:00Z")))).toBe("2028-02-29T12:00:00.000Z");
    expect(nextRun("0 0 30 2 *", "UTC", at("2026-11-17T00:00:00Z"))).toBeNull();
  });

  it("passes over a time the clocks skip, and runs twice through one they repeat", () => {
    // Europe/London went forward at 01:00 UTC on 29 March 2026: 01:30 local never happened that day.
    expect(iso(nextRun("30 1 * * *", "Europe/London", at("2026-03-28T23:00:00Z")))).toBe("2026-03-30T00:30:00.000Z");
    // It goes back at 01:00 UTC on 25 October 2026: 01:30 local happens at 00:30 and at 01:30 UTC.
    expect(nextRuns("30 1 * * *", "Europe/London", at("2026-10-24T23:00:00Z"), 2).map(iso)).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
    // A day made shorter or longer doesn't make one run lost.
    expect(iso(nextRun("0 0 * * *", "Europe/London", at("2026-03-28T12:00:00Z")))).toBe("2026-03-29T00:00:00.000Z");
    expect(iso(nextRun("0 0 * * *", "Europe/London", at("2026-03-29T12:00:00Z")))).toBe("2026-03-29T23:00:00.000Z");
  });

  it("lists the next few", () => {
    expect(nextRuns("0 */6 * * *", "UTC", at("2026-11-17T05:00:00Z"), 3).map(iso)).toEqual(["2026-11-17T06:00:00.000Z", "2026-11-17T12:00:00.000Z", "2026-11-17T18:00:00.000Z"]);
  });
});

describe("the schedule piece's triggers", () => {
  it("become the cron the piece itself sets", () => {
    expect(scheduleOf("every_x_minutes", { minutes: 5 })).toEqual({ cron: "*/5 * * * *", timezone: "UTC" });
    expect(scheduleOf("every_hour", { run_on_weekends: false })).toEqual({ cron: "0 * * * 1-5", timezone: "UTC" });
    expect(scheduleOf("every_hour", { run_on_weekends: true })).toEqual({ cron: "0 * * * *", timezone: "UTC" });
    expect(scheduleOf("every_day", { hour_of_the_day: 9, timezone: "Asia/Kolkata", run_on_weekends: false })).toEqual({ cron: "0 9 * * 1-5", timezone: "Asia/Kolkata" });
    expect(scheduleOf("every_week", { day_of_the_week: 1, hour_of_the_day: 9, timezone: "UTC" })).toEqual({ cron: "0 9 * * 1", timezone: "UTC" });
    expect(scheduleOf("every_month", { day_of_the_month: 31, hour_of_the_day: 23, timezone: "UTC" })).toEqual({ cron: "0 23 31 * *", timezone: "UTC" });
    expect(scheduleOf("cron_expression", { cronExpression: " 0/5 * * * * ", timezone: "Europe/London" })).toEqual({ cron: "0/5 * * * *", timezone: "Europe/London" });
  });

  it("keeps settings in range, and refuses what can't work", () => {
    expect(scheduleOf("every_day", { hour_of_the_day: 40 })).toEqual({ cron: "0 23 * * 1-5", timezone: "UTC" });
    expect(scheduleOf("every_x_minutes", { minutes: 0 })).toBeNull();
    expect(scheduleOf("cron_expression", { cronExpression: "" })).toBeNull();
    expect(scheduleOf("new_item", {})).toBeNull();
    for (const name of ["every_x_minutes", "every_hour", "every_day", "every_week", "every_month"]) {
      const schedule = scheduleOf(name, { minutes: 1 });
      expect(schedule && scheduleProblem(schedule)).toBeNull();
    }
  });

  it("says why a schedule can't be used", () => {
    expect(scheduleProblem({ cron: "0 9 * * *", timezone: "Mars/Olympus" })).toBe('"Mars/Olympus" isn\'t a timezone.');
    expect(scheduleProblem({ cron: "0 0 30 2 *", timezone: "UTC" })).toBe("That schedule never comes round.");
    expect(scheduleProblem({ cron: "nonsense", timezone: "UTC" })).toContain("five parts");
  });
});

describe("what's due", () => {
  const everyFive = { cron: "*/5 * * * *", timezone: "UTC" };

  it("is nothing before the next time", () => {
    expect(dueRun(everyFive, at("2026-11-17T10:00:00Z"), at("2026-11-17T10:04:59Z"))).toBeNull();
  });

  it("is the time just passed, once", () => {
    expect(iso(dueRun(everyFive, at("2026-11-17T10:00:00Z"), at("2026-11-17T10:05:20Z")))).toBe("2026-11-17T10:05:00.000Z");
    expect(dueRun(everyFive, at("2026-11-17T10:05:00Z"), at("2026-11-17T10:05:50Z"))).toBeNull();
  });

  it("makes up only the latest of several missed, and none missed long ago", () => {
    expect(iso(dueRun(everyFive, at("2026-11-17T10:00:00Z"), at("2026-11-17T10:17:00Z")))).toBe("2026-11-17T10:15:00.000Z");
    expect(dueRun({ cron: "0 9 * * *", timezone: "UTC" }, at("2026-11-16T09:00:00Z"), at("2026-11-17T10:00:00Z"))).toBeNull();
  });

  it("never runs one from before it was turned on", () => {
    expect(dueRun(everyFive, at("2026-11-17T10:06:00Z"), at("2026-11-17T10:07:00Z"))).toBeNull();
  });
});
