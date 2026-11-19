/** Exercise whole-block boundaries and real Yjs/ProseMirror merge behavior so concurrent moves retain exactly one block. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Schema, type Node as ProseMirrorNode, type NodeSpec } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { initProseMirrorDoc, prosemirrorToYDoc, updateYFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { dispatchBlockMove } from "./block-handle";
import { BLOCK_TYPES, blockIdFromYType, blockMoveTransaction, findBlock, findBlockByIdentity, nextMoveToken, repairBlockIdentities, siblingBoundary } from "./block-move";

const specs: Record<string, NodeSpec> = {
  doc: { content: "block+" }, text: { group: "inline" },
  paragraph: { group: "block", content: "inline*" },
  bulletList: { group: "block", content: "listItem+" },
  listItem: { content: "paragraph block*" },
  toggle: { group: "block", content: "toggleSummary toggleBody" },
  toggleSummary: { content: "inline*" },
  toggleBody: { content: "block+" },
  table: { group: "block", content: "tableRow+" },
  tableRow: { content: "tableCell+" },
  tableCell: { content: "block+" },
};
for (const [name, spec] of Object.entries(specs)) if (BLOCK_TYPES.includes(name)) spec.attrs = { blockId: { default: null }, blockMoveToken: { default: "" } };
const schema = new Schema({ nodes: specs });
const p = (id: string, text = id) => schema.node("paragraph", { blockId: id }, text ? schema.text(text) : undefined);
const docOf = (...nodes: ProseMirrorNode[]) => schema.node("doc", null, nodes);
const stateOf = (doc: ProseMirrorNode, position = 1) => EditorState.create({ schema, doc, selection: TextSelection.near(doc.resolve(position)) });
function position(doc: ProseMirrorNode, text: string) {
  let found = 0;
  doc.descendants((node, pos) => { if (node.isText && node.text === text) found = pos; });
  return found;
}
const ids = (doc: ProseMirrorNode) => Array.from({ length: doc.childCount }, (_, i) => doc.child(i).attrs.blockId);

test("a list paragraph moves its whole item including nested children", () => {
  const nested = schema.node("bulletList", { blockId: "nested-list" }, schema.node("listItem", { blockId: "nested-item" }, p("nested", "child")));
  const first = schema.node("listItem", { blockId: "first-item" }, [p("one", "parent"), nested]);
  const second = schema.node("listItem", { blockId: "second-item" }, p("two", "next"));
  const doc = docOf(schema.node("bulletList", { blockId: "list" }, [first, second]));
  const state = stateOf(doc, position(doc, "parent"));
  const block = findBlock(doc, state.selection.from)!;
  assert.equal(block.node.type.name, "listItem");
  assert.equal(block.node.childCount, 2);
  const moved = blockMoveTransaction(state, block, siblingBoundary(block, 1)!, "0000000000000001:a")!;
  assert.equal(moved.doc.firstChild!.child(1).textContent, "parentchild");
  assert.equal(moved.doc.firstChild!.child(1).attrs.blockId, "first-item");
});

test("a toggle summary moves its whole toggle while body paragraphs remain sibling blocks", () => {
  const toggle = schema.node("toggle", { blockId: "toggle" }, [schema.node("toggleSummary", null, schema.text("Summary")), schema.node("toggleBody", null, [p("inside-a"), p("inside-b")])]);
  const doc = docOf(toggle, p("outside"));
  const summary = findBlock(doc, position(doc, "Summary"))!;
  assert.equal(summary.node.type.name, "toggle");
  const moved = blockMoveTransaction(stateOf(doc, position(doc, "Summary")), summary, doc.content.size, "0000000000000001:a")!;
  assert.equal(moved.doc.lastChild!.textContent, "Summaryinside-ainside-b");
  const inside = findBlock(doc, position(doc, "inside-a"))!;
  assert.equal(inside.node.type.name, "paragraph");
  assert.equal(inside.parent.type.name, "toggleBody");
  assert.equal(blockMoveTransaction(stateOf(doc), inside, doc.content.size), null);
});

test("table cell content resolves to its complete table and a lone block cannot move", () => {
  const table = schema.node("table", { blockId: "table" }, schema.node("tableRow", null, schema.node("tableCell", null, p("cell", "in cell"))));
  const doc = docOf(table, p("outside"));
  assert.equal(findBlock(doc, position(doc, "in cell"))!.node.type.name, "table");
  const single = docOf(p("alone"));
  assert.equal(siblingBoundary(findBlock(single, 1)!, -1), null);
  assert.equal(siblingBoundary(findBlock(single, 1)!, 1), null);
  assert.equal(blockMoveTransaction(stateOf(single), findBlock(single, 1)!, single.content.size), null);
});

test("sibling moves preserve content, identity and cursor and reject inside-block destinations", () => {
  const doc = docOf(p("a"), p("b"), p("c"));
  const state = stateOf(doc, position(doc, "b"));
  const block = findBlock(doc, state.selection.from)!;
  assert.equal(blockMoveTransaction(state, block, block.from + 1), null);
  const moved = blockMoveTransaction(state, block, siblingBoundary(block, -1)!, "0000000000000001:a")!;
  assert.deepEqual(ids(moved.doc), ["b", "a", "c"]);
  assert.equal(moved.selection.$from.parent.textContent, "b");
  assert.equal(moved.doc.textContent, "bac");
  assert.ok(nextMoveToken("0000000000000001:z", "a") > "0000000000000001:z");
});

test("ordinary split or pasted identities are rekeyed rather than deleted", () => {
  const doc = docOf(p("same", "first"), p("same", "second"));
  const repaired = repairBlockIdentities(stateOf(doc), () => "fresh")!;
  assert.deepEqual(ids(repaired.doc), ["same", "fresh"]);
  assert.equal(repaired.doc.textContent, "firstsecond");
});

test("a deleted drag source cannot move the unrelated block now occupying its old position", () => {
  const doc = docOf(p("a"), p("b"), p("c"));
  const before = findBlockByIdentity(doc, "b", 0)!;
  const after = docOf(p("a"), p("c"));
  assert.equal(findBlockByIdentity(after, "b", before.from), null);
  assert.equal(findBlockByIdentity(doc, "b", 0)!.node.attrs.blockId, "b");
});

test("a viewer cannot dispatch a block move", () => {
  const doc = docOf(p("a"), p("b"));
  let dispatched = false;
  const view = { editable: false, state: stateOf(doc), dispatch: () => { dispatched = true; } } as unknown as EditorView;
  assert.equal(dispatchBlockMove(view, findBlock(doc, 1)!, doc.content.size), false);
  assert.equal(dispatched, false);
});

test("concurrent move reconciliation chooses the highest token and keeps its children intact", () => {
  const a = schema.node("bulletList", { blockId: "same", blockMoveToken: "0000000000000001:a" }, schema.node("listItem", { blockId: "item" }, p("child")));
  const b = schema.node("bulletList", { blockId: "same", blockMoveToken: "0000000000000001:b" }, schema.node("listItem", { blockId: "item" }, p("child")));
  const repaired = repairBlockIdentities(stateOf(docOf(a, p("other"), b)))!;
  assert.deepEqual(ids(repaired.doc), ["other", "same"]);
  assert.equal(repaired.doc.lastChild!.firstChild!.attrs.blockId, "item");
  assert.equal(repaired.doc.lastChild!.firstChild!.firstChild!.attrs.blockId, "child");
});

function applyMove(doc: Y.Doc, id: string, direction: -1 | 1, unique: string) {
  const fragment = doc.getXmlFragment("content");
  const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
  const index = ids(current).indexOf(id);
  let from = 0;
  for (let i = 0; i < index; i++) from += current.child(i).nodeSize;
  const state = stateOf(current, from + 1), block = findBlock(current, from + 1)!;
  const moved = blockMoveTransaction(state, block, siblingBoundary(block, direction)!, nextMoveToken(block.node.attrs.blockMoveToken, unique))!;
  doc.transact(() => updateYFragment(doc, fragment, moved.doc, meta), "test-move");
}

function reconcile(doc: Y.Doc, reconcileCopies = false) {
  const fragment = doc.getXmlFragment("content");
  const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
  const repair = repairBlockIdentities(stateOf(current), undefined, { reconcileCopies });
  if (repair) doc.transact(() => updateYFragment(doc, fragment, repair.doc, meta), "test-repair");
}

for (const sameSource of [false, true]) test(`real Yjs binding merges concurrent ${sameSource ? "same" : "different"}-source moves without duplicate or lost blocks`, () => {
  const a = prosemirrorToYDoc(docOf(p("a"), p("b"), p("c"), p("d")), "content");
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  applyMove(a, "b", -1, "ana");
  applyMove(b, sameSource ? "b" : "c", 1, "ben");
  const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
  reconcile(a); reconcile(b);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  reconcile(a); reconcile(b);
  const read = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment("content"), schema);
  assert.deepEqual(ids(read(a)), ids(read(b)));
  assert.deepEqual([...ids(read(a))].sort(), ["a", "b", "c", "d"]);
  assert.equal(read(a).childCount, 4);
  assert.deepEqual(read(a).toJSON(), read(b).toJSON());
  a.destroy(); b.destroy();
});

for (const order of ["winner first", "loser first", "concurrent"] as const) test(`real Yjs undo after concurrent moves keeps one original block: ${order}`, () => {
  const a = prosemirrorToYDoc(docOf(p("a"), p("b"), p("c"), p("d")), "content"), b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const undoA = new Y.UndoManager(a.getXmlFragment("content"), { trackedOrigins: new Set(["test-move"]) });
  const undoB = new Y.UndoManager(b.getXmlFragment("content"), { trackedOrigins: new Set(["test-move"]) });
  const read = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment("content"), schema);
  const settle = () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b);
      Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
      // The live plugin uses this mode for ySyncPluginKey.isChangeOrigin, including Undo/Redo.
      reconcile(a, true); reconcile(b, true);
    }
    assert.deepEqual(read(a).toJSON(), read(b).toJSON());
    assert.deepEqual([...ids(read(a))].sort(), ["a", "b", "c", "d"]);
    assert.equal(read(a).childCount, 4);
  };
  applyMove(a, "b", -1, "ana");
  applyMove(b, "b", 1, "ben");
  settle();
  if (order === "concurrent") { undoA.undo(); reconcile(a, true); undoB.undo(); reconcile(b, true); settle(); }
  else {
    const first = order === "winner first" ? undoB : undoA, second = order === "winner first" ? undoA : undoB;
    first.undo(); reconcile(first === undoA ? a : b, true); settle();
    second.undo(); reconcile(second === undoA ? a : b, true); settle();
  }
  undoA.destroy(); undoB.destroy(); a.destroy(); b.destroy();
});

test("legacy blocks acquire the same identity before disconnected peers concurrently move them", () => {
  const legacy = ["one", "two", "three", "four"].map((text) => schema.node("paragraph", null, schema.text(text)));
  const a = prosemirrorToYDoc(docOf(...legacy), "content"), b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const migrate = (doc: Y.Doc) => {
    const fragment = doc.getXmlFragment("content");
    const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
    const shared = new Map<ProseMirrorNode, string>();
    meta.mapping.forEach((node, type) => { if (type instanceof Y.XmlElement && !Array.isArray(node)) shared.set(node, blockIdFromYType(type)); });
    const repaired = repairBlockIdentities(stateOf(current), (node) => shared.get(node)!)!;
    doc.transact(() => updateYFragment(doc, fragment, repaired.doc, meta), "test-migration");
    return ids(repaired.doc);
  };
  const expected = migrate(a);
  assert.deepEqual(migrate(b), expected);
  applyMove(a, expected[1], -1, "ana");
  applyMove(b, expected[1], 1, "ben");
  const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
  reconcile(a); reconcile(b);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const read = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment("content"), schema);
  assert.deepEqual([...ids(read(a))].sort(), [...expected].sort());
  assert.deepEqual(read(a).toJSON(), read(b).toJSON());
  a.destroy(); b.destroy();
});
