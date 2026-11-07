/** Traces: every call to the AI from a room, with its tokens and timing, for seeing what was sent and what it cost. */

export const AI_TRACE_SOURCES = ["chat", "prompt", "gateway", "embedding"] as const;
export type AiTraceSource = (typeof AI_TRACE_SOURCES)[number];
export type AiTraceStatus = "ok" | "cut" | "refused" | "stopped" | "error";

/** GET /api/rooms/:roomId/ai/traces, newest first. */
export type AiTrace = {
  id: string;
  at: string;
  source: AiTraceSource;
  /** The AI panel's mode, for a call from there. */
  mode: string | null;
  /** Who made it. Null for code in the room's sandbox, which isn't anyone in particular. */
  by: string | null;
  mine: boolean;
  model: string;
  status: AiTraceStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  firstMs: number | null;
  totalMs: number;
  /** What was sent and what came back. Someone's conversation is theirs, so for anyone else these are null, and `hidden` says why. */
  input: Array<{ role: string; content: string }> | null;
  output: string | null;
  hidden: boolean;
};
