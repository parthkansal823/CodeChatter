/** Rebuild a room's files at any moment of an interview, from the edit log GET /api/interviews/:id/replay/updates sends. */
import { blobOf, flatten, listTree, textOf } from "@codechatter/workspace-model";
import * as Y from "yjs";

export type ReplayFrame = { at: number; update: Uint8Array };
export type ReplayFile = { path: string; text: string | null };

/** The format: [time in ms as float64][length as uint32][update bytes], big-endian, one after another. */
export function parseReplayFrames(bytes: Uint8Array): ReplayFrame[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: ReplayFrame[] = [];
  for (let offset = 0; offset + 12 <= bytes.byteLength; ) {
    const at = view.getFloat64(offset);
    const length = view.getUint32(offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) throw new Error("The replay's edit log is cut short.");
    frames.push({ at, update: bytes.subarray(offset + 12, end) });
    offset = end;
  }
  return frames;
}

/** Every file as it was at that moment. A binary file has no text. */
export function filesAt(frames: readonly ReplayFrame[], upTo: number): ReplayFile[] {
  const doc = new Y.Doc();
  try {
    for (const frame of frames) if (frame.at <= upTo) Y.applyUpdate(doc, frame.update);
    return flatten(listTree(doc))
      .filter((node) => node.kind === "file")
      .map((node) => ({ path: node.path, text: blobOf(doc, node.id) ? null : (textOf(doc, node.id)?.toString() ?? "") }));
  } finally {
    doc.destroy();
  }
}

/** The moment to show for something that happened at `at`: the last edit at or before it, or the first one. */
export function momentFor(moments: readonly string[], at: string): number {
  const time = new Date(at).getTime();
  let index = 0;
  for (let i = 0; i < moments.length; i++) {
    if (new Date(moments[i]!).getTime() <= time) index = i;
    else break;
  }
  return index;
}
