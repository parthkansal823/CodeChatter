/**
 * Automations started by what happens in their room: files changing, a commit pushed, a pull request opened, someone let in. n8n has nothing like it, as it
 * isn't an IDE. Files changing is seen by collab (apps/collab/src/extensions/automation-events.ts), the rest come from the audit log (AuditService); both are
 * queued in Valkey and run by the API (apps/api/src/automations). In the flow file the trigger is Activepieces' webhook trigger with a `room` setting, so the
 * engine runs it as it is, and taken to Activepieces it's still a webhook something can call.
 */

export const ROOM_EVENT_CARRIER = { pieceName: "@activepieces/piece-webhook", triggerName: "catch_webhook" } as const;

export const ROOM_EVENTS = {
  "files.changed": { label: "Files change", about: "Someone adds, edits, renames, moves or deletes files. What the room's own runs change doesn't count, so a flow can't set itself off." },
  "repo.commit": { label: "A commit is pushed", about: "Someone commits and pushes from Source control." },
  "repo.pull-request": { label: "A pull request is opened", about: "Someone opens a pull request from Source control." },
  "repo.publish": { label: "The room is published to GitHub", about: "Someone makes a GitHub repository of the room." },
  "room.member.approve": { label: "Someone is let in", about: "An owner lets someone who asked into the room." },
  "room.member.leave": { label: "Someone leaves", about: "Someone leaves the room." },
  "room.update": { label: "The room's settings change", about: "Its name, description or who can see it." },
  "sandbox.image": { label: "The sandbox's image changes", about: "Someone switches the room to another sandbox image." },
} as const;
export type RoomEventName = keyof typeof ROOM_EVENTS;
export const ROOM_EVENT_NAMES = Object.keys(ROOM_EVENTS) as RoomEventName[];
export const isRoomEvent = (name: unknown): name is RoomEventName => typeof name === "string" && Object.hasOwn(ROOM_EVENTS, name);

/** What a flow on a room event listens for: the event, and for files, which (globs, one a line or comma-separated; nothing means all). */
export type RoomEventSettings = { event: RoomEventName; paths?: string };

/** The room setting on a flow's trigger, if it's a room event's. */
export function roomEventOf(settings: unknown): RoomEventSettings | null {
  const room = (settings as { room?: unknown } | null)?.room as { event?: unknown; paths?: unknown } | undefined;
  if (!room || !isRoomEvent(room.event)) return null;
  return room.event === "files.changed" && typeof room.paths === "string" && room.paths.trim() ? { event: room.event, paths: room.paths } : { event: room.event };
}

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
