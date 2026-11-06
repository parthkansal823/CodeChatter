/** The interviewer's private scorecard: each criterion from 1 to 5 with a note, an overall score, a recommendation and notes. */
"use client";

import type { InterviewCriterion, Scorecard } from "@codechatter/contracts";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { RECOMMENDATION_LABEL } from "./format";

const SCORES = ["1", "2", "3", "4", "5"];

/** Its values alone: the database hands keys back in its own order. */
const valuesOf = (card: Scorecard) => JSON.stringify([card.scores.map((row) => [row.id, row.score, row.note]), card.overall, card.recommendation, card.notes]);

function ScorePicker({ label, value, onChange }: { label: string; value: number | null; onChange: (score: number | null) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" aria-label={label} value={value === null ? "" : String(value)} onValueChange={(next) => onChange(next ? Number(next) : null)}>
      {SCORES.map((score) => <ToggleGroupItem key={score} value={score} aria-label={`${score} out of 5`} className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{score}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

export function ScorecardForm({ rubric, scorecard, onSave }: { rubric: InterviewCriterion[]; scorecard: Scorecard; onSave: (next: Scorecard) => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(scorecard);
  const [busy, setBusy] = useState(false);
  const labels = new Map(rubric.map((criterion) => [criterion.id, criterion.label]));
  const changed = valuesOf(draft) !== valuesOf(scorecard);
  const setRow = (rowId: string, next: Partial<Scorecard["scores"][number]>) =>
    setDraft((current) => ({ ...current, scores: current.scores.map((row) => (row.id === rowId ? { ...row, ...next } : row)) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="grid max-w-2xl gap-4">
      <p className="text-muted-foreground">Only interviewers see this. The candidate never does.</p>
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
            {(["yes", "maybe", "no"] as const).map((value) => <ToggleGroupItem key={value} value={value} className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{RECOMMENDATION_LABEL[value]}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} rows={5} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
      </div>
      <div><Button type="submit" size="sm" disabled={busy || !changed}>{busy ? "Saving…" : changed ? "Save scorecard" : "Saved"}</Button></div>
    </form>
  );
}
