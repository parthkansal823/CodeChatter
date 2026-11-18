/**
 * Automations started by what happens in their room: files changing, a Run or tests failing, a commit, a chat message, a pull request opened, someone let in.
 * n8n has nothing like it, as it isn't an IDE. Files changing is seen by collab (apps/collab/src/extensions/automation-events.ts); Runs, tests and the chat by
 * the API (realtime/events.gateway.ts, judge/judge.controller.ts); commits in the sandbox by its agent, through the runner (sandbox/agent/src/git-log.ts); the
 * rest come from the audit log (AuditService). All are queued in Valkey and run by the API (apps/api/src/automations). In the flow file the trigger is Activepieces' webhook trigger with a `room` setting, so the
 * engine runs it as it is, and taken to Activepieces it's still a webhook something can call.
 */

export const ROOM_EVENT_CARRIER = { pieceName: "@activepieces/piece-webhook", triggerName: "catch_webhook" } as const;

export const ROOM_EVENTS = {
  "files.changed": { label: "Files change", about: "Someone adds, edits, renames, moves or deletes files. What the room's own runs change doesn't count, so a flow can't set itself off." },
  "run.failed": { label: "A run fails", about: "Someone's Run ends with an error, runs out of time or prints too much. Stopping it doesn't count. The flow gets the file, how it ended and the end of its output." },
  "run.finished": { label: "A run finishes", about: "Someone's Run ends, however it ends, with the file, how it ended and the end of its output." },
  "tests.failed": { label: "Tests fail", about: "Someone runs a file's tests in the Tests tab and one doesn't pass, or the file doesn't compile. The flow gets each test's result." },
  "tests.finished": { label: "Tests are run", about: "Someone runs a file's tests in the Tests tab, whatever the result. The flow gets each test's result." },
  "git.commit": { label: "A commit is made in the sandbox", about: "Someone commits with git in a terminal, or with Git in the sandbox in Source control. The flow gets the branch and each commit's message and author." },
  "chat.message": { label: "A chat message", about: "Someone posts in the room's chat. Choose what it starts with, such as /deploy, to make it a command." },
  "repo.commit": { label: "A commit is pushed", about: "Someone commits and pushes from Source control." },
  "repo.pull-request": { label: "A pull request is opened", about: "Someone opens a pull request from Source control." },
  "repo.publish": { label: "The room is published to GitHub", about: "Someone makes a GitHub repository of the room." },
  "room.member.approve": { label: "Someone is let in", about: "An owner lets someone who asked into the room." },
  "room.member.leave": { label: "Someone leaves", about: "Someone leaves the room." },
  "room.update": { label: "The room's settings change", about: "Its name, description or who can see it." },
  "sandbox.image": { label: "The sandbox's image changes", about: "Someone switches the room to another sandbox image." },
  // Not turned on like the rest: a flow names this one as its error flow, and its failing runs it, in the sandbox (n8n's Error Trigger).
  // The same: another flow calls this one with "Call a flow" (n8n's Execute Workflow Trigger), so only flows that start on this can be called.
  "flow.called": { label: "Called by another flow", about: "Another flow runs this one with its \"Call a flow\" step, with what it sends, and gets back what this one's last step gives." },
  "flow.failed": { label: "Another flow fails", about: "A flow that names this one under \"If it fails, run\" fails or takes too long. It gets the run, its error and the flow, as n8n's Error Trigger gives them." },
} as const;
export type RoomEventName = keyof typeof ROOM_EVENTS;
export const ROOM_EVENT_NAMES = Object.keys(ROOM_EVENTS) as RoomEventName[];
export const isRoomEvent = (name: unknown): name is RoomEventName => typeof name === "string" && Object.hasOwn(ROOM_EVENTS, name);
/** The event that runs a flow as another's error flow: chosen on the failing flow, so there's nothing to turn on. */
export const ERROR_FLOW_EVENT = "flow.failed" satisfies RoomEventName;
/** The event a flow starts on to be called by others: chosen in the calling step, so there's nothing to turn on either. */
export const CALLED_FLOW_EVENT = "flow.called" satisfies RoomEventName;
/** Room events that start a flow from another flow, in the sandbox, rather than being turned on. */
export const FLOW_TO_FLOW_EVENTS: readonly RoomEventName[] = [ERROR_FLOW_EVENT, CALLED_FLOW_EVENT];

/** Events about files: files changing, and a Run or tests, of one file. A flow can listen for some files only (globs). */
export const PATH_EVENTS: readonly RoomEventName[] = ["files.changed", "run.failed", "run.finished", "tests.failed", "tests.finished"];
export const hasPaths = (event: RoomEventName): boolean => PATH_EVENTS.includes(event);
/** The chat's event: a flow can listen only for messages that start with something, as a command. */
export const CHAT_EVENT = "chat.message" satisfies RoomEventName;

/**
 * What a flow on a room event listens for: the event; for files, a Run or tests, which files (globs, one a line or comma-separated; nothing means all); for
 * the chat, what a message starts with (nothing means every message).
 */
export type RoomEventSettings = { event: RoomEventName; paths?: string; startsWith?: string };

/** The room setting on a flow's trigger, if it's a room event's. What was typed is kept as it is; the API keeps it trimmed (keptRoomEvent). */
export function roomEventOf(settings: unknown): RoomEventSettings | null {
  const room = (settings as { room?: unknown } | null)?.room as { event?: unknown; paths?: unknown; startsWith?: unknown } | undefined;
  if (!room || !isRoomEvent(room.event)) return null;
  const paths = hasPaths(room.event) && typeof room.paths === "string" && room.paths.trim() ? room.paths : undefined;
  const startsWith = room.event === CHAT_EVENT && typeof room.startsWith === "string" && room.startsWith.trim() ? room.startsWith : undefined;
  return { event: room.event, ...(paths !== undefined && { paths }), ...(startsWith !== undefined && { startsWith }) };
}

/** Settings as the API keeps them: only what the event takes, trimmed, and nothing when it's empty. */
export function keptRoomEvent(settings: RoomEventSettings): RoomEventSettings {
  const paths = hasPaths(settings.event) ? settings.paths?.trim() : undefined;
  const startsWith = settings.event === CHAT_EVENT ? settings.startsWith?.trim() : undefined;
  return { event: settings.event, ...(paths && { paths }), ...(startsWith && { startsWith }) };
}

/** The events a queued one is: a Run or tests that failed are listened for as finished and as failed. */
export function eventNamesOf(event: { event: RoomEventName; data?: Record<string, unknown> }): RoomEventName[] {
  if (event.event === "run.finished" && event.data?.failed === true) return ["run.finished", "run.failed"];
  if (event.event === "tests.finished" && event.data?.failed === true) return ["tests.finished", "tests.failed"];
  return [event.event];
}

/**
 * Whether a chat message is one a flow listens for, and what follows the start it listens for (a command's arguments); with no start, every message is,
 * all of it. Case doesn't matter, and a start ending in a letter or digit must end a word: "/deploy" isn't "/deployment".
 */
export function chatCommandOf(text: string, startsWith: string | undefined): { args: string } | null {
  const message = text.trimStart();
  const start = startsWith?.trim();
  if (!start) return { args: message.trim() };
  if (message.slice(0, start.length).toLowerCase() !== start.toLowerCase()) return null;
  const rest = message.slice(start.length);
  if (/[\p{L}\p{N}_]$/u.test(start) && rest && !/^\s/.test(rest)) return null;
  return { args: rest.trim() };
}

/** Why a chat start can't be used, or null. */
export function startsWithProblem(startsWith: string | undefined): string | null {
  const start = startsWith?.trim() ?? "";
  if (start.length > 100) return "Up to 100 characters.";
  if (/[\r\n]/.test(start)) return "One line: what a message starts with.";
  return null;
}

/** What a flow on a Run is given as `data` (from the API, as the run ends). */
export type RunEventData = { path: string; command: string; runId: string; code: number | null; reason: string; durationMs: number; failed: boolean; output: string };
/** What a flow on tests is given as `data` (from the API, as the Tests tab's run ends). */
export type TestsEventData = {
  path: string;
  passed: number;
  total: number;
  failed: boolean;
  compileError?: string;
  error?: string;
  cases: Array<{ index: number; verdict: string; timeMs: number; stdout: string; stderr: string }>;
};
/** One commit in the sandbox's git, from its reflog (sandbox/agent/src/git-log.ts). */
export type SandboxCommit = { commit: string; parent: string | null; kind: "commit" | "initial" | "amend" | "merge" | "cherry-pick" | "revert"; message: string; author: { name: string; email: string }; at: string };
/** What a flow on a commit in the sandbox is given as `data`. */
export type GitEventData = { branch: string | null; commits: SandboxCommit[] };
/** What a flow on a chat message is given as `data`: the message, and what follows the start it listens for. */
export type ChatEventData = { id: string; text: string; args: string };

export type FileChange = "added" | "changed" | "renamed" | "moved" | "deleted" | "restored";
export type ChangedFile = { path: string; kind: "file" | "folder"; change: FileChange; from?: string };
export type RoomEventPerson = { id: string | null; name: string };
/** What a flow on a room event is given. */
export type RoomEventPayload = { event: RoomEventName; at: string; by: RoomEventPerson[]; files?: ChangedFile[]; more?: number; data?: Record<string, unknown> };
/** What collab and the audit log queue for the API (Valkey list `automations:events`). */
export type QueuedRoomEvent = { room: string; event: RoomEventName; at: number; by: RoomEventPerson[] | string[]; files?: ChangedFile[]; more?: number; data?: Record<string, unknown> };
export const ROOM_EVENTS_QUEUE = "automations:events";

/** One glob as a regular expression: `**` any folders, `*` and `?` within a name, `{a,b}` either. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  const text = glob.trim().replace(/^\.?\//, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "*") {
      if (text[i + 1] === "*") {
        // "**/" is any folders, or none; "**" alone is anything.
        if (text[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else if (char === "{") {
      const close = text.indexOf("}", i);
      if (close < 0) out += "\\{";
      else {
        out += `(?:${text
          .slice(i + 1, close)
          .split(",")
          .map((part) => part.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
          .join("|")})`;
        i = close;
      }
    } else out += char.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** The globs in a setting: one a line, or separated by commas outside braces. */
export function globsOf(paths: string | undefined): string[] {
  if (!paths) return [];
  return paths
    .split(/\n|,(?![^{]*\})/)
    .map((each) => each.trim())
    .filter(Boolean);
}

/**
 * Whether a path matches any of the globs; with none, everything does. A folder's change (renamed, moved, deleted) matches when the glob could match
 * something inside it: when the folder is under the glob's fixed start, or that start is under the folder.
 */
export function matchesPaths(path: string, paths: string | undefined, kind: "file" | "folder" = "file"): boolean {
  const globs = globsOf(paths);
  if (globs.length === 0) return true;
  return globs.some((glob) => {
    if (globToRegExp(glob).test(path)) return true;
    if (kind !== "folder") return false;
    const fixed = glob.trim().replace(/^\.?\//, "").split(/[*?{]/)[0]!;
    const start = fixed.slice(0, fixed.lastIndexOf("/") + 1);
    return `${path}/`.startsWith(start) || start.startsWith(`${path}/`);
  });
}

/** Why a glob setting can't be used, or null. */
export function pathsProblem(paths: string | undefined): string | null {
  const globs = globsOf(paths);
  if (globs.length > 20) return "Up to 20 patterns.";
  for (const glob of globs) {
    if (glob.length > 200) return "A pattern is up to 200 characters.";
    if (glob.startsWith("/") || glob.split("/").includes("..")) return `"${glob}" should be a path inside the room, such as src/**/*.py.`;
    try {
      globToRegExp(glob);
    } catch {
      return `"${glob}" isn't a pattern.`;
    }
  }
  return null;
}
