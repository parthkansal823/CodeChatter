/** Labeled tour and stop dialogs publish only submitted fields, keeping concurrent changes outside those fields intact. */
"use client";

import {
  MAX_TOUR_DESCRIPTION,
  MAX_TOUR_NOTE,
  MAX_TOUR_TITLE,
  type Tour,
  type TourStop,
} from "@codechatter/workspace-model";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type TourFields = { title: string; description: string };
export type StopFields = { title: string; note: string };

export function TourEditor({
  tour,
  onClose,
  onSave,
}: {
  tour: Tour | null;
  onClose: () => void;
  onSave: (fields: TourFields) => void;
}) {
  const [title, setTitle] = useState(tour?.title ?? "");
  const [description, setDescription] = useState(tour?.description ?? "");
  const id = useId();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-own-run-key className="text-[13px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tour ? "Edit tour" : "New tour"}</DialogTitle>
          <DialogDescription>Everyone in the room sees this tour.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) onSave({ title, description });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-title`}>Tour title</Label>
            <Input
              id={`${id}-title`}
              autoFocus
              required
              maxLength={MAX_TOUR_TITLE}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-description`}>Description</Label>
            <Textarea
              id={`${id}-description`}
              maxLength={MAX_TOUR_DESCRIPTION}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim()}>
              {tour ? "Save tour" : "Create tour"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StopEditor({
  stop,
  onClose,
  onSave,
}: {
  stop: TourStop;
  onClose: () => void;
  onSave: (fields: StopFields) => void;
}) {
  const [title, setTitle] = useState(stop.title);
  const [note, setNote] = useState(stop.note);
  const id = useId();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-own-run-key className="text-[13px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit stop</DialogTitle>
          <DialogDescription>
            The note can use Markdown. Its place in the code stays the same.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) onSave({ title, note });
          }}
        >
          <StopInputs id={id} title={title} note={note} setTitle={setTitle} setNote={setNote} />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim()}>
              Save stop
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddStopEditor({
  tours,
  fileLabel,
  ready,
  onClose,
  onSave,
}: {
  tours: Tour[];
  fileLabel: string;
  ready: boolean;
  onClose: () => void;
  onSave: (fields: StopFields & { tourId: string; tourTitle: string }) => void;
}) {
  const [tourId, setTourId] = useState(tours[0]?.id ?? "");
  const [tourTitle, setTourTitle] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const id = useId();
  const existing = tours.some((tour) => tour.id === tourId);
  const valid = ready && title.trim() && (existing || (!tourId && tourTitle.trim()));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-own-run-key className="text-[13px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add this line to a tour</DialogTitle>
          <DialogDescription>{fileLabel}. Everyone in the room sees this stop.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSave({ title, note, tourId, tourTitle });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-tour`}>Tour</Label>
            <select
              id={`${id}-tour`}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px]"
              value={tourId}
              onChange={(event) => setTourId(event.target.value)}
            >
              <option value="">New tour</option>
              {tourId && !existing && (
                <option value={tourId} disabled>
                  Deleted tour
                </option>
              )}
              {tours.map((tour) => (
                <option key={tour.id} value={tour.id}>
                  {tour.title}
                </option>
              ))}
            </select>
          </div>
          {!tourId && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-tour-title`}>Tour title</Label>
              <Input
                id={`${id}-tour-title`}
                required
                maxLength={MAX_TOUR_TITLE}
                value={tourTitle}
                onChange={(event) => setTourTitle(event.target.value)}
              />
            </div>
          )}
          <StopInputs id={id} title={title} note={note} setTitle={setTitle} setNote={setNote} />
          {!ready && (
            <p role="status" className="text-xs text-muted-foreground">
              Waiting for the tours and file to be available.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid}>
              Add stop
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StopInputs({
  id,
  title,
  note,
  setTitle,
  setNote,
}: {
  id: string;
  title: string;
  note: string;
  setTitle: (value: string) => void;
  setNote: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Stop title</Label>
        <Input
          id={`${id}-title`}
          required
          maxLength={MAX_TOUR_TITLE}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-note`}>Note (Markdown)</Label>
        <Textarea
          id={`${id}-note`}
          maxLength={MAX_TOUR_NOTE}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-28 text-[13px]"
        />
      </div>
    </>
  );
}
