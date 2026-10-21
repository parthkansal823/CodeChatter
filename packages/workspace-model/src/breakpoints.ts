import * as Y from "yjs";

import { textOf } from "./model.js";

/**
 * Breakpoints, shared by everyone in the room (the debugger's, roadmap §14 A), in map
 * "breakpoints" of the files document: by file id, each one a position anchored to the
 * start of its line, so it stays on its line while people edit above it.
 */
export const breakpointMap = (doc: Y.Doc) => doc.getMap<Y.Array<unknown>>("breakpoints");

/** The 1-based line holding `index`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** Where line `line` (1-based) starts; the end of the text past the last line. */
function startOfLine(content: string, line: number): number {
  let index = 0;
  for (let current = 1; current < line; current++) {
    const next = content.indexOf("\n", index);
    if (next === -1) return content.length;
    index = next + 1;
  }
  return index;
}

/** Each stored breakpoint's line, or null for one whose text has gone. */
function linesOfEntries(doc: Y.Doc, text: Y.Text, entries: unknown[]): Array<number | null> {
  const content = text.toString();
  return entries.map((json) => {
    const position = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc);
    return position && position.type === text ? lineAt(content, position.index) : null;
  });
}

/** A file's breakpoints, as 1-based lines, in order, each once. */
export function breakpointLines(doc: Y.Doc, fileId: string): number[] {
  const text = textOf(doc, fileId);
  const list = breakpointMap(doc).get(fileId);
  if (!text || !list) return [];
  const lines = linesOfEntries(doc, text, list.toArray()).filter((line): line is number => line !== null);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** Every file's breakpoints. */
export function allBreakpoints(doc: Y.Doc): Array<{ fileId: string; lines: number[] }> {
  return [...breakpointMap(doc).keys()].map((fileId) => ({ fileId, lines: breakpointLines(doc, fileId) })).filter((entry) => entry.lines.length > 0);
}

/** Set or clear the breakpoint on a line; true when the line has one afterwards. */
export function toggleBreakpoint(doc: Y.Doc, fileId: string, line: number): boolean {
  const text = textOf(doc, fileId);
  if (!text) return false;
  let set = false;
  doc.transact(() => {
    const map = breakpointMap(doc);
    let list = map.get(fileId);
    if (!list) {
      list = new Y.Array<unknown>();
      map.set(fileId, list);
    }
    const lines = linesOfEntries(doc, text, list.toArray());
    let removed = false;
    // From the end, so the indexes stay right; entries whose text has gone are tidied away.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === null || lines[i] === line) {
        removed ||= lines[i] === line;
        list.delete(i, 1);
      }
    }
    if (!removed) {
      list.push([Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, startOfLine(text.toString(), line)))]);
      set = true;
    }
  });
  return set;
}

/** Remove a file's breakpoints, or every breakpoint in the room. */
export function clearBreakpoints(doc: Y.Doc, fileId?: string): void {
  const map = breakpointMap(doc);
  doc.transact(() => {
    for (const id of fileId ? [fileId] : [...map.keys()]) map.delete(id);
  });
}
