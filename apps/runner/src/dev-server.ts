import { ROOM_CONFIG_PATH, RoomConfig, type DevServerStatus } from "@codechatter/contracts";
import { findByPath, textOf } from "@codechatter/workspace-model";
import type { Duplex } from "node:stream";

import type { Databases } from "./databases.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { MANIFESTS, warmArchive, warmFolder, type WarmIndex } from "./warm-cache.js";

/**
 * The room's dev server (roadmap §14 C): what `.codechatter/room.json` says to
 * install and run, in a tmux session everyone in the room shares, named "dev"
 * (the API opens it for `/ws/terminal?shared=dev`). It runs like a terminal:
 * as the sandbox user, inside the jail, with the room's environment.
 */
export const DEV_SESSION = "dev";

/** room.json's settings, why they can't be read, or null when the room has none. */
export function readRoomConfig(session: RoomSession): RoomConfig | { error: string } | null {
  const doc = session.sync.doc;
  const node = findByPath(doc, ROOM_CONFIG_PATH);
  if (!node || node.kind !== "file") return null;
  let json: unknown;
  try {
    json = JSON.parse(textOf(doc, node.id)?.toString() ?? "");
  } catch (error) {
    return { error: `${ROOM_CONFIG_PATH} isn't valid JSON: ${(error as Error).message}` };
  }
  const parsed = RoomConfig.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return { error: `${ROOM_CONFIG_PATH}: ${issue?.path.length ? `"${issue.path.join(".")}" ` : ""}${issue?.message ?? "isn't valid"}` };
}

/**
 * What the dev session runs: the install when what it installs is missing,
 * then the dev server. When either stops, a shell stays open in the session,
 * so its output can still be read and commands run by hand. With `archive` (a
 * pre-warmed install of exactly these dependency files, warm-cache.ts), the
 * install is unpacked from it first, so nothing is downloaded.
 */
export function devScript(config: RoomConfig & { dev: string }, archive: string | null = null): string {
  const show = (command: string) => `printf '\\033[2m$ %s\\033[0m\\n' ${quote(command)}`;
  const lines = ["cd /workspace || exit 1"];
  const folder = warmFolder(config);
  if (config.install && config.installed && archive && folder) {
    lines.push(
      `if [ ! -e ${quote(config.installed)} ] && [ -f ${quote(archive)} ]; then`,
      `  printf '\\033[2mUnpacking the packages this template was warmed with (no download)…\\033[0m\\n'`,
      `  tar -xf ${quote(archive)} -C /workspace || rm -rf ${quote(folder)}`,
      "fi",
    );
  }
  if (config.install) {
    lines.push(
      config.installed ? `if [ ! -e ${quote(config.installed)} ]; then` : "if true; then",
      `  ${show(config.install)}`,
      `  ${config.install} || { echo; echo "Installing failed. If it couldn't reach a package registry, the room's owner can allow package installs (Ports panel)."; exec bash; }`,
      "fi",
    );
  }
  lines.push(show(config.dev), config.dev, "echo", 'echo "[The dev server stopped. Start it again from the Dev server tab, or run it here.]"', "exec bash");
  return lines.join("\n");
}

/** The room's dependency files as they are now (warm-cache.ts names an install by them). */
function manifests(session: RoomSession): Map<string, string> {
  const doc = session.sync.doc;
  const found = new Map<string, string>();
  for (const name of MANIFESTS) {
    const node = findByPath(doc, name);
    if (node?.kind === "file") found.set(name, textOf(doc, node.id)?.toString() ?? "");
  }
  return found;
}

/** A word for sh, single-quoted. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Start (or restart) the dev server: the room's databases from room.json,
 * then the dev session. A dev server already running is stopped first.
 */
export async function startDev(session: RoomSession, databases: Databases): Promise<{ error: string } | null> {
  await session.ready();
  const config = readRoomConfig(session);
  if (!config) return { error: `This room has no ${ROOM_CONFIG_PATH} to say how to start it.` };
  if ("error" in config) return config;
  if (!config.dev) return { error: `${ROOM_CONFIG_PATH} has no "dev" command.` };
  for (const kind of config.databases ?? []) databases.start(session.sandbox, kind);
  await tmux(session, ["kill-session", "-t", DEV_SESSION]);
  // The script travels in the session's environment, never pasted into a command line.
  const script = devScript({ ...config, dev: config.dev }, warmArchive(config, manifests(session)));
  const started = await tmux(session, ["new-session", "-d", "-s", DEV_SESSION, "-x", "160", "-y", "40", "-e", `CC_DEV_SCRIPT=${script}`, 'exec bash -c "$CC_DEV_SCRIPT"']);
  return started === 0 ? null : { error: "The dev server couldn't start in the sandbox." };
}

export async function stopDev(session: RoomSession): Promise<void> {
  if (session.sandbox.agent?.alive) await tmux(session, ["kill-session", "-t", DEV_SESSION]);
}

/** Without waking the sandbox: room.json, whether the dev session exists, whether its port listens, and whether it needs installing. */
export async function devStatus(session: RoomSession, warm: WarmIndex): Promise<DevServerStatus> {
  await session.sync.synced();
  const config = readRoomConfig(session);
  const settings = config && !("error" in config) ? config : null;
  const up = Boolean(session.sandbox.agent?.alive);
  const running = up && (await tmux(session, ["has-session", "-t", DEV_SESSION])) === 0;
  let needsInstall: boolean | null = settings?.install ? null : false;
  // Installed already, or a warmed install to unpack: either way, nothing to download.
  const archive = settings?.install ? warmArchive(settings, manifests(session)) : null;
  if (settings?.install && settings.installed && up) {
    const test = archive ? `test -e "$1" || test -f "$2"` : `test -e "$1"`;
    needsInstall = (await inWorkspace(session, ["sh", "-c", test, "cc-dev", settings.installed, archive ?? ""])) !== 0;
  } else if (archive && (await warm.has(archive))) {
    // No sandbox to look in yet (a new room's first seconds), but the warm volume has its install.
    needsInstall = false;
  }
  return { config, running, listening: running && settings?.port !== undefined && session.ports.includes(settings.port), needsInstall };
}

/** A tmux command as the sandbox user (the same server as the room's terminals); its exit code. */
function tmux(session: RoomSession, args: string[]): Promise<number | null> {
  return inWorkspace(session, ["sh", "-c", 'umask 002; exec tmux -u "$@"', "cc-dev", ...args]);
}

/** A command as the sandbox user, in /workspace and inside the jail; its exit code. */
async function inWorkspace(session: RoomSession, cmd: string[]): Promise<number | null> {
  const handle = await session.sandbox.exec([JAIL, ...cmd], { tty: false, stdin: false });
  await drained(handle.stream);
  return handle.exitCode();
}

function drained(stream: Duplex): Promise<void> {
  return new Promise((resolve) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", () => resolve());
    stream.resume();
  });
}
