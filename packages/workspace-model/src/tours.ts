/** Shared code tours: independent Yjs entries preserve simultaneous edits; relative anchors follow the file's text. */
import * as Y from "yjs";

import { getNode, randomId, textOf } from "./model.js";

export const MAX_TOUR_TITLE = 200;
export const MAX_TOUR_DESCRIPTION = 4000;
export const MAX_TOUR_NOTE = 8000;
export const MAX_TOURS = 100;
export const MAX_TOUR_STOPS = 500;
export const MAX_TOUR_ANCHOR_LENGTH = 200_000;

type SourceSpan = { client: number; clock: number; length: number };
export type TourStopAnchor = {
  fileId: string;
  start: unknown;
  end: unknown;
  endLineEmpty: boolean;
  source: SourceSpan[];
};
export type TourStop = TourStopAnchor & { id: string; title: string; note: string; order: number };
export type Tour = {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: number;
  order: number;
  stops: TourStop[];
};
export type TourStopPlace = { from: number; to: number; startLine: number; endLine: number };
export type NewTour = { title: string; description?: string; createdBy: string; id?: string };
export type NewTourStop = { fileId: string; startLine: number; endLine?: number; title: string; note?: string; id?: string };
export type NewAnchoredTourStop = { anchor: TourStopAnchor; title: string; note?: string; id?: string };

const ORIGIN = "code-tours";
const clipped = (value: unknown, max: number): string => typeof value === "string" ? value.slice(0, max) : "";
const titleOf = (value: unknown): string => clipped(value, MAX_TOUR_TITLE).trim();
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const orderOf = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const sorted = <T extends { id: string; order: number }>(values: T[]): T[] => values.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Every tour and stop owns its map; adding one never overwrites another person's list. */
export const toursMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>("tours");

function entryOf(doc: Y.Doc, tourId: string): Y.Map<unknown> | null {
  const entry = toursMap(doc).get(tourId);
  return entry instanceof Y.Map ? entry : null;
}

function stopsOf(entry: Y.Map<unknown>): Y.Map<Y.Map<unknown>> | null {
  const stops = entry.get("stops");
  return stops instanceof Y.Map ? stops as Y.Map<Y.Map<unknown>> : null;
}

function readSource(value: unknown): SourceSpan[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOUR_ANCHOR_LENGTH) return null;
  let length = 0;
  for (const span of value) {
    if (!span || !Number.isSafeInteger(span.client) || span.client < 0 || !Number.isSafeInteger(span.clock) || span.clock < 0 || !Number.isSafeInteger(span.length) || span.length <= 0 || !Number.isSafeInteger(span.clock + span.length)) return null;
    length += span.length;
    if (length > MAX_TOUR_ANCHOR_LENGTH) return null;
  }
  return value as SourceSpan[];
}

function readStops(entry: Y.Map<unknown>): TourStop[] {
  const out: TourStop[] = [];
  stopsOf(entry)?.forEach((stop, id) => {
    if (!(stop instanceof Y.Map) || !validId(id) || !validId(stop.get("fileId"))) return;
    const source = readSource(stop.get("source"));
    const title = titleOf(stop.get("title"));
    if (!source || !title) return;
    out.push({ id, fileId: stop.get("fileId") as string, title, note: clipped(stop.get("note"), MAX_TOUR_NOTE), order: orderOf(stop.get("order")), start: stop.get("start"), end: stop.get("end"), endLineEmpty: stop.get("endLineEmpty") === true, source });
  });
  return sorted(out);
}

/** Shared tours and their stops, in the same deterministic order on every peer. */
export function listTours(doc: Y.Doc): Tour[] {
  const out: Tour[] = [];
  toursMap(doc).forEach((entry, id) => {
    if (!(entry instanceof Y.Map) || !validId(id)) return;
    const title = titleOf(entry.get("title"));
    if (!title || !stopsOf(entry)) return;
    const createdAt = entry.get("createdAt");
    out.push({ id, title, description: clipped(entry.get("description"), MAX_TOUR_DESCRIPTION), createdBy: clipped(entry.get("createdBy"), 128), createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0, order: orderOf(entry.get("order")), stops: readStops(entry) });
  });
  return sorted(out);
}

/** Fractional ranks update only the moved entry. ID ties converge after simultaneous adds. */
function nextOrder(entries: Y.Map<Y.Map<unknown>>, skip?: string, beforeId?: string | null): number {
  const peers = sorted([...entries.entries()].filter(([id, entry]) => id !== skip && entry instanceof Y.Map).map(([id, entry]) => ({ id, order: orderOf(entry.get("order")), entry })));
  const before = beforeId ? peers.findIndex(({ id }) => id === beforeId) : -1;
  const rank = () => before < 0 ? (peers.at(-1)?.order ?? -1) + 1 : before === 0 ? peers[0]!.order - 1 : peers[before - 1]!.order + (peers[before]!.order - peers[before - 1]!.order) / 2;
  let next = rank();
  if (!Number.isFinite(next) || (before > 0 && !(next > peers[before - 1]!.order && next < peers[before]!.order)) || (before === 0 && !(next < peers[0]!.order)) || (before < 0 && peers.length > 0 && !(next > peers.at(-1)!.order))) {
    // Restore room for future moves when floating-point gaps are exhausted.
    peers.forEach((peer, index) => { peer.order = index; peer.entry.set("order", index); });
    next = rank();
  }
  return next;
}

export function addTour(doc: Y.Doc, input: NewTour): string | null {
  const title = titleOf(input.title), id = input.id ?? randomId();
  if (!title || !validId(id) || toursMap(doc).has(id) || toursMap(doc).size >= MAX_TOURS) return null;
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("title", title);
    entry.set("description", clipped(input.description, MAX_TOUR_DESCRIPTION));
    entry.set("createdBy", clipped(input.createdBy, 128));
    entry.set("createdAt", Date.now());
    entry.set("order", nextOrder(toursMap(doc)));
    entry.set("stops", new Y.Map<Y.Map<unknown>>());
    toursMap(doc).set(id, entry);
  }, ORIGIN);
  return id;
}

export function editTour(doc: Y.Doc, tourId: string, patch: { title?: string; description?: string }): boolean {
  const entry = entryOf(doc, tourId);
  if (!entry || (patch.title !== undefined && !titleOf(patch.title))) return false;
  doc.transact(() => {
    if (patch.title !== undefined) entry.set("title", titleOf(patch.title));
    if (patch.description !== undefined) entry.set("description", clipped(patch.description, MAX_TOUR_DESCRIPTION));
  }, ORIGIN);
  return true;
}

export function moveTour(doc: Y.Doc, tourId: string, beforeId?: string | null): boolean {
  const entry = entryOf(doc, tourId);
  if (!entry || tourId === beforeId || (beforeId && !entryOf(doc, beforeId))) return false;
  doc.transact(() => entry.set("order", nextOrder(toursMap(doc), tourId, beforeId)), ORIGIN);
  return true;
}

export function deleteTour(doc: Y.Doc, tourId: string): boolean {
  if (!entryOf(doc, tourId)) return false;
  doc.transact(() => toursMap(doc).delete(tourId), ORIGIN);
  return true;
}

/** A trashed folder hides its descendants too, although their Y.Text is retained for restore. */
function liveText(files: Y.Doc, fileId: string): Y.Text | null {
  let node = getNode(files, fileId);
  if (!node || node.kind !== "file") return null;
  const seen = new Set<string>();
  while (node) {
    if (node.trashedAt || seen.has(node.id)) return null;
    seen.add(node.id);
    if (!node.parentId) break;
    node = getNode(files, node.parentId);
    if (!node) return null;
  }
  return textOf(files, fileId) ?? null;
}

/** Compact original character IDs let us reject wholly deleted code even if replacement text lies between its anchors. */
function sourceSpans(text: Y.Text, from: number, to: number): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (let index = from; index < to; index++) {
    const item = Y.createRelativePositionFromTypeIndex(text, index).item;
    if (!item) continue;
    const previous = spans.at(-1);
    if (previous && previous.client === item.client && previous.clock + previous.length === item.clock) previous.length++;
    else spans.push({ client: item.client, clock: item.clock, length: 1 });
  }
  return spans;
}

/** Capture the selected code before a dialog opens; later edits move these anchors, never the original numeric line selection. */
export function captureTourStop(files: Y.Doc, fileId: string, startLine: number, endLine = startLine): TourStopAnchor | null {
  const text = liveText(files, fileId);
  if (!text || !validId(fileId) || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  const content = text.toString(), offsets = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) offsets.push(i + 1);
  if (endLine > offsets.length) return null;
  const from = offsets[startLine - 1]!, to = endLine < offsets.length ? offsets[endLine]! - 1 : content.length;
  const endLineEmpty = to === offsets[endLine - 1];
  if (to - from > MAX_TOUR_ANCHOR_LENGTH) return null;
  // Empty lines use their line break as a deletion witness (the preceding break at EOF).
  const witnessFrom = from === to && from === content.length ? Math.max(0, from - 1) : from;
  const witnessTo = from === to && from < content.length ? from + 1 : to;
  const source = sourceSpans(text, witnessFrom, witnessTo);
  // Yjs's JSON helper retains ID prototypes locally; store plain JSON so fresh and remote readers agree.
  const start: unknown = JSON.parse(JSON.stringify(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from, 0))));
  const end: unknown = JSON.parse(JSON.stringify(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to, -1))));
  return { fileId, start, end, endLineEmpty, source };
}

/** Commit a captured selection only while its original code still exists. */
export function addAnchoredTourStop(doc: Y.Doc, files: Y.Doc, tourId: string, input: NewAnchoredTourStop): string | null {
  const entry = entryOf(doc, tourId), stops = entry && stopsOf(entry);
  const title = titleOf(input.title), id = input.id ?? randomId(), anchor = input.anchor;
  if (!stops || !title || !validId(id) || stops.has(id) || stops.size >= MAX_TOUR_STOPS || !anchor || !resolveTourStop(files, anchor)) return null;
  doc.transact(() => {
    const stop = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({ fileId: anchor.fileId, title, note: clipped(input.note, MAX_TOUR_NOTE), start: anchor.start, end: anchor.end, endLineEmpty: anchor.endLineEmpty, source: anchor.source, order: nextOrder(stops) })) stop.set(key, value);
    stops.set(id, stop);
  }, ORIGIN);
  return id;
}

/** Lines are one-based and inclusive; immediate callers can capture and commit in one step. */
export function addTourStop(doc: Y.Doc, files: Y.Doc, tourId: string, input: NewTourStop): string | null {
  const anchor = captureTourStop(files, input.fileId, input.startLine, input.endLine);
  return anchor ? addAnchoredTourStop(doc, files, tourId, { anchor, title: input.title, note: input.note, id: input.id }) : null;
}

function stopEntry(doc: Y.Doc, tourId: string, stopId: string): Y.Map<unknown> | null {
  const tour = entryOf(doc, tourId), stop = tour && stopsOf(tour)?.get(stopId);
  return stop instanceof Y.Map ? stop : null;
}

export function editTourStop(doc: Y.Doc, tourId: string, stopId: string, patch: { title?: string; note?: string }): boolean {
  const stop = stopEntry(doc, tourId, stopId);
  if (!stop || (patch.title !== undefined && !titleOf(patch.title))) return false;
  doc.transact(() => {
    if (patch.title !== undefined) stop.set("title", titleOf(patch.title));
    if (patch.note !== undefined) stop.set("note", clipped(patch.note, MAX_TOUR_NOTE));
  }, ORIGIN);
  return true;
}

export function moveTourStop(doc: Y.Doc, tourId: string, stopId: string, beforeId?: string | null): boolean {
  const tour = entryOf(doc, tourId), stops = tour && stopsOf(tour), stop = stopEntry(doc, tourId, stopId);
  if (!stops || !stop || beforeId === stopId || (beforeId && !stopEntry(doc, tourId, beforeId))) return false;
  doc.transact(() => stop.set("order", nextOrder(stops, stopId, beforeId)), ORIGIN);
  return true;
}

export function deleteTourStop(doc: Y.Doc, tourId: string, stopId: string): boolean {
  const tour = entryOf(doc, tourId), stops = tour && stopsOf(tour);
  if (!stops || !stopEntry(doc, tourId, stopId)) return false;
  doc.transact(() => stops.delete(stopId), ORIGIN);
  return true;
}

function hasSurvivingSource(files: Y.Doc, source: SourceSpan[]): boolean {
  const deleted = Y.snapshot(files).ds.clients;
  return source.some((span) => {
    let cursor = span.clock;
    const end = span.clock + span.length;
    for (const range of deleted.get(span.client) ?? []) {
      if (range.clock > cursor) break;
      cursor = Math.max(cursor, range.clock + range.len);
      if (cursor >= end) return false;
    }
    return cursor < end;
  });
}

/** Null means a missing file, unknown anchor or wholly removed code. No fallback to an unrelated line. */
export function resolveTourStop(files: Y.Doc, stop: TourStopAnchor): TourStopPlace | null {
  const text = liveText(files, stop.fileId), source = readSource(stop.source);
  if (!text || !source || (source.length > 0 && !hasSurvivingSource(files, source))) return null;
  try {
    const start = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(stop.start), files);
    const end = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(stop.end), files);
    if (!start || !end || start.type !== text || end.type !== text || start.index > end.index) return null;
    const content = text.toString(), from = start.index, to = end.index;
    const lineAt = (index: number) => { let line = 1; for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++; return line; };
    return { from, to, startLine: lineAt(from), endLine: lineAt(stop.endLineEmpty ? to : Math.max(from, to - 1)) };
  } catch {
    return null;
  }
}
