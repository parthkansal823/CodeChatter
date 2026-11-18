/**
 * Automations: flows in a room's files, in Activepieces' own format, run in its sandbox by Activepieces' real engine and pieces (MIT). There's no Activepieces server,
 * so a room's connections never leave its own sandbox, and it costs nothing. The chart and editor are our own.
 */
import { z } from "zod";

import { CALLED_FLOW_EVENT, ERROR_FLOW_EVENT, isRoomEvent, pathsProblem, type RoomEventSettings } from "./room-events.js";
import { scheduleProblem } from "./schedule.js";

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
    /** Where a run waiting for a call is resumed from outside: set by the API, never taken from a browser (RunnerClient). */
    resumeBase: z.string().url().max(300).optional(),
  }),
  /**
   * A run waiting (a Delay, or "Respond and wait for the next webhook"), carried on from where it stopped. One waiting for a call needs the token in its
   * address; one waiting for a time doesn't, so the API (or a person, early) can carry it on.
   */
  z.object({ op: z.literal("resume"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run."), token: z.string().max(100).optional(), payload: z.unknown().optional() }),
  /** The runs waiting in the room, for the API's timer. Looking doesn't wake a room. */
  z.object({ op: z.literal("waits") }),
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("runs"), path: FlowFile.optional() }),
  z.object({ op: z.literal("run-details"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.") }),
  z.object({ op: z.literal("manifest") }),
]);
export type AutomationInput = z.infer<typeof AutomationInput>;

export type AutomationStepResult = { type: string; status: string; input?: unknown; output?: unknown; errorMessage?: string; duration?: number };
/** What a waiting run waits for: a time, or a call to its address (its token is never shown). */
export type AutomationWaitpoint = { type: "DELAY" | "WEBHOOK"; step: string; resumeAt: number | null };
export type AutomationRunSummary = { id: string; path: string; flowId?: string | null; mode?: "run" | "step" | "retry" | "resume"; waitpoint?: AutomationWaitpoint | null; step?: string | null; retryOf?: string | null; /** A failed run that started its flow's error flow: that run, or why it couldn't. */ errorRun?: string | null; errorProblem?: string | null; name: string; trigger: string; by: string | null; status: string; message: string | null; startedAt: number; finishedAt: number | null; durationMs?: number };
export type AutomationRun = AutomationRunSummary & { steps: Record<string, AutomationStepResult>; failedStep?: { name: string; displayName?: string; message?: string }; payload?: unknown; /** Steps that gave back what was pinned on them rather than running. */ pinned?: string[] };
export type AutomationLive = (Partial<AutomationRun> & { state: "idle" | "running" | "finished"; id: string | null; steps: Record<string, AutomationStepResult>; queued: number });

/**
 * Starting by itself: a flow turned on has a trigger, kept with its room (apps/api/src/automations). A webhook's address is a secret: whoever has it can start
 * the flow, so it can be replaced, and only people who can run code in the room see it.
 */
export const TRIGGER_KINDS = ["webhook", "schedule", "event"] as const;
export const MOST_TRIGGERS = 10;
/** When a flow on a schedule runs: a cron expression on a timezone's clock (`schedule.ts`), worked out from its trigger's settings. */
export const ScheduleInput = z
  .object({ cron: z.string().trim().min(1).max(200), timezone: z.string().min(1).max(64) })
  .superRefine((schedule, context) => {
    const problem = scheduleProblem(schedule);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
/** What a flow on a room event listens for (room-events.ts). */
export const RoomEventInput = z
  .object({
    event: z
      .string()
      .refine(isRoomEvent, "That isn't something that happens in a room.")
      .refine((event) => event !== ERROR_FLOW_EVENT, "An error flow isn't turned on: choose it under \"If it fails, run\" on the flow it's for.")
      .refine((event) => event !== CALLED_FLOW_EVENT, "A flow called by others isn't turned on: choose it in another flow's \"Call a flow\" step."),
    paths: z.string().max(4000).optional(),
  })
  .superRefine((input, context) => {
    const problem = pathsProblem(input.paths);
    if (problem) context.addIssue({ code: "custom", message: problem, path: ["paths"] });
  })
  .transform((input): RoomEventSettings => (input.event === "files.changed" && input.paths?.trim() ? { event: input.event, paths: input.paths.trim() } : { event: input.event as RoomEventSettings["event"] }));
export const AutomationTriggerInput = z
  .object({
    path: FlowFile,
    flowId: z.string().min(1).max(100),
    kind: z.enum(TRIGGER_KINDS),
    /** "now": answer at once with the run's id. "finished": wait for the run (up to 30 seconds) and answer with what its last step gave. */
    respond: z.enum(["now", "finished"]).default("now"),
    schedule: ScheduleInput.optional(),
    event: RoomEventInput.optional(),
  })
  .refine((input) => (input.kind === "schedule") === Boolean(input.schedule), { message: "A schedule needs a time to run, and only a schedule has one.", path: ["schedule"] })
  .refine((input) => (input.kind === "event") === Boolean(input.event), { message: "A room event needs what to listen for, and only a room event has it.", path: ["event"] });
export type AutomationTriggerInput = z.infer<typeof AutomationTriggerInput>;
/** What a call to a webhook must show besides its address (apps/api/src/automations/hook-auth.ts). Secrets go in, and never come back out. */
const HeaderName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,64}$/, "A header's name is letters, digits and dashes.")
  .refine((name) => !["cookie", "host", "content-length", "content-type", "authorization"].includes(name.toLowerCase()), "Choose another header: that one is the browser's or the server's.");
const Secret = z.string().min(8, "Make the secret at least 8 characters.").max(512);
export const AutomationHookAuthInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("header"), header: HeaderName, value: Secret }),
  z.object({ kind: z.literal("basic"), user: z.string().trim().min(1).max(100).refine((user) => !user.includes(":"), "A user name can't have a colon in it."), password: Secret }),
  z.object({ kind: z.literal("signature"), header: HeaderName.default("X-Hub-Signature-256"), prefix: z.string().max(40).default("sha256="), secret: Secret }),
]);
export type AutomationHookAuthInput = z.infer<typeof AutomationHookAuthInput>;
export const AutomationTriggerPatch = z.object({ enabled: z.boolean().optional(), respond: z.enum(["now", "finished"]).optional(), path: FlowFile.optional(), schedule: ScheduleInput.optional(), event: RoomEventInput.optional(), auth: AutomationHookAuthInput.optional() });
export type AutomationTriggerPatch = z.infer<typeof AutomationTriggerPatch>;
export type AutomationTrigger = {
  id: string;
  kind: (typeof TRIGGER_KINDS)[number];
  flowId: string;
  path: string;
  enabled: boolean;
  respond: "now" | "finished";
  /** Where to send things to start it, and to try it without running it: a webhook's only. */
  url: string | null;
  testUrl: string | null;
  /** A schedule's only: when it runs, and next will. */
  schedule: { cron: string; timezone: string } | null;
  nextRunAt: number | null;
  /** A room event's only: what it listens for. */
  event: RoomEventSettings | null;
  /** A webhook's only: what a call must show besides the address, without its secret. */
  auth: { kind: "none" | "header" | "basic" | "signature"; header?: string; user?: string; prefix?: string } | null;
  /** Why it stopped by itself, such as its flow no longer starting on a schedule. */
  problem: string | null;
  createdBy: string | null;
  createdAt: number;
  lastRunAt: number | null;
  lastRunId: string | null;
};
/** What a test call to a webhook was sent, for setting a flow up with real data. */
export type AutomationTestEvent = { body: unknown; headers: Record<string, string>; query: Record<string, string>; method: string; at: number; /** Whether it showed what the live address would ask for, and why not. */ authorized?: boolean; why?: string | null };

export type PieceField = { type: string; label: string; description: string; required: boolean; default?: unknown; options?: Array<{ label: string; value: unknown }>; fields?: Record<string, PieceField> };
export type PieceStep = { label: string; description: string; needsAuth: boolean; fields: Record<string, PieceField>; kind?: string };
export type PieceInfo = { label: string; description: string; version: string; categories: string[]; auth: { type: string; label: string; description: string; fields: Record<string, PieceField> } | null; actions: Record<string, PieceStep>; triggers: Record<string, PieceStep> };
export type AutomationManifest = { pieces: Record<string, PieceInfo> };
