/** A live editor overlay moves whole sibling blocks without a drag-handle package and separates each move in collaborative undo. */
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { BLOCK_TYPES, blockIdFromYType, blockMoveTransaction, findBlock, findBlockByIdentity, repairBlockIdentities, siblingBoundary, type BlockRange } from "./block-move";

const MIME = "application/x-codechatter-doc-block";
const handleKey = new PluginKey("ccBlockHandle");

/** Identity belongs in the shared schema, including previews and headless import/export; open state never belongs here. */
export const BlockIdentity = Extension.create({
  name: "blockIdentity",
  addGlobalAttributes() {
    return [{ types: BLOCK_TYPES, attributes: {
      blockId: { default: null, parseHTML: (element) => element.getAttribute("data-block-id"), renderHTML: (attrs) => attrs.blockId ? { "data-block-id": attrs.blockId } : {} },
      blockMoveToken: { default: "", rendered: false },
    } }];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      appendTransaction: (transactions, _old, state) => {
        if (!editor.isEditable || !transactions.some((transaction) => transaction.docChanged)) return null;
        const sharedIds = new Map<ProseMirrorNode, string>();
        const mapping = ySyncPluginKey.getState(state)?.binding?.mapping as Map<Y.AbstractType<unknown>, ProseMirrorNode | ProseMirrorNode[]> | undefined;
        mapping?.forEach((node, type) => { if (type instanceof Y.XmlElement && !Array.isArray(node)) sharedIds.set(node, blockIdFromYType(type)); });
        const remote = transactions.some((transaction) => transaction.getMeta(ySyncPluginKey)?.isChangeOrigin);
        const repair = repairBlockIdentities(state, (node) => !node.attrs.blockId && sharedIds.get(node) || crypto.randomUUID(), { reconcileCopies: remote });
        // New paragraphs acquire IDs in the edit's own undo item; remote normalization is not a local edit.
        if (repair && !remote) repair.setMeta("addToHistory", true);
        return repair;
      },
      props: {
        transformPasted: (slice) => {
          const copy = (fragment: Fragment): Fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, i) => {
            const node = fragment.child(i);
            const attrs = "blockId" in node.attrs ? { ...node.attrs, blockId: crypto.randomUUID(), blockMoveToken: "" } : node.attrs;
            return node.isText ? node : node.type.create(attrs, copy(node.content), node.marks);
          }));
          return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
        },
      },
    })];
  },
});

export function dispatchBlockMove(view: EditorView, block: BlockRange, target: number): boolean {
  if (!view.editable) return false;
  const transaction = blockMoveTransaction(view.state, block, target);
  if (!transaction) return false;
  const manager = yUndoPluginKey.getState(view.state)?.undoManager;
  manager?.stopCapturing();
  view.dispatch(transaction);
  manager?.stopCapturing();
  view.focus();
  return true;
}

export const BlockMoves = Extension.create<{ pageId: string }>({
  name: "blockMoves",
  addOptions() { return { pageId: "" }; },
  addKeyboardShortcuts() {
    const move = (direction: -1 | 1) => {
      const view = this.editor.view;
      const block = findBlock(view.state.doc, view.state.selection.from);
      const target = block && siblingBoundary(block, direction);
      return block && target !== null ? dispatchBlockMove(view, block, target) : false;
    };
    return { "Alt-Shift-ArrowUp": () => move(-1), "Alt-Shift-ArrowDown": () => move(1) };
  },
  addProseMirrorPlugins() {
    const pageId = this.options.pageId;
    return [new Plugin({ key: handleKey, view: (view) => {
      const host = view.dom.parentElement!;
      host.classList.add("cc-doc-block-host");
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cc-doc-block-handle";
      handle.setAttribute("aria-label", "Move block");
      handle.title = "Drag to move. Alt+Shift+Up or Down moves the block.";
      handle.draggable = true;
      handle.hidden = true;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 20");
      icon.setAttribute("aria-hidden", "true");
      for (const cx of [5, 11]) for (const cy of [4, 10, 16]) {
        const dot = document.createElementNS(icon.namespaceURI, "circle");
        dot.setAttribute("cx", String(cx)); dot.setAttribute("cy", String(cy)); dot.setAttribute("r", "1.4"); icon.append(dot);
      }
      handle.append(icon);
      const line = document.createElement("div");
      line.className = "cc-doc-drop-line";
      line.setAttribute("aria-hidden", "true");
      line.hidden = true;
      host.append(handle, line);
      const nonce = crypto.randomUUID();
      let current: BlockRange | null = null;
      let dragging: { id: string; from: number } | null = null;
      let target: number | null = null;
      let frame = 0;
      let lastPointer: { left: number; top: number } | null = null;
      let hovered = false;
      let activeDom: HTMLElement | null = null;
      const show = (block: BlockRange | null) => {
        activeDom?.classList.remove("cc-doc-block-active");
        activeDom = null;
        current = block;
        handle.hidden = !view.editable || !block;
        if (!block || !view.editable) return;
        const dom = view.nodeDOM(block.from);
        if (!(dom instanceof HTMLElement)) { handle.hidden = true; return; }
        const rect = dom.getBoundingClientRect(), container = host.getBoundingClientRect();
        handle.style.left = `${rect.left - container.left - 25}px`;
        handle.style.top = `${rect.top - container.top}px`;
        activeDom = dom;
        dom.classList.add("cc-doc-block-active");
      };
      const pointerBlock = () => {
        const position = lastPointer && view.posAtCoords(lastPointer);
        show(position ? findBlock(view.state.doc, position.pos) : view.hasFocus() ? findBlock(view.state.doc, view.state.selection.from) : null);
      };
      const pointer = (event: MouseEvent) => {
        hovered = true;
        lastPointer = { left: event.clientX, top: event.clientY };
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!dragging) pointerBlock(); });
      };
      const leave = (event: MouseEvent) => {
        if (event.relatedTarget instanceof Node && handle.contains(event.relatedTarget)) return;
        hovered = false; lastPointer = null;
        if (!dragging) show(view.hasFocus() ? findBlock(view.state.doc, view.state.selection.from) : null);
      };
      const start = (event: DragEvent) => {
        if (!view.editable || !current || !event.dataTransfer) { event.preventDefault(); return; }
        dragging = { id: String(current.node.attrs.blockId ?? ""), from: current.from };
        event.dataTransfer.setData(MIME, JSON.stringify({ pageId, nonce }));
        event.dataTransfer.effectAllowed = "move";
        const dom = view.nodeDOM(current.from);
        if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
      };
      const finish = () => { dragging = null; target = null; line.hidden = true; };
      const over = (event: DragEvent) => {
        target = null; line.hidden = true;
        if (!dragging || !view.editable || !event.dataTransfer?.types.includes(MIME)) return;
        const source = findBlockByIdentity(view.state.doc, dragging.id, dragging.from);
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!source || !hit) return;
        const resolved = view.state.doc.resolve(hit.pos);
        for (let depth = resolved.depth; depth > 0; depth--) if (["tableCell", "tableHeader"].includes(resolved.node(depth).type.name)) return;
        const destination = findBlock(view.state.doc, hit.pos);
        if (!destination || source.parent !== destination.parent) return;
        const dom = view.nodeDOM(destination.from);
        if (!(dom instanceof HTMLElement)) return;
        const rect = dom.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        const next = before ? destination.from : destination.to;
        if (next >= source.from && next <= source.to) return;
        target = next;
        const container = host.getBoundingClientRect();
        line.style.top = `${(before ? rect.top : rect.bottom) - container.top}px`;
        line.style.left = `${rect.left - container.left}px`;
        line.style.width = `${rect.width}px`;
        line.hidden = false;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      };
      const drop = (event: DragEvent) => {
        if (!dragging || !event.dataTransfer) return;
        // Positions may have changed since the last pointer event because another person edited the page.
        over(event);
        if (target === null) { finish(); return; }
        let valid = false;
        try { const data = JSON.parse(event.dataTransfer.getData(MIME)); valid = data.pageId === pageId && data.nonce === nonce; } catch { /* External data is never a page move. */ }
        if (!valid) { finish(); return; }
        event.preventDefault(); event.stopPropagation();
        const source = findBlockByIdentity(view.state.doc, dragging.id, dragging.from);
        if (source) dispatchBlockMove(view, source, target);
        finish();
      };
      const select = () => {
        if (!current || !view.editable) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, current.from)));
        view.focus();
      };
      const handleKeys = (event: KeyboardEvent) => {
        if (event.altKey && event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key) && current) {
          const boundary = siblingBoundary(current, event.key === "ArrowUp" ? -1 : 1);
          if (boundary !== null && dispatchBlockMove(view, current, boundary)) event.preventDefault();
        }
      };
      handle.addEventListener("click", select);
      handle.addEventListener("keydown", handleKeys);
      handle.addEventListener("dragstart", start);
      handle.addEventListener("dragend", finish);
      host.addEventListener("dragover", over);
      host.addEventListener("drop", drop, true);
      view.dom.addEventListener("mousemove", pointer);
      view.dom.addEventListener("mouseleave", leave);
      const relocate = () => { if (current && !dragging) show(findBlock(view.state.doc, view.state.selection.from)); };
      window.addEventListener("resize", relocate);
      document.addEventListener("scroll", relocate, true);
      return {
        update: () => { if (!dragging) hovered && lastPointer ? pointerBlock() : show(view.hasFocus() ? findBlock(view.state.doc, view.state.selection.from) : null); },
        destroy: () => {
          cancelAnimationFrame(frame);
          activeDom?.classList.remove("cc-doc-block-active");
          handle.remove(); line.remove(); host.classList.remove("cc-doc-block-host");
          host.removeEventListener("dragover", over); host.removeEventListener("drop", drop, true);
          view.dom.removeEventListener("mousemove", pointer); view.dom.removeEventListener("mouseleave", leave);
          window.removeEventListener("resize", relocate); document.removeEventListener("scroll", relocate, true);
        },
      };
    } })];
  },
});
