import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { expandInstances, instanceContent, instancesOf, mainOf, overridableIn, virtualId, withOverrides } from "./components";
import { defaultsFor, parseShape, shapeEntries, type Shape, type ShapeProps } from "./shape";

const shape = (id: string, props: Partial<ShapeProps> & Pick<ShapeProps, "type">): Shape => ({ ...defaultsFor(props.type, "design"), ...props, id });

const main = shape("main", { type: "frame", x: 100, y: 100, w: 200, h: 80, component: true, fill: "var(--p-2)", name: "Button" });
const label = shape("label", { type: "text", x: 110, y: 110, w: 60, h: 21, text: "Save", parentId: "main", z: "a0" });
const icon = shape("icon", { type: "rect", x: 250, y: 110, w: 20, h: 20, parentId: "main", z: "a1", fill: "var(--foreground)" });

function world(...extra: Shape[]) {
  return new Map([main, label, icon, ...extra].map((s) => [s.id, s]));
}

describe("components", () => {
  it("finds the main component of an instance", () => {
    const inst = shape("i1", { type: "instance", x: 500, y: 40, instanceOf: "main" });
    const shapes = world(inst);
    assert.equal(mainOf(inst, (id) => shapes.get(id))?.id, "main");
    // A frame that isn't a component doesn't count.
    const other = shape("i2", { type: "instance", instanceOf: "icon" });
    assert.equal(mainOf(other, (id) => shapes.get(id)), undefined);
    assert.equal(mainOf(shape("i3", { type: "instance", instanceOf: "gone" }), (id) => shapes.get(id)), undefined);
  });

  it("shows the component's content where the instance sits", () => {
    const inst = shape("i1", { type: "instance", x: 500, y: 40, instanceOf: "main" });
    const content = instanceContent(inst, main, world(inst));
    assert.deepEqual(
      content.map((s) => [s.id, s.x, s.y, s.parentId]),
      [
        [virtualId("i1", "label"), 510, 50, "i1"],
        [virtualId("i1", "icon"), 650, 50, "i1"],
      ],
    );
  });

  it("applies overrides, ignoring values of the wrong type", () => {
    const changed = withOverrides(label, { label: { text: "Cancel", fill: "var(--p-6)", opacity: "x" as unknown as number } });
    assert.equal(changed.text, "Cancel");
    assert.equal(changed.fill, "var(--p-6)");
    assert.equal(changed.opacity, 1);
    assert.equal(withOverrides(icon, { label: { text: "x" } }), icon);
  });

  it("expands instances into frames of copies, following the main component", () => {
    const inst = shape("i1", { type: "instance", x: 500, y: 40, instanceOf: "main", overrides: { label: { text: "Cancel" } } });
    const out = expandInstances(world(inst));
    const frame = out.get("i1")!;
    assert.equal(frame.type, "frame");
    assert.equal(frame.fill, "var(--p-2)");
    assert.equal(frame.w, 200);
    assert.equal(out.get(virtualId("i1", "label"))!.text, "Cancel");
    // Change the main component: the instance follows without being touched.
    const changedMain = { ...main, fill: "var(--p-4)", w: 260 };
    const out2 = expandInstances(new Map([...world(inst), [main.id, changedMain]]));
    assert.equal(out2.get("i1")!.fill, "var(--p-4)");
    assert.equal(out2.get("i1")!.w, 260);
    // The main component itself is untouched.
    assert.equal(out2.get("main")!.type, "frame");
  });

  it("survives an instance that contains itself", () => {
    const loopMain = shape("loop", { type: "frame", component: true, w: 50, h: 50 });
    const inner = shape("inner", { type: "instance", instanceOf: "loop", parentId: "loop", x: 5, y: 5 });
    const out = expandInstances(new Map([loopMain, inner].map((s) => [s.id, s])));
    assert.ok(out.size < 40);
  });

  it("lists what can be overridden and where a component is used", () => {
    const inst = shape("i1", { type: "instance", instanceOf: "main" });
    const shapes = world(inst);
    assert.deepEqual(overridableIn(main, shapes).map((s) => s.id), ["label", "icon"]);
    assert.deepEqual(instancesOf("main", shapes).map((s) => s.id), ["i1"]);
  });

  it("stores overrides one key at a time and reads them back", () => {
    const inst = shape("i1", { type: "instance", instanceOf: "main", overrides: { label: { text: "Cancel", fill: "var(--p-6)" } } });
    const entries = Object.fromEntries(shapeEntries(inst, true));
    assert.equal(entries["o.label.text"], "Cancel");
    assert.equal(entries["o.label.fill"], "var(--p-6)");
    assert.equal(entries.overrides, undefined);
    // Defaults for optional properties aren't written.
    assert.equal(entries.layout, undefined);
    assert.equal(entries.instanceOf, "main");
    const back = parseShape("i1", entries);
    assert.deepEqual(back.overrides, inst.overrides);
  });
});
