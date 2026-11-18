/** Code tours stay ordered across peers and follow live code without jumping to deleted ranges. */
import assert from "node:assert/strict";
import * as Y from "yjs";

import { parseDocName, roomDocName } from "./index.js";
import { createFile, createFolder, move, rename, restore, textOf, trash } from "./model.js";
import { addAnchoredTourStop, addTour, addTourStop, captureTourStop, deleteTour, deleteTourStop, editTour, editTourStop, listTours, MAX_TOUR_ANCHOR_LENGTH, MAX_TOUR_DESCRIPTION, MAX_TOUR_NOTE, MAX_TOUR_STOPS, MAX_TOUR_TITLE, moveTour, moveTourStop, resolveTourStop, toursMap } from "./tours.js";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
function sync(a: Y.Doc, b: Y.Doc) { Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); }
function fixture(content = "one\ntwo\nthree\nfour\n") {
  const files = new Y.Doc(), tours = new Y.Doc();
  const fileId = createFile(files, { name: "main.ts", content });
  const tourId = addTour(tours, { title: "Architecture", description: "A useful route", createdBy: "ana" })!;
  return { files, tours, fileId, tourId, text: textOf(files, fileId)! };
}
function stop(f: ReturnType<typeof fixture>, startLine = 2, endLine = startLine, title = "A stop") {
  const id = addTourStop(f.tours, f.files, f.tourId, { fileId: f.fileId, startLine, endLine, title, note: "**Why** this matters" });
  assert.ok(id);
  return listTours(f.tours)[0]!.stops.find((item) => item.id === id)!;
}

test("tours has one authorized document per room, never an item document", () => {
  assert.equal(roomDocName("E2ETST", "tours"), "room:E2ETST:tours");
  assert.deepEqual(parseDocName("room:E2ETST:tours"), { roomId: "E2ETST", kind: "tours" });
  assert.equal(parseDocName("room:E2ETST:tours:abcdefgh"), null);
});

test("tours and stops can be added, edited, reordered and deleted", () => {
  const f = fixture();
  const first = stop(f, 1), second = stop(f, 2), third = stop(f, 3);
  const other = addTour(f.tours, { title: "Second tour", createdBy: "ben" })!;
  assert.equal(editTour(f.tours, f.tourId, { title: "  Start here  ", description: "Updated" }), true);
  assert.equal(editTourStop(f.tours, f.tourId, first.id, { title: "  Entry  ", note: "New note" }), true);
  assert.equal(moveTourStop(f.tours, f.tourId, third.id, first.id), true);
  assert.deepEqual(listTours(f.tours)[0]!.stops.map(({ id }) => id), [third.id, first.id, second.id]);
  assert.equal(moveTourStop(f.tours, f.tourId, third.id), true);
  assert.deepEqual(listTours(f.tours)[0]!.stops.map(({ id }) => id), [first.id, second.id, third.id]);
  assert.equal(moveTour(f.tours, other, f.tourId), true);
  assert.deepEqual(listTours(f.tours).map(({ id }) => id), [other, f.tourId]);
  const tour = listTours(f.tours)[1]!;
  assert.equal(tour.title, "Start here");
  assert.equal(tour.description, "Updated");
  assert.equal(tour.createdBy, "ana");
  assert.ok(tour.createdAt > 0);
  assert.equal(tour.stops[0]!.title, "Entry");
  assert.equal(tour.stops[0]!.note, "New note");
  assert.equal(deleteTourStop(f.tours, f.tourId, second.id), true);
  assert.equal(deleteTourStop(f.tours, f.tourId, second.id), false);
  assert.equal(deleteTour(f.tours, f.tourId), true);
  assert.equal(deleteTour(f.tours, f.tourId), false);
  assert.deepEqual(listTours(f.tours).map(({ id }) => id), [other]);
});

test("two peers adding stops concurrently keep both, with identical order", () => {
  const f = fixture(), peer = new Y.Doc();
  sync(f.tours, peer);
  const first = stop(f, 1);
  const secondId = addTourStop(peer, f.files, f.tourId, { fileId: f.fileId, startLine: 3, title: "Ben's stop" })!;
  sync(f.tours, peer);
  assert.deepEqual(listTours(f.tours), listTours(peer));
  assert.deepEqual(new Set(listTours(peer)[0]!.stops.map(({ id }) => id)), new Set([first.id, secondId]));
  assert.equal(listTours(peer)[0]!.stops[0]!.order, listTours(peer)[0]!.stops[1]!.order);
});

test("concurrent metadata edits and moves preserve independent fields", () => {
  const f = fixture(), peer = new Y.Doc();
  const first = stop(f, 1), second = stop(f, 2), third = stop(f, 3);
  sync(f.tours, peer);
  editTour(f.tours, f.tourId, { title: "Edited tour" });
  editTour(peer, f.tourId, { description: "Other person's description" });
  editTourStop(f.tours, f.tourId, first.id, { title: "Edited stop" });
  editTourStop(peer, f.tourId, first.id, { note: "Other person's note" });
  moveTourStop(f.tours, f.tourId, first.id);
  moveTourStop(peer, f.tourId, third.id, second.id);
  sync(f.tours, peer);
  assert.deepEqual(listTours(f.tours), listTours(peer));
  const tour = listTours(peer)[0]!, edited = tour.stops.find(({ id }) => id === first.id)!;
  assert.equal(tour.title, "Edited tour");
  assert.equal(tour.description, "Other person's description");
  assert.equal(edited.title, "Edited stop");
  assert.equal(edited.note, "Other person's note");
  assert.equal(tour.stops.length, 3);
});

test("delete wins over stale stop edits and a deleted tour is not recreated by an add", () => {
  const f = fixture(), peer = new Y.Doc();
  const selected = stop(f);
  sync(f.tours, peer);
  deleteTourStop(f.tours, f.tourId, selected.id);
  editTourStop(peer, f.tourId, selected.id, { title: "Stale edit" });
  sync(f.tours, peer);
  assert.deepEqual(listTours(peer)[0]!.stops, []);
  deleteTour(f.tours, f.tourId);
  addTourStop(peer, f.files, f.tourId, { fileId: f.fileId, startLine: 1, title: "Racing add" });
  sync(f.tours, peer);
  assert.deepEqual(listTours(f.tours), []);
  assert.deepEqual(listTours(peer), []);
  assert.equal(editTourStop(peer, f.tourId, selected.id, { title: "Gone" }), false);
});

test("relative anchors follow multiple selected lines after another peer inserts above them", () => {
  const f = fixture(), selected = stop(f, 2, 3), peerFiles = new Y.Doc();
  sync(f.files, peerFiles);
  textOf(peerFiles, f.fileId)!.insert(0, "before\nmore\n");
  sync(f.files, peerFiles);
  assert.deepEqual(resolveTourStop(f.files, selected), { from: 16, to: 25, startLine: 4, endLine: 5 });
  assert.equal(f.text.toString().slice(16, 25), "two\nthree");
  assert.deepEqual(resolveTourStop(f.files, selected), resolveTourStop(peerFiles, selected));
});

test("deleting selected lines makes the stop unavailable, including replacement between tombstoned boundaries", () => {
  const f = fixture(), selected = stop(f, 2, 3);
  const placed = resolveTourStop(f.files, selected)!;
  f.files.transact(() => {
    f.text.delete(placed.from, placed.to - placed.from);
    f.text.insert(placed.from, "unrelated replacement");
  });
  assert.equal(resolveTourStop(f.files, selected), null);
  assert.equal(listTours(f.tours)[0]!.stops.length, 1);
});

test("a captured draft follows edits above it before the stop is committed", () => {
  const f = fixture(), anchor = captureTourStop(f.files, f.fileId, 2, 3)!;
  assert.ok(anchor);
  assert.deepEqual(listTours(f.tours)[0]!.stops, []);
  f.text.insert(0, "new first\nnew second\n");
  const id = addAnchoredTourStop(f.tours, f.files, f.tourId, { anchor, title: "Original code", note: "Written while code moves" });
  assert.ok(id);
  const selected = listTours(f.tours)[0]!.stops[0]!;
  const place = resolveTourStop(f.files, selected)!;
  assert.deepEqual([place.startLine, place.endLine], [4, 5]);
  assert.equal(f.text.toString().slice(place.from, place.to), "two\nthree");
});

test("a draft whose selected code was deleted or replaced cannot commit onto unrelated text", () => {
  for (const replacement of ["", "unrelated replacement"]) {
    const f = fixture(), anchor = captureTourStop(f.files, f.fileId, 2, 3)!;
    const place = resolveTourStop(f.files, anchor)!;
    f.files.transact(() => {
      f.text.delete(place.from, place.to - place.from);
      if (replacement) f.text.insert(place.from, replacement);
    });
    assert.equal(addAnchoredTourStop(f.tours, f.files, f.tourId, { anchor, title: "Stale draft" }), null);
    assert.deepEqual(listTours(f.tours)[0]!.stops, []);
  }
});

test("a draft cannot commit after its file or tour disappears", () => {
  const f = fixture(), anchor = captureTourStop(f.files, f.fileId, 2)!;
  trash(f.files, f.fileId);
  assert.equal(addAnchoredTourStop(f.tours, f.files, f.tourId, { anchor, title: "Deleted file" }), null);
  assert.equal(captureTourStop(f.files, f.fileId, 2), null);
  restore(f.files, f.fileId);
  deleteTour(f.tours, f.tourId);
  assert.equal(addAnchoredTourStop(f.tours, f.files, f.tourId, { anchor, title: "Deleted tour" }), null);
});

test("partially edited ranges remain available while original characters survive", () => {
  const f = fixture(), selected = stop(f, 2, 3);
  const placed = resolveTourStop(f.files, selected)!;
  f.text.delete(placed.from, 3);
  f.text.insert(placed.from, "TWO");
  assert.ok(resolveTourStop(f.files, selected));
  f.text.delete(placed.from + 4, 5);
  assert.ok(resolveTourStop(f.files, selected)); // the original selected newline remains
  f.text.delete(placed.from + 3, 1);
  assert.equal(resolveTourStop(f.files, selected), null);
});

test("file IDs survive rename and move; trashed files or folders are unavailable until restored", () => {
  const f = fixture(), selected = stop(f), folder = createFolder(f.files, { name: "src" });
  rename(f.files, f.fileId, "renamed.ts");
  move(f.files, f.fileId, folder);
  assert.equal(selected.fileId, f.fileId);
  assert.equal(resolveTourStop(f.files, selected)!.startLine, 2);
  trash(f.files, folder);
  assert.equal(resolveTourStop(f.files, selected), null);
  restore(f.files, folder);
  assert.ok(resolveTourStop(f.files, selected));
  trash(f.files, f.fileId);
  assert.equal(resolveTourStop(f.files, selected), null);
  assert.equal(addTourStop(f.tours, f.files, f.tourId, { fileId: f.fileId, startLine: 1, title: "Trashed" }), null);
  restore(f.files, f.fileId);
  assert.ok(resolveTourStop(f.files, selected));
});

test("empty lines and an empty file are valid stops; deleting an empty line invalidates its witness", () => {
  const f = fixture("one\n\nthree\n"), blank = stop(f, 2), trailing = stop(f, 4);
  assert.equal(resolveTourStop(f.files, blank)!.startLine, 2);
  assert.equal(resolveTourStop(f.files, trailing)!.startLine, 4);
  f.text.delete(4, 1);
  assert.equal(resolveTourStop(f.files, blank), null);
  f.text.delete(f.text.length - 1, 1);
  assert.equal(resolveTourStop(f.files, trailing), null);
  const empty = fixture("");
  assert.deepEqual(resolveTourStop(empty.files, stop(empty, 1)), { from: 0, to: 0, startLine: 1, endLine: 1 });
});

test("inclusive selections retain an empty final line and survive persistence", () => {
  const f = fixture("one\n\nthree\n"), selected = stop(f, 1, 2), endingAtEof = stop(f, 3, 4);
  assert.equal(resolveTourStop(f.files, selected)!.endLine, 2);
  assert.equal(resolveTourStop(f.files, endingAtEof)!.endLine, 4);
  const reloadedFiles = new Y.Doc(), reloadedTours = new Y.Doc();
  Y.applyUpdate(reloadedFiles, Y.encodeStateAsUpdate(f.files));
  Y.applyUpdate(reloadedTours, Y.encodeStateAsUpdate(f.tours));
  assert.deepEqual(listTours(f.tours), listTours(reloadedTours));
  assert.deepEqual(resolveTourStop(reloadedFiles, selected), resolveTourStop(f.files, selected));
  textOf(reloadedFiles, f.fileId)!.delete(0, 4);
  assert.equal(resolveTourStop(reloadedFiles, selected), null);
});

test("repeated close-gap reorders keep the requested order after rank precision is exhausted", () => {
  const f = fixture();
  const first = stop(f, 1), second = stop(f, 2), third = stop(f, 3);
  let moving = third.id, before = second.id;
  for (let i = 0; i < 120; i++) {
    assert.equal(moveTourStop(f.tours, f.tourId, moving, before), true);
    const ids = listTours(f.tours)[0]!.stops.map(({ id }) => id);
    assert.deepEqual(ids, [first.id, moving, before]);
    [moving, before] = [before, moving];
  }
});

test("input bounds reject impossible selections and cap stored text and very long tours", () => {
  const f = fixture();
  assert.equal(addTour(f.tours, { title: " ", createdBy: "ana" }), null);
  assert.equal(editTour(f.tours, f.tourId, { title: " " }), false);
  assert.equal(editTour(f.tours, "missing", { title: "No" }), false);
  assert.equal(moveTour(f.tours, f.tourId, "missing"), false);
  editTour(f.tours, f.tourId, { title: "x".repeat(1000), description: "d".repeat(9000) });
  assert.equal(listTours(f.tours)[0]!.title.length, MAX_TOUR_TITLE);
  assert.equal(listTours(f.tours)[0]!.description.length, MAX_TOUR_DESCRIPTION);
  for (const startLine of [NaN, Infinity, -1, 0, 1.5, 9999]) assert.equal(addTourStop(f.tours, f.files, f.tourId, { fileId: f.fileId, startLine, title: "Invalid" }), null);
  assert.equal(addTourStop(f.tours, f.files, f.tourId, { fileId: f.fileId, startLine: 3, endLine: 2, title: "Backwards" }), null);
  const selected = stop(f);
  assert.equal(editTourStop(f.tours, f.tourId, selected.id, { title: "" }), false);
  editTourStop(f.tours, f.tourId, selected.id, { note: "n".repeat(20_000) });
  assert.equal(listTours(f.tours)[0]!.stops[0]!.note.length, MAX_TOUR_NOTE);
  for (let i = 1; i < MAX_TOUR_STOPS; i++) stop(f);
  assert.equal(listTours(f.tours)[0]!.stops.length, MAX_TOUR_STOPS);
  assert.equal(addTourStop(f.tours, f.files, f.tourId, { fileId: f.fileId, startLine: 1, title: "Too many" }), null);
  const large = fixture("x".repeat(MAX_TOUR_ANCHOR_LENGTH + 1));
  assert.equal(addTourStop(large.tours, large.files, large.tourId, { fileId: large.fileId, startLine: 1, title: "Too large" }), null);
});

test("malformed shared entries and unknown relative positions fail safely", () => {
  const f = fixture(), selected = stop(f);
  assert.equal(resolveTourStop(f.files, { ...selected, start: { item: { client: 123, clock: 99 } } }), null);
  assert.equal(resolveTourStop(f.files, { ...selected, source: [{ client: -1, clock: 0, length: 2 }] }), null);
  assert.equal(resolveTourStop(f.files, { ...selected, fileId: "missing" }), null);
  toursMap(f.tours).set("malformed", new Y.Map<unknown>());
  assert.equal(listTours(f.tours).length, 1);
});
