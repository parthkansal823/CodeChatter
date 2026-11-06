/** Small words and numbers shared by the interview pages and the room's panel. */
import type { InterviewStatus } from "@codechatter/contracts";

export const STATUS_LABEL: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  finished: "Finished",
  cancelled: "Cancelled",
};

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

/** The candidate's link for this site. */
export const candidateLink = (origin: string, token: string) => `${origin}/interview/${token}`;

/** A `<input type="datetime-local">` value as an ISO time, or undefined when empty. */
export function isoFromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
