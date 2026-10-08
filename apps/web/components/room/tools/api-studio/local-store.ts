"use client";

import type { HttpMethod, VariableLookup } from "@codechatter/contracts";
import { useCallback, useSyncExternalStore } from "react";

import type { Environment } from "./model";

/**
 * What each person keeps on their own device, never in the shared document:
 * the chosen environment, their variable values (secrets, and values set by
 * scripts or extractions, like Postman's "current value"), and history.
 * Storage can be unavailable (private mode, blocked cookies); everything
 * still works for the session, it just isn't remembered.
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(key);
  } catch {
    value = null;
  }
  memory.set(key, value);
  return value;
}

function write(key: string, value: string | null): void {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Quota or blocked storage: the in-memory copy still serves this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key) memory.delete(event.key);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// Parsed values by key, reused while the stored text is unchanged, so a
// value keeps its identity between renders.
const parsed = new Map<string, { raw: string; value: unknown }>();

function parse<T>(key: string, raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  const cached = parsed.get(key);
  if (cached?.raw === raw) return cached.value as T;
  let value: T = fallback;
  try {
    value = JSON.parse(raw) as T;
  } catch {
    value = fallback;
  }
  parsed.set(key, { raw, value });
  return value;
}

function useStored<T>(key: string, fallback: T): [T, (next: T | ((current: T) => T)) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = parse(key, raw, fallback);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = parse(key, read(key), fallback);
      const resolved = typeof next === "function" ? (next as (c: T) => T)(current) : next;
      write(key, JSON.stringify(resolved));
    },
    [key, fallback],
  );
  return [value, set];
}

/** Read or write a stored value outside React (the send pipeline runs in event handlers). */
const getStored = <T>(key: string, fallback: T): T => parse(key, read(key), fallback);
const setStored = <T>(key: string, value: T): void => write(key, JSON.stringify(value));

const prefix = (roomId: string, userId: string) => `cc:api-studio:${userId}:${roomId}`;

/** Values per environment id ("" = no environment), per variable name. */
export type LocalValues = Record<string, Record<string, string>>;
const NO_VALUES: LocalValues = {};

export function useSelectedEnvironment(roomId: string, userId: string) {
  return useStored<string>(`${prefix(roomId, userId)}:env`, "");
}

export function useLocalValues(roomId: string, userId: string) {
  return useStored<LocalValues>(`${prefix(roomId, userId)}:values`, NO_VALUES);
}

export const HISTORY_LIMIT = 50;

export type HistoryEntry = {
  id: string;
  at: number;
  requestId: string | null;
  name: string;
  method: HttpMethod;
  /** The URL as written ({{variables}} unresolved, so no secrets land here). */
  url: string;
  status: number | null;
  error: string | null;
  timeMs: number;
  size: number;
};

const NO_HISTORY: HistoryEntry[] = [];

export function useHistory(roomId: string, userId: string) {
  return useStored<HistoryEntry[]>(`${prefix(roomId, userId)}:history`, NO_HISTORY);
}

/**
 * Variable values for one environment: your own value first (secrets and
 * values set by scripts), then the shared value. Secrets have no shared value.
 */
export function variableLookup(env: Environment | null, mine: Record<string, string>): VariableLookup {
  const shared = new Map<string, string>();
  for (const v of env?.variables ?? []) if (v.enabled && v.key && !v.secret && !shared.has(v.key)) shared.set(v.key, v.value);
  return (name) => (Object.hasOwn(mine, name) ? mine[name] : shared.get(name));
}

/** Every value the lookup knows, for scripts (env.get / env.toObject). */
export function variableSnapshot(env: Environment | null, mine: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of env?.variables ?? []) if (v.enabled && v.key && !v.secret && !(v.key in out)) out[v.key] = v.value;
  return { ...out, ...mine };
}

/** Names whose values shouldn't leave this device by accident: secrets, and values only you have (set from responses). */
export function sensitiveNames(env: Environment | null, mine: Record<string, string>): Set<string> {
  const variables = env?.variables ?? [];
  const shared = new Set(variables.filter((v) => v.enabled && !v.secret && v.value !== "").map((v) => v.key));
  const names = new Set(variables.filter((v) => v.secret).map((v) => v.key));
  for (const key of Object.keys(mine)) if (!shared.has(key)) names.add(key);
  return names;
}

// ---------------------------------------------------------------------------
// Outside React

const envKeyOf = (roomId: string, userId: string) => `${prefix(roomId, userId)}:env`;
const valuesKeyOf = (roomId: string, userId: string) => `${prefix(roomId, userId)}:values`;
const historyKeyOf = (roomId: string, userId: string) => `${prefix(roomId, userId)}:history`;

export const getSelectedEnvironment = (roomId: string, userId: string) => getStored<string>(envKeyOf(roomId, userId), "");

export function getValues(roomId: string, userId: string, envKey: string): Record<string, string> {
  return getStored<LocalValues>(valuesKeyOf(roomId, userId), NO_VALUES)[envKey] ?? {};
}

/** Set (string) or clear (null) several of your values for one environment. */
export function patchValues(roomId: string, userId: string, envKey: string, changes: Record<string, string | null>): void {
  const all = getStored<LocalValues>(valuesKeyOf(roomId, userId), NO_VALUES);
  const next = { ...(all[envKey] ?? {}) };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  setStored(valuesKeyOf(roomId, userId), { ...all, [envKey]: next });
}

export function recordHistory(roomId: string, userId: string, entry: HistoryEntry): void {
  setStored(historyKeyOf(roomId, userId), [entry, ...getStored<HistoryEntry[]>(historyKeyOf(roomId, userId), NO_HISTORY)].slice(0, HISTORY_LIMIT));
}

export function clearHistory(roomId: string, userId: string): void {
  setStored(historyKeyOf(roomId, userId), []);
}
