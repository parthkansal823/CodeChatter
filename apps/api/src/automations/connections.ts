/**
 * A room's connections for automations: the sign-ins its flows' pieces use (a Slack token, a database's password), as n8n's credentials. Kept with the room
 * (room settings, `automationConnections`), each sealed with AES-256-GCM under a key of its own (github/token-box.ts), and never shown again: what anyone
 * sees is its name, its piece, and the fields that aren't secret. A run gets them opened, in memory, from the API (RunnerClient), so they never sit in the
 * room's files. Pure helpers here; automation-connections.service.ts keeps them.
 */
import { ConnectionValue, shownOf, type AutomationConnection, type AutomationConnectionInput } from "@codechatter/contracts";

export const CONNECTIONS = "automationConnections";
export const CONNECTION_PURPOSE = "automation-connection v1";

export type StoredConnection = {
  piece: string;
  type: ConnectionValue["type"];
  sealed: string;
  shown: AutomationConnection["shown"];
  createdBy: { id: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
  lastTest: AutomationConnection["lastTest"];
};
type Seal = (text: string) => string;

/** A room's kept connections, from its settings. */
export const entriesOf = (settings: unknown): Record<string, StoredConnection> => {
  const value = (settings as Record<string, unknown> | null)?.[CONNECTIONS];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, StoredConnection>) : {};
};
type Open = (sealed: string) => string | null;

/** A connection as it's kept: its value sealed, what's shown worked out here rather than taken from the browser as it is. */
export function storedOf(input: AutomationConnectionInput, by: { id: string; name: string }, seal: Seal, earlier?: StoredConnection, now = Date.now()): StoredConnection {
  return {
    piece: input.piece,
    type: input.value.type,
    sealed: seal(JSON.stringify(input.value)),
    shown: shownOf(input.value, input.shown ?? []),
    createdBy: earlier?.createdBy ?? by,
    createdAt: earlier?.createdAt ?? now,
    updatedAt: now,
    // New details haven't been tried.
    lastTest: null,
  };
}

export function shownConnectionOf(name: string, stored: StoredConnection): AutomationConnection {
  return { name, piece: stored.piece, type: stored.type, shown: stored.shown ?? {}, createdBy: stored.createdBy ?? null, createdAt: stored.createdAt, updatedAt: stored.updatedAt, lastTest: stored.lastTest ?? null };
}

/** One connection opened, or null when it can't be (sealed under another secret, or not a connection any more). */
export function openedValue(stored: StoredConnection, open: Open): ConnectionValue | null {
  const text = typeof stored?.sealed === "string" ? open(stored.sealed) : null;
  if (!text) return null;
  try {
    const parsed = ConnectionValue.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every connection a run can use, opened, by name: { piece, value }. One that can't be opened is left out, so a step using it says it isn't there. */
export function forRun(all: Record<string, StoredConnection>, open: Open): Record<string, { piece: string; value: ConnectionValue }> {
  const out: Record<string, { piece: string; value: ConnectionValue }> = {};
  for (const [name, stored] of Object.entries(all)) {
    const value = openedValue(stored, open);
    if (value) out[name] = { piece: stored.piece, value };
  }
  return out;
}

/** What a database or service answers when it refuses, by its code, in plain words. */
const REFUSALS: Record<string, string> = {
  "28P01": "The user name or password is wrong.",
  "28000": "This user isn't allowed to sign in.",
  "3D000": "There's no database with that name.",
  ER_ACCESS_DENIED_ERROR: "The user name or password is wrong.",
  ER_BAD_DB_ERROR: "There's no database with that name.",
  ECONNREFUSED: "Nothing answered at that host and port. Is the database running?",
  ENOTFOUND: "There's no host with that name here.",
  ETIMEDOUT: "It didn't answer in time.",
  EAI_AGAIN: "That host's name couldn't be looked up: rooms reach only their own services for now.",
};

/**
 * Why a connection didn't work, as a person can read it. A piece's check often hands back the error it caught as JSON (a database driver's error, whose
 * message isn't one of its fields): its code says what happened.
 */
export function plainConnectionError(text: string): string {
  const raw = text.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Already words.
  }
  if (!parsed || typeof parsed !== "object") return raw.slice(0, 500) || "It didn't work with these details.";
  const error = parsed as { message?: unknown; code?: unknown; routine?: unknown; errno?: unknown };
  const code = typeof error.code === "string" ? error.code : typeof error.errno === "string" ? error.errno : null;
  const known = code ? REFUSALS[code] : undefined;
  if (known) return `${known} (${code})`;
  if (typeof error.message === "string" && error.message) return error.message.slice(0, 500);
  if (code) return typeof error.routine === "string" ? `It was refused: ${error.routine} (${code}).` : `It was refused (${code}).`;
  return "It didn't work with these details.";
}
