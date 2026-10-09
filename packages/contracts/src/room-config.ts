import { z } from "zod";

import { DATABASE_KINDS } from "./databases.js";

/**
 * How a room installs, starts and previews its app (roadmap §14 C):
 * `.codechatter/room.json`, a file in the room like any other, so templates and
 * imported projects say it the same way and everyone can edit it.
 *
 *   {
 *     "install": "npm install",    // run first when "installed" is missing
 *     "installed": "node_modules", // a path that exists once installed
 *     "dev": "npm run dev",        // the dev server
 *     "port": 5173,                // where it listens, for the preview
 *     "databases": ["postgres"]    // started before the dev server
 *   }
 */
export const ROOM_CONFIG_PATH = ".codechatter/room.json";

export const RoomConfig = z.object({
  install: z.string().trim().min(1).max(1000).optional(),
  installed: z.string().trim().min(1).max(500).optional(),
  dev: z.string().trim().min(1).max(1000).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  databases: z.array(z.enum(DATABASE_KINDS)).max(DATABASE_KINDS.length).optional(),
});
export type RoomConfig = z.infer<typeof RoomConfig>;

/** The room's dev server: what room.json says, and whether it's running now. */
export type DevServerStatus = {
  /** room.json's settings, or why they can't be read; null when the room has none. */
  config: RoomConfig | { error: string } | null;
  /** The shared "dev" terminal session exists. */
  running: boolean;
  /** Its port is listening in the sandbox (ready for the preview). */
  listening: boolean;
  /** Whether Start will install first: room.json's "installed" path is missing. Null when that can't be told (the sandbox isn't up, or there's no "installed"). */
  needsInstall: boolean | null;
};
