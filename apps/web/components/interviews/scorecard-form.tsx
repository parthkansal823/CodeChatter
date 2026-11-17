/** The interviewer's private scorecard: each criterion from 1 to 5 with a note, an overall score, a recommendation and notes. */
"use client";

import type { InterviewCriterion, Scorecard, SaveScorecardInput } from "@codechatter/contracts";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { RECOMMENDATION_LABEL } from "./format";

const SCORES = ["1", "2", "3", "4", "5"];
/** Hover too: with the pointer still on what was just clicked, its text would otherwise turn the same colour as its background. */
const CHOSEN = "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground";

/** Its values alone: the database hands keys back in its own order. */
const valuesOf = (card: Scorecard) => JSON.stringify([card.scores.map((row) => [row.id, row.score, row.note]), card.overall, card.recommendation, card.notes]);

function ScorePicker({ label, value, onChange }: { label: string; value: number | null; onChange: (score: number | null) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" className="max-w-full flex-wrap" aria-label={label} value={value === null ? "" : String(value)} onValueChange={(next) => onChange(next ? Number(next) : null)}>
      {SCORES.map((score) => <ToggleGroupItem key={score} value={score} aria-label={`${score} out of 5`} className={CHOSEN}>{score}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

export function ScorecardForm({ rubric, scorecard, submittedAt, onSave }: { rubric: InterviewCriterion[]; scorecard: Scorecard; submittedAt: string | null; onSave: (next: SaveScorecardInput) => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(scorecard);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [savedValues, setSavedValues] = useState(() => valuesOf(scorecard));
  const incoming = valuesOf(scorecard);
  // Polls may update an unchanged draft, but never overwrite edits still in this form.
  if (incoming !== savedValues) {
    setSavedValues(incoming);
    if (valuesOf(draft) === savedValues) setDraft(scorecard);
  }
  const labels = new Map(rubric.map((criterion) => [criterion.id, criterion.label]));
  const changed = valuesOf(draft) !== valuesOf(scorecard);
  const setRow = (rowId: string, next: Partial<Scorecard["scores"][number]>) =>
    setDraft((current) => ({ ...current, scores: current.scores.map((row) => (row.id === rowId ? { ...row, ...next } : row)) }));

  async function save(submit: boolean) {
    setBusy(true);
    setError("");
    try {
      await onSave({ ...draft, submit });
      setConfirm(false);
    } catch {
      setError("Couldn't save your scorecard. Your changes are still here. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-own-run-key onSubmit={(event) => { event.preventDefault(); void save(false); }} className="grid min-w-0 max-w-2xl gap-4">
      <div className="grid gap-1"><h3 className="font-medium">Your scorecard</h3><p role="status">{submittedAt ? `Submitted ${new Date(submittedAt).toLocaleString()}` : "Draft — only you can see it."}{changed ? " Unsaved changes." : ""}</p><p className="text-muted-foreground">The candidate never sees scorecards. {submittedAt ? "Saving changes as a draft withdraws this submission until you submit again." : "Submit when you're ready to see the other submitted reviews."}</p></div>
      <fieldset disabled={busy} className="contents">
        <legend className="sr-only">Your scorecard</legend>
      {draft.scores.map((row) => (
        <div key={row.id} className="grid gap-1.5 border-b pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{labels.get(row.id) ?? row.id}</span>
            <div className="ml-auto"><ScorePicker label={labels.get(row.id) ?? row.id} value={row.score} onChange={(score) => setRow(row.id, { score })} /></div>
          </div>
          <Textarea aria-label={`Note on ${labels.get(row.id) ?? row.id}`} rows={2} placeholder="A note (optional)" value={row.note} onChange={(event) => setRow(row.id, { note: event.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">Overall</span>
          <ScorePicker label="Overall" value={draft.overall} onChange={(overall) => setDraft((current) => ({ ...current, overall }))} />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">Recommend?</span>
          <ToggleGroup type="single" size="sm" variant="outline" aria-label="Recommendation" value={draft.recommendation ?? ""} onValueChange={(next) => setDraft((current) => ({ ...current, recommendation: (next || null) as Scorecard["recommendation"] }))}>
            {(["yes", "maybe", "no"] as const).map((value) => <ToggleGroupItem key={value} value={value} className={CHOSEN}>{RECOMMENDATION_LABEL[value]}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} rows={5} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
      </div>
      </fieldset>
      {error && !confirm && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || !changed}>{busy ? "Saving…" : changed ? "Save scorecard" : "Saved"}</Button><Button type="button" size="sm" variant="outline" disabled={busy || (Boolean(submittedAt) && !changed)} onClick={() => { setError(""); setConfirm(true); }}>{submittedAt ? "Submit again" : "Submit scorecard"}</Button></div>
      <AlertDialog open={confirm} onOpenChange={(open) => { if (!busy) setConfirm(open); }}>
        <AlertDialogContent data-own-run-key><AlertDialogHeader><AlertDialogTitle>{submittedAt ? "Submit your updated scorecard?" : "Submit your scorecard?"}</AlertDialogTitle><AlertDialogDescription>Your judgement becomes visible to other interviewers once they submit their own. You will be able to read their submitted scorecards. Organisation owners and admins can read submitted scorecards.</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void save(true); }}>{busy ? "Submitting…" : "Submit"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
