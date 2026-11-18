/** Shared room tours with accessible editing and local playback; stable file ids and relative positions keep stops with their code. */
"use client";

import {
  addTour,
  deleteTour,
  deleteTourStop,
  editTour,
  editTourStop,
  listTours,
  MAX_TOURS,
  MAX_TOUR_STOPS,
  moveTour,
  moveTourStop,
  resolveTourStop,
  type Tour,
  type TourStop,
} from "@codechatter/workspace-model";
import { ArrowDown, ArrowUp, GripVertical, Play, Plus, X } from "lucide-react";
import { useId, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";

import { useDocumentVersion, useToursConnection, type ToursConnection } from "./connection";
import { useToursPlayback } from "./local-store";
import { StopEditor, TourEditor } from "./tour-editors";

const DRAG_TYPE = "application/x-codechatter-tour-stop";
const MARKDOWN_PLUGINS = [remarkGfm];

export default function ToursTool({ close }: RoomToolProps) {
  const { room } = useRoom();
  const connection = useToursConnection(room.id);
  return (
    <section
      aria-label="Code tours"
      data-own-run-key
      className="flex h-full min-h-0 flex-col bg-panel text-[13px]"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="mr-auto font-medium">Tours</h1>
        <Button size="icon-xs" variant="ghost" aria-label="Close tours" onClick={close}>
          <X />
        </Button>
      </header>
      {connection?.synced ? (
        <ToursContent connection={connection} />
      ) : (
        <p role="status" className="p-3 text-muted-foreground">
          {connection?.status === "denied"
            ? "Tours could not be opened. Reload the room to check your access."
            : "Opening tours..."}
        </p>
      )}
    </section>
  );
}

function ToursContent({ connection }: { connection: ToursConnection }) {
  "use no memo";
  // Explicit document revisions invalidate anchor resolution after text changes.
  const { room, me, doc: filesDoc, can } = useRoom();
  const files = useRoomFiles();
  const filesVersion = useDocumentVersion(filesDoc);
  const tours = useMemo(() => listTours(connection.doc), [connection]);
  const playback = useToursPlayback((state) => state.byRoom[room.id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingTour, setEditingTour] = useState<Tour | "new" | null>(null);
  const [editingStop, setEditingStop] = useState<{ tourId: string; stop: TourStop } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const id = useId();
  const editable = can("files.edit") && connection.status !== "denied";
  const activeTour = tours.find((tour) => tour.id === playback?.tourId);
  const tour = tours.find((item) => item.id === selected) ?? activeTour ?? tours[0];
  const currentIndex = activeTour?.stops.findIndex((stop) => stop.id === playback?.stopId) ?? -1;
  const currentStop = activeTour?.stops[currentIndex];
  const currentFile = files.find((file) => file.id === currentStop?.fileId);
  const currentPlace = useMemo(() => {
    void filesVersion;
    return currentStop ? resolveTourStop(filesDoc, currentStop) : null;
  }, [filesDoc, currentStop, filesVersion]);
  const play = (item: Tour, stop: TourStop | undefined = item.stops[0]) => {
    if (stop) {
      setSelected(item.id);
      useToursPlayback.getState().play(room.id, item.id, stop.id);
    }
  };
  const moveStop = (stopId: string, beforeId: string | null) => {
    if (editable && tour && moveTourStop(connection.doc, tour.id, stopId, beforeId))
      setAnnouncement("Stop moved.");
  };
  const moveBy = (stop: TourStop, direction: -1 | 1) => {
    if (!tour) return;
    const index = tour.stops.findIndex((item) => item.id === stop.id);
    if (index + direction < 0 || index + direction >= tour.stops.length) return;
    moveStop(stop.id, direction < 0 ? tour.stops[index - 1]!.id : (tour.stops[index + 2]?.id ?? null));
  };
  const onStopKey = (event: KeyboardEvent<HTMLDivElement>, stop: TourStop) => {
    if (
      !editable ||
      event.target !== event.currentTarget ||
      !["ArrowUp", "ArrowDown"].includes(event.key) ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    event.preventDefault();
    moveBy(stop, event.key === "ArrowUp" ? -1 : 1);
    requestAnimationFrame(() => document.getElementById(`${id}-${stop.id}`)?.focus());
  };
  const drop = (event: DragEvent<HTMLElement>, beforeId: string | null) => {
    if (!editable || !tour) return;
    event.preventDefault();
    const stopId = event.dataTransfer.getData(DRAG_TYPE);
    if (tour.stops.some((stop) => stop.id === stopId)) moveStop(stopId, beforeId);
    event.stopPropagation();
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="grid gap-3 p-3">
        {connection.status === "offline" && (
          <p role="status" className="text-xs text-muted-foreground">
            Offline. Leave the room open so changes can sync when you reconnect.
          </p>
        )}
        {!editable && (
          <p className="text-xs text-muted-foreground">
            You can play tours. Editing needs file-editing permission.
          </p>
        )}
        {editable && (
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={tours.length >= MAX_TOURS}
            onClick={() => setEditingTour("new")}
          >
            <Plus />
            New tour
          </Button>
        )}
        {!tours.length && (
          <p className="text-muted-foreground">
            {editable
              ? "Right-click a line in the editor and choose Add this line to a tour."
              : "There are no tours yet."}
          </p>
        )}
        <ul aria-label="Room tours" className="grid min-w-0 gap-1">
          {tours.map((item, index) => (
            <li key={item.id} className="flex min-w-0 items-center gap-1 rounded-md border p-1">
              <button
                type="button"
                aria-pressed={tour?.id === item.id}
                className="min-h-7 min-w-0 flex-1 rounded-sm px-1.5 text-left break-words hover:bg-accent aria-pressed:bg-accent"
                onClick={() => setSelected(item.id)}
              >
                {item.title}
                <span className="ml-1 text-xs text-muted-foreground">({item.stops.length})</span>
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Play ${item.title}`}
                disabled={!item.stops.length}
                onClick={() => play(item)}
              >
                <Play />
              </Button>
              {editable && (
                <>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move tour ${item.title} up`}
                    disabled={index === 0}
                    onClick={() => {
                      if (editable) moveTour(connection.doc, item.id, tours[index - 1]!.id);
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move tour ${item.title} down`}
                    disabled={index === tours.length - 1}
                    onClick={() => {
                      if (editable) moveTour(connection.doc, item.id, tours[index + 2]?.id ?? null);
                    }}
                  >
                    <ArrowDown />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {activeTour && currentStop && (
          <section
            aria-label="Tour playback"
            className="grid min-w-0 gap-2 rounded-md border border-brand/50 bg-background p-3"
          >
            <p className="text-xs text-muted-foreground">{activeTour.title}</p>
            <p role="status" aria-live="polite" className="text-xs">
              Stop {currentIndex + 1} of {activeTour.stops.length}
            </p>
            <h2 className="break-words font-medium">{currentStop.title}</h2>
            <p className="break-all text-xs text-muted-foreground">
              {currentFile?.path ?? "Deleted file"}
              {currentPlace
                ? `:${currentPlace.startLine}${currentPlace.endLine !== currentPlace.startLine ? `–${currentPlace.endLine}` : ""}`
                : ""}
            </p>
            {!currentFile ? (
              <p role="status">This file has been deleted. Skip this stop.</p>
            ) : !currentPlace ? (
              <p role="status">These lines no longer exist. Skip this stop.</p>
            ) : null}
            <div className="min-w-0 break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
              <Markdown
                skipHtml
                remarkPlugins={MARKDOWN_PLUGINS}
                components={{
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {currentStop.note || "No note for this stop."}
              </Markdown>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                size="xs"
                variant="outline"
                disabled={currentIndex <= 0}
                onClick={() => play(activeTour, activeTour.stops[currentIndex - 1])}
              >
                Back
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={currentIndex >= activeTour.stops.length - 1}
                onClick={() => play(activeTour, activeTour.stops[currentIndex + 1])}
              >
                Next
              </Button>
              <Button size="xs" variant="ghost" onClick={() => useToursPlayback.getState().stop(room.id)}>
                End tour
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Alt+Right: next. Alt+Left: back.</p>
          </section>
        )}
        {tour && (
          <section aria-label="Tour stops" className="grid min-w-0 gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <h2 className="mr-auto min-w-0 break-words font-medium">{tour.title}</h2>
              {editable && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label="Edit tour"
                    onClick={() => setEditingTour(tour)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label="Delete tour"
                    onClick={() => {
                      if (editable) deleteTour(connection.doc, tour.id);
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
            {tour.description && (
              <p className="break-words whitespace-pre-wrap text-xs text-muted-foreground">
                {tour.description}
              </p>
            )}
            {editable && (
              <p id={`${id}-keys`} className="text-xs text-muted-foreground">
                Add a stop from a line&apos;s right-click menu. Drag stops, use their arrow buttons, or focus
                a stop and press Up or Down to reorder.
              </p>
            )}
            {!tour.stops.length && (
              <p className="text-xs text-muted-foreground">This tour has no stops yet.</p>
            )}
            {tour.stops.length >= MAX_TOUR_STOPS && (
              <p className="text-xs text-muted-foreground">This tour has reached {MAX_TOUR_STOPS} stops.</p>
            )}
            <ol
              aria-label="Stops"
              className="grid gap-2"
              onDragOver={(event) => {
                if (editable && event.dataTransfer.types.includes(DRAG_TYPE)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => drop(event, null)}
            >
              {tour.stops.map((stop, index) => (
                <li key={stop.id} onDrop={(event) => drop(event, stop.id)}>
                  <div
                    id={`${id}-${stop.id}`}
                    role="group"
                    aria-label={`Stop: ${stop.title}`}
                    aria-describedby={editable ? `${id}-keys` : undefined}
                    data-tour-stop-id={stop.id}
                    tabIndex={0}
                    draggable={editable}
                    onDragStart={(event) => {
                      if (!editable) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData(DRAG_TYPE, stop.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onKeyDown={(event) => onStopKey(event, stop)}
                    className="grid min-w-0 gap-1.5 rounded-md border bg-background p-2"
                  >
                    <div className="flex min-w-0 items-start gap-1.5">
                      {editable && (
                        <GripVertical
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        />
                      )}
                      <h3 className="min-w-0 flex-1 break-words font-medium">
                        {index + 1}. {stop.title}
                      </h3>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Play stop ${stop.title}`}
                        onClick={() => play(tour, stop)}
                      >
                        <Play />
                      </Button>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {files.find((file) => file.id === stop.fileId)?.path ?? "Deleted file"}
                    </p>
                    {editable && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Move stop ${stop.title} up`}
                          disabled={index === 0}
                          onClick={() => moveBy(stop, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Move stop ${stop.title} down`}
                          disabled={index === tour.stops.length - 1}
                          onClick={() => moveBy(stop, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Edit stop ${stop.title}`}
                          onClick={() => setEditingStop({ tourId: tour.id, stop })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Delete stop ${stop.title}`}
                          onClick={() => {
                            if (editable) deleteTourStop(connection.doc, tour.id, stop.id);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      {editingTour && editable && (
        <TourEditor
          key={editingTour === "new" ? "new" : editingTour.id}
          tour={editingTour === "new" ? null : editingTour}
          onClose={() => setEditingTour(null)}
          onSave={(fields) => {
            if (!editable) return;
            if (editingTour === "new") {
              const newId = addTour(connection.doc, { ...fields, createdBy: me.user.id });
              if (!newId) {
                toast.error(
                  "Could not create the tour. It needs a title and the room may already have enough tours.",
                );
                return;
              }
              setSelected(newId);
            } else {
              const patch: Parameters<typeof editTour>[2] = {};
              if (fields.title !== editingTour.title) patch.title = fields.title;
              if (fields.description !== editingTour.description) patch.description = fields.description;
              if (!editTour(connection.doc, editingTour.id, patch)) {
                toast.error("This tour has been removed.");
                return;
              }
            }
            setEditingTour(null);
          }}
        />
      )}
      {editingStop && editable && (
        <StopEditor
          key={editingStop.stop.id}
          stop={editingStop.stop}
          onClose={() => setEditingStop(null)}
          onSave={(fields) => {
            if (!editable) return;
            const patch: Parameters<typeof editTourStop>[3] = {};
            if (fields.title !== editingStop.stop.title) patch.title = fields.title;
            if (fields.note !== editingStop.stop.note) patch.note = fields.note;
            if (!editTourStop(connection.doc, editingStop.tourId, editingStop.stop.id, patch)) {
              toast.error("This stop has been removed.");
              return;
            }
            setEditingStop(null);
          }}
        />
      )}
    </div>
  );
}
