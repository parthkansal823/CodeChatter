/** What the candidate's page has noticed since it last reported. The guard sends it; anything on the page can add to it. */
import type { BROWSER_INTEGRITY_KINDS } from "@codechatter/contracts";

export type NoticedKind = (typeof BROWSER_INTEGRITY_KINDS)[number];
export type Noticed = { kind: NoticedKind; at: string; length?: number };

const MOST_HELD = 50;
const queue: Noticed[] = [];

export function noteIntegrity(kind: NoticedKind, length?: number): void {
  if (queue.length < MOST_HELD) queue.push({ kind, at: new Date().toISOString(), ...(length !== undefined && { length }) });
}

export const takeNoticed = (): Noticed[] => queue.splice(0);

/** Being offline for a moment shouldn't lose the record. */
export function putBackNoticed(events: readonly Noticed[]): void {
  queue.unshift(...events.slice(0, MOST_HELD - queue.length));
}
