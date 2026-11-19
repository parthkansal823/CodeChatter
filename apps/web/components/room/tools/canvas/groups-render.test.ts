/** Group rendering, export and pointer gestures preserve children and inherited state. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Y from "yjs";

import { expandInstances, overridableIn, virtualId } from "./components";
import { Editor } from "./editor";
import { exportSvg, frameHtml, shapeCss, type ExportContext } from "./export";
import { Interaction, type PointerInfo } from "./interaction";
import { defaultsFor, type Shape, type ShapeProps } from "./shape";
import { effectiveHidden, effectiveLocked } from "./tree";

const shape = (id: string, props: Partial<ShapeProps> & Pick<ShapeProps, "type">): Shape => ({ ...defaultsFor(props.type, "design"), ...props, id });
const measure: ExportContext["measure"] = (text, font) => text.length * font.size * 0.5;
const context = (...shapes: Shape[]): ExportContext => ({ shapes: new Map(shapes.map((s) => [s.id, s])), resolve: (color) => color, measure, fonts: { sans: "sans-serif", note: "monospace" } });
const pointer = (x: number, y: number, shapeId: string | null = null, handle: PointerInfo["hit"]["handle"] = null): PointerInfo => ({ screen: { x, y }, world: { x, y }, button: 0, shift: false, alt: true, pressure: 0.5, hit: { shapeId, frameBody: false, handle } });

function scene() {
  const doc = new Y.Doc();
  const editor = new Editor(doc, "board", measure);
  let group = "", a = "", b = "";
  editor.change(() => {
    group = editor.create("group");
    a = editor.create("rect", { x: 10, y: 20, w: 20, h: 10, parentId: group });
    b = editor.create("rect", { x: 50, y: 30, w: 20, h: 20, parentId: group });
  });
  return { doc, editor, interaction: new Interaction(editor), group, a, b };
}

describe("group render and export", () => {
  it("exports transparent nested groups at their children's bounds, ignoring stale group paint and rotation", () => {
    const outer = shape("outer", { type: "group", x: -999, y: -999, w: 2000, h: 2000, fill: "var(--brand)", stroke: "var(--brand)", strokeWidth: 99, radius: 20, rotation: 45, opacity: 0.5 });
    const inner = shape("inner", { type: "group", parentId: "outer" });
    const first = shape("first", { type: "rect", parentId: "inner", x: 10, y: 20, w: 40, h: 20, strokeWidth: 0 });
    const last = shape("last", { type: "rect", parentId: "outer", x: 70, y: 30, w: 30, h: 40, strokeWidth: 0, z: "a1" });
    const ctx = context(outer, inner, first, last);
    const out = exportSvg(["outer", "first"], ctx)!;
    assert.equal(out.width, 90);
    assert.equal(out.height, 50);
    assert.match(out.svg, /viewBox="10 20 90 50"/);
    assert.equal((out.svg.match(/<rect /g) ?? []).length, 2);
    assert.match(out.svg, /<g opacity="0.5">/);
    assert.doesNotMatch(out.svg, /clipPath|rotate\(|var\(--brand\)/);
    assert.doesNotMatch(shapeCss(outer, ctx), /background:|border:|border-radius:|transform:/);
  });

  it("retains the containing frame's clipping without adding a group clip", () => {
    const frame = shape("frame", { type: "frame", x: 100, y: 100, w: 100, h: 80 });
    const group = shape("group", { type: "group", parentId: "frame" });
    const child = shape("child", { type: "ellipse", parentId: "group", x: 170, y: 150, w: 90, h: 70 });
    const svg = exportSvg(["frame"], context(frame, group, child))!.svg;
    assert.equal((svg.match(/<clipPath /g) ?? []).length, 1);
    assert.match(svg, /<g clip-path="url\(#clip-0\)"><ellipse /);
    assert.match(svg, /viewBox="100 100 100 80"/);
  });

  it("hands groups off as visible-overflow containers with derived relative child positions", () => {
    const frame = shape("frame", { type: "frame", x: 100, y: 100, w: 100, h: 80, name: "Screen" });
    const group = shape("group", { type: "group", parentId: "frame", name: "Group", fill: "var(--brand)", strokeWidth: 99, radius: 8 });
    const child = shape("child", { type: "rect", parentId: "group", x: 120, y: 130, w: 40, h: 20, name: "Child" });
    const html = frameHtml("frame", context(frame, group, child))!;
    assert.match(html, /\.group \{[^}]*left: 20px;[^}]*top: 30px;[^}]*width: 40px;[^}]*overflow: visible;/);
    assert.match(html, /\.child \{[^}]*left: 0px;[^}]*top: 0px;/);
    assert.doesNotMatch(/\.group \{([^}]*)\}/.exec(html)![1]!, /background:|border:|border-radius:|overflow: hidden;/);
    assert.match(html, /\.screen \{[^}]*overflow: hidden;/);
    assert.match(html, /<div class="group">\s+<div class="child">/);
  });

  it("does not export a selected descendant of a hidden group", () => {
    const group = shape("group", { type: "group", hidden: true });
    const child = shape("child", { type: "rect", parentId: "group" });
    const ctx = context(group, child);
    assert.equal(exportSvg(["group"], ctx), null);
    assert.equal(exportSvg(["child"], ctx), null);
    assert.equal(child.hidden, false);
  });

  it("expands grouped component content with inherited flags and current main edits", () => {
    const main = shape("main", { type: "frame", component: true, x: 100, y: 100, w: 200, h: 100 });
    const group = shape("group", { type: "group", parentId: "main", locked: true });
    const label = shape("label", { type: "text", parentId: "group", x: 120, y: 110, w: 50, h: 20, text: "Before" });
    const instance = shape("instance", { type: "instance", x: 400, y: 200, instanceOf: "main", overrides: { label: { fill: "var(--brand)" } } });
    const ctx = context(main, group, label, instance);
    const first = expandInstances(ctx.shapes);
    const childId = virtualId(instance.id, label.id), groupId = virtualId(instance.id, group.id);
    assert.equal(first.get(childId)!.parentId, groupId);
    assert.equal(first.get(childId)!.x, 420);
    assert.equal(first.get(groupId)!.x, 420);
    assert.equal(effectiveLocked(first, childId), true);
    assert.equal(first.get(childId)!.locked, false);
    assert.deepEqual(overridableIn(main, ctx.shapes).map((s) => s.id), ["label"]);
    const changed = new Map(ctx.shapes);
    changed.set(label.id, { ...label, x: 130, text: "After" });
    changed.set(group.id, { ...group, hidden: true });
    const second = expandInstances(changed);
    assert.equal(second.get(childId)!.x, 430);
    assert.equal(second.get(groupId)!.x, 430);
    assert.equal(second.get(childId)!.text, "After");
    assert.equal(second.get(childId)!.fill, "var(--brand)");
    assert.equal(effectiveHidden(second, childId), true);
    const exported = exportSvg([instance.id], { ...ctx, shapes: first })!;
    assert.match(exported.svg, /Before/);
    assert.match(exported.svg, /fill="var\(--brand\)"/);
    assert.equal((exported.svg.match(/<clipPath /g) ?? []).length, 1);
    assert.doesNotMatch(exportSvg([instance.id], { ...ctx, shapes: second })!.svg, /After/);
  });
});

describe("group pointer gestures", () => {
  it("selects and moves the whole group exactly once, then allows an entered child", () => {
    const { editor, interaction, group, a, b } = scene();
    interaction.down(pointer(15, 25, a), false);
    assert.deepEqual(editor.selection.get(), [group]);
    interaction.move(pointer(35, 40, a));
    interaction.up(pointer(35, 40, a));
    assert.deepEqual([editor.get(a)!.x, editor.get(a)!.y, editor.get(b)!.x, editor.get(b)!.y], [30, 35, 70, 45]);
    assert.deepEqual(editor.bounds(group), { x: 30, y: 35, w: 60, h: 30 });
    assert.equal(editor.enterGroup(group), true);
    interaction.down(pointer(35, 40, a), false);
    interaction.up(pointer(35, 40, a));
    assert.deepEqual(editor.selection.get(), [a]);
  });

  it("scales each group descendant once and undoes the gesture together", () => {
    const { editor, interaction, group, a, b } = scene();
    editor.select([group]);
    interaction.down(pointer(70, 50, null, "se"), false);
    interaction.move(pointer(130, 80));
    interaction.up(pointer(130, 80));
    assert.deepEqual([editor.get(a)!.x, editor.get(a)!.y, editor.get(a)!.w, editor.get(a)!.h], [10, 20, 40, 20]);
    assert.deepEqual([editor.get(b)!.x, editor.get(b)!.y, editor.get(b)!.w, editor.get(b)!.h], [90, 40, 40, 40]);
    assert.deepEqual(editor.bounds(group), { x: 10, y: 20, w: 120, h: 60 });
    editor.undo();
    assert.deepEqual(editor.bounds(group), { x: 10, y: 20, w: 60, h: 30 });
    assert.equal(editor.get(a)!.w, 20);
    assert.equal(editor.get(b)!.x, 50);
  });

  it("leaves inherited locked and hidden children out of pointer and eraser edits", () => {
    const { editor, interaction, group, a } = scene();
    editor.update(group, { locked: true });
    interaction.down(pointer(15, 25, a), false);
    interaction.move(pointer(45, 55, a));
    interaction.up(pointer(45, 55, a));
    assert.equal(editor.get(a)!.x, 10);
    interaction.setProbe(() => [a]);
    editor.tool.set("eraser");
    interaction.down(pointer(15, 25), false);
    assert.equal(editor.erasing.get().size, 0);
    interaction.up(pointer(15, 25));
    editor.update(group, { locked: false, hidden: true });
    interaction.down(pointer(15, 25), false);
    assert.equal(editor.erasing.get().size, 0);
    interaction.up(pointer(15, 25));
    assert.equal(editor.get(a)!.hidden, false);
    assert.equal(editor.get(a)!.locked, false);
  });
});
