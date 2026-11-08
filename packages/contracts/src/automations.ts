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
  }),
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("runs"), path: FlowFile.optional() }),
  z.object({ op: z.literal("run-details"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.") }),
  z.object({ op: z.literal("manifest") }),
]);
export type AutomationInput = z.infer<typeof AutomationInput>;

export type AutomationStepResult = { type: string; status: string; input?: unknown; output?: unknown; errorMessage?: string; duration?: number };
export type AutomationRunSummary = { id: string; path: string; flowId?: string | null; name: string; trigger: string; by: string | null; status: string; message: string | null; startedAt: number; finishedAt: number | null; durationMs?: number };
export type AutomationRun = AutomationRunSummary & { steps: Record<string, AutomationStepResult>; failedStep?: { name: string; displayName?: string; message?: string }; payload?: unknown };
export type AutomationLive = (Partial<AutomationRun> & { state: "idle" | "running" | "finished"; id: string | null; steps: Record<string, AutomationStepResult>; queued: number });

export type PieceField = { type: string; label: string; description: string; required: boolean; default?: unknown; options?: Array<{ label: string; value: unknown }>; fields?: Record<string, PieceField> };
export type PieceStep = { label: string; description: string; needsAuth: boolean; fields: Record<string, PieceField>; kind?: string };
export type PieceInfo = { label: string; description: string; version: string; categories: string[]; auth: { type: string; label: string; description: string; fields: Record<string, PieceField> } | null; actions: Record<string, PieceStep>; triggers: Record<string, PieceStep> };
export type AutomationManifest = { pieces: Record<string, PieceInfo> };
