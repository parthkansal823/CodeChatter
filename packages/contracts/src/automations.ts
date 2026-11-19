/**
 * Automations: flows in a room's files, in Activepieces' own format, run in its sandbox by Activepieces' real engine and pieces (MIT). There's no Activepieces server,
 * so a room's connections never leave its own sandbox, and it costs nothing. The chart and editor are our own.
 */
import { z } from "zod";

import { CALLED_FLOW_EVENT, ERROR_FLOW_EVENT, isRoomEvent, keptRoomEvent, pathsProblem, startsWithProblem, type RoomEventSettings } from "./room-events.js";
import { scheduleProblem } from "./schedule.js";
import { RunVariables } from "./variables.js";

/** Flows live in the room's files, so they're edited together, versioned, and can leave. */
export const AUTOMATION_SUFFIX = ".flow.json";
export const isFlowFile = (name: string) => name.toLowerCase().endsWith(AUTOMATION_SUFFIX);

const FlowFile = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => isFlowFile(path) && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "That isn't a flow in this room.");

/**
 * A connection's sign-in, as Activepieces keeps one (its AppConnectionValue): a secret (an API key, a token), a user and password, or a piece's own fields
 * (a database's host, port, user and password). OAuth2 comes later.
 */
export const ConnectionValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SECRET_TEXT"), secret_text: z.string().min(1, "Give the secret.").max(8192) }),
  z.object({ type: z.literal("BASIC_AUTH"), username: z.string().max(512), password: z.string().max(8192) }),
  z.object({
    type: z.literal("CUSTOM_AUTH"),
    props: z.record(z.string().max(100), z.union([z.string().max(16_384), z.number(), z.boolean(), z.null()])).refine((props) => Object.keys(props).length <= 30, "Up to 30 fields."),
  }),
]);
export type ConnectionValue = z.infer<typeof ConnectionValue>;
/** What a run is given of the room's connections, by name: set by the API (apps/api/src/automations/connections.ts), never taken from a browser. */
const RunConnections = z.record(z.string().max(60), z.object({ piece: z.string().max(100), value: ConnectionValue })).optional();
/** The hosts the room's automations may reach (its Internet settings): set by the API, never taken from a browser. */
const RunInternet = z.array(z.string().max(253)).max(100).optional();

export const AutomationInput = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("run"),
    path: FlowFile,
    /** What the trigger hands the first step, as its `body`. */
    payload: z.unknown().optional(),
    seconds: z.number().int().min(5).max(900).optional(),
    /** What the browser has, so the run waits until the sandbox has it too. */
    stateVector: z.string().max(4_000_000).optional(),
    /**
     * "step": only `step` runs, with `sampleData` (each other step's output, by name) standing in for the rest. "retry": carries on from where `retryOf`
     * stopped. "from": `step` and everything after it run, with what `retryOf`'s steps before it gave (n8n's partial run).
     */
    mode: z.enum(["run", "step", "retry", "from"]).optional(),
    step: z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "That isn't a step.").optional(),
    sampleData: z.record(z.string(), z.unknown()).optional(),
    retryOf: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.").optional(),
    /** The flow's own id: a run started by a trigger finds the flow by it if its file has moved. */
    flowId: z.string().min(1).max(100).optional(),
    /** What a webhook was sent along with its body. */
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    /** What started it: shown with the run. */
    trigger: z.enum(["manual", "webhook", "schedule", "event", "poll"]).optional(),
    /** Where a run waiting for a call is resumed from outside: set by the API, never taken from a browser (RunnerClient). */
    resumeBase: z.string().url().max(300).optional(),
    connections: RunConnections,
    internet: RunInternet,
    variables: RunVariables,
  }),
  /**
   * A run waiting (a Delay, or "Respond and wait for the next webhook"), carried on from where it stopped. One waiting for a call needs the token in its
   * address; one waiting for a time doesn't, so the API (or a person, early) can carry it on.
   */
  z.object({ op: z.literal("resume"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run."), token: z.string().max(100).optional(), payload: z.unknown().optional(), connections: RunConnections, internet: RunInternet, variables: RunVariables }),
  /** The runs waiting in the room, for the API's timer. Looking doesn't wake a room. */
  z.object({ op: z.literal("waits") }),
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("runs"), path: FlowFile.optional() }),
  z.object({ op: z.literal("run-details"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.") }),
  /** A file a run's step made (File Helper's, a CSV file, Read files'), kept with the run: its name and its bytes as base64. */
  z.object({ op: z.literal("run-file"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run."), file: z.string().regex(/^[\w-]{1,64}$/, "That isn't a file.") }),
  z.object({ op: z.literal("manifest") }),
]);
export type AutomationInput = z.infer<typeof AutomationInput>;

const PIECE_NAME = z.string().regex(/^@activepieces\/piece-[a-z0-9-]{1,60}$/, "That isn't a piece.");
/** What the API asks the runner beyond a browser's ops: whether a connection's details work (the piece's own check, in the sandbox). */
export const AutomationRunnerInput = z.union([
  AutomationInput,
  z.object({ op: z.literal("test-connection"), piece: PIECE_NAME, value: ConnectionValue, internet: RunInternet }),
  /** A flow's polling trigger (a service's new items): its hooks, as Activepieces' server calls them, from the API's timer and the trigger's panel. */
  z.object({
    op: z.literal("poll"),
    path: FlowFile,
    flowId: z.string().min(1).max(100).optional(),
    hook: z.enum(["ON_ENABLE", "RUN", "ON_DISABLE", "TEST"]),
    connections: RunConnections,
    internet: RunInternet,
    variables: RunVariables,
    resumeBase: z.string().url().max(300).optional(),
  }),
]);
export type AutomationRunnerInput = z.infer<typeof AutomationRunnerInput>;

/**
 * The hosts each piece calls, for the Internet dialog: the room's owner turns a service on, and the room's proxy lets its hosts through (HTTPS only, by
 * name, exactly). `own` asks for a host of the person's own (their Jira, their feeds). Not through the proxy: SMTP, and databases outside the room.
 */
export const PIECE_HOSTS: Record<string, { hosts: string[]; own?: string }> = {
  "@activepieces/piece-github": { hosts: ["api.github.com", "github.com", "uploads.github.com", "raw.githubusercontent.com"] },
  "@activepieces/piece-gitlab": { hosts: ["gitlab.com"], own: "Your GitLab's host, if it isn't gitlab.com" },
  "@activepieces/piece-slack": { hosts: ["slack.com", "api.slack.com", "files.slack.com", "hooks.slack.com"] },
  "@activepieces/piece-discord": { hosts: ["discord.com", "cdn.discordapp.com"] },
  "@activepieces/piece-telegram-bot": { hosts: ["api.telegram.org"] },
  "@activepieces/piece-openai": { hosts: ["api.openai.com"] },
  "@activepieces/piece-notion": { hosts: ["api.notion.com"] },
  "@activepieces/piece-linear": { hosts: ["api.linear.app"] },
  "@activepieces/piece-jira-cloud": { hosts: [], own: "Your Jira's host, as in your-team.atlassian.net" },
  "@activepieces/piece-confluence": { hosts: [], own: "Your Confluence's host, as in your-team.atlassian.net" },
  "@activepieces/piece-trello": { hosts: ["api.trello.com"] },
  "@activepieces/piece-asana": { hosts: ["app.asana.com"] },
  "@activepieces/piece-clickup": { hosts: ["api.clickup.com"] },
  "@activepieces/piece-airtable": { hosts: ["api.airtable.com"] },
  "@activepieces/piece-sendgrid": { hosts: ["api.sendgrid.com"] },
  "@activepieces/piece-datadog": { hosts: ["api.datadoghq.com", "api.datadoghq.eu", "api.us3.datadoghq.com", "api.us5.datadoghq.com"] },
  "@activepieces/piece-pagerduty": { hosts: ["api.pagerduty.com", "events.pagerduty.com"] },
  "@activepieces/piece-vercel": { hosts: ["api.vercel.com"] },
  "@activepieces/piece-netlify": { hosts: ["api.netlify.com"] },
  "@activepieces/piece-supabase": { hosts: [], own: "Your project's host, as in your-project.supabase.co" },
  "@activepieces/piece-hackernews": { hosts: ["hacker-news.firebaseio.com"] },
  "@activepieces/piece-amazon-s3": { hosts: ["s3.amazonaws.com"], own: "Your bucket's host, as in your-bucket.s3.eu-west-1.amazonaws.com" },
  "@activepieces/piece-rss": { hosts: [], own: "The feeds' hosts" },
  "@activepieces/piece-http": { hosts: [], own: "The hosts it calls" },
  "@activepieces/piece-graphql": { hosts: [], own: "The GraphQL server's host" },
};
const HOST_NAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const PRIVATE_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|svc|cluster\.local|home\.arpa)$/;
/** A host as kept: lower case, without a trailing dot. */
export const hostOf = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");
/** Why a host can't be on a room's internet list, or null: a public name only, never an address, a port or a private name. */
export function hostProblem(host: string): string | null {
  const name = hostOf(host);
  if (/^\d+(\.\d+){3}$/.test(name) || name.includes(":") || name.includes("[")) return `${host}: give its name, not an address or a port.`;
  if (name.includes("/") || name.includes("*")) return `${host}: just the host's name, such as api.example.com, with no path or wildcard.`;
  if (!HOST_NAME.test(name)) return `${host} isn't a host's name, such as api.example.com.`;
  if (PRIVATE_NAME.test(name)) return `${host} is a private name: a room reaches only the internet's.`;
  return null;
}
export const MOST_INTERNET_HOSTS = 100;
/** Every host a room's automations may reach: its services' and the ones named. */
export function internetHostsOf(services: readonly string[], hosts: readonly string[]): string[] {
  return [...new Set([...services.flatMap((service) => PIECE_HOSTS[service]?.hosts ?? []), ...hosts.map(hostOf)])].sort().slice(0, MOST_INTERNET_HOSTS);
}
export const AutomationInternetInput = z
  .object({ services: z.array(PIECE_NAME).max(60).default([]), hosts: z.array(z.string().max(253)).max(50, "Up to 50 hosts of your own.").default([]) })
  .superRefine((input, context) => {
    for (const service of input.services) if (!Object.hasOwn(PIECE_HOSTS, service)) context.addIssue({ code: "custom", message: `${service} has no hosts to turn on: name its hosts instead.`, path: ["services"] });
    for (const host of input.hosts) {
      const problem = hostProblem(host);
      if (problem) context.addIssue({ code: "custom", message: problem, path: ["hosts"] });
    }
  })
  .transform((input) => ({ services: [...new Set(input.services)].sort(), hosts: [...new Set(input.hosts.map(hostOf))].sort() }));
export type AutomationInternetInput = z.infer<typeof AutomationInternetInput>;
/** What a room's automations may reach, as anyone who can run its code sees it: the services and hosts turned on, every host that comes to, and who. */
export type AutomationInternet = { services: string[]; hosts: string[]; on: string[]; by: string | null; at: number | null };

/** A connection's name, as flows use it: {{connections['room-db']}}. */
export const CONNECTION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
export const MOST_CONNECTIONS = 50;
export const AutomationConnectionInput = z.object({
  name: z.string().regex(CONNECTION_NAME, "A name is letters, digits, dashes and underscores, such as room-db."),
  piece: PIECE_NAME,
  value: ConnectionValue,
  /** Its fields that aren't secret (a host, a user), to show again: the piece's own description says which. Passwords and keys are never shown, whatever this says. */
  shown: z.array(z.string().max(100)).max(30).optional(),
});
export type AutomationConnectionInput = z.infer<typeof AutomationConnectionInput>;
/** A connection as anyone in the room sees it: never its secrets. */
export type AutomationConnection = {
  name: string;
  piece: string;
  type: ConnectionValue["type"];
  shown: Record<string, string | number | boolean | null>;
  createdBy: { id: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
  lastTest: { valid: boolean; error: string | null; at: number } | null;
};
/** How a step names a connection, in Activepieces' own words. */
export const connectionExpression = (name: string) => `{{connections['${name}']}}`;
/** The connection a step's auth names, if it names one. */
export function connectionNameOf(auth: unknown): string | null {
  const match = typeof auth === "string" ? /^\{\{\s*connections\[['"]([^'"\]]+)['"]\]\s*\}\}$/.exec(auth.trim()) : null;
  return match ? match[1]! : null;
}
/** Fields never shown again, whatever a browser says: passwords, keys, tokens, certificates. */
export const SECRET_FIELD = /pass|secret|token|key|auth|cred|cert|private|pwd/i;
/** What's shown of a connection: a user name, and its fields named as not secret that don't look secret either. */
export function shownOf(value: ConnectionValue, fields: readonly string[] = []): AutomationConnection["shown"] {
  if (value.type === "BASIC_AUTH") return { username: value.username.slice(0, 200) };
  if (value.type === "SECRET_TEXT") return {};
  const out: AutomationConnection["shown"] = {};
  for (const name of fields) {
    if (SECRET_FIELD.test(name) || !Object.hasOwn(value.props, name)) continue;
    const field = value.props[name]!;
    out[name] = typeof field === "string" ? field.slice(0, 200) : field;
  }
  return out;
}

export type AutomationStepResult = { type: string; status: string; input?: unknown; output?: unknown; errorMessage?: string; duration?: number };
/** What a waiting run waits for: a time, or a call to its address (its token is never shown). */
export type AutomationWaitpoint = { type: "DELAY" | "WEBHOOK"; step: string; resumeAt: number | null };
export type AutomationRunSummary = { id: string; path: string; flowId?: string | null; mode?: "run" | "step" | "retry" | "resume" | "from"; waitpoint?: AutomationWaitpoint | null; step?: string | null; retryOf?: string | null; /** A failed run that started its flow's error flow: that run, or why it couldn't. */ errorRun?: string | null; errorProblem?: string | null; /** What it kept to be found by (Save run data): up to 10 names and text. */ data?: Record<string, string> | null; name: string; trigger: string; by: string | null; status: string; message: string | null; startedAt: number; finishedAt: number | null; durationMs?: number };
export type AutomationRun = AutomationRunSummary & { steps: Record<string, AutomationStepResult>; failedStep?: { name: string; displayName?: string; message?: string }; payload?: unknown; /** Steps that gave back what was pinned on them rather than running. */ pinned?: string[] };
export type AutomationLive = (Partial<AutomationRun> & { state: "idle" | "running" | "finished"; id: string | null; steps: Record<string, AutomationStepResult>; queued: number });

/**
 * Starting by itself: a flow turned on has a trigger, kept with its room (apps/api/src/automations). A webhook's address is a secret: whoever has it can start
 * the flow, so it can be replaced, and only people who can run code in the room see it.
 */
export const TRIGGER_KINDS = ["webhook", "schedule", "event", "poll"] as const;
/** How often a polling trigger looks for new items: every minute at most, once a day at least. */
export const PollInput = z.object({ everyMinutes: z.number().int().min(1, "At least every minute.").max(1440, "At most once a day (1440 minutes).") });
export type PollSettings = z.infer<typeof PollInput>;
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
    startsWith: z.string().max(400).optional(),
  })
  .superRefine((input, context) => {
    const problem = pathsProblem(input.paths);
    if (problem) context.addIssue({ code: "custom", message: problem, path: ["paths"] });
    const start = startsWithProblem(input.startsWith);
    if (start) context.addIssue({ code: "custom", message: start, path: ["startsWith"] });
  })
  .transform((input): RoomEventSettings => keptRoomEvent(input as RoomEventSettings));
export const AutomationTriggerInput = z
  .object({
    path: FlowFile,
    flowId: z.string().min(1).max(100),
    kind: z.enum(TRIGGER_KINDS),
    /** "now": answer at once with the run's id. "finished": wait for the run (up to 30 seconds) and answer with what its last step gave. */
    respond: z.enum(["now", "finished"]).default("now"),
    schedule: ScheduleInput.optional(),
    event: RoomEventInput.optional(),
    poll: PollInput.optional(),
  })
  .refine((input) => (input.kind === "schedule") === Boolean(input.schedule), { message: "A schedule needs a time to run, and only a schedule has one.", path: ["schedule"] })
  .refine((input) => (input.kind === "poll") === Boolean(input.poll), { message: "Looking for new items needs how often, and only that has it.", path: ["poll"] })
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
export const AutomationTriggerPatch = z.object({ enabled: z.boolean().optional(), respond: z.enum(["now", "finished"]).optional(), path: FlowFile.optional(), schedule: ScheduleInput.optional(), event: RoomEventInput.optional(), auth: AutomationHookAuthInput.optional(), poll: PollInput.optional() });
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
  /** A polling trigger's only: how often it looks for new items (and nextRunAt, when it next will). */
  poll: PollSettings | null;
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
