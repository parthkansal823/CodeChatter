/**
 * Automations: flows in a room's files, in Activepieces' own format, run in its sandbox by Activepieces' real engine and pieces (MIT). There's no Activepieces server,
 * so a room's connections never leave its own sandbox, and it costs nothing. The chart and editor are our own.
 */
import { z } from "zod";

/** Flows live in the room's files, so they're edited together, versioned, and can leave. */
export const AUTOMATION_SUFFIX = ".flow.json";
export const isFlowFile = (name: string) => name.toLowerCase().endsWith(AUTOMATION_SUFFIX);

const FlowFile = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => isFlowFile(path) && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "That isn't a flow in this room.");

export const AutomationInput = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("run"),
    path: FlowFile,
    /** What the trigger hands the first step, as its `body`. */
    payload: z.unknown().optional(),
    seconds: z.number().int().min(5).max(900).optional(),
    /** What the browser has, so the run waits until the sandbox has it too. */
    stateVector: z.string().max(4_000_000).optional(),
    /** "step": only `step` runs, with `sampleData` (each other step's output, by name) standing in for the rest. "retry": carries on from where `retryOf` stopped. */
    mode: z.enum(["run", "step", "retry"]).optional(),
    step: z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "That isn't a step.").optional(),
    sampleData: z.record(z.string(), z.unknown()).optional(),
    retryOf: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.").optional(),
    /** The flow's own id: a run started by a trigger finds the flow by it if its file has moved. */
    flowId: z.string().min(1).max(100).optional(),
    /** What a webhook was sent along with its body. */
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    /** What started it: shown with the run. */
    trigger: z.enum(["manual", "webhook", "schedule", "event"]).optional(),
  }),
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("runs"), path: FlowFile.optional() }),
  z.object({ op: z.literal("run-details"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.") }),
  z.object({ op: z.literal("manifest") }),
]);
export type AutomationInput = z.infer<typeof AutomationInput>;

export type AutomationStepResult = { type: string; status: string; input?: unknown; output?: unknown; errorMessage?: string; duration?: number };
export type AutomationRunSummary = { id: string; path: string; flowId?: string | null; mode?: "run" | "step" | "retry"; step?: string | null; retryOf?: string | null; name: string; trigger: string; by: string | null; status: string; message: string | null; startedAt: number; finishedAt: number | null; durationMs?: number };
export type AutomationRun = AutomationRunSummary & { steps: Record<string, AutomationStepResult>; failedStep?: { name: string; displayName?: string; message?: string }; payload?: unknown; /** Steps that gave back what was pinned on them rather than running. */ pinned?: string[] };
export type AutomationLive = (Partial<AutomationRun> & { state: "idle" | "running" | "finished"; id: string | null; steps: Record<string, AutomationStepResult>; queued: number });

/**
 * Starting by itself: a flow turned on has a trigger, kept with its room (apps/api/src/automations). A webhook's address is a secret: whoever has it can start
 * the flow, so it can be replaced, and only people who can run code in the room see it.
 */
export const TRIGGER_KINDS = ["webhook"] as const;
export const MOST_TRIGGERS = 10;
export const AutomationTriggerInput = z.object({
  path: FlowFile,
  flowId: z.string().min(1).max(100),
  kind: z.enum(TRIGGER_KINDS),
  /** "now": answer at once with the run's id. "finished": wait for the run (up to 30 seconds) and answer with what its last step gave. */
  respond: z.enum(["now", "finished"]).default("now"),
});
export type AutomationTriggerInput = z.infer<typeof AutomationTriggerInput>;
export const AutomationTriggerPatch = z.object({ enabled: z.boolean().optional(), respond: z.enum(["now", "finished"]).optional(), path: FlowFile.optional() });
export type AutomationTriggerPatch = z.infer<typeof AutomationTriggerPatch>;
export type AutomationTrigger = {
  id: string;
  kind: (typeof TRIGGER_KINDS)[number];
  flowId: string;
  path: string;
  enabled: boolean;
  respond: "now" | "finished";
  /** Where to send things to start it, and to try it without running it. */
  url: string | null;
  testUrl: string | null;
  createdBy: string | null;
  createdAt: number;
  lastRunAt: number | null;
  lastRunId: string | null;
};
/** What a test call to a webhook was sent, for setting a flow up with real data. */
export type AutomationTestEvent = { body: unknown; headers: Record<string, string>; query: Record<string, string>; method: string; at: number };

export type PieceField = { type: string; label: string; description: string; required: boolean; default?: unknown; options?: Array<{ label: string; value: unknown }>; fields?: Record<string, PieceField> };
export type PieceStep = { label: string; description: string; needsAuth: boolean; fields: Record<string, PieceField>; kind?: string };
export type PieceInfo = { label: string; description: string; version: string; categories: string[]; auth: { type: string; label: string; description: string; fields: Record<string, PieceField> } | null; actions: Record<string, PieceStep>; triggers: Record<string, PieceStep> };
export type AutomationManifest = { pieces: Record<string, PieceInfo> };
