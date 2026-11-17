/** Show the viewer's editable personal scorecard, then the submitted reviews the API permits them to see. */
"use client";

import type { InterviewerInterview, SaveScorecardInput } from "@codechatter/contracts";

import { ScorecardForm } from "./scorecard-form";
import { ScorecardsReview } from "./scorecards-review";

export function ScorecardsPanel({ interview, onSave }: { interview: InterviewerInterview; onSave: (next: SaveScorecardInput) => Promise<void> }) {
  const { scorecards } = interview;
  return (
    <div className="grid min-w-0 gap-5">
      {scorecards.canWrite && scorecards.own ? <ScorecardForm key={`${interview.id}:${scorecards.own.interviewer.id}`} rubric={interview.rubric} scorecard={scorecards.own} submittedAt={scorecards.own.submittedAt} onSave={onSave} /> : <p className="text-muted-foreground">You can read submitted scorecards. Only an active interviewer on this interview can write one.</p>}
      <ScorecardsReview scorecards={scorecards} rubric={interview.rubric} hideOwn={scorecards.canWrite} />
    </div>
  );
}
