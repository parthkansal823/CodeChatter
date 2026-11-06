/** What the agent reports when a program's file changes on disk, above all when it grows past what the room can hold. */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BLOB_SYNC_MAX_BYTES, SYNC_MAX_BYTES } from "./rules.js";
import { Workspace } from "./workspace.js";

const binary = (size: number) => Buffer.alloc(size, 0);
const kinds = (events: Array<{ ev: string }>) => events.map((event) => event.ev);

describe("Workspace.inspect", () => {
  let root: string;
  let workspace: Workspace;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-workspace-"));
    workspace = new Workspace(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("takes a cut-off copy back out of the room when the file passes the limit", async () => {
    // The watcher looks while a program is still writing: a piece under the limit.
    writeFileSync(join(root, "big.bin"), binary(1024));
    expect(kinds((await workspace.inspect("big.bin")).events)).toEqual(["blob"]);
    // The program finishes, over the limit: that piece must not stay in the room.
    appendFileSync(join(root, "big.bin"), binary(BLOB_SYNC_MAX_BYTES + 1));
    expect((await workspace.inspect("big.bin")).events).toEqual([
      { ev: "removed", path: "big.bin" },
      { ev: "skipped", path: "big.bin", reason: "too-large" },
    ]);
    // Said once.
    expect((await workspace.inspect("big.bin")).events).toEqual([]);
  });

  it("does the same for text", async () => {
    writeFileSync(join(root, "run.log"), "started\n");
    expect(kinds((await workspace.inspect("run.log")).events)).toEqual(["file"]);
    appendFileSync(join(root, "run.log"), "x".repeat(SYNC_MAX_BYTES + 1));
    expect(kinds((await workspace.inspect("run.log")).events)).toEqual(["removed", "skipped"]);
  });

  it("brings the file back if it shrinks under the limit", async () => {
    writeFileSync(join(root, "big.bin"), binary(1024));
    await workspace.inspect("big.bin");
    appendFileSync(join(root, "big.bin"), binary(BLOB_SYNC_MAX_BYTES + 1));
    await workspace.inspect("big.bin");
    writeFileSync(join(root, "big.bin"), binary(1024));
    expect(kinds((await workspace.inspect("big.bin")).events)).toEqual(["blob"]);
  });

  it("only skips a file that was over the limit from the start", async () => {
    writeFileSync(join(root, "big.bin"), binary(BLOB_SYNC_MAX_BYTES + 1));
    expect((await workspace.inspect("big.bin")).events).toEqual([{ ev: "skipped", path: "big.bin", reason: "too-large" }]);
  });

  it("leaves the room's own copy alone when a file the room sent passes the limit", async () => {
    await workspace.write("notes.txt", "from the room\n");
    expect((await workspace.inspect("notes.txt")).events).toEqual([]);
    appendFileSync(join(root, "notes.txt"), "x".repeat(Math.max(SYNC_MAX_BYTES, BLOB_SYNC_MAX_BYTES) + 1));
    expect(kinds((await workspace.inspect("notes.txt")).events)).toEqual(["skipped"]);
  });

  it("forgets what it knew about a deleted file", async () => {
    writeFileSync(join(root, "gone.bin"), binary(1024));
    await workspace.inspect("gone.bin");
    rmSync(join(root, "gone.bin"));
    expect((await workspace.inspect("gone.bin")).events).toEqual([{ ev: "removed", path: "gone.bin" }]);
    writeFileSync(join(root, "gone.bin"), binary(BLOB_SYNC_MAX_BYTES + 1));
    expect(kinds((await workspace.inspect("gone.bin")).events)).toEqual(["skipped"]);
  });
});
