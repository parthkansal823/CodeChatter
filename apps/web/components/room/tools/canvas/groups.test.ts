/** Group commands, derived geometry and merge safety without React or a running server. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Y from "yjs";

import { Editor } from "./editor";
import { linearEnds } from "./draw";
import { normalizeGroups } from "./groups";
import { parseShape, type Shape, type ShapePatch } from "./shape";
import { ancestors, childrenIndex, descendantsOf, effectiveHidden, effectiveLocked, effectiveParent, topLevelIds } from "./tree";

const measure = (text: string, font: { size: number }) => text.length * font.size * 0.5;
const setup = (doc = new Y.Doc(), kind: "design" | "board" = "design") => new Editor(doc, kind, measure);
const shape = (editor: Editor, x: number, props: ShapePatch = {}) => editor.create("rect", { x, y: 10, w: 20, h: 30, ...props });
const group = (editor: Editor, ids: string[]) => { editor.select(ids); return editor.groupSelection()!; };
const box = (s: Shape | undefined) => s && ({ x: s.x, y: s.y, w: s.w, h: s.h });
const sync = (a: Editor, b: Editor) => {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
};
const peer = (editor: Editor) => { const other = setup(); sync(editor, other); return other; };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

describe("transparent groups", () => {
  it("keeps absolute positions and child order at the highest selected sibling's slot", () => {
    const e = setup();
    const a = shape(e, 0), between = shape(e, 30), b = shape(e, 60), above = shape(e, 90);
    const positions = [box(e.get(a)), box(e.get(b))];
    const z = [e.get(a)!.z, e.get(b)!.z];
    const id = group(e, [b, a]);
    assert.equal(e.get(id)!.type, "group");
    assert.equal(e.get(id)!.z, z[1]);
    assert.deepEqual(e.store.childIds(null), [between, id, above]);
    assert.deepEqual(e.store.childIds(id), [a, b]);
    assert.deepEqual([box(e.get(a)), box(e.get(b))], positions);
    assert.deepEqual([e.get(a)!.z, e.get(b)!.z], z);
    assert.deepEqual(box(e.get(id)), { x: 0, y: 10, w: 80, h: 30 });
    e.destroy();
  });

  it("refuses cross-container selections and does not change their parents", () => {
    const e = setup();
    const frame = e.create("frame");
    const a = shape(e, 0), b = shape(e, 50, { parentId: frame });
    e.select([a, b]);
    assert.equal(e.groupingError(), "Select shapes in the same frame or group.");
    assert.equal(e.groupSelection(), null);
    assert.equal(e.get(a)!.parentId, null);
    assert.equal(e.get(b)!.parentId, frame);
    e.select([a]); assert.equal(e.groupSelection(), null);
    e.destroy();
  });

  it("ungroups in the same sibling slot, selects promoted children and undoes in one step", () => {
    const e = setup();
    const bottom = shape(e, -40), a = shape(e, 0), b = shape(e, 40), above = shape(e, 80);
    const id = group(e, [a, b]);
    const positions = [box(e.get(a)), box(e.get(b))];
    assert.deepEqual(e.ungroupSelection(), [a, b]);
    assert.deepEqual(e.selection.get(), [a, b]);
    assert.deepEqual(e.store.childIds(null), [bottom, a, b, above]);
    assert.deepEqual([box(e.get(a)), box(e.get(b))], positions);
    assert.equal(e.get(id), undefined);
    e.undo();
    assert.equal(e.get(a)!.parentId, id);
    assert.equal(e.get(b)!.parentId, id);
    e.redo(); assert.equal(e.get(id), undefined);
    e.destroy();
  });

  it("supports nested groups and local drill-in with Escape-style exit", () => {
    const e = setup();
    const a = shape(e, 0), b = shape(e, 40), c = shape(e, 80);
    const inner = group(e, [a, b]), outer = group(e, [inner, c]);
    assert.equal(e.resolveHit(a), outer);
    assert.equal(e.enterGroup(outer), true);
    assert.equal(e.resolveHit(a), inner);
    assert.equal(e.enterGroup(inner), true);
    assert.equal(e.resolveHit(a), a);
    assert.equal(e.exitGroup(), true); assert.equal(e.activeGroup.get(), outer);
    assert.deepEqual(e.selection.get(), [inner]);
    assert.equal(e.exitGroup(), true); assert.equal(e.activeGroup.get(), null);
    assert.equal(e.exitGroup(), false);
    assert.deepEqual(e.topSelection([a, inner, outer]), [outer]);
    e.destroy();
  });

  it("moves every descendant once even when both a group and child are selected", () => {
    const e = setup();
    const a = shape(e, 0), b = shape(e, 40);
    const inner = group(e, [a, b]), c = shape(e, 80), outer = group(e, [inner, c]);
    e.nudge([outer, a], 11, -3);
    assert.equal(e.get(a)!.x, 11); assert.equal(e.get(b)!.x, 51); assert.equal(e.get(c)!.x, 91);
    assert.deepEqual(box(e.get(outer)), { x: 11, y: 7, w: 100, h: 30 });
    e.undo(); assert.equal(e.get(a)!.x, 0);
    e.destroy();
  });

  it("resizes geometry and pen points and wraps text using the existing selection rules", () => {
    const e = setup();
    const a = shape(e, 0, { y: 0, h: 20 });
    const path = e.create("path", { x: 40, y: 0, w: 20, h: 20, points: [0, 0, 0.5, 20, 20, 1] });
    const text = e.create("text", { x: 0, y: 30, text: "Hello" });
    const id = group(e, [a, path, text]);
    const before = e.get(id)!;
    e.setBox(id, { x: 10, y: 20, w: before.w * 2, h: before.h * 2 });
    assert.equal(e.get(a)!.x, 10); assert.equal(e.get(a)!.w, 40);
    assert.equal(e.get(path)!.x, 90);
    assert.deepEqual(e.get(path)!.points, [0, 0, 0.5, 40, 40, 1]);
    assert.equal(e.get(text)!.wrap, true);
    assert.equal(e.get(text)!.y, 80);
    e.undo(); assert.equal(e.get(a)!.x, 0); assert.equal(e.get(path)!.w, 20);
    e.destroy();
  });

  it("bakes rotation into leaves and derives a fresh axis-aligned group box", () => {
    const e = setup();
    const a = shape(e, 0, { y: 0, h: 20 }), b = shape(e, 40, { y: 0, h: 20 });
    const id = group(e, [a, b]);
    e.updateMany([[id, { rotation: 90 }]]);
    assert.equal(e.get(id)!.rotation, 0);
    close(e.get(a)!.x, 20); close(e.get(a)!.y, -20);
    close(e.get(b)!.x, 20); close(e.get(b)!.y, 20);
    assert.equal(e.get(a)!.rotation, 90);
    close(e.get(id)!.w, 20); close(e.get(id)!.h, 60);
    e.undo(); close(e.get(a)!.x, 0); assert.equal(e.get(a)!.rotation, 0);
    e.destroy();
  });

  it("rotates frames as whole SVG units without double rotating their contents", () => {
    const e = setup();
    const frame = e.create("frame", { x: 0, y: 0, w: 100, h: 100 });
    const child = shape(e, 10, { y: 10, parentId: frame });
    const other = shape(e, 200, { y: 0 });
    const id = group(e, [frame, other]);
    e.update(id, { rotation: 90 });
    assert.equal(e.get(frame)!.rotation, 90);
    assert.equal(e.get(child)!.rotation, 0);
    close(e.get(child)!.x - e.get(frame)!.x, 10);
    close(e.get(child)!.y - e.get(frame)!.y, 10);
    e.destroy();
  });

  it("rotates attached connector geometry once while retaining its attachments", () => {
    const e = setup(new Y.Doc(), "board");
    const a = shape(e, 0, { y: 0, w: 10, h: 10 }), b = shape(e, 100, { y: 0, w: 10, h: 10 });
    const arrow = e.create("arrow", { x: 10, y: 5, w: 90, h: 0, points: [0, 0, 90, 0], startId: a, endId: b });
    const id = group(e, [a, b, arrow]);
    e.update(id, { rotation: 90 });
    const current = e.get(arrow)!;
    assert.equal(current.rotation, 0); assert.equal(current.startId, a); assert.equal(current.endId, b);
    const [start, end] = linearEnds(current, e.store.get);
    close(start.x, end.x); assert.ok(start.y < end.y);
    e.destroy();
  });

  it("derives ancestor boxes on peer geometry updates without writing group geometry", () => {
    const a = setup();
    const x = shape(a, 0), y = shape(a, 40), inner = group(a, [x, y]), z = shape(a, 80), outer = group(a, [inner, z]);
    const b = peer(a);
    const oldOuter = a.get(outer), oldInner = a.get(inner), untouched = a.get(z);
    const persisted = a.map.get(inner)!.get("w");
    const ids = [outer]; const oldPick = a.store.pick(ids);
    let notified = 0; const off = a.store.subscribeShape(outer, () => notified++);
    b.nudge([x], -50, 0); sync(a, b);
    assert.notEqual(a.get(inner), oldInner); assert.notEqual(a.get(outer), oldOuter);
    assert.equal(a.get(z), untouched); assert.notEqual(a.store.pick(ids), oldPick);
    assert.ok(notified > 0); assert.equal(a.get(outer)!.x, -50);
    assert.equal(a.map.get(inner)!.get("w"), persisted);
    off(); a.destroy(); b.destroy();
  });

  it("retains child flags when inherited hiding or locking is toggled", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40);
    const id = group(e, [a, b]);
    e.update(id, { hidden: true, locked: true });
    assert.equal(e.get(a)!.hidden, false); assert.equal(e.get(a)!.locked, false);
    assert.equal(effectiveHidden(e.store.all(), a), true); assert.equal(effectiveLocked(e.store.all(), a), true);
    assert.equal(e.resolveHit(a), null); e.nudge([a, id], 30, 0); assert.equal(e.get(a)!.x, 0);
    e.update(b, { hidden: true, locked: true });
    e.update(id, { hidden: false, locked: false });
    assert.equal(effectiveHidden(e.store.all(), a), false); assert.equal(effectiveLocked(e.store.all(), a), false);
    assert.equal(effectiveHidden(e.store.all(), b), true); assert.equal(effectiveLocked(e.store.all(), b), true);
    e.destroy();
  });

  it("copies, pastes and duplicates entire nested trees with new ids", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), inner = group(e, [a, b]), c = shape(e, 80), outer = group(e, [inner, c]);
    const payload = e.copyPayload([outer])!;
    assert.equal(payload.shapes.length, 5);
    const [duplicate] = e.duplicate([outer]);
    assert.equal(e.get(duplicate!)!.type, "group");
    const tree = e.carried([duplicate!]); assert.equal(tree.length, 5);
    assert.equal(tree.filter((s) => s.type === "group").length, 2);
    assert.ok(tree.every((s) => !payload.shapes.some((old) => old.id === s.id)));
    assert.equal(e.get(duplicate!)!.x, e.get(outer)!.x + 16);
    const [pasted] = e.paste(payload, { x: 400, y: 300, at: true });
    close(e.get(pasted!)!.x + e.get(pasted!)!.w / 2, 400);
    close(e.get(pasted!)!.y + e.get(pasted!)!.h / 2, 300);
    e.destroy();
  });

  it("deletes a group subtree and restores it with one undo", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), id = group(e, [a, b]);
    e.deleteShapes([id]); assert.equal(e.store.size, 0);
    e.undo(); assert.equal(e.store.size, 3); assert.equal(e.get(a)!.parentId, id);
    e.redo(); assert.equal(e.store.size, 0); e.destroy();
  });

  it("removes empty ancestor groups in the same local delete undo step", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), inner = group(e, [a, b]), c = shape(e, 80), outer = group(e, [inner, c]);
    e.deleteShapes([a, b, c]); assert.equal(e.store.size, 0);
    e.undo(); assert.equal(e.store.size, 5); assert.equal(e.get(inner)!.parentId, outer);
    e.destroy();
  });

  it("removes an emptied group after layer reparent and restores everything on undo", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), id = group(e, [a, b]);
    const frame = e.create("frame");
    e.moveInLayers([a, b], frame, "inside"); assert.equal(e.get(id), undefined);
    assert.deepEqual(e.store.childIds(frame), [a, b]);
    e.undo(); assert.equal(e.get(a)!.parentId, id); assert.equal(e.get(id)!.type, "group");
    e.destroy();
  });

  it("keeps drilled-in children inside their group after drag reparent", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), id = group(e, [a, b]);
    e.enterGroup(id); e.nudge([a], 500, 0); e.write(() => e.reparent([a]));
    assert.equal(e.get(a)!.parentId, id);
    const created = shape(e, 100); assert.equal(e.get(created)!.parentId, id);
    e.selectAll(); assert.deepEqual(new Set(e.selection.get()), new Set([a, b, created]));
    e.destroy();
  });

  it("supports groups inside frames, frames inside groups and cycle-safe layer drops", () => {
    const e = setup(); const frame = e.create("frame", { x: 0, y: 0, w: 400, h: 400 });
    const a = shape(e, 10, { parentId: frame }), b = shape(e, 50, { parentId: frame }), id = group(e, [a, b]);
    assert.equal(e.get(id)!.parentId, frame);
    e.moveInLayers([frame], id, "inside"); assert.equal(e.get(frame)!.parentId, null);
    const outerShape = shape(e, 500); const outer = group(e, [frame, outerShape]);
    assert.equal(e.frameAt({ x: 100, y: 100 }), frame);
    assert.equal(e.get(frame)!.parentId, outer);
    e.destroy();
  });

  it("does not drag inherited locked members or accept a locked destination", () => {
    const e = setup(); const a = shape(e, 0), b = shape(e, 40), id = group(e, [a, b]);
    const other = shape(e, 90), target = e.create("frame");
    e.update(id, { locked: true });
    e.moveInLayers([a, other], target, "inside");
    assert.equal(e.get(a)!.parentId, id); assert.equal(e.get(other)!.parentId, target);
    e.moveInLayers([other], id, "inside"); assert.equal(e.get(other)!.parentId, target);
    e.moveInLayers([other], a, "above"); assert.equal(e.get(other)!.parentId, target);
    e.destroy();
  });

  it("works on whiteboards and refuses mutations while read-only", () => {
    const e = setup(new Y.Doc(), "board"); const a = shape(e, 0), b = shape(e, 40);
    const id = group(e, [a, b]); assert.equal(e.get(id)!.type, "group");
    e.readOnly.set(true); assert.equal(e.ungroupSelection().length, 0);
    e.deleteShapes([id]); assert.equal(e.store.size, 3);
    e.nudge([id], 30, 0); assert.equal(e.get(a)!.x, 0); e.destroy();
  });
});

describe("group merge safety", () => {
  it("merges grouping against an independent child move", () => {
    const a = setup(); const x = shape(a, 0), y = shape(a, 40); const b = peer(a);
    const id = group(a, [x, y]); b.nudge([x], 17, 8); sync(a, b);
    assert.equal(a.get(x)!.parentId, id); assert.equal(a.get(x)!.x, 17); assert.equal(a.get(x)!.y, 18);
    assert.deepEqual(box(a.get(id)), box(b.get(id)));
    a.undo(); sync(a, b); assert.equal(a.get(x)!.parentId, null); assert.equal(a.get(x)!.x, 17);
    a.destroy(); b.destroy();
  });

  it("lets ungroup structure win while preserving a peer's group movement", () => {
    const a = setup(); const x = shape(a, 0), y = shape(a, 40), id = group(a, [x, y]); const b = peer(a);
    a.ungroupSelection(); b.nudge([id], 25, 9); sync(a, b);
    for (const e of [a, b]) {
      assert.equal(e.get(id), undefined); assert.equal(e.get(x)!.parentId, null);
      assert.equal(e.get(x)!.x, 25); assert.equal(e.get(y)!.x, 65);
    }
    a.destroy(); b.destroy();
  });

  it("cleans a group emptied only by merging independent child deletions", () => {
    const a = setup(); const x = shape(a, 0), y = shape(a, 40), id = group(a, [x, y]); const b = peer(a);
    a.deleteShapes([x]); b.deleteShapes([y]);
    assert.ok(a.get(id)); assert.ok(b.get(id)); sync(a, b);
    assert.equal(a.get(id), undefined); assert.equal(b.get(id), undefined);
    assert.equal(a.store.size, 0); assert.equal(b.store.size, 0);
    a.destroy(); b.destroy();
  });

  it("keeps a concurrently added child visible after its group is ungrouped", () => {
    const a = setup(); const x = shape(a, 0), y = shape(a, 40), id = group(a, [x, y]); const b = peer(a);
    a.ungroupSelection(); const added = shape(b, 90, { parentId: id }); sync(a, b);
    assert.equal(a.get(id), undefined); assert.ok(a.get(added));
    assert.equal(effectiveParent(a.store.all(), added), null);
    assert.ok(a.store.childIds(null).includes(added));
    a.destroy(); b.destroy();
  });

  it("invalidates a drilled scope when a peer hides or deletes it", () => {
    const a = setup(); const x = shape(a, 0), y = shape(a, 40), id = group(a, [x, y]); const b = peer(a);
    a.enterGroup(id); b.update(id, { hidden: true }); sync(a, b); assert.equal(a.activeGroup.get(), null);
    b.update(id, { hidden: false }); sync(a, b); a.enterGroup(id);
    b.deleteShapes([id]); sync(a, b); assert.equal(a.activeGroup.get(), null);
    a.destroy(); b.destroy();
  });
});

describe("group tree recovery", () => {
  it("keeps old documents, missing parents and concurrent cycles visible", () => {
    const shapes = new Map([
      ["old", parseShape("old", { x: 20 })],
      ["orphan", parseShape("orphan", { parentId: "gone" })],
      ["a", parseShape("a", { type: "group", parentId: "b" })],
      ["b", parseShape("b", { type: "group", parentId: "a" })],
      ["child", parseShape("child", { parentId: "a" })],
    ]);
    const index = childrenIndex(shapes);
    assert.equal(index.get(null)!.length, shapes.size);
    assert.deepEqual(topLevelIds(shapes, ["a", "b", "child"]), ["a", "b", "child"]);
    assert.equal(normalizeGroups(shapes).size, shapes.size);
    assert.equal(shapes.get("old")!.type, "rect");
  });

  it("walks deep hierarchies without recursion or dropped descendants", () => {
    const shapes = new Map<string, Shape>();
    for (let i = 0; i < 1500; i++) shapes.set(`g${i}`, parseShape(`g${i}`, { type: "group", parentId: i ? `g${i - 1}` : null }));
    shapes.set("leaf", parseShape("leaf", { x: 70, y: 80, w: 90, h: 100, parentId: "g1499" }));
    const index = childrenIndex(shapes);
    assert.equal(descendantsOf(index, "g0").length, 1500);
    assert.equal(ancestors(shapes, "leaf").length, 1500);
    const normalized = normalizeGroups(shapes);
    assert.deepEqual(box(normalized.get("g0")), { x: 70, y: 80, w: 90, h: 100 });
    assert.deepEqual(topLevelIds(shapes, ["g0", "g1499", "leaf"]), ["g0"]);
  });
});
