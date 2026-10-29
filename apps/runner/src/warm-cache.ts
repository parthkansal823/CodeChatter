import { createHash } from "node:crypto";

import type { RoomConfig } from "@codechatter/contracts";

/**
 * Pre-warmed installs (roadmap §14 C): `pnpm sandbox:warm` installs each template's
 * packages once, in a clean container of its own, and keeps the result as an archive in
 * one volume. Every sandbox sees that volume read-only here, so a room whose dependency
 * files are exactly a template's unpacks its packages instead of downloading them. Rooms
 * can't write to it, so no room can plant anything in another's packages.
 */
// Under /usr, which the jail lets everything read (and nothing write).
export const WARM_MOUNT = "/usr/local/share/cc-warm";
export const warmVolume = (namespace: string) => `cc-${namespace}-warm`;

/** The files, at the room's top level, that decide what an install puts in place. */
export const MANIFESTS = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "requirements.txt", "pyproject.toml", "composer.json", "composer.lock"];

/** The folder an install fills, from room.json's "installed" path (node_modules, .venv, Composer's vendor); null for one the cache doesn't keep. */
export function warmFolder(config: RoomConfig): string | null {
  const top = config.installed?.split("/")[0];
  return top === "node_modules" || top === ".venv" || top === "vendor" ? top : null;
}

/** The cache's name for an install: the command and the dependency files' exact text. */
export function warmKey(install: string, manifests: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256").update(install).update("\0");
  for (const name of MANIFESTS) {
    const text = manifests.get(name);
    if (text !== undefined) hash.update(name).update("\0").update(text).update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

/** Where a warmed install's archive is, as a sandbox sees it; null when the config can't be warmed. */
export function warmArchive(config: RoomConfig, manifests: ReadonlyMap<string, string>): string | null {
  if (!config.install || !warmFolder(config)) return null;
  return `${WARM_MOUNT}/${warmKey(config.install, manifests)}.tar`;
}

/**
 * Which archives the volume holds, for a room whose sandbox isn't up to look (a new room's
 * Dev server tab, in its first seconds). Listing takes a throwaway container, so the answer
 * is kept for a minute, and one listing at a time serves everyone asking.
 */
export class WarmIndex {
  private names: Set<string> | null = null;
  private listedAt = 0;
  private listing: Promise<Set<string> | null> | null = null;

  constructor(
    /** The archives' file names; null where there's no warm volume (the Kubernetes driver). */
    private readonly list: (() => Promise<string[]>) | null,
    private readonly ttlMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}

  /** Whether the volume holds this archive (a path from warmArchive); null when it can't be told. */
  async has(archive: string): Promise<boolean | null> {
    const names = await this.current();
    return names ? names.has(archive.slice(archive.lastIndexOf("/") + 1)) : null;
  }

  private async current(): Promise<Set<string> | null> {
    if (!this.list) return null;
    if (this.names && this.now() - this.listedAt < this.ttlMs) return this.names;
    this.listing ??= this.list().then(
      (names) => {
        this.names = new Set(names);
        this.listedAt = this.now();
        return this.names;
      },
      // Docker or the image missing: say nothing rather than guess (and try again next time).
      () => null,
    ).finally(() => (this.listing = null));
    return this.listing;
  }
}
