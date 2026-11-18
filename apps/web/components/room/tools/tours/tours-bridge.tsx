/** Connect editor add actions and per-person playback to live tours while the tool panel is closed, without broadcasting playback. */
"use client";

import {
  addTour,
  addAnchoredTourStop,
  deleteTour,
  listTours,
  resolveTourStop,
} from "@codechatter/workspace-model";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { revealInFile } from "@/components/room/editor/reveal";
import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";

import { useDocumentVersion, useToursConnection } from "./connection";
import { useTourRequests, useToursPlayback } from "./local-store";
import { AddStopEditor } from "./tour-editors";

export function ToursBridge({ openFile }: { openFile: (fileId: string) => void }) {
  "use no memo";
  // This adapter reads externally mutable Yjs documents; explicit revisions own caching.
  const { room, doc: filesDoc, me, can } = useRoom();
  const files = useRoomFiles();
  const connection = useToursConnection(room.id);
  const version = useDocumentVersion(filesDoc);
  const pending = useTourRequests((state) => state.pending);
  const playback = useToursPlayback((state) => state.byRoom[room.id]);
  const tours = useMemo(() => (connection ? listTours(connection.doc) : []), [connection]);
  const tour = tours.find((item) => item.id === playback?.tourId);
  const stop = tour?.stops.find((item) => item.id === playback?.stopId);
  const file = files.find((item) => item.id === stop?.fileId);
  const place = useMemo(() => {
    void version;
    return stop ? resolveTourStop(filesDoc, stop) : null;
  }, [filesDoc, stop, version]);
  const sourcePlace = useMemo(() => {
    void version;
    return pending ? resolveTourStop(filesDoc, pending.anchor) : null;
  }, [filesDoc, pending, version]);
  const lastNavigation = useRef<string | null>(null);
  const editable = can("files.edit") && connection?.synced && connection.status !== "denied";

  useEffect(() => {
    const store = useToursPlayback.getState();
    if (connection?.synced && playback?.tourId && (!tour || !stop)) {
      store.stop(room.id);
      lastNavigation.current = null;
      return;
    }
    store.setMark(
      room.id,
      file && place ? { fileId: file.id, startLine: place.startLine, endLine: place.endLine } : null,
    );
    const key =
      file && place && stop && tour
        ? `${room.id}:${tour.id}:${stop.id}:${playback?.navigationRevision}`
        : null;
    if (key && key !== lastNavigation.current && file && place) {
      openFile(file.id);
      revealInFile(file, {
        startLine: place.startLine,
        startColumn: 1,
        endLine: place.endLine,
        endColumn: 1,
      });
    }
    // Edits move the mark, but must not repeatedly focus or scroll the editor.
    lastNavigation.current = key;
  }, [
    connection?.synced,
    room.id,
    playback?.tourId,
    playback?.stopId,
    playback?.navigationRevision,
    tour,
    stop,
    file,
    place,
    openFile,
  ]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key))
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('[role="dialog"]') ||
        (target?.closest('input, textarea, select, [contenteditable="true"]') &&
          !target.closest(".monaco-editor"))
      )
        return;
      const current = useToursPlayback.getState().byRoom[room.id];
      if (!current?.tourId || !connection) return;
      const currentTour = listTours(connection.doc).find((item) => item.id === current.tourId);
      const index = currentTour?.stops.findIndex((item) => item.id === current.stopId) ?? -1;
      const next = currentTour?.stops[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (index < 0) return;
      event.preventDefault();
      if (next && currentTour) useToursPlayback.getState().play(room.id, currentTour.id, next.id);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [room.id, connection]);

  useEffect(
    () => () => {
      useToursPlayback.getState().stop(room.id);
      if (useTourRequests.getState().pending?.roomId === room.id) useTourRequests.getState().request(null);
    },
    [room.id],
  );

  if (!pending || pending.roomId !== room.id || !can("files.edit")) return null;
  const source = files.find((item) => item.id === pending.fileId);
  const close = () => useTourRequests.getState().request(null);
  return (
    <AddStopEditor
      key={`${pending.fileId}:${pending.startLine}:${pending.endLine}`}
      tours={tours}
      ready={Boolean(editable && source && sourcePlace)}
      fileLabel={
        source && sourcePlace
          ? `${source.path}:${sourcePlace.startLine}${sourcePlace.endLine !== sourcePlace.startLine ? `–${sourcePlace.endLine}` : ""}`
          : source
            ? "These lines no longer exist"
            : "Deleted file"
      }
      onClose={close}
      onSave={(fields) => {
        if (!editable || !connection || !source || !sourcePlace) return;
        let added: string | null = null;
        connection.doc.transact(() => {
          const tourId =
            fields.tourId || addTour(connection.doc, { title: fields.tourTitle, createdBy: me.user.id });
          if (!tourId) return;
          added = addAnchoredTourStop(connection.doc, filesDoc, tourId, {
            anchor: pending.anchor,
            title: fields.title,
            note: fields.note,
          });
          if (!added && !fields.tourId) deleteTour(connection.doc, tourId);
        });
        if (!added) {
          toast.error(
            "Could not add the stop. Its tour, file or lines may have changed, or the tour is full.",
          );
          return;
        }
        toast.success("Stop added to the tour.");
        close();
      }}
    />
  );
}
