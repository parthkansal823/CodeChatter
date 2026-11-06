/** A candidate's questions in the Interview panel: choices and written answers that save as they go, and coding questions with their tests. */
"use client";

import type { CandidateAnswer, CandidateInterview, CandidatePaperQuestion, QuestionKind } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Check, FlaskConical, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { KIND_LABEL } from "@/components/interviews/format";
import { RunList } from "@/components/interviews/run-list";
import { MarkdownBody } from "@/components/room/editor/markdown-preview";
import { useRoom } from "@/components/room/room-context";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";

import { interviewKey } from "./use-interview";

const failed = (error: unknown, fallback: string) => toast.error(error instanceof ApiError ? error.detail : fallback);

const WRITTEN_HINT: Partial<Record<QuestionKind, string>> = {
  design: "Draw it in this room's Diagrams or Board, and explain it here. Whoever marks this sees both.",
};

function Choices({ question, answer, disabled, onSave }: { question: CandidatePaperQuestion; answer: CandidateAnswer | undefined; disabled: boolean; onSave: (body: { choiceIds: string[] }) => void }) {
  const chosen = answer?.choiceIds ?? [];
  if (question.multiple) {
    return (
      <div className="grid gap-1.5" role="group" aria-label={`Choices for ${question.title}`}>
        <p className="text-muted-foreground">Choose all that apply.</p>
        {question.choices.map((choice) => (
          <label key={choice.id} className="flex items-start gap-2 rounded-sm border p-2 hover:bg-accent">
            <Checkbox
              className="mt-0.5"
              disabled={disabled}
              checked={chosen.includes(choice.id)}
              onCheckedChange={(on) => onSave({ choiceIds: on === true ? [...chosen, choice.id] : chosen.filter((id) => id !== choice.id) })}
            />
            <span className="min-w-0 break-words">{choice.text}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <RadioGroup aria-label={`Choices for ${question.title}`} className="gap-1.5" disabled={disabled} value={chosen[0] ?? ""} onValueChange={(id) => onSave({ choiceIds: [id] })}>
      {question.choices.map((choice) => (
        <label key={choice.id} className="flex items-start gap-2 rounded-sm border p-2 hover:bg-accent">
          <RadioGroupItem className="mt-0.5" value={choice.id} />
          <span className="min-w-0 break-words">{choice.text}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** Saves a moment after they stop typing, and when they leave the box. */
function Written({ question, answer, disabled, onSave }: { question: CandidatePaperQuestion; answer: CandidateAnswer | undefined; disabled: boolean; onSave: (body: { text: string }) => Promise<void> }) {
  const [text, setText] = useState(answer?.text ?? "");
  const [state, setState] = useState<"saved" | "typing" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState("saving");
    void onSave({ text: value }).finally(() => setState("saved"));
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <div className="grid gap-1">
      {WRITTEN_HINT[question.kind] && <p className="text-muted-foreground">{WRITTEN_HINT[question.kind]}</p>}
      <Textarea
        aria-label={`Your answer to ${question.title}`}
        rows={question.kind === "design" ? 8 : 4}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          setState("typing");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => save(value), 900);
        }}
        onBlur={() => {
          if (timer.current) save(text);
        }}
      />
      <span role="status" className="flex items-center gap-1 text-2xs text-muted-foreground">
        {state === "saved" ? answer ? <><Check className="size-3" /> Saved</> : "Saves as you type" : state === "saving" ? "Saving…" : "Typing…"}
      </span>
    </div>
  );
}

function Coding({ question, interview, live, running, onRun }: { question: CandidatePaperQuestion; interview: CandidateInterview; live: boolean; running: boolean; onRun: () => void }) {
  const runs = interview.runs.filter((run) => run.questionId === question.id);
  const tests = question.visibleTests.length + question.hiddenTestCount;
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground">
        Write it in <code className="font-mono">{question.file}</code>.
        {tests > 0 && ` ${question.visibleTests.length} visible test${question.visibleTests.length === 1 ? "" : "s"}${question.hiddenTestCount > 0 ? `, ${question.hiddenTestCount} hidden` : ""}.`}
      </p>
      {question.visibleTests.map((test, index) => (
        <div key={test.id} className="grid grid-cols-2 gap-1 rounded-sm border p-1.5">
          <div className="min-w-0"><div className="text-2xs text-muted-foreground">Test {index + 1}: input</div><pre className="max-h-24 overflow-auto rounded-sm bg-background p-1 font-mono text-xs whitespace-pre-wrap">{test.input || "(none)"}</pre></div>
          <div className="min-w-0"><div className="text-2xs text-muted-foreground">Expected</div><pre className="max-h-24 overflow-auto rounded-sm bg-background p-1 font-mono text-xs whitespace-pre-wrap">{test.expected || "(none)"}</pre></div>
        </div>
      ))}
      {tests > 0 && (
        <Button size="sm" variant="outline" className="justify-self-start" disabled={!live || running} onClick={onRun}>
          {running ? <Loader2 className="animate-spin" /> : <FlaskConical />} {running ? "Running…" : "Run tests"}
        </Button>
      )}
      {runs.length > 0 && <RunList runs={runs} />}
    </div>
  );
}

export function CandidatePaper({ interview, stateVector }: { interview: CandidateInterview; stateVector: () => string }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const key = interviewKey(room.id);
  const live = interview.status === "live";
  const [running, setRunning] = useState<string | null>(null);
  const [handingIn, setHandingIn] = useState(false);
  const answers = new Map(interview.answers.map((answer) => [answer.questionId, answer]));
  const assessment = interview.mode === "assessment";

  async function save(question: CandidatePaperQuestion, body: { choiceIds?: string[]; text?: string }): Promise<void> {
    try {
      const saved = await api<CandidateAnswer>(`/api/rooms/${room.id}/interview/answers/${question.id}`, { method: "PUT", json: body });
      queryClient.setQueryData<CandidateInterview>(key, (current) => current && { ...current, answers: [...current.answers.filter((answer) => answer.questionId !== question.id), saved] });
    } catch (error) {
      failed(error, "Your answer couldn't be saved. Try again.");
    }
  }

  async function run(question: CandidatePaperQuestion) {
    setRunning(question.id);
    try {
      await api(`/api/rooms/${room.id}/interview/run-tests`, { method: "POST", json: { stateVector: stateVector(), questionId: question.id } });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      failed(error, "The tests couldn't run. Try again.");
    } finally {
      setRunning(null);
    }
  }

  async function handIn() {
    setHandingIn(false);
    try {
      await api(`/api/rooms/${room.id}/interview/submit`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      failed(error, "It couldn't be handed in. Try again.");
    }
  }

  const answeredCount = interview.paper.filter((question) => {
    const answer = answers.get(question.id);
    return answer && (answer.choiceIds.length > 0 || answer.text.trim());
  }).length;
  const written = interview.paper.filter((question) => question.kind !== "coding").length;

  return (
    <div className="grid gap-3 p-3" data-question={interview.lockClipboard ? "" : undefined}>
      {interview.paper.length === 0 && live && <p className="text-muted-foreground">{interview.interviewerName ?? "Your interviewer"} will ask you questions here.</p>}
      {interview.paper.map((question, index) => (
        <section key={question.id} aria-label={`Question ${index + 1}`} className="grid gap-2 rounded-md border p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 font-medium">{index + 1}. {question.title}</h3>
            <Badge variant="outline" className="ml-auto">{KIND_LABEL[question.kind]}</Badge>
            <span className="text-2xs text-muted-foreground">{question.marks} mark{question.marks === 1 ? "" : "s"}</span>
          </div>
          {question.prompt && <MarkdownBody text={question.prompt} compact />}
          {question.kind === "mcq" && <Choices question={question} answer={answers.get(question.id)} disabled={!live} onSave={(body) => void save(question, body)} />}
          {(question.kind === "short" || question.kind === "design") && <Written question={question} answer={answers.get(question.id)} disabled={!live} onSave={(body) => save(question, body)} />}
          {question.kind === "coding" && <Coding question={question} interview={interview} live={live} running={running === question.id} onRun={() => void run(question)} />}
        </section>
      ))}
      {assessment && live && (
        <div className="flex items-center gap-2 border-t pt-3">
          {written > 0 && <span className="text-muted-foreground">{answeredCount} of {written} answered</span>}
          <Button size="sm" variant="brand" className="ml-auto" onClick={() => setHandingIn(true)}>Hand in</Button>
        </div>
      )}
      {assessment && interview.status === "finished" && <p role="status" className="text-muted-foreground">Handed in. You can close this page.</p>}
      <AlertDialog open={handingIn} onOpenChange={setHandingIn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hand it in?</AlertDialogTitle>
            <AlertDialogDescription>You can&apos;t change anything after this, even with time left.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handIn()}>Hand in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
