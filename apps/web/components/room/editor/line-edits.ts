import { diffLines } from "../tools/ai/line-diff";

/** Replace before[start, end) with text (offsets in the text before any edit). */
export type TextEdit = { start: number; end: number; text: string };

/**
 * The few edits that turn `before` into `after`, one per run of changed lines, rather
 * than one edit for the whole file: a formatter's result lands as small changes, so
 * everyone else's cursor in an untouched line stays where it was. Edits don't overlap
 * and are in order.
 */
export function lineEdits(before: string, after: string): TextEdit[] {
  if (before === after) return [];
  const a = before.split("\n");
  // Where each line of `before` starts.
  const starts: number[] = [];
  let at = 0;
  for (const line of a) {
    starts.push(at);
    at += line.length + 1;
  }
  const edits: TextEdit[] = [];
  let i = 0; // the next line of `before`
  let removed: number | null = null; // first line of the run being replaced
  let added: string[] = [];
  const flush = () => {
    if (removed === null && added.length === 0) return;
    const from = removed ?? i;
    const lines = i - from;
    if (lines > 0 && added.length > 0) {
      // Lines replaced by others: swap their text, keeping the line break after them.
      edits.push({ start: starts[from]!, end: starts[i - 1]! + a[i - 1]!.length, text: added.join("\n") });
    } else if (lines > 0) {
      // Lines deleted: with the break after them, or (at the very end) the break before them.
      if (i < a.length) edits.push({ start: starts[from]!, end: starts[i]!, text: "" });
      else edits.push({ start: from > 0 ? starts[from]! - 1 : 0, end: before.length, text: "" });
    } else if (i < a.length) {
      // Lines added before line i.
      edits.push({ start: starts[i]!, end: starts[i]!, text: `${added.join("\n")}\n` });
    } else {
      edits.push({ start: before.length, end: before.length, text: `\n${added.join("\n")}` });
    }
    removed = null;
    added = [];
  };
  for (const line of diffLines(before, after)) {
    if (line.kind === "same") {
      flush();
      i += 1;
    } else if (line.kind === "del") {
      removed ??= i;
      i += 1;
    } else {
      added.push(line.text);
    }
  }
  flush();
  // Edits that touch (an insert, then a delete from the same offset) become one, so the
  // order they're applied in can't matter.
  const merged: TextEdit[] = [];
  for (const edit of edits) {
    const prev = merged[merged.length - 1];
    if (prev && edit.start <= prev.end) {
      merged[merged.length - 1] = { start: prev.start, end: Math.max(prev.end, edit.end), text: prev.text + edit.text };
    } else {
      merged.push(edit);
    }
  }
  return merged;
}

/** `edits` applied to `text` (they don't overlap; applied from the end so offsets hold). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}
