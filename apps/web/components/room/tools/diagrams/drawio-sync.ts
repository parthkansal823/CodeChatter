import * as Y from "yjs";

/**
 * A draw.io diagram in a room document, edited live by everyone in it.
 *
 * - `xml`: the whole diagram, as someone joining loads it.
 * - `ops`: draw.io's own patches (diffSync), for everyone already editing.
 *
 * draw.io computes the patches, applies others' patches without sending them
 * back as new changes, and keeps local edits when it merges, so people
 * changing different shapes at once both keep their work.
 */
export type DiagramOp = { patch: string; by: number };

const ORIGIN = "drawio";
// Old patches were applied long ago by everyone online; anyone joining loads `xml`.
const MAX_OPS = 400;
const KEEP_OPS = 200;

const state = (doc: Y.Doc) => doc.getMap<string>("diagram");
const ops = (doc: Y.Doc) => doc.getArray<DiagramOp>("ops");

export const readXml = (doc: Y.Doc): string => state(doc).get("xml") ?? "";

/** One local change, for everyone already editing. */
export function pushPatch(doc: Y.Doc, patch: unknown) {
  doc.transact(() => {
    const log = ops(doc);
    log.push([{ patch: JSON.stringify(patch), by: doc.clientID }]);
    if (log.length > MAX_OPS) log.delete(0, log.length - KEEP_OPS);
  }, ORIGIN);
}

/** The whole diagram, for whoever joins next. */
export function saveXml(doc: Y.Doc, xml: string) {
  if (readXml(doc) !== xml) doc.transact(() => state(doc).set("xml", xml), ORIGIN);
}

/** Calls `apply` with every patch someone else adds, in order. */
export function onRemotePatches(doc: Y.Doc, apply: (patch: unknown) => void): () => void {
  const log = ops(doc);
  const handler = (event: Y.YArrayEvent<DiagramOp>, transaction: Y.Transaction) => {
    if (transaction.local) return;
    for (const delta of event.changes.delta) {
      for (const op of (delta.insert as DiagramOp[] | undefined) ?? []) {
        if (op.by === doc.clientID) continue;
        try {
          apply(JSON.parse(op.patch));
        } catch {
          // A patch that doesn't parse can't be applied; the next full merge brings the change.
        }
      }
    }
  };
  log.observe(handler);
  return () => log.unobserve(handler);
}

/** Calls `changed` when someone else saves the whole diagram (viewers follow along this way). */
export function onRemoteXml(doc: Y.Doc, changed: (xml: string) => void): () => void {
  const map = state(doc);
  const handler = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (!transaction.local && event.keysChanged.has("xml")) changed(readXml(doc));
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}
