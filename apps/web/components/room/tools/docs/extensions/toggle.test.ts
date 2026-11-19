/** Verify toggle identities, browser-local disclosure keys and schema-safe insertion without a browser. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { getSchema, type Command, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { enterToggleBody, insertToggle, readToggleOpen, rekeyPastedToggles, Toggle, ToggleBody, ToggleSummary, toggleStateKey, writeToggleOpen } from "./toggle";

const schema = getSchema([StarterKit.configure({ undoRedo: false }), Toggle, ToggleSummary, ToggleBody]);
const paragraph = (text = "") => schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);
const toggle = (id: string, summary = "Summary", children = [paragraph("Inside")]) => schema.nodes.toggle!.create({ id }, [schema.nodes.toggleSummary!.create(null, summary ? schema.text(summary) : null), schema.nodes.toggleBody!.create(null, children)]);

test("an empty document fills with a paragraph instead of recursively filling a toggle body", () => {
  const doc = schema.topNodeType.createAndFill();
  assert.ok(doc);
  assert.equal(doc.firstChild!.type.name, "paragraph");
});

test("local state keys separate pages, toggles and delimiter-containing identities", () => {
  assert.notEqual(toggleStateKey("page-a", "toggle"), toggleStateKey("page-b", "toggle"));
  assert.notEqual(toggleStateKey("page", "one"), toggleStateKey("page", "two"));
  assert.notEqual(toggleStateKey("room:page", "toggle"), toggleStateKey("room", "page:toggle"));
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readToggleOpen(storage, "page", "one"), true);
  writeToggleOpen(storage, "page", "one", false);
  assert.equal(readToggleOpen(storage, "page", "one"), false);
  assert.equal(readToggleOpen(storage, "other-page", "one"), true);
  assert.equal(readToggleOpen(storage, "page", "two"), true);
  writeToggleOpen(storage, "page", "one", true);
  assert.equal(readToggleOpen(storage, "page", "one"), true);
});

test("disabled browser storage defaults open and cannot prevent disclosure changes", () => {
  assert.equal(readToggleOpen(null, "page", "id"), true);
  const denied = { getItem: () => { throw new Error("Unavailable"); }, setItem: () => { throw new Error("Unavailable"); } };
  assert.equal(readToggleOpen(denied, "page", "id"), true);
  assert.doesNotThrow(() => writeToggleOpen(denied, "page", "id", false));
});

test("nested toggles hold ordinary blocks and serialize identity without an open attribute", () => {
  const nested = toggle("outer", "Outer", [paragraph("First"), toggle("inner"), schema.nodes.bulletList!.create(null, schema.nodes.listItem!.create(null, [paragraph("Item"), paragraph("Child")]))]);
  assert.doesNotThrow(() => nested.check());
  assert.equal(nested.lastChild!.childCount, 3);
  assert.equal(nested.lastChild!.child(1).attrs.id, "inner");
  assert.equal(nested.toJSON().attrs!.id, "outer");
  assert.equal(Object.hasOwn(nested.toJSON().attrs!, "open"), false);
});

function insertion(doc: ReturnType<typeof schema.nodeFromJSON>, position: number, editable = true) {
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, position) });
  const tr = state.tr;
  const editor = { schema, isEditable: editable } as Editor;
  const result = insertToggle({ editor, state, tr, dispatch: () => {} } as Parameters<Command>[0]);
  return { result, tr };
}

test("inserting a toggle keeps neighboring blocks and the current line as its editable summary", () => {
  const doc = schema.nodes.doc!.create(null, [paragraph("Before"), paragraph("Summary"), paragraph("After")]);
  const { result, tr } = insertion(doc, doc.child(0).nodeSize + 1);
  assert.equal(result, true);
  assert.equal(tr.doc.childCount, 3);
  assert.equal(tr.doc.child(0).textContent, "Before");
  assert.equal(tr.doc.child(1).type.name, "toggle");
  assert.equal(tr.doc.child(1).firstChild!.textContent, "Summary");
  assert.ok(tr.doc.child(1).attrs.id);
  assert.equal(tr.doc.child(2).textContent, "After");
  assert.equal(tr.selection.$from.parent.type.name, "toggleSummary");
  assert.doesNotThrow(() => tr.doc.check());
});

test("readers and a list item's required first paragraph cannot be converted destructively", () => {
  const doc = schema.nodes.doc!.create(null, paragraph("Text"));
  assert.equal(insertion(doc, 1, false).result, false);
  const list = schema.nodes.doc!.create(null, schema.nodes.bulletList!.create(null, schema.nodes.listItem!.create(null, paragraph("Item"))));
  const attempted = insertion(list, 3);
  assert.equal(attempted.result, false);
  assert.equal(attempted.tr.docChanged, false);
});

test("pasted nested toggles receive new identities while text, marks and slice boundaries survive", () => {
  const original = toggle("outer", "Outer", [paragraph("Body"), toggle("inner")]);
  const slice = new Slice(Fragment.from(original), 0, 0);
  const copy = rekeyPastedToggles(slice);
  assert.notEqual(copy.content.firstChild!.attrs.id, "outer");
  assert.notEqual(copy.content.firstChild!.lastChild!.child(1).attrs.id, "inner");
  assert.equal(copy.content.firstChild!.textContent, original.textContent);
  assert.equal(original.attrs.id, "outer");
  assert.equal(copy.openStart, slice.openStart);
  assert.equal(copy.openEnd, slice.openEnd);
  assert.doesNotThrow(() => copy.content.firstChild!.check());
});

test("Enter enters an existing body without edits and supplies a paragraph for an atom-only body", () => {
  const existing = schema.nodes.doc!.create(null, [toggle("first"), paragraph("Outside")]);
  const state = EditorState.create({ schema, doc: existing });
  const entered = enterToggleBody(state.tr, 0);
  assert.equal(entered.docChanged, false);
  assert.equal(entered.selection.$from.parent.textContent, "Inside");
  const atoms = schema.nodes.doc!.create(null, [toggle("atoms", "Summary", [schema.nodes.horizontalRule!.create()]), paragraph("Outside")]);
  const inserted = enterToggleBody(EditorState.create({ schema, doc: atoms }).tr, 0);
  assert.equal(inserted.docChanged, true);
  assert.equal(inserted.doc.firstChild!.lastChild!.firstChild!.type.name, "paragraph");
  assert.equal(inserted.selection.$from.parent.type.name, "paragraph");
  assert.equal(inserted.selection.$from.node(-1).type.name, "toggleBody");
  assert.doesNotThrow(() => inserted.doc.check());
});
