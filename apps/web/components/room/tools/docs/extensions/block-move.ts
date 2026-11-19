/** Find whole editable blocks and build atomic moves, retaining shared identity so concurrent move copies can be reconciled. */
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import * as Y from "yjs";

export const BLOCK_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote", "callout", "codeBlock", "horizontalRule", "table", "toggle"];
export const BLOCK_MOVE_META = "cc-block-move";
export type BlockRange = { node: ProseMirrorNode; from: number; to: number; parent: ProseMirrorNode; parentDepth: number; index: number };

/** Existing shared elements have the same CRDT identity on every peer, even before their first block-ID migration. */
export function blockIdFromYType(type: Y.XmlElement): string {
  const identity = Y.createRelativePositionFromTypeIndex(type, 0).type!;
  return `y:${identity.client}:${identity.clock}`;
}

/** Summary arrows move their whole toggle; list items keep their nested children; cells never move out of their table. */
export function findBlock(doc: ProseMirrorNode, position: number): BlockRange | null {
  const $pos = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  const range = (depth: number): BlockRange => ({ node: $pos.node(depth), from: $pos.before(depth), to: $pos.after(depth), parent: $pos.node(depth - 1), parentDepth: depth - 1, index: $pos.index(depth - 1) });
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "table") return range(depth);
  }
  if (!$pos.parent.isTextblock && $pos.nodeAfter && BLOCK_TYPES.includes($pos.nodeAfter.type.name)) {
    if (["listItem", "taskItem"].includes($pos.parent.type.name)) return range($pos.depth);
    const node = $pos.nodeAfter;
    return { node, from: $pos.pos, to: $pos.pos + node.nodeSize, parent: $pos.parent, parentDepth: $pos.depth, index: $pos.index() };
  }
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "toggleSummary") return depth > 1 && $pos.node(depth - 1).type.name === "toggle" ? range(depth - 1) : null;
    if (["toggleBody", "tableRow", "tableCell", "tableHeader"].includes(node.type.name)) continue;
    if (depth > 1 && ["listItem", "taskItem"].includes($pos.node(depth - 1).type.name)) return range(depth - 1);
    if (BLOCK_TYPES.includes(node.type.name)) return range(depth);
  }
  // A node selection's boundary resolves in its parent, not inside the selected node.
  const node = $pos.nodeAfter;
  return node && BLOCK_TYPES.includes(node.type.name) ? { node, from: $pos.pos, to: $pos.pos + node.nodeSize, parent: $pos.parent, parentDepth: $pos.depth, index: $pos.index() } : null;
}

/** A drag resolves its original identity again after remote edits; deleting that identity cancels the move. */
export function findBlockByIdentity(doc: ProseMirrorNode, id: string, fallback: number): BlockRange | null {
  let found: number | null = null;
  if (id) doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs.blockId === id) { found = pos; return false; }
  });
  if (id && found === null) return null;
  const pos = found ?? fallback;
  return pos >= 0 && pos < doc.content.size && doc.nodeAt(pos) ? findBlock(doc, pos) : null;
}

export function siblingBoundary(block: BlockRange, direction: -1 | 1): number | null {
  if (direction < 0) return block.index > 0 ? block.from - block.parent.child(block.index - 1).nodeSize : null;
  return block.index + 1 < block.parent.childCount ? block.to + block.parent.child(block.index + 1).nodeSize : null;
}

export function nextMoveToken(previous: unknown, unique = crypto.randomUUID()): string {
  const generation = typeof previous === "string" ? Number(previous.split(":", 1)[0]) : 0;
  return `${String(Number.isSafeInteger(generation) && generation >= 0 ? generation + 1 : 1).padStart(16, "0")}:${unique}`;
}

/** Reorder siblings only: a target inside a table, another container, or this block is rejected. */
export function blockMoveTransaction(state: EditorState, block: BlockRange, target: number, token = nextMoveToken(block.node.attrs.blockMoveToken)): Transaction | null {
  if (target < 0 || target > state.doc.content.size || target >= block.from && target <= block.to || block.parent.childCount < 2) return null;
  const $target = state.doc.resolve(target);
  if ($target.depth !== block.parentDepth || $target.parent !== block.parent || state.doc.nodeAt(block.from) !== block.node) return null;
  const attrs = { ...block.node.attrs, blockId: block.node.attrs.blockId || crypto.randomUUID(), blockMoveToken: token };
  const moved = block.node.type.create(attrs, block.node.content, block.node.marks);
  const destination = target > block.from ? target - block.node.nodeSize : target;
  const transaction = state.tr.delete(block.from, block.to).insert(destination, moved).setMeta(BLOCK_MOVE_META, true);
  if (state.selection instanceof NodeSelection) transaction.setSelection(NodeSelection.create(transaction.doc, destination));
  else transaction.setSelection(TextSelection.near(transaction.doc.resolve(destination + Math.max(1, Math.min(state.selection.from - block.from, moved.nodeSize - 1)))));
  return transaction.scrollIntoView();
}

type Located = { node: ProseMirrorNode; pos: number; id: string; token: string };

/** Highest move token wins; remote/undo copies also reconcile equal tokens, while local splits receive fresh identities. */
export function repairBlockIdentities(state: EditorState, createId: (node: ProseMirrorNode, pos: number) => string = () => crypto.randomUUID(), options: { reconcileCopies?: boolean } = {}): Transaction | null {
  const groups = new Map<string, Located[]>();
  const missing: Located[] = [];
  state.doc.descendants((node, pos) => {
    if (!BLOCK_TYPES.includes(node.type.name) || !("blockId" in node.attrs)) return;
    const entry = { node, pos, id: typeof node.attrs.blockId === "string" ? node.attrs.blockId : "", token: typeof node.attrs.blockMoveToken === "string" ? node.attrs.blockMoveToken : "" };
    if (!entry.id) missing.push(entry);
    else groups.set(entry.id, [...(groups.get(entry.id) ?? []), entry]);
  });
  const removed: Located[] = [];
  for (const entries of groups.values()) {
    const tokens = new Set(entries.map((entry) => entry.token));
    if (tokens.size < 2 && !options.reconcileCopies) continue;
    const highest = entries.reduce((winner, entry) => entry.token > winner.token ? entry : winner);
    removed.push(...entries.filter((entry) => entry !== highest && (options.reconcileCopies || entry.token !== highest.token)));
  }
  const covered = (entry: Located) => removed.some((parent) => parent.pos <= entry.pos && parent.pos + parent.node.nodeSize >= entry.pos + entry.node.nodeSize);
  const replace = [...missing.filter((entry) => !covered(entry))];
  for (const entries of groups.values()) {
    const kept = entries.filter((entry) => !covered(entry));
    replace.push(...kept.slice(1));
  }
  if (!removed.length && !replace.length) return null;
  const transaction = state.tr;
  // Repair IDs before deleting so positions are still those of the input document.
  for (const entry of replace) transaction.setNodeMarkup(entry.pos, undefined, { ...entry.node.attrs, blockId: createId(entry.node, entry.pos), blockMoveToken: "" });
  for (const entry of removed.sort((a, b) => b.pos - a.pos)) {
    if (removed.some((parent) => parent !== entry && parent.pos < entry.pos && parent.pos + parent.node.nodeSize >= entry.pos + entry.node.nodeSize)) continue;
    transaction.delete(entry.pos, entry.pos + entry.node.nodeSize);
  }
  return transaction.setMeta("addToHistory", false);
}
