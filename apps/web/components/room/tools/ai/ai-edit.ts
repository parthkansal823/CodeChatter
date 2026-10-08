"use client";

import { setText, textOf } from "@codechatter/workspace-model";
import { toast } from "sonner";
import * as Y from "yjs";

/**
 * Everything the AI writes into a file goes through one Yjs transaction with
 * this origin. Collaborators see a single change, and Undo reverses exactly
 * these transactions (and nothing anyone typed), whoever else edited the file since.
 */
export const AI_ORIGIN = "ai-copilot";

const managers = new WeakMap<Y.Doc, Map<string, Y.UndoManager>>();

function managerFor(doc: Y.Doc, fileId: string, ytext: Y.Text): Y.UndoManager {
  let byFile = managers.get(doc);
  if (!byFile) managers.set(doc, (byFile = new Map()));
  let manager = byFile.get(fileId);
  if (!manager) {
    // captureTimeout 0: each AI write is its own undo step.
    manager = new Y.UndoManager(ytext, { trackedOrigins: new Set([AI_ORIGIN]), captureTimeout: 0 });
    byFile.set(fileId, manager);
  }
  return manager;
}

/** Replace a file's text, or only its `range`, as one undoable transaction. False when the file is gone. */
export function applyAiText(doc: Y.Doc, fileId: string, next: string, range?: { from: number; to: number }): boolean {
  const ytext = textOf(doc, fileId);
  if (!ytext) return false;
  managerFor(doc, fileId, ytext);
  const full = ytext.toString();
  const result = range ? full.slice(0, range.from) + next + full.slice(range.to) : next;
  // setText keeps the common start and end, so only the middle is replaced and others' cursors survive.
  doc.transact(() => setText(ytext, result), AI_ORIGIN);
  return true;
}

export const canUndoAi = (doc: Y.Doc, fileId: string): boolean => managers.get(doc)?.get(fileId)?.canUndo() ?? false;

export function undoAi(doc: Y.Doc, fileId: string): boolean {
  const manager = managers.get(doc)?.get(fileId);
  if (!manager?.canUndo()) return false;
  manager.undo();
  return true;
}

/** A confirmation that offers Undo for ten seconds. */
export function appliedToast(label: string, undo: () => boolean): void {
  toast.success(label, {
    duration: 10_000,
    action: { label: "Undo", onClick: () => (undo() ? toast("Change undone") : toast.error("Nothing left to undo.")) },
  });
}

/** The selected range as Yjs relative positions (JSON), which follow edits made around them. */
export function captureRange(ytext: Y.Text, start: number, end: number): { from: unknown; to: unknown } {
  return {
    from: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, start, 0)),
    to: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, end, -1)),
  };
}

export function resolveRange(doc: Y.Doc, ytext: Y.Text, range: { from: unknown; to: unknown }): { from: number; to: number } | null {
  const from = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(range.from), doc);
  const to = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(range.to), doc);
  if (!from || !to || from.type !== ytext || to.type !== ytext) return null;
  return { from: Math.min(from.index, to.index), to: Math.max(from.index, to.index) };
}

/** FNV-1a: enough to tell whether text changed, without keeping a whole file in sessionStorage. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/** A code block loses the file's last newline; keep what the replaced text had. */
export function matchTrailingNewline(before: string, after: string): string {
  const had = before.endsWith("\n");
  const has = after.endsWith("\n");
  if (had && !has) return `${after}\n`;
  if (!had && has) return after.slice(0, -1);
  return after;
}

/** The first fenced code block of an answer. */
export function firstCodeBlock(markdown: string): string | null {
  const match = /```[^\n]*\n([\s\S]*?)\n?```/.exec(markdown);
  return match ? match[1]! : null;
}
