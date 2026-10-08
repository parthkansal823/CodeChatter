/**
 * Room permission matrix — the one place that decides who may do what inside
 * a room. The API enforces it (services/access), the collab server uses it for
 * read-only connections, and the web app uses it to hide what you can't do.
 *
 * v1 scattered these checks through a 2,330-line database module and let a
 * public-room visitor default to "editor", which unlocked the terminal.
 */
export const ROOM_ROLES = ["owner", "editor", "runner", "viewer", "interviewer", "candidate"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const ROOM_ACTIONS = [
  "room.view", // open the room, read files, see presence and chat
  "room.chat", // post chat messages and comments
  "files.edit", // change files (Yjs writes)
  "code.run", // Run button / tests in the sandbox
  "terminal.open", // interactive shell (can change any file via the sandbox)
  "room.invite", // share links, invite people
  "room.manage", // rename, visibility, join policy, members' roles
  "room.delete",
  "sandbox.network", // switch on outbound network for the sandbox
  "interview.rubric", // see and write the private rubric / scorecard
  "interview.hiddenTests", // see hidden test cases and their output
] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

// Read across a row to see everything a role can do.
const MATRIX: Record<RoomRole, readonly RoomAction[]> = {
  owner: [
    "room.view", "room.chat", "files.edit", "code.run", "terminal.open",
    "room.invite", "room.manage", "room.delete", "sandbox.network",
  ],
  editor: ["room.view", "room.chat", "files.edit", "code.run", "terminal.open", "room.invite"],
  // Can run code but not type into files. No terminal: a shell could rewrite
  // any file through the sandbox and would quietly make them an editor.
  runner: ["room.view", "room.chat", "code.run"],
  viewer: ["room.view", "room.chat"],
  interviewer: [
    "room.view", "room.chat", "files.edit", "code.run", "terminal.open",
    "room.invite", "room.manage", "interview.rubric", "interview.hiddenTests",
  ],
  // The candidate writes and runs code but never sees the rubric or hidden tests.
  candidate: ["room.view", "room.chat", "files.edit", "code.run", "terminal.open"],
};

const LOOKUP = {} as Record<RoomRole, ReadonlySet<RoomAction>>;
for (const role of ROOM_ROLES) LOOKUP[role] = new Set(MATRIX[role]);

export function can(role: RoomRole | null | undefined, action: RoomAction): boolean {
  return role != null && LOOKUP[role].has(action);
}

/** Roles an inviter may hand out: never more than they hold, never owner by link. */
export function assignableRoles(inviterRole: RoomRole): RoomRole[] {
  if (inviterRole === "owner") return ["editor", "runner", "viewer"];
  if (inviterRole === "interviewer") return ["interviewer", "candidate", "viewer"];
  if (inviterRole === "editor") return ["editor", "runner", "viewer"];
  return [];
}
