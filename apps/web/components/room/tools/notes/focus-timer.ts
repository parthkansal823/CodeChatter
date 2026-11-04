import type * as Y from "yjs";

/**
 * The room's focus timer (Notes), shared by everyone in map "timer" of the notes
 * document: a focus stretch, then a break, then focus again. While it runs it holds
 * when it ends (each person counts down from that); paused, how long was left. Anyone
 * who can chat can start, pause, reset or skip it; the first browser to see a stretch
 * end moves it on, and only once (the end it saw has to still be the one stored).
 */
export type TimerPhase = "focus" | "break";
export type TimerState = {
  phase: TimerPhase;
  running: boolean;
  /** When it runs: the end of this stretch (ms since the epoch). */
  endsAt: number | null;
  /** When it's paused or stopped: how long this stretch has left. */
  remainingMs: number;
  focusMinutes: number;
  breakMinutes: number;
  /** Who last started or changed it. */
  by: string | null;
};

export const FOCUS_CHOICES = [15, 25, 45, 50] as const;
export const BREAK_CHOICES = [5, 10, 15] as const;
const DEFAULT: TimerState = { phase: "focus", running: false, endsAt: null, remainingMs: 25 * 60_000, focusMinutes: 25, breakMinutes: 5, by: null };

const lengthOf = (state: Pick<TimerState, "focusMinutes" | "breakMinutes">, phase: TimerPhase) =>
  (phase === "focus" ? state.focusMinutes : state.breakMinutes) * 60_000;

const minutes = (value: unknown, choices: readonly number[], fallback: number) =>
  typeof value === "number" && choices.includes(value) ? value : fallback;

export function readTimer(map: Y.Map<unknown>): TimerState {
  const phase = map.get("phase") === "break" ? "break" : "focus";
  const focusMinutes = minutes(map.get("focusMinutes"), FOCUS_CHOICES, DEFAULT.focusMinutes);
  const breakMinutes = minutes(map.get("breakMinutes"), BREAK_CHOICES, DEFAULT.breakMinutes);
  const endsAt = typeof map.get("endsAt") === "number" ? (map.get("endsAt") as number) : null;
  const running = map.get("running") === true && endsAt !== null;
  const stored = map.get("remainingMs");
  const remainingMs = typeof stored === "number" && stored >= 0 ? stored : lengthOf({ focusMinutes, breakMinutes }, phase);
  const by = typeof map.get("by") === "string" ? (map.get("by") as string) : null;
  return { phase, running, endsAt, remainingMs, focusMinutes, breakMinutes, by };
}

/** How long this stretch has left now. */
export const remainingAt = (state: TimerState, now: number): number =>
  state.running && state.endsAt !== null ? Math.max(0, state.endsAt - now) : state.remainingMs;

/** "24:59". */
export function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function write(map: Y.Map<unknown>, patch: Partial<TimerState>) {
  map.doc!.transact(() => {
    for (const [key, value] of Object.entries(patch)) map.set(key, value);
  });
}

export function startTimer(map: Y.Map<unknown>, by: string, now: number): void {
  const state = readTimer(map);
  if (state.running) return;
  write(map, { running: true, endsAt: now + state.remainingMs, by });
}

export function pauseTimer(map: Y.Map<unknown>, by: string, now: number): void {
  const state = readTimer(map);
  if (!state.running) return;
  write(map, { running: false, endsAt: null, remainingMs: remainingAt(state, now), by });
}

/** Back to the start of a focus stretch, stopped. */
export function resetTimer(map: Y.Map<unknown>, by: string): void {
  const state = readTimer(map);
  write(map, { phase: "focus", running: false, endsAt: null, remainingMs: lengthOf(state, "focus"), by });
}

/** On to the other stretch, at its full length; it keeps running if it was. */
export function skipTimer(map: Y.Map<unknown>, by: string, now: number): void {
  const state = readTimer(map);
  const phase: TimerPhase = state.phase === "focus" ? "break" : "focus";
  const length = lengthOf(state, phase);
  write(map, { phase, remainingMs: length, endsAt: state.running ? now + length : null, by });
}

/** New lengths; a stopped timer that hasn't started its stretch takes the new length. */
export function setLengths(map: Y.Map<unknown>, lengths: { focusMinutes?: number; breakMinutes?: number }, by: string): void {
  const state = readTimer(map);
  const next = {
    focusMinutes: minutes(lengths.focusMinutes, FOCUS_CHOICES, state.focusMinutes),
    breakMinutes: minutes(lengths.breakMinutes, BREAK_CHOICES, state.breakMinutes),
  };
  const untouched = !state.running && state.remainingMs === lengthOf(state, state.phase);
  write(map, { ...next, ...(untouched && { remainingMs: lengthOf(next, state.phase) }), by });
}

/**
 * A running stretch that has ended moves on to the next one (focus, then a break, and
 * back), running. Only the end `seen` moves it, so two browsers noticing at once move
 * it once. Returns the phase that ended, or null when nothing moved.
 */
export function advanceIfEnded(map: Y.Map<unknown>, now: number, seen: number): TimerPhase | null {
  const state = readTimer(map);
  if (!state.running || state.endsAt === null || state.endsAt !== seen || now < state.endsAt) return null;
  const phase: TimerPhase = state.phase === "focus" ? "break" : "focus";
  const length = lengthOf(state, phase);
  write(map, { phase, remainingMs: length, endsAt: state.endsAt + length });
  return state.phase;
}
