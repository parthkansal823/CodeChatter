/** Shared toggle content with a stable identity and browser-local disclosure preferences. */
import { DOMParser, Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import { InputRule, mergeAttributes, Node, type Command, type Editor } from "@tiptap/react";

export type ToggleOptions = { pageKey: string };
const OPEN_EVENT = "cc-doc-toggle-open";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Encoding both identities avoids ambiguous separators and never depends on document position. */
export const toggleStateKey = (pageKey: string, toggleId: string) => `cc-docs:toggle:${JSON.stringify([pageKey, toggleId])}`;
export function readToggleOpen(storage: Pick<Storage, "getItem"> | null, pageKey: string, toggleId: string): boolean {
  try { return !storage || storage.getItem(toggleStateKey(pageKey, toggleId)) !== "closed"; } catch { return true; }
}
export function writeToggleOpen(storage: Pick<Storage, "setItem"> | null, pageKey: string, toggleId: string, open: boolean): void {
  try { storage?.setItem(toggleStateKey(pageKey, toggleId), open ? "open" : "closed"); } catch { /* Storage is optional. */ }
}
function browserStorage(pageKey: string): PreferenceStorage | null {
  if (!pageKey || typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}
function createToggle(editor: Editor, summary?: Fragment): ProseMirrorNode {
  const { nodes } = editor.schema;
  return nodes.toggle!.create({ id: globalThis.crypto.randomUUID() }, [nodes.toggleSummary!.create(null, summary), nodes.toggleBody!.create(null, nodes.paragraph!.create())]);
}
/** Enter always lands inside the body, even when its existing blocks contain no text cursor. */
export function enterToggleBody(tr: Transaction, position: number): Transaction {
  const toggle = tr.doc.nodeAt(position)!;
  const bodyStart = position + 1 + toggle.firstChild!.nodeSize;
  const bodyEnd = bodyStart + toggle.lastChild!.nodeSize - 1;
  let selection = TextSelection.findFrom(tr.doc.resolve(bodyStart + 1), 1, true);
  if (!selection || selection.from >= bodyEnd) {
    tr.insert(bodyStart + 1, tr.doc.type.schema.nodes.paragraph!.create());
    selection = TextSelection.create(tr.doc, bodyStart + 2);
  }
  return tr.setSelection(selection).scrollIntoView();
}
/** Clipboard copies get independent preferences; direct block moves retain the original ID. */
export function rekeyPastedToggles(slice: Slice): Slice {
  const rekey = (fragment: Fragment): Fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, index) => {
    const node = fragment.child(index);
    if (node.isText) return node;
    return node.type.create(node.type.name === "toggle" ? { ...node.attrs, id: globalThis.crypto.randomUUID() } : node.attrs, rekey(node.content), node.marks);
  }));
  return new Slice(rekey(slice.content), slice.openStart, slice.openEnd);
}
/** Slash conversion keeps the existing line as the summary and checks its parent's schema first. */
export const insertToggle: Command = ({ editor, tr, dispatch }) => {
  const { $from } = tr.selection;
  if (!editor.isEditable || !$from.parent.isTextblock || ["codeBlock", "toggleSummary"].includes($from.parent.type.name) || !$from.depth) return false;
  const from = $from.before(), toggle = createToggle(editor, $from.parent.content);
  const $before = tr.doc.resolve(from);
  if (!$before.parent.canReplace($before.index(), $before.index() + 1, Fragment.from(toggle))) return false;
  if (dispatch) tr.replaceWith(from, from + $from.parent.nodeSize, toggle).setSelection(TextSelection.create(tr.doc, from + 2)).scrollIntoView();
  return true;
};

export const ToggleSummary = Node.create({
  name: "toggleSummary", content: "inline*", defining: true,
  parseHTML() { return [{ tag: "div[data-toggle-summary]" }, { tag: "summary" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-summary": "", class: "cc-doc-toggle-summary" }), 0]; },
});
export const ToggleBody = Node.create({
  name: "toggleBody", content: "block+", defining: true,
  parseHTML() { return [{ tag: "div[data-toggle-body]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-body": "", class: "cc-doc-toggle-body" }), 0]; },
});

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle", priority: 900, group: "block", content: "toggleSummary toggleBody", defining: true,
  addOptions() { return { pageKey: "" }; },
  addAttributes() {
    return { id: { default: null, parseHTML: (element) => element.getAttribute("data-toggle-id") || globalThis.crypto.randomUUID(), renderHTML: (attributes) => ({ "data-toggle-id": attributes.id }) } };
  },
  parseHTML() {
    return [{ tag: "div[data-toggle]" }, {
      tag: "details",
      getContent: (element, schema) => {
        const parser = DOMParser.fromSchema(schema), body = element.cloneNode(true) as HTMLElement;
        const summary = Array.from(body.children).find((child) => child.tagName === "SUMMARY");
        const summaryContent = summary ? parser.parse(summary, { topNode: schema.nodes.toggleSummary!.create() }).content : Fragment.empty;
        summary?.remove();
        return Fragment.fromArray([schema.nodes.toggleSummary!.create(null, summaryContent), parser.parse(body, { topNode: schema.nodes.toggleBody!.create() })]);
      },
    }];
  },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "", class: "cc-doc-toggle" }), 0]; },

  addNodeView() {
    const { pageKey } = this.options;
    return ({ editor, node: initialNode, getPos }) => {
      let node = initialNode, id = String(node.attrs.id ?? "");
      const storage = browserStorage(pageKey);
      let open = readToggleOpen(storage, pageKey, id);
      const dom = document.createElement("div");
      dom.className = "cc-doc-toggle"; dom.setAttribute("data-toggle", "");
      const contentDOM = document.createElement("div"); contentDOM.className = "cc-doc-toggle-content";
      const button = document.createElement("button");
      button.type = "button"; button.className = "cc-doc-toggle-arrow"; button.contentEditable = "false"; button.textContent = "▸";
      const render = () => {
        dom.dataset.toggleId = id; dom.dataset.open = String(open);
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", `Toggle ${node.firstChild?.textContent.trim().slice(0, 120) || "content"}`);
      };
      const change = (next: boolean) => { open = next; writeToggleOpen(storage, pageKey, id, open); render(); };
      const onOpen = () => change(true);
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        const position = getPos();
        if (open && typeof position === "number") {
          const { from, to } = editor.state.selection, bodyStart = position + 1 + node.firstChild!.nodeSize;
          if (from >= bodyStart && to < position + node.nodeSize) editor.commands.setTextSelection(bodyStart - 1);
        }
        change(!open);
      };
      button.addEventListener("click", onClick); dom.addEventListener(OPEN_EVENT, onOpen);
      dom.append(button, contentDOM); render();
      return {
        dom, contentDOM,
        update: (next) => {
          if (next.type.name !== "toggle") return false;
          node = next;
          const nextId = String(node.attrs.id ?? "");
          if (nextId !== id) { id = nextId; open = readToggleOpen(storage, pageKey, id); }
          render(); return true;
        },
        stopEvent: (event) => button.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) => mutation.type !== "selection" && (button.contains(mutation.target) || mutation.target === dom),
        destroy: () => {
          button.removeEventListener("click", onClick); dom.removeEventListener(OPEN_EVENT, onOpen);
          let exists = false;
          editor.state.doc.descendants((current) => { if (current.type.name === "toggle" && current.attrs.id === id) exists = true; });
          if (!exists) { try { storage?.removeItem(toggleStateKey(pageKey, id)); } catch { /* Storage is optional. */ } }
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!editor.isEditable || !empty || $from.parent.type.name !== "toggleSummary" || $from.parentOffset !== $from.parent.content.size) return false;
        const position = $from.before($from.depth - 1);
        const dom = editor.view.nodeDOM(position);
        if (dom instanceof HTMLElement) dom.dispatchEvent(new Event(OPEN_EVENT));
        editor.view.dispatch(enterToggleBody(editor.state.tr, position));
        return true;
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!editor.isEditable || !empty || $from.parent.type.name !== "toggleSummary" || $from.parentOffset || $from.parent.content.size) return false;
        const position = $from.before($from.depth - 1), toggle = editor.state.doc.nodeAt(position)!;
        const content = Fragment.from(editor.schema.nodes.paragraph!.create()).append(toggle.lastChild!.content);
        const tr = editor.state.tr.replaceWith(position, position + toggle.nodeSize, content);
        editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, position + 1)).scrollIntoView()); return true;
      },
    };
  },

  addInputRules() {
    return [new InputRule({ find: /^> $/, handler: ({ state, range }) => {
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.name !== "paragraph" || $from.parent.textContent !== ">" || !$from.depth) return null;
      const from = $from.before(), toggle = createToggle(this.editor), $before = state.doc.resolve(from);
      if (!$before.parent.canReplace($before.index(), $before.index() + 1, Fragment.from(toggle))) return null;
      const tr = state.tr.replaceWith(from, from + $from.parent.nodeSize, toggle);
      tr.setSelection(TextSelection.create(tr.doc, from + 2));
    } })];
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      props: { transformPasted: rekeyPastedToggles },
      appendTransaction: (transactions, _old, state) => {
        if (!this.editor.isEditable || !transactions.some((transaction) => transaction.docChanged)) return null;
        const tr = state.tr;
        state.doc.descendants((node, position) => {
          if (node.type.name === "toggle" && (typeof node.attrs.id !== "string" || !node.attrs.id)) tr.setNodeMarkup(position, undefined, { ...node.attrs, id: globalThis.crypto.randomUUID() });
        });
        return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
      },
    })];
  },
});
