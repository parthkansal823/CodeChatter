/**
 * Automations on a schedule: Activepieces' schedule piece's six triggers turned into a cron expression and a timezone, as the piece itself does when it's turned
 * on, and when a cron expression next comes round in a timezone. Our own, small and tested, as nothing in the API reads cron; shared by the API's timer
 * (apps/api/src/automations) and the trigger's panel, so the times the panel shows are the times it runs.
 *
 * Cron here is the usual five fields (minute, hour, day of the month, month, day of the week), with lists, ranges, steps (`*\/5`, `0/5`, `1-10/2`), month and
 * day names, 7 for Sunday too, and `@hourly`, `@daily`, `@weekly`, `@monthly` and `@yearly`. As in Vixie cron, a day matches if either day field does when
 * both are given, and both when one is `*`. Times are whole minutes in the schedule's timezone: on the night clocks go forward, a time that doesn't exist is
 * passed over; when they go back, a time that happens twice comes round twice.
 */

export const SCHEDULE_PIECE = "@activepieces/piece-schedule";
export const SCHEDULE_TRIGGERS = ["every_x_minutes", "every_hour", "every_day", "every_week", "every_month", "cron_expression"] as const;
export type Schedule = { cron: string; timezone: string };

type Field = { name: string; min: number; max: number; names?: readonly string[] };
const FIELDS: readonly Field[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of the month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  { name: "day of the week", min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
];
const MACROS: Record<string, string> = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

export type Cron = { minutes: ReadonlySet<number>; hours: ReadonlySet<number>; days: ReadonlySet<number>; months: ReadonlySet<number>; weekdays: ReadonlySet<number>; anyDay: boolean; anyWeekday: boolean };

function valueOf(text: string, field: Field): number {
  const named = field.names?.indexOf(text.toUpperCase()) ?? -1;
  // Month names count from 1, day names from 0 (Sunday).
  if (named >= 0) return field.min === 1 ? named + 1 : named;
  if (!/^\d{1,2}$/.test(text)) throw new Error(`"${text}" isn't a ${field.name}.`);
  const value = Number(text);
  if (value < field.min || value > field.max) throw new Error(`A ${field.name} is from ${field.min} to ${field.max}, not ${value}.`);
  return value;
}

function partOf(text: string, field: Field): Set<number> {
  if (text === "") throw new Error(`The ${field.name} is missing.`);
  const found = new Set<number>();
  for (const piece of text.split(",")) {
    const [range = "", stepText, extra] = piece.split("/");
    if (extra !== undefined || range === "") throw new Error(`"${piece}" isn't a ${field.name}.`);
    const step = stepText === undefined ? 1 : /^\d{1,2}$/.test(stepText) && Number(stepText) > 0 ? Number(stepText) : NaN;
    if (Number.isNaN(step)) throw new Error(`"${stepText ?? ""}" isn't a step: it's a whole number above 0.`);
    let from: number;
    let to: number;
    if (range === "*") [from, to] = [field.min, field.max];
    else if (range.includes("-")) {
      const [a = "", b = ""] = range.split("-");
      [from, to] = [valueOf(a, field), valueOf(b, field)];
      if (from > to) throw new Error(`"${range}" goes backwards.`);
    } else {
      from = valueOf(range, field);
      // "0/5" is every 5th from 0 to the end; "5" alone is just 5.
      to = stepText === undefined ? from : field.max;
    }
    for (let value = from; value <= to; value += step) found.add(value);
  }
  return found;
}

/** Throws an Error saying plainly what's wrong. */
export function parseCron(text: string): Cron {
  const expanded = MACROS[text.trim().toLowerCase()] ?? text;
  const parts = expanded.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("A cron expression has five parts: minute, hour, day of the month, month and day of the week.");
  const [minutes, hours, days, months, weekdays] = parts.map((part, index) => partOf(part, FIELDS[index]!)) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (weekdays.delete(7)) weekdays.add(0);
  return { minutes, hours, days, months, weekdays, anyDay: parts[2]!.startsWith("*"), anyWeekday: parts[4]!.startsWith("*") };
}

export function isTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formats = new Map<string, Intl.DateTimeFormat>();

/** A moment's date and time on the clock in a timezone. */
function clockAt(at: number, timezone: string) {
  let format = formats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formats.set(timezone, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(at)) parts[part.type] = part.value;
  return { month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday ?? ""] ?? 0 };
}

const MINUTE = 60_000;
/** Far enough for 29 February on a Monday; a cron that never comes round (30 February) is found out by then. */
const MOST_LOOKAHEAD = 8 * 366 * 24 * 60 * MINUTE;

/** The first whole minute after `after` that the cron matches in the timezone, or null if it never comes round. */
export function nextRun(cron: Cron | string, timezone: string, after: number): number | null {
  const rule = typeof cron === "string" ? parseCron(cron) : cron;
  const minutes = [...rule.minutes].sort((a, b) => a - b);
  const until = after + MOST_LOOKAHEAD;
  let at = Math.floor(after / MINUTE) * MINUTE + MINUTE;
  while (at <= until) {
    const clock = clockAt(at, timezone);
    const dayMatches = rule.anyDay || rule.anyWeekday ? rule.days.has(clock.day) && rule.weekdays.has(clock.weekday) : rule.days.has(clock.day) || rule.weekdays.has(clock.weekday);
    const left = 24 * 60 - (clock.hour * 60 + clock.minute);
    if (!rule.months.has(clock.month) || !dayMatches) {
      // To late the same evening, then an hour at a time, so a day shortened or lengthened by the clocks changing is never jumped over.
      at += Math.max(60 - clock.minute, left - 120) * MINUTE;
      continue;
    }
    if (!rule.hours.has(clock.hour)) {
      at += (60 - clock.minute) * MINUTE;
      continue;
    }
    if (rule.minutes.has(clock.minute)) return at;
    const later = minutes.find((minute) => minute > clock.minute);
    at += ((later ?? 60) - clock.minute) * MINUTE;
  }
  return null;
}

/** The next few times, for showing. */
export function nextRuns(cron: Cron | string, timezone: string, after: number, count: number): number[] {
  const rule = typeof cron === "string" ? parseCron(cron) : cron;
  const found: number[] = [];
  for (let at: number | null = after; found.length < count; ) {
    at = nextRun(rule, timezone, at);
    if (at === null) break;
    found.push(at);
  }
  return found;
}

const hourOf = (value: unknown) => (Number.isInteger(value) ? Math.min(Math.max(value as number, 0), 23) : 0);
const zoneOf = (value: unknown) => (typeof value === "string" && value ? value : "UTC");

/**
 * The schedule of one of the piece's triggers, given its settings, as the piece works it out (0.1.22's `onEnable`). Every few minutes is counted from the hour,
 * as the piece's own cron says, rather than from when it was turned on. Null when it isn't one of them, or its settings aren't usable.
 */
export function scheduleOf(triggerName: string, input: Record<string, unknown>): Schedule | null {
  switch (triggerName) {
    case "every_x_minutes": {
      const minutes = input.minutes;
      return Number.isInteger(minutes) && (minutes as number) >= 1 && (minutes as number) <= 59 ? { cron: `*/${minutes as number} * * * *`, timezone: "UTC" } : null;
    }
    case "every_hour":
      return { cron: input.run_on_weekends ? "0 * * * *" : "0 * * * 1-5", timezone: "UTC" };
    case "every_day":
      return { cron: `0 ${hourOf(input.hour_of_the_day)} * * ${input.run_on_weekends ? "*" : "1-5"}`, timezone: zoneOf(input.timezone) };
    case "every_week": {
      const day = Number.isInteger(input.day_of_the_week) ? Math.min(Math.max(input.day_of_the_week as number, 0), 6) : 0;
      return { cron: `0 ${hourOf(input.hour_of_the_day)} * * ${day}`, timezone: zoneOf(input.timezone) };
    }
    case "every_month": {
      const day = Number.isInteger(input.day_of_the_month) ? Math.min(Math.max(input.day_of_the_month as number, 1), 31) : 1;
      return { cron: `0 ${hourOf(input.hour_of_the_day)} ${day} * *`, timezone: zoneOf(input.timezone) };
    }
    case "cron_expression":
      return typeof input.cronExpression === "string" && input.cronExpression.trim() ? { cron: input.cronExpression.trim(), timezone: zoneOf(input.timezone) } : null;
    default:
      return null;
  }
}

/** Why a schedule can't be used, or null when it can. */
export function scheduleProblem(schedule: Schedule, now = Date.now()): string | null {
  if (!isTimezone(schedule.timezone)) return `"${schedule.timezone}" isn't a timezone.`;
  try {
    return nextRun(schedule.cron, schedule.timezone, now) === null ? "That schedule never comes round." : null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Which time a flow on a schedule is due for now, if any: the latest time it should have run since it last did, not before `since`. Times missed by more than
 * `grace` (the server was down) aren't made up, as n8n doesn't; one a little late still runs once.
 */
export function dueRun(schedule: Schedule, since: number, now: number, grace = 10 * MINUTE): number | null {
  const rule = parseCron(schedule.cron);
  let due: number | null = null;
  for (let at = nextRun(rule, schedule.timezone, Math.max(since, now - grace)); at !== null && at <= now; at = nextRun(rule, schedule.timezone, at)) due = at;
  return due;
}
