/** Render only the server-approved submitted reviews and aggregate, shared by the detail page, room tool and batch results. */
"use client";

import type { InterviewCriterion, InterviewScorecards } from "@codechatter/contracts";

import { PresenceAvatar, slotFor } from "@/components/presence/presence";

import { RECOMMENDATION_LABEL } from "./format";
import { recommendationSpread, scoreAverage } from "./report";

export function ScorecardsReview({ scorecards, rubric, hideOwn = false }: { scorecards: InterviewScorecards; rubric: InterviewCriterion[]; hideOwn?: boolean }) {
  if (scorecards.locked) return (
    <section aria-label="Scorecard review" className="grid min-w-0 gap-2 border-t pt-4">
      <p>{scorecards.otherSubmittedCount} other scorecard{scorecards.otherSubmittedCount === 1 ? "" : "s"} submitted.</p>
      <p className="text-muted-foreground">Submit your scorecard to see other submitted reviews and their summary.</p>
    </section>
  );
  const summary = scorecards.summary;
  const labels = new Map(rubric.map((criterion) => [criterion.id, criterion.label]));
  const others = scorecards.submitted.filter((card) => !hideOwn || card.interviewer.id !== scorecards.own?.interviewer.id);
  return (
    <section aria-label="Scorecard review" className="grid min-w-0 gap-5 border-t pt-4">
      {summary && <section aria-label="Scorecard summary" className="grid min-w-0 gap-2">
        <h3 className="font-medium">Review summary</h3>
        <p>Recommendations: {recommendationSpread(summary)}</p>
        <p>Overall average: {scoreAverage(summary.overall.average)} <span className="text-muted-foreground">({summary.overall.count} scored)</span></p>
        <ul className="grid gap-1">{summary.criteria.map((criterion) => <li key={criterion.id} className="break-words">{criterion.label}: {scoreAverage(criterion.average)} <span className="text-muted-foreground">({criterion.count} scored)</span></li>)}</ul>
        <p className="text-muted-foreground">{summary.submitted} submitted. {summary.pending.length ? "Not submitted:" : "No active interviewers are waiting to submit."}</p>
        {summary.pending.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-2">{summary.pending.map((person) => <li key={person.id} className="flex min-w-0 items-center gap-2"><PresenceAvatar name={person.name} image={person.image} size={20} slot={slotFor(person.id ?? "former")} /><span className="min-w-0 break-words">{person.name}</span></li>)}</ul>}
      </section>}
      {others.length > 0 ? <div className="grid min-w-0 gap-4">
        <h3 className="font-medium">{hideOwn ? "Other submitted scorecards" : "Submitted scorecards"}</h3>
        {others.map((card, index) => <article key={`${card.interviewer.id ?? "former"}:${index}`} aria-label={`Submitted scorecard by ${card.interviewer.name}`} className="grid min-w-0 gap-3 rounded-md border p-3">
          <header className="flex min-w-0 flex-wrap items-center gap-2"><PresenceAvatar name={card.interviewer.name} image={card.interviewer.image} size={22} slot={slotFor(card.interviewer.id ?? `former-${index}`)} /><span className="min-w-0 break-words font-medium">{card.interviewer.name}</span><span className="text-xs text-muted-foreground">Submitted {card.submittedAt ? new Date(card.submittedAt).toLocaleString() : ""}</span></header>
          <p>Recommendation: {card.recommendation ? RECOMMENDATION_LABEL[card.recommendation] : "None yet"}. Overall: {scoreAverage(card.overall)}</p>
          <ul className="grid gap-2">{card.scores.map((entry) => <li key={entry.id} className="min-w-0"><span>{labels.get(entry.id) ?? entry.id}: {scoreAverage(entry.score)}</span>{entry.note && <p className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}</li>)}</ul>
          {card.notes && <p className="break-words whitespace-pre-wrap">{card.notes}</p>}
        </article>)}
      </div> : <p className="text-muted-foreground">{hideOwn ? "No other scorecards have been submitted yet." : "No scorecards have been submitted yet."}</p>}
    </section>
  );
}
