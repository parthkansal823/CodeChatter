/** Dates are "YYYY-MM-DD" strings in the viewer's time zone; they sort and compare as text. */
const pad = (n: number) => String(n).padStart(2, "0");

export const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const today = () => isoDate(new Date());

/** A date at local noon, so adding days never lands on the wrong day around daylight-saving changes. */
export function parseIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return isoDate(date) === value ? date : null;
}

export function addDays(value: string, days: number): string {
  const date = parseIso(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export const monthKey = (value: string) => value.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(y, m - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Weeks (Monday first) covering a "YYYY-MM" month; days outside it are included to fill the rows. */
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(y, m - 1, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const total = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7) * 7;
  const start = isoDate(first);
  return Array.from({ length: total / 7 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day - lead)));
}

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(parseIso(`${month}-01`) ?? new Date());

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
