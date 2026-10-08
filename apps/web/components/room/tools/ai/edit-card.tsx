"use client";

import { textOf } from "@codechatter/workspace-model";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { appliedToast, applyAiText, canUndoAi, fingerprint, matchTrailingNewline, resolveRange, undoAi } from "./ai-edit";
import type { ChatEntry } from "./history";
import type { Review } from "./review-dialog";

type Props = {
  entry: ChatEntry;
  /** The replacement code from the answer. */
  code: string;
  setReview: (review: Review | null) => void;
  patch: (patch: Partial<ChatEntry>) => void;
};

/** Under an Edit answer: review the proposed change as a side-by-side diff, then accept or reject it. */
export function EditCard({ entry, code, setReview, patch }: Props) {
  const { doc, can } = useRoom();
  const target = entry.target;
  if (!target) return null;

  /** Where the change goes now: the sent selection (followed through other people's edits), or the whole file. */
  const locate = () => {
    const ytext = textOf(doc, target.fileId);
    if (!ytext) return null;
    const range = target.range ? resolveRange(doc, ytext, target.range) : { from: 0, to: ytext.length };
    return range ? { range, before: ytext.toString().slice(range.from, range.to) } : null;
  };

  const review = () => {
    const found = locate();
    if (!found) return void toast.error(`${target.path} or the selected code is gone. Ask again.`);
    const after = matchTrailingNewline(found.before, code);
    setReview({
      title: target.range ? `Apply this change to ${target.path}?` : `Replace ${target.path}?`,
      description: target.range ? "Only the code you selected changes." : "The whole file becomes the AI's version.",
      path: target.path,
      before: found.before,
      after,
      acceptLabel: "Accept change",
      ...(fingerprint(found.before) !== target.fingerprint && { warning: "This code changed after you asked, so the proposal was written for an older version." }),
      onAccept: () => {
        const now = locate();
        if (!now || !applyAiText(doc, target.fileId, after, now.range)) return void toast.error("Couldn't apply: the code moved or was deleted.");
        patch({ edit: "applied" });
        appliedToast(`Applied to ${target.path}`, () => undoAi(doc, target.fileId));
      },
      onReject: () => patch({ edit: "rejected" }),
    });
  };

  if (entry.edit === "applied") {
    return (
      <div className="mt-2 flex items-center gap-2 font-sans text-xs text-muted-foreground">
        <span>Applied to {target.path}.</span>
        {canUndoAi(doc, target.fileId) && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => (undoAi(doc, target.fileId) ? patch({ edit: "undone" }) : toast.error("Nothing left to undo."))}
          >
            <Undo2 /> Undo
          </Button>
        )}
      </div>
    );
  }
  if (entry.edit === "rejected") return <p className="mt-2 font-sans text-xs text-muted-foreground">You rejected this change.</p>;
  if (entry.edit === "undone") return <p className="mt-2 font-sans text-xs text-muted-foreground">Change undone.</p>;

  return (
    <div className="mt-2 flex items-center gap-2 font-sans">
      <Button size="xs" variant="secondary" disabled={!can("files.edit")} onClick={review}>
        Review change
      </Button>
      {!can("files.edit") && <span className="text-2xs text-muted-foreground">You can view this room but not edit files.</span>}
    </div>
  );
}
