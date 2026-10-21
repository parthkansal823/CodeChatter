// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changesOf, merge3, mergeFiles } from "./merge";

const labels = { ours: "room", theirs: "github main" };
const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("changesOf", () => {
  it("lists added, modified and deleted files by path", () => {
    const base = files({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
    const room = files({ "a.txt": "a\n", "b.txt": "B\n", "d/e.txt": "e\n" });
    assert.deepEqual(changesOf(base, room), [
      { path: "b.txt", kind: "modified" },
      { path: "c.txt", kind: "deleted" },
      { path: "d/e.txt", kind: "added" },
    ]);
    assert.deepEqual(changesOf(base, base), []);
  });
});

describe("merge3", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";

  it("takes a change from either side, and the same change once", () => {
    assert.deepEqual(merge3(base, base, "one\nTWO\nthree\nfour\nfive\n", labels), {
      text: "one\nTWO\nthree\nfour\nfive\n",
      conflict: false,
    });
    assert.deepEqual(merge3(base, "zero\n" + base, base, labels), { text: "zero\n" + base, conflict: false });
    assert.deepEqual(merge3(base, "x\n", "x\n", labels), { text: "x\n", conflict: false });
  });

  it("merges changes to different lines of one file", () => {
    const ours = "one\nTWO\nthree\nfour\nfive\n";
    const theirs = "one\ntwo\nthree\nfour\nFIVE\nsix\n";
    assert.deepEqual(merge3(base, ours, theirs, labels), {
      text: "one\nTWO\nthree\nfour\nFIVE\nsix\n",
      conflict: false,
    });
  });

  it("marks different changes to the same lines as git does", () => {
    const merged = merge3(base, "one\nours\nthree\nfour\nfive\n", "one\ntheirs\nthree\nfour\nfive\n", labels);
    assert.equal(merged.conflict, true);
    assert.equal(
      merged.text,
      "one\n<<<<<<< room\nours\n=======\ntheirs\n>>>>>>> github main\nthree\nfour\nfive\n",
    );
  });

  it("keeps a last line without a newline, and closes conflict markers on their own lines", () => {
    assert.deepEqual(merge3("a\nmid\nb", "A\nmid\nb", "a\nmid\nB", labels), {
      text: "A\nmid\nB",
      conflict: false,
    });
    // Changes to touching lines conflict, as in git.
    assert.equal(merge3("a\nb", "A\nb", "a\nB", labels).conflict, true);
    assert.equal(merge3("a", "b", "c", labels).text, "<<<<<<< room\nb\n=======\nc\n>>>>>>> github main\n");
  });
});

describe("mergeFiles", () => {
  const base = files({
    "same.txt": "s\n",
    "theirs.txt": "t\n",
    "ours.txt": "o\n",
    "both.txt": "1\n2\n3\n",
    "gone.txt": "g\n",
    "fight.txt": "f\n",
  });

  it("brings in GitHub's changes, additions and deletions, and keeps the room's own", () => {
    const room = files({
      "same.txt": "s\n",
      "theirs.txt": "t\n",
      "ours.txt": "O\n",
      "both.txt": "ONE\n2\n3\n",
      "gone.txt": "g\n",
      "fight.txt": "f\n",
      "mine.txt": "m\n",
    });
    const remote = files({
      "same.txt": "s\n",
      "theirs.txt": "T\n",
      "ours.txt": "o\n",
      "both.txt": "1\n2\nTHREE\n",
      "fight.txt": "f\n",
      "new.txt": "n\n",
    });
    const plan = mergeFiles(base, room, remote, labels);
    assert.deepEqual(Object.fromEntries(plan.write), {
      "both.txt": "ONE\n2\nTHREE\n",
      "new.txt": "n\n",
      "theirs.txt": "T\n",
    });
    assert.deepEqual(plan.remove, ["gone.txt"]);
    assert.deepEqual(plan.conflicts, []);
  });

  it("reports conflicts: the same lines, and deleted on one side but changed on the other", () => {
    const room = files({ ...Object.fromEntries(base), "both.txt": "room\n2\n3\n", "fight.txt": "room\n" });
    room.delete("gone.txt");
    const remote = files({
      ...Object.fromEntries(base),
      "both.txt": "github\n2\n3\n",
      "gone.txt": "changed\n",
    });
    remote.delete("fight.txt");
    const plan = mergeFiles(base, room, remote, labels);
    assert.deepEqual(plan.conflicts, ["both.txt", "fight.txt", "gone.txt"]);
    assert.match(
      plan.write.get("both.txt")!,
      /^<<<<<<< room\nroom\n=======\ngithub\n>>>>>>> github main\n2\n3\n$/,
    );
    // Changed on GitHub but deleted in the room: GitHub's comes back. Changed in the room but deleted on GitHub: the room's stays.
    assert.equal(plan.write.get("gone.txt"), "changed\n");
    assert.equal(plan.write.has("fight.txt"), false);
    assert.deepEqual(plan.remove, []);
  });

  it("does nothing when GitHub has nothing new", () => {
    const room = files({ ...Object.fromEntries(base), "ours.txt": "changed\n" });
    const plan = mergeFiles(base, room, base, labels);
    assert.deepEqual([plan.write.size, plan.remove.length, plan.conflicts.length], [0, 0, 0]);
  });
});
