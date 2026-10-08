import { z } from "zod";

import { WorkspacePath } from "./run.js";

/**
 * The room AI copilot (apps/api/src/ai, apps/web/components/room/tools/ai).
 * Provider keys never leave the API; the browser only sends the conversation
 * and the context it chose to attach.
 */

export const AI_MODES = ["assistant", "explain-error", "tutor", "interviewer", "complexity", "screenshot", "edit", "agent", "summary"] as const;
export type AiMode = (typeof AI_MODES)[number];

/**
 * Hard caps on what one request may carry. The API's JSON body limit is 1 MB,
 * so the client trims to these before sending and the server enforces them.
 * The server trims further to its own context budget before calling a model.
 */
export const AI_LIMITS = {
  messageChars: 12_000,
  messages: 40,
  fileChars: 120_000,
  selectionChars: 24_000,
  paths: 400,
  pathChars: 512,
  /** Base64 characters (~480 KB of image). The web client downscales pastes to fit. */
  imageChars: 650_000,
  /** Files the agent was allowed to read, beyond the active one. */
  extraFiles: 6,
  extraFileChars: 40_000,
  changesChars: 20_000,
} as const;

export const AI_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const AiTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(AI_LIMITS.messageChars, "That message is too long."),
});
export type AiTurn = z.infer<typeof AiTurn>;

export const AiChatInput = z.object({
  mode: z.enum(AI_MODES).default("assistant"),
  /** Oldest first; the last one is the question being asked. */
  messages: z
    .array(AiTurn)
    .min(1)
    .max(AI_LIMITS.messages)
    .refine((list) => list.at(-1)?.role === "user" && list.at(-1)!.content.trim().length > 0, "End with your question."),
  context: z
    .object({
      file: z.object({ path: WorkspacePath, text: z.string().max(AI_LIMITS.fileChars, "The file is too large to attach.") }).optional(),
      selection: z
        .object({
          path: WorkspacePath,
          text: z.string().min(1).max(AI_LIMITS.selectionChars, "The selection is too large to attach."),
          startLine: z.number().int().min(1),
          endLine: z.number().int().min(1),
        })
        .optional(),
      /** The server reads the room's last Run output itself (never trusted from the browser). */
      runOutput: z.boolean().default(false),
      paths: z.array(WorkspacePath.max(AI_LIMITS.pathChars)).max(AI_LIMITS.paths).optional(),
      extraFiles: z
        .array(z.object({ path: WorkspacePath, text: z.string().max(AI_LIMITS.extraFileChars, "A file is too large to attach.") }))
        .max(AI_LIMITS.extraFiles)
        .optional(),
      /**
       * Summary mode: the server reads the room's chat and edit activity for
       * the window itself; the browser adds what it saw change in the files.
       */
      summary: z
        .object({
          minutes: z.number().int().min(5).max(24 * 60).default(60),
          changes: z.string().max(AI_LIMITS.changesChars).default(""),
        })
        .optional(),
      image: z
        .object({
          mediaType: z.enum(AI_IMAGE_TYPES),
          data: z
            .string()
            .min(1)
            .max(AI_LIMITS.imageChars, "That image is too large. Paste a smaller one.")
            .regex(/^[A-Za-z0-9+/]+={0,2}$/, "The image isn't valid base64."),
        })
        .optional(),
    })
    .default({ runOutput: false }),
});
export type AiChatInput = z.infer<typeof AiChatInput>;

export type AiProviderName = "anthropic" | "openai" | "none";

/** GET /api/ai/status: enough for the UI to show the chat or the setup help. */
export type AiStatus = {
  configured: boolean;
  provider: AiProviderName;
  model: string | null;
  /** The model accepts pasted images. */
  vision: boolean;
  /** Why AI isn't usable yet, in plain words (never contains a secret). */
  problem: string | null;
  limit: { requests: number; windowSeconds: number };
};

/** Tokens one answer used. `estimated` when the provider didn't report them (counted from characters). */
export type AiTokenCount = { inputTokens: number; outputTokens: number; estimated: boolean };
export type AiUsageTotals = AiTokenCount & { requests: number };

/** GET /api/ai/usage: your own usage, and where you stand against the rate limit. */
export type AiUsage = {
  /** UTC day. */
  today: AiUsageTotals;
  last30Days: AiUsageTotals;
  rateLimit: {
    limit: number;
    windowSeconds: number;
    used: number;
    remaining: number;
    /** Seconds until one more request fits; 0 while any remain. */
    resetSeconds: number;
  };
};

/**
 * POST /api/rooms/:roomId/ai/chat answers with Server-Sent Events, one JSON
 * object per `data:` line. Errors before streaming starts (permissions, rate
 * limit, validation) are ordinary problem+json responses instead.
 */
export type AiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; stop: "end" | "length" | "refusal"; usage?: AiTokenCount }
  | { type: "error"; message: string };

/*
 * Agent mode: the model proposes actions as tags in its answer, the browser
 * shows each as a step the person approves, and nothing runs or changes
 * without that. One definition serves the server prompt and the web parser,
 * so they can't drift apart.
 */
export const AGENT_PROTOCOL = `Propose actions with these tags, each on its own lines:
<plan>
1. A short numbered plan.
</plan>
<read path="src/util.py"/>
<edit path="src/app.py">
the complete new content of an existing file, no code fences
</edit>
<create path="src/new.py">
the complete content of a new file, no code fences
</create>
<run path="src/app.py"/>
<test path="src/app.py"/>
read asks to see a file. run presses Run on a file. test runs the file's saved test cases.
Paths are relative to the room root, exactly as in the file list. Read a file before editing it unless its content is attached. Propose only the next few steps, then stop and wait for their results. When the task is complete, say so and propose no more actions.`;

export type AgentAction =
  | { kind: "edit" | "create"; path: string; content: string }
  | { kind: "read" | "run" | "test"; path: string };

export type AgentSegment =
  | { type: "text"; text: string }
  /** `complete` is false while an edit or create is still streaming in. */
  | { type: "action"; index: number; action: AgentAction; complete: boolean };

const isWorkspacePath = (path: string) => WorkspacePath.safeParse(path).success;

/** Content between tags, without the code fence models often add anyway. */
function cleanContent(raw: string): string {
  const content = raw.replace(/^\n/, "").replace(/\n$/, "");
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(content);
  return fenced ? fenced[1]! : content;
}

const TAGS = ["plan", "read", "edit", "create", "run", "test"];

/** A tag still being typed at the very end of a streaming answer ("<edi", '<read path="sr'). */
function stripPartialTag(value: string): string {
  const open = /<\/?(?:([a-z]+)(?:\s[^>]*)?)?$/.exec(value);
  return open && TAGS.some((tag) => tag.startsWith(open[1] ?? "")) ? value.slice(0, open.index) : value;
}

/** Split an agent answer into text and proposed actions, tolerating a half-streamed tag or action. */
export function parseAgentReply(reply: string): AgentSegment[] {
  const segments: AgentSegment[] = [];
  const text = (value: string) => {
    const cleaned = stripPartialTag(value)
      .replace(/\s*<plan>\s*/g, "\n\n**Plan**\n\n")
      .replace(/\s*<\/plan>/g, "");
    if (cleaned.trim()) segments.push({ type: "text", text: cleaned.trim() });
  };
  const opening = /<(edit|create)\s+path="([^"\n]+)"\s*>|<(read|run|test)\s+path="([^"\n]+)"\s*\/?>(?:\s*<\/\3>)?/g;
  let index = 0;
  let cursor = 0;
  for (let match = opening.exec(reply); match; match = opening.exec(reply)) {
    text(reply.slice(cursor, match.index));
    const [whole, blockKind, blockPath, simpleKind, simplePath] = match;
    if (simpleKind && simplePath) {
      if (isWorkspacePath(simplePath)) {
        segments.push({ type: "action", index: index++, action: { kind: simpleKind as "read" | "run" | "test", path: simplePath }, complete: true });
      }
      cursor = match.index + whole.length;
      continue;
    }
    const start = match.index + whole.length;
    const close = reply.indexOf(`</${blockKind}>`, start);
    const body = close === -1 ? reply.slice(start) : reply.slice(start, close);
    if (isWorkspacePath(blockPath!)) {
      segments.push({
        type: "action",
        index: index++,
        action: { kind: blockKind as "edit" | "create", path: blockPath!, content: cleanContent(body) },
        complete: close !== -1,
      });
    }
    if (close === -1) return segments;
    cursor = close + blockKind!.length + 3;
    opening.lastIndex = cursor;
  }
  text(reply.slice(cursor));
  return segments;
}
