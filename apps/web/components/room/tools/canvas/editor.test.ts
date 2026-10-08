import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Y from "yjs";

import { Editor } from "./editor";
import type { Measure } from "./text-layout";

const measure: Measure = (text, font) => text.length * font.size * 0.5;

function setup(kind: "design" | "board" = "design") {
  const doc = new Y.Doc();
  const editor = new Editor(doc, kind, measure);
  return { doc, editor };
}

const order = (editor: Editor, parent: string | null = null) => editor.store.childIds(parent).map((id) => editor.get(id)!.name);

describe("editor", () => {
  it("creates shapes on top, named by type", () => {
    const { editor } = setup();
    editor.change(() => {
      editor.create("rect", { x: 0, y: 0 });
    });
    editor.change(() => {
      editor.create("rect", { x: 10, y: 0 });
    });
    assert.deepEqual(order(editor), ["Rectangle 1", "Rectangle 2"]);
  });

  it("undoes a whole gesture as one step and only its own edits", () => {
    const { doc, editor } = setup();
    let id = "";
    editor.change(() => {
      id = editor.create("rect", { x: 0, y: 0 });
    });
    editor.beginGesture();
    for (let i = 1; i <= 10; i++) editor.write(() => editor.apply(id, { x: i * 10 }));
    editor.endGesture();
    // Someone else's edit arrives meanwhile.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap<Y.Map<unknown>>("shapes").get(id)!.set("fill", "var(--p-3)");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    assert.equal(editor.get(id)!.x, 100);
    editor.undo();
    assert.equal(editor.get(id)!.x, 0);
    assert.equal(editor.get(id)!.fill, "var(--p-3)");
    editor.undo();
    assert.equal(editor.get(id), undefined);
    editor.redo();
    assert.ok(editor.get(id));
  });

  it("measures text as it changes", () => {
    const { editor } = setup();
    let id = "";
    editor.change(() => {
      id = editor.create("text", { text: "hello", fontSize: 10 });
    });
    assert.equal(editor.get(id)!.w, 27);
    editor.update(id, { text: "hello\nworld" });
    assert.equal(editor.get(id)!.h, 26);
  });

  it("moves frames with their children and reparents on drop", () => {
    const { editor } = setup();
    let frame = "";
    let rect = "";
    editor.change(() => {
      frame = editor.create("frame", { x: 0, y: 0, w: 200, h: 200 });
    });
    editor.change(() => {
      rect = editor.create("rect", { x: 300, y: 300, w: 20, h: 20 });
    });
    editor.update(rect, { x: 50, y: 50 });
    editor.change(() => editor.reparent([rect]));
    assert.equal(editor.get(rect)!.parentId, frame);
    editor.nudge([frame], 10, 5);
    assert.equal(editor.get(rect)!.x, 60);
    assert.equal(editor.get(frame)!.y, 5);
  });

  it("reorders with fractional keys", () => {
    const { editor } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) editor.change(() => void ids.push(editor.create("rect", { name: `r${i}` })));
    editor.reorder([ids[0]!], "front");
    assert.deepEqual(order(editor), ["r1", "r2", "r3", "r0"]);
    editor.reorder([ids[0]!], "backward");
    assert.deepEqual(order(editor), ["r1", "r2", "r0", "r3"]);
    editor.reorder([ids[3]!, ids[2]!], "back");
    assert.deepEqual(order(editor), ["r2", "r3", "r1", "r0"]);
    editor.moveInLayers([ids[2]!], ids[0]!, "above");
    assert.deepEqual(order(editor), ["r3", "r1", "r0", "r2"]);
  });

  it("duplicates frames with their contents and new ids", () => {
    const { editor } = setup();
    let frame = "";
    editor.change(() => {
      frame = editor.create("frame", { x: 0, y: 0, w: 100, h: 100 });
    });
    editor.change(() => {
      editor.create("rect", { x: 10, y: 10, w: 10, h: 10, parentId: frame });
    });
    const [copy] = editor.duplicate([frame]);
    assert.ok(copy && copy !== frame);
    assert.equal(editor.get(copy)!.x, 16);
    const children = editor.store.childIds(copy);
    assert.equal(children.length, 1);
    assert.equal(editor.get(children[0]!)!.x, 26);
    assert.equal(editor.store.size, 4);
  });

  it("keeps connectors attached, and lets go when a shape is deleted", () => {
    const { editor } = setup("board");
    let a = "";
    let b = "";
    let arrow = "";
    editor.change(() => {
      a = editor.create("rect", { x: 0, y: 0, w: 100, h: 100 });
      b = editor.create("rect", { x: 300, y: 0, w: 100, h: 100 });
    });
    editor.change(() => {
      arrow = editor.create("arrow", { x: 50, y: 50, w: 300, h: 0, points: [0, 0, 300, 0], startId: a, endId: b });
    });
    const before = editor.bounds(arrow)!;
    assert.equal(before.x, 106);
    editor.nudge([b], 100, 0);
    assert.equal(editor.bounds(arrow)!.x + editor.bounds(arrow)!.w, 394);
    editor.deleteShapes([b]);
    const after = editor.get(arrow)!;
    assert.equal(after.endId, null);
    assert.equal(after.startId, a);
  });

  it("frames a selection in place", () => {
    const { editor } = setup();
    const ids: string[] = [];
    editor.change(() => {
      ids.push(editor.create("rect", { x: 10, y: 10, w: 10, h: 10 }));
      ids.push(editor.create("rect", { x: 40, y: 30, w: 10, h: 10 }));
    });
    editor.select(ids);
    const frame = editor.frameSelection()!;
    assert.deepEqual(editor.bounds(frame), { x: 10, y: 10, w: 40, h: 30 });
    assert.equal(editor.store.childIds(frame).length, 2);
    editor.undo();
    assert.equal(editor.get(frame), undefined);
    assert.equal(editor.get(ids[0]!)!.parentId, null);
  });

  it("does nothing when read-only", () => {
    const { editor } = setup();
    editor.readOnly.set(true);
    editor.change(() => {
      editor.create("rect");
    });
    assert.equal(editor.store.size, 0);
  });
});
