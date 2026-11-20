/**
 * A run's notes, as n8n's annotations: whether it was a good or a bad run, tags to find it by in Every run, and a short note, kept with the run in the
 * sandbox (automation.py's annotate), so they go when it does. Anyone who can run the room's flows can change them, once the run has ended.
 */
"use client";

import { MOST_RUN_NOTE_CHARACTERS, type AutomationInput, type AutomationRunAnnotation } from "@codechatter/contracts";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { withTag } from "./model";

type Notes = { vote: "good" | "bad" | null; tags: string[]; note: string };

export function RunNotes({ runId, annotation, canEdit, ask, onSaved }: { runId: string; annotation: AutomationRunAnnotation | null | undefined; canEdit: boolean; ask: <T>(input: AutomationInput) => Promise<T>; onSaved: (annotation: AutomationRunAnnotation | null) => void }) {
  const [typedTag, setTypedTag] = useState("");
  const [tagProblem, setTagProblem] = useState<string | null>(null);
  const [typedNote, setTypedNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current: Notes = { vote: annotation?.vote ?? null, tags: annotation?.tags ?? [], note: annotation?.note ?? "" };

  const save = async (change: Partial<Notes>) => {
    const wanted = { ...current, ...change };
    setSaving(true);
    try {
      const answer = await ask<{ annotation: AutomationRunAnnotation | null }>({ op: "annotate", id: runId, vote: wanted.vote, tags: wanted.tags, note: wanted.note });
      onSaved(answer.annotation);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't save the run's notes. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const addTag = async () => {
    const next = withTag(current.tags, typedTag);
    if ("problem" in next) return setTagProblem(next.problem);
    setTagProblem(null);
    if (next.tags.length !== current.tags.length && !(await save({ tags: next.tags }))) return;
    setTypedTag("");
  };
  const vote = (which: "good" | "bad") => void save({ vote: current.vote === which ? null : which });

  return (
    <section aria-label="Its notes" className="grid gap-1.5 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-medium">Notes</span>
        <Button size="xs" variant={current.vote === "good" ? "secondary" : "ghost"} aria-pressed={current.vote === "good"} disabled={!canEdit || saving} onClick={() => vote("good")}>
          <ThumbsUp /> Good run
        </Button>
        <Button size="xs" variant={current.vote === "bad" ? "secondary" : "ghost"} aria-pressed={current.vote === "bad"} disabled={!canEdit || saving} onClick={() => vote("bad")}>
          <ThumbsDown /> Bad run
        </Button>
      </div>
      <ul aria-label="Its tags" className="flex flex-wrap gap-1">
        {current.tags.map((tag) => (
          <li key={tag} className="flex h-6 items-center gap-0.5 rounded-sm border bg-secondary pl-1.5 pr-0.5">
            {tag}
            {canEdit && (
              <button type="button" aria-label={`Remove the tag ${tag}`} disabled={saving} className="grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void save({ tags: current.tags.filter((each) => each !== tag) })}>
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
        {!current.tags.length && !canEdit && <li className="text-muted-foreground">No tags.</li>}
      </ul>
      {canEdit && (
        <div className="grid gap-1">
          <form
            className="flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void addTag();
            }}
          >
            <Input className="h-7 text-xs md:text-xs" aria-label="A tag to add" aria-describedby={tagProblem ? `${runId}-tag-problem` : undefined} aria-invalid={Boolean(tagProblem)} maxLength={30} placeholder="A tag, such as release or flaky" value={typedTag} disabled={saving}
              onChange={(event) => {
                setTypedTag(event.target.value);
                setTagProblem(null);
              }}
            />
            <Button type="submit" size="xs" variant="outline" disabled={saving || !typedTag.trim()}>
              Add
            </Button>
          </form>
          {tagProblem && (
            <p id={`${runId}-tag-problem`} className="text-destructive">
              {tagProblem}
            </p>
          )}
        </div>
      )}
      {/* Named by aria-label rather than a wrapping label, whose name would take in what's typed. */}
      <Textarea
        aria-label="Its note"
        className={cn("min-h-12 text-xs md:text-xs", !canEdit && "resize-none")}
        readOnly={!canEdit}
        maxLength={MOST_RUN_NOTE_CHARACTERS}
        placeholder={canEdit ? "A note on this run, for whoever looks at it next" : "No note."}
        value={typedNote ?? current.note}
        onChange={(event) => setTypedNote(event.target.value)}
        onBlur={() => {
          if (typedNote === null) return;
          if (typedNote.trim() === current.note) return setTypedNote(null);
          void save({ note: typedNote }).then((saved) => saved && setTypedNote(null));
        }}
      />
    </section>
  );
}
