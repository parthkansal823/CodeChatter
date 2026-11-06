/** The paper as an interviewer sees it, in the room while it runs and on the interview's page afterwards: right answers, the candidate's answers, and marks. */
"use client";

import type { GradedAnswer, InterviewerInterview, PaperQuestion } from "@codechatter/contracts";
import { Check, EyeOff, Send, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MarkdownBody } from "@/components/room/editor/markdown-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DIFFICULTY_LABEL, KIND_LABEL } from "./format";

function MarkBox({ interview, question, answer, onChanged }: { interview: InterviewerInterview; question: PaperQuestion; answer: GradedAnswer | undefined; onChanged: (next: InterviewerInterview) => void }) {
  const [value, setValue] = useState(answer?.awarded === null || answer?.awarded === undefined ? "" : String(answer.awarded));
  const [busy, setBusy] = useState(false);
  async function save() {
    const marks = Number(value);
    if (value.trim() === "" || !Number.isInteger(marks) || marks < 0) return;
    if (marks === answer?.awarded) return;
    setBusy(true);
    try {
      onChanged(await api<InterviewerInterview>(`/api/interviews/${interview.id}/answers/${question.id}/marks`, { method: "PUT", json: { marks } }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "The mark couldn't be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground">
      Marks
      <Input
        className="h-6 w-14 px-1.5"
        type="number"
        min={0}
        max={question.marks}
        disabled={busy}
        aria-label={`Marks for ${question.title}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => event.key === "Enter" && void save()}
      />
      of {question.marks}
    </label>
  );
}

function QuestionCard({ index, interview, question, answer, onAsk, onChanged }: { index: number; interview: InterviewerInterview; question: PaperQuestion; answer: GradedAnswer | undefined; onAsk?: (question: PaperQuestion) => void; onChanged: (next: InterviewerInterview) => void }) {
  const asked = interview.mode === "assessment" || question.askedAt !== null;
  const runs = interview.runs.filter((run) => run.questionId === question.id);
  const best = runs.length ? Math.max(...runs.map((run) => (run.total ? run.passed / run.total : 0))) : null;
  return (
    <section aria-label={`Question ${index + 1}: ${question.title}`} className={cn("grid gap-2 rounded-md border p-2.5", !asked && "border-dashed")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="min-w-0 font-medium">{index + 1}. {question.title}</h3>
        <Badge variant="outline">{KIND_LABEL[question.kind]}</Badge>
        {question.bankId && <span className="text-2xs text-muted-foreground">{DIFFICULTY_LABEL[question.difficulty]}</span>}
        {!asked && <span className="flex items-center gap-1 text-2xs text-muted-foreground"><EyeOff className="size-3" /> Not asked yet</span>}
        {!asked && onAsk && interview.status === "live" && (
          <Button size="xs" className="ml-auto" aria-label={`Ask ${question.title}`} onClick={() => onAsk(question)}><Send /> Ask now</Button>
        )}
      </div>
      {question.prompt && <MarkdownBody text={question.prompt} compact />}

      {question.kind === "mcq" && (
        <ul className="grid gap-1">
          {question.choices.map((choice) => {
            const picked = answer?.choiceIds.includes(choice.id);
            return (
              <li key={choice.id} className={cn("flex items-start gap-1.5 rounded-sm border p-1.5", picked && "bg-accent")}>
                {choice.correct ? <Check aria-label="Right answer" className="mt-0.5 size-3.5 shrink-0 text-brand" /> : <X aria-label="Wrong answer" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 break-words">{choice.text}</span>
                {picked && <span className="shrink-0 text-2xs font-medium">Chosen</span>}
              </li>
            );
          })}
        </ul>
      )}

      {question.kind === "coding" && (
        <p className="text-muted-foreground">
          Code in <code className="font-mono">{question.file}</code>.{" "}
          {question.tests.length === 0 ? "No tests, so you mark it." : best === null ? "Tests not run yet." : `Best run: ${Math.round(best * 100)}% of ${question.tests.length} tests.`}
        </p>
      )}

      {(question.kind === "short" || question.kind === "design") && (
        <div className="grid gap-1">
          <div className="text-2xs text-muted-foreground">Their answer</div>
          <p className="rounded-sm bg-background p-1.5 break-words whitespace-pre-wrap">{answer?.text.trim() || <span className="text-muted-foreground">{question.kind === "design" ? "Nothing written. Check the room's Diagrams and Board." : "Nothing yet."}</span>}</p>
          {question.kind === "design" && answer?.text.trim() && <p className="text-muted-foreground">Their drawing is in the room&apos;s Diagrams and Board.</p>}
          {question.modelAnswer && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">What a good answer says</summary>
              <p className="mt-1 break-words whitespace-pre-wrap">{question.modelAnswer}</p>
            </details>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {question.kind === "mcq" ? (
          <span className="text-muted-foreground">{answer ? `${answer.awarded ?? 0} of ${question.marks}` : `Not answered, ${question.marks} mark${question.marks === 1 ? "" : "s"}`}</span>
        ) : (
          <MarkBox key={`${question.id}-${answer?.awarded ?? ""}`} interview={interview} question={question} answer={answer} onChanged={onChanged} />
        )}
      </div>
    </section>
  );
}

export function PaperReview({ interview, onChanged, onAsk }: { interview: InterviewerInterview; onChanged: (next: InterviewerInterview) => void; onAsk?: (question: PaperQuestion) => void }) {
  const answers = new Map(interview.answers.map((answer) => [answer.questionId, answer]));
  if (interview.paper.length === 0) return <p className="text-muted-foreground">No questions on this paper.</p>;
  const { score } = interview;
  return (
    <div className="grid gap-2">
      <p role="status" className="font-medium">
        {score.marks} of {score.max} marks
        {score.unmarked > 0 && <span className="font-normal text-muted-foreground"> · {score.unmarked} waiting for you to mark</span>}
      </p>
      {interview.paper.map((question, index) => (
        <QuestionCard key={question.id} index={index} interview={interview} question={question} answer={answers.get(question.id)} onAsk={onAsk} onChanged={onChanged} />
      ))}
    </div>
  );
}
