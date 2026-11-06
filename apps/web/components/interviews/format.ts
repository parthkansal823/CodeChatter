/** Small words and numbers shared by the interview pages and the room's panel. */
import type { InterviewMode, InterviewStatus, QuestionDifficulty, QuestionKind } from "@codechatter/contracts";

export const STATUS_LABEL: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  finished: "Finished",
  cancelled: "Cancelled",
  missed: "Missed",
};

export const MODE_LABEL: Record<InterviewMode, string> = { interview: "Interview", assessment: "Assessment" };
export const KIND_LABEL: Record<QuestionKind, string> = { coding: "Coding", mcq: "Multiple choice", short: "Short answer", design: "System design" };
export const DIFFICULTY_LABEL: Record<QuestionDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export const RECOMMENDATION_LABEL = { yes: "Yes", maybe: "Maybe", no: "No" } as const;

/** Time left as 23:05 or 1:02:09. Never negative: the server closes it a few seconds after zero. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * One CSV line. A cell starting with =, +, - or @ is turned into text, so a candidate's name
 * can't run as a formula when someone opens the file in a spreadsheet.
 */
export function csvRow(cells: ReadonlyArray<string | number>): string {
  return cells
    .map((cell) => {
      const text = String(cell);
      const safe = typeof cell === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
    })
    .join(",");
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** The candidate's link for this site. */
export const candidateLink = (origin: string, token: string) => `${origin}/interview/${token}`;

/** A `<input type="datetime-local">` value as an ISO time, or undefined when empty. */
export function isoFromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
