import { statSync, unwatchFile, watchFile, type Stats } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { posix } from "node:path";

import type { AgentEvent, SandboxCommit } from "@codechatter/contracts";

/**
 * Commits made in the sandbox's git, for automations ("A commit is made in the sandbox"): read from the repository's reflog (/workspace/.git/logs/HEAD), to
 * which git adds a line for every commit however it's made: in a terminal, by Git in the sandbox, by a script. Nothing is run and no hook is needed, so a
 * repository's own config can't make the agent run anything. Only what's added after the agent starts counts.
 */

const KINDS: Array<[RegExp, SandboxCommit["kind"]]> = [
  [/^commit \(initial\): /, "initial"],
  [/^commit \(amend\): /, "amend"],
  [/^commit \(merge\): /, "merge"],
  [/^commit: /, "commit"],
  [/^cherry-pick: /, "cherry-pick"],
  [/^revert: /, "revert"],
];
const LINE = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (.*?) <([^>]*)> (\d+) ([+-]\d{4})\t(.*)$/;
const MOST = 20;
const MOST_BYTES = 64 * 1024;

/** The commits in reflog lines: new commits only, not checkouts, resets, rebases or fast-forwards. A merge git made is one, named after what was merged. */
export function commitsOf(text: string): SandboxCommit[] {
  const commits: SandboxCommit[] = [];
  for (const line of text.split("\n")) {
    const match = LINE.exec(line.trimEnd());
    if (!match) continue;
    const [, parent, commit, name, email, seconds, , said] = match as unknown as [string, string, string, string, string, string, string, string];
    let kind: SandboxCommit["kind"] | null = null;
    let message = "";
    for (const [pattern, each] of KINDS) {
      if (pattern.test(said)) {
        kind = each;
        message = said.replace(pattern, "");
        break;
      }
    }
    // "merge feature: Merge made by the 'ort' strategy." makes a commit; "merge feature: Fast-forward" doesn't.
    const merged = /^merge (.+?): Merge made by/.exec(said);
    if (!kind && merged) {
      kind = "merge";
      message = `Merge ${merged[1]}`;
    }
    if (!kind) continue;
    commits.push({ commit, parent: /^0+$/.test(parent) ? null : parent, kind, message, author: { name, email }, at: new Date(Number(seconds) * 1000).toISOString() });
  }
  return commits.slice(-MOST);
}

/** The branch HEAD is on, from `.git/HEAD`; null when it's detached or there's no repository. */
export function branchOf(head: string): string | null {
  const match = /^ref: refs\/heads\/(.+)$/.exec(head.trim());
  return match ? match[1]! : null;
}

/** Watches the reflog (a stat every second and a half: one file, so it costs nothing) and says what's new. */
export class ReflogWatcher {
  private readonly file: string;
  private offset = 0;
  private ino = 0;
  private reading: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly emit: (event: AgentEvent) => void,
    private readonly intervalMs = 1500,
  ) {
    this.file = posix.join(root, ".git/logs/HEAD");
  }

  start(): void {
    // What's there already happened before: only what's added from now counts.
    try {
      const now = statSync(this.file);
      this.offset = now.size;
      this.ino = now.ino;
    } catch {
      // No repository yet.
    }
    watchFile(this.file, { interval: this.intervalMs, persistent: false }, (now) => {
      this.reading = this.reading.then(() => this.changed(now)).catch(() => {});
    });
  }

  stop(): void {
    unwatchFile(this.file);
  }

  private async changed(now: Stats): Promise<void> {
    if (now.ino === 0) {
      // No repository (or it was deleted): a new one's reflog is read from its start.
      this.offset = 0;
      this.ino = 0;
      return;
    }
    if (this.ino === 0) {
      this.ino = now.ino;
      this.offset = 0;
    } else if (now.ino !== this.ino) {
      // Rewritten (git reflog expire, gc) or replaced at once: what's in it isn't new.
      this.ino = now.ino;
      this.offset = now.size;
      return;
    }
    if (now.size < this.offset) {
      this.offset = now.size;
      return;
    }
    if (now.size === this.offset) return;
    let from = this.offset;
    let skipFirst = false;
    if (now.size - from > MOST_BYTES) {
      from = now.size - MOST_BYTES;
      skipFirst = true;
    }
    const handle = await open(this.file, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(now.size - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    // Only whole lines: one being written is read next time.
    const end = text.lastIndexOf("\n");
    if (end < 0) return;
    this.offset = from + Buffer.byteLength(text.slice(0, end + 1));
    let lines = text.slice(0, end + 1);
    if (skipFirst) lines = lines.slice(lines.indexOf("\n") + 1);
    const commits = commitsOf(lines);
    if (commits.length === 0) return;
    const head = await readFile(posix.join(this.root, ".git/HEAD"), "utf8").catch(() => "");
    this.emit({ ev: "git", branch: branchOf(head), commits });
  }
}
