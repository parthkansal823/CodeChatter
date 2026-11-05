import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { posix } from "node:path";

import type { AgentEvent } from "@codechatter/contracts";

import { asText, BLOB_SYNC_MAX_BYTES, isIgnored, SYNC_MAX_BYTES, TEMP_PREFIX } from "./rules.js";

/** A text file is hashed as its UTF-8 text, a binary one as its bytes. */
const sha1 = (content: string | Uint8Array) => createHash("sha1").update(content).digest("base64");
const slashes = (path: string) => path.replaceAll("\\", "/");

/** What changed at one path, as seen on disk. */
export type Inspection = { events: AgentEvent[]; isDir: boolean };

/**
 * The /workspace folder inside the sandbox, kept equal to the room's files.
 *
 * `known` holds a hash of what the room has for every synced file. The agent
 * updates it *before* writing, so when the file-system event for its own
 * write comes back, the content matches and nothing is echoed to the room.
 * Only changes made by the user's programs or terminal differ, and those are
 * reported.
 */
export class Workspace {
  private known = new Map<string, string>();
  private reported = new Set<string>();
  private tmpCounter = 0;
  private rootReal: string | null = null;

  constructor(readonly root: string) {}

  /** Absolute path for a workspace-relative one; refuses anything that could leave the workspace. */
  resolve(rel: string): string {
    if (!rel || rel.startsWith("/") || rel.split("/").some((s) => s === "" || s === "." || s === "..")) {
      throw new Error(`invalid path: ${rel}`);
    }
    return posix.join(this.root, rel);
  }

  /** Write a room file: text, or a binary file's bytes sent as base64. */
  async write(rel: string, content: string, encoding?: "base64"): Promise<void> {
    const abs = this.resolve(rel);
    const data: string | Buffer = encoding === "base64" ? Buffer.from(content, "base64") : content;
    this.known.set(rel, sha1(data));
    this.reported.delete(rel);
    const current = await lstat(abs).catch(() => null);
    if (current?.isFile() && current.size === Buffer.byteLength(data)) {
      // Unchanged files are left alone, so restarts don't touch every mtime.
      const onDisk = await readFile(abs).catch(() => null);
      if (onDisk && onDisk.equals(typeof data === "string" ? Buffer.from(data, "utf8") : data)) return;
    }
    await this.ensureDir(posix.dirname(rel));
    if (current?.isDirectory()) await rm(abs, { recursive: true, force: true });
    // Write beside, then rename over: atomic for readers, and it works even
    // when the old file belongs to the sandbox user (the folder is shared).
    const tmp = posix.join(posix.dirname(abs), `${TEMP_PREFIX}${process.pid}-${++this.tmpCounter}`);
    await writeFile(tmp, data, { mode: 0o664 });
    await rename(tmp, abs);
  }

  async mkdir(rel: string): Promise<void> {
    await this.ensureDir(rel);
  }

  async delete(rel: string): Promise<void> {
    const abs = this.resolve(rel);
    this.forget(rel);
    await rm(abs, { recursive: true, force: true });
  }

  /** Remove every non-ignored file and folder the room doesn't have. Returns how many entries went. */
  async reconcile(files: string[], dirs: string[]): Promise<number> {
    const keepFiles = new Set(files);
    const keepDirs = new Set(dirs);
    for (const file of files) {
      for (let i = file.lastIndexOf("/"); i > 0; i = file.lastIndexOf("/", i - 1)) keepDirs.add(file.slice(0, i));
    }
    for (const path of [...this.known.keys()]) if (!keepFiles.has(path)) this.known.delete(path);

    let removed = 0;
    const walk = async (relDir: string): Promise<void> => {
      const abs = relDir ? this.resolve(relDir) : this.root;
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (isIgnored(rel)) continue;
        if (entry.isDirectory() && keepDirs.has(rel)) {
          await walk(rel);
        } else if (entry.isDirectory() || !keepFiles.has(rel)) {
          await rm(posix.join(abs, entry.name), { recursive: true, force: true });
          removed += 1;
        }
      }
    };
    await walk("");
    return removed;
  }

  /** Called by the watcher for a path that changed on disk. */
  async inspect(rel: string): Promise<Inspection> {
    if (isIgnored(rel)) return { events: [], isDir: false };
    const abs = this.resolve(rel);
    const stat = await lstat(abs).catch(() => null);
    if (!stat) {
      return { events: this.forget(rel).map((path) => ({ ev: "removed", path })), isDir: false };
    }
    if (stat.isDirectory()) return { events: [], isDir: true };
    if (!stat.isFile()) return { events: [], isDir: false }; // symlinks, sockets, fifos stay local

    if (stat.size > Math.max(SYNC_MAX_BYTES, BLOB_SYNC_MAX_BYTES)) return { events: this.reportOnce(rel, "too-large"), isDir: false };
    const bytes = await readFile(abs).catch(() => Buffer.alloc(0));
    const text = asText(bytes);
    if (text === null) {
      // A binary file: its bytes go to the room (the runner stores them), unless they're what the room sent.
      if (bytes.byteLength > BLOB_SYNC_MAX_BYTES) return { events: this.reportOnce(rel, "too-large"), isDir: false };
      const hash = sha1(bytes);
      if (this.known.get(rel) === hash) return { events: [], isDir: false };
      this.known.set(rel, hash);
      this.reported.delete(rel);
      return { events: [{ ev: "blob", path: rel, b64: bytes.toString("base64") }], isDir: false };
    }
    if (bytes.byteLength > SYNC_MAX_BYTES) return { events: this.reportOnce(rel, "too-large"), isDir: false };

    const hash = sha1(text);
    if (this.known.get(rel) === hash) return { events: [], isDir: false };
    this.known.set(rel, hash);
    this.reported.delete(rel);
    return { events: [{ ev: "file", path: rel, content: text }], isDir: false };
  }

  /** Every non-ignored file under a folder, for a folder that just appeared (mv, git clone, unzip). */
  async listFiles(relDir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(this.resolve(dir), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (isIgnored(rel)) continue;
        if (entry.isDirectory()) await walk(rel);
        else if (entry.isFile()) out.push(rel);
      }
    };
    await walk(relDir);
    return out;
  }

  /** Drop a path (and everything under it) from `known`; returns the files that were known. */
  private forget(rel: string): string[] {
    const gone: string[] = [];
    for (const path of this.known.keys()) {
      if (path === rel || path.startsWith(`${rel}/`)) gone.push(path);
    }
    for (const path of gone) this.known.delete(path);
    return gone;
  }

  private reportOnce(rel: string, reason: "binary" | "too-large"): AgentEvent[] {
    if (this.reported.has(rel)) return [];
    this.reported.add(rel);
    return [{ ev: "skipped", path: rel, reason }];
  }

  /**
   * Create a folder (and its parents). Anything in the way that isn't a real
   * folder, such as a file or a symlink planted from the terminal, is replaced:
   * the room's files decide, and writes must never follow a link out of the
   * workspace.
   */
  private async ensureDir(rel: string): Promise<void> {
    if (!rel || rel === ".") return;
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const abs = this.resolve(parts.slice(0, i).join("/"));
      const stat = await lstat(abs).catch(() => null);
      if (stat && !stat.isDirectory()) await rm(abs, { force: true });
      if (!stat || !stat.isDirectory()) await mkdir(abs, { mode: 0o2775 });
    }
    this.rootReal ??= slashes(await realpath(this.root));
    const real = slashes(await realpath(this.resolve(rel)));
    if (real !== this.rootReal && !real.startsWith(`${this.rootReal}/`)) throw new Error(`outside workspace: ${rel}`);
  }
}
