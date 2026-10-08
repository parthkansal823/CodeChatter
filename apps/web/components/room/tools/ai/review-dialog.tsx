"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { diffLines, sideBySide, type SideRow } from "./line-diff";

/** A change the AI proposes, waiting for a decision. Nothing is written until onAccept runs. */
export type Review = {
  title: string;
  description: string;
  path: string;
  before: string;
  after: string;
  acceptLabel: string;
  /** Shown above the diff, e.g. when the code changed while the AI was working. */
  warning?: string;
  onAccept: () => void;
  onReject?: () => void;
};

/** Current and proposed text side by side, then Accept or Reject. Closing with Escape decides nothing. */
export function ReviewDialog({ review, onClose }: { review: Review | null; onClose: () => void }) {
  return (
    <Dialog open={review !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 p-5 sm:max-w-5xl">{review && <ReviewBody review={review} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ReviewBody({ review, onClose }: { review: Review; onClose: () => void }) {
  const lines = useMemo(() => diffLines(review.before, review.after), [review.before, review.after]);
  const rows = useMemo(() => sideBySide(lines), [lines]);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  const unchanged = added + removed === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">{review.title}</DialogTitle>
        <DialogDescription>
          {review.description}{" "}
          <span className="text-foreground tabular-nums">
            {added} {added === 1 ? "line" : "lines"} added, {removed} removed.
          </span>
        </DialogDescription>
      </DialogHeader>
      {review.warning && (
        <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-sm">
          {review.warning}
        </p>
      )}
      <div className="grid grid-cols-2 gap-px text-2xs text-muted-foreground">
        <span className="px-1">Current</span>
        <span className="px-1">Proposed</span>
      </div>
      {unchanged ? (
        <p className="rounded-md border bg-panel px-3 py-2 text-sm text-muted-foreground">No changes: the file already matches this code.</p>
      ) : (
        <div className="grid max-h-[50vh] grid-cols-2 gap-px overflow-y-auto rounded-md border bg-border font-mono text-xs leading-5">
          <Column label={`Current ${review.path}`} rows={rows} side="left" />
          <Column label={`Proposed ${review.path}`} rows={rows} side="right" />
        </div>
      )}
      <DialogFooter>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            review.onReject?.();
            onClose();
          }}
        >
          {review.onReject ? "Reject" : "Cancel"}
        </Button>
        <Button
          size="sm"
          disabled={unchanged}
          onClick={() => {
            review.onAccept();
            onClose();
          }}
        >
          {review.acceptLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function Column({ label, rows, side }: { label: string; rows: SideRow[]; side: "left" | "right" }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 overflow-x-auto bg-panel">
      <div className="w-max min-w-full">
        {rows.map((row, i) => {
          if ("gap" in row) {
            return (
              <div key={i} className="h-6 bg-muted/50 px-3 font-sans text-2xs leading-6 text-muted-foreground">
                {row.gap} unchanged {row.gap === 1 ? "line" : "lines"}
              </div>
            );
          }
          const cell = row[side];
          return (
            <div
              key={i}
              className={cn("flex h-5 whitespace-pre", cell?.kind === "del" && "bg-destructive/12", cell?.kind === "add" && "bg-success/12", !cell && "bg-muted/50")}
            >
              <span aria-hidden className="w-5 shrink-0 text-center text-muted-foreground select-none">
                {cell?.kind === "del" ? "-" : cell?.kind === "add" ? "+" : ""}
              </span>
              <span className="sr-only">{cell?.kind === "del" ? "Removed: " : cell?.kind === "add" ? "Added: " : ""}</span>
              <span className="pr-3">{cell?.text ?? ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
