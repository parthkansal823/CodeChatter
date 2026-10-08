import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { posix } from "node:path";

import { isIgnored } from "./rules.js";

/**
 * Recursive watcher that skips ignored folders. Node's `recursive: true`
 * would put an inotify watch on every folder in node_modules; this one never
 * enters them. Events are batched, so a `git checkout` or an editor's
 * save-by-rename arrives as one set of paths.
 */
export class TreeWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly onBatch: (paths: string[]) => Promise<void>,
    private readonly delayMs = 120,
  ) {}

  /** Watch a folder and every non-ignored folder below it ("" = the workspace root). */
  async watchTree(relDir = ""): Promise<void> {
    if ((relDir && isIgnored(relDir)) || this.watchers.has(relDir)) return;
    const abs = relDir ? posix.join(this.root, relDir) : this.root;
    try {
      const watcher = watch(abs, (_event, name) => {
        if (name) this.queue(relDir ? `${relDir}/${String(name)}` : String(name));
      });
      watcher.on("error", () => this.unwatch(relDir));
      this.watchers.set(relDir, watcher);
    } catch {
      return; // the folder vanished between the event and now
    }
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) await this.watchTree(relDir ? `${relDir}/${entry.name}` : entry.name);
    }
  }

  unwatch(relDir: string): void {
    for (const [dir, watcher] of this.watchers) {
      if (dir === relDir || dir.startsWith(`${relDir}/`)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private queue(rel: string): void {
    this.pending.add(rel);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const paths = [...this.pending].sort(); // parents before children
      this.pending.clear();
      this.running = this.running.then(() => this.onBatch(paths)).catch(() => {});
    }, this.delayMs);
  }
}
