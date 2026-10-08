import { AI_LIMITS, type AiMode, type AiTokenCount, type AiTurn } from "@codechatter/contracts";

/** Where an Edit answer applies: the selection that was sent (or the whole file) and a fingerprint of its text. */
export type EditTarget = {
  fileId: string;
  path: string;
  /** Yjs relative positions as JSON, so the range follows other people's edits; null means the whole file. */
  range: { from: unknown; to: unknown } | null;
  /** Fingerprint of the text that was sent, to notice if it changed while the AI worked. */
  fingerprint: string;
};

/** What happened to one action the agent proposed. */
export type StepState = {
  state: "pending" | "running" | "done" | "failed" | "skipped";
  /** One line, for the person and for the AI's next message. */
  note?: string;
  /** Program output or failing test cases, trimmed. */
  detail?: string;
  /** The file an approved edit or create touched, so Undo can reverse it. */
  fileId?: string;
  /** The step made the file, so Undo moves it to the trash instead of reverting text. */
  created?: boolean;
};

export type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: AiMode;
  /** What was attached, as short labels ("main.py", "Run output"). */
  context?: string[];
  image?: boolean;
  status?: "streaming" | "done" | "stopped" | "cut" | "refused" | "error";
  error?: string;
  usage?: AiTokenCount;
  /** Edit mode. */
  target?: EditTarget;
  edit?: "applied" | "rejected" | "undone";
  /** Agent mode: a decision per proposed action, by its position in the answer. */
  steps?: Record<number, StepState>;
  /** The agent's step results were already sent back. */
  followedUp?: boolean;
};

type Stored = { mode: AiMode; entries: ChatEntry[] };

const key = (roomId: string) => `cc-ai:${roomId}`;
const KEEP_ENTRIES = 80;

/** This tab's conversation for a room. sessionStorage: it survives reloads, not closing the tab. */
export function loadHistory(roomId: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(key(roomId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    // An answer that was streaming when the page closed is finished as stopped.
    const entries = stored.entries.map((e) => (e.status === "streaming" ? { ...e, status: "stopped" as const } : e));
    return { mode: stored.mode, entries };
  } catch {
    return null;
  }
}

export function saveHistory(roomId: string, stored: Stored): void {
  try {
    sessionStorage.setItem(key(roomId), JSON.stringify({ mode: stored.mode, entries: stored.entries.slice(-KEEP_ENTRIES) }));
  } catch {
    // Storage full or blocked: the conversation still works, it just won't survive a reload.
  }
}

export function clearHistory(roomId: string): void {
  try {
    sessionStorage.removeItem(key(roomId));
  } catch {
    // Nothing to clear.
  }
}

const HISTORY_TURNS = 20;
const HISTORY_CHARS = 40_000;

/** The turns worth sending: answered exchanges only, newest last, within the request size limits. */
export function turnsToSend(entries: ChatEntry[]): AiTurn[] {
  const usable = entries.filter((e) => e.content.trim() && e.status !== "error");
  const turns: AiTurn[] = [];
  let size = 0;
  for (let i = usable.length - 1; i >= 0 && turns.length < HISTORY_TURNS; i--) {
    const entry = usable[i]!;
    let content = entry.content;
    if (content.length > AI_LIMITS.messageChars) content = `${content.slice(0, AI_LIMITS.messageChars - 40)}\n… (trimmed)`;
    if (turns.length > 0 && size + content.length > HISTORY_CHARS) break;
    turns.unshift({ role: entry.role, content });
    size += content.length;
  }
  while (turns.length > 0 && turns[0]!.role !== "user") turns.shift();
  return turns;
}
