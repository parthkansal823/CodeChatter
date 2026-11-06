import assert from "node:assert/strict";
import { test } from "node:test";

import { createFileAtPath, findByPath, setFileText } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { filesAt, momentFor, parseReplayFrames, type ReplayFrame } from "./replay";

function frame(at: number, update: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + update.byteLength);
  const view = new DataView(out.buffer);
  view.setFloat64(0, at);
  view.setUint32(8, update.byteLength);
  out.set(update, 12);
  return out;
}

function history(): ReplayFrame[] {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  createFileAtPath(doc, "main.py", "one");
  const firstCount = updates.length;
  setFileText(doc, findByPath(doc, "main.py")!.id, "two");
  return updates.map((update, index) => ({ at: index < firstCount ? 1000 : 2000, update }));
}

test("reads frames from the wire format", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([9]);
  const bytes = new Uint8Array([...frame(1793931444037, a), ...frame(1793931444038, b)]);
  const frames = parseReplayFrames(bytes);
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.at, 1793931444037);
  assert.deepEqual([...frames[0]!.update], [1, 2, 3]);
  assert.deepEqual([...frames[1]!.update], [9]);
});

test("reads frames from a view into a larger buffer", () => {
  const whole = new Uint8Array([0, 0, ...frame(5, new Uint8Array([7]))]);
  const frames = parseReplayFrames(whole.subarray(2));
  assert.equal(frames[0]!.at, 5);
  assert.deepEqual([...frames[0]!.update], [7]);
});

test("an empty log has no frames, and a cut one says so", () => {
  assert.deepEqual(parseReplayFrames(new Uint8Array()), []);
  assert.throws(() => parseReplayFrames(frame(1, new Uint8Array([1, 2, 3])).subarray(0, 14)), /cut short/);
});

test("rebuilds the files at each moment", () => {
  const frames = history();
  assert.deepEqual(filesAt(frames, 999), []);
  assert.deepEqual(filesAt(frames, 1000), [{ path: "main.py", text: "one" }]);
  assert.deepEqual(filesAt(frames, 2000), [{ path: "main.py", text: "two" }]);
});

test("finds the moment for an event", () => {
  const moments = ["2026-11-06T10:00:00.000Z", "2026-11-06T10:01:00.000Z", "2026-11-06T10:02:00.000Z"];
  assert.equal(momentFor(moments, "2026-11-06T09:59:00.000Z"), 0);
  assert.equal(momentFor(moments, "2026-11-06T10:01:30.000Z"), 1);
  assert.equal(momentFor(moments, "2026-11-06T10:02:00.000Z"), 2);
  assert.equal(momentFor([], "2026-11-06T10:02:00.000Z"), 0);
});
