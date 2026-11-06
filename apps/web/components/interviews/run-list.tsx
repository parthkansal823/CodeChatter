/** Test runs, newest first. Interviewers' runs carry hidden cases; a candidate's only count them. */
"use client";

import type { CandidateRun, InterviewerRun, VisibleCaseResult } from "@codechatter/contracts";
import { CheckCircle2, ChevronRight, EyeOff, XCircle } from "lucide-react";

import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const VERDICT_LABEL: Record<string, string> = { passed: "Passed", failed: "Wrong answer", error: "Crashed", timeout: "Too slow", ran: "Ran" };

function Block({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <div className="text-2xs text-muted-foreground">{label}</div>
      <pre className="mt-0.5 max-h-32 overflow-auto rounded-sm border bg-background p-1.5 font-mono text-xs whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function CaseRow({ result, label }: { result: VisibleCaseResult; label: string }) {
  const passed = result.verdict === "passed";
  return (
    <details className="group rounded-sm border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        {passed ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-destructive" />}
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{VERDICT_LABEL[result.verdict] ?? result.verdict} · {result.timeMs} ms</span>
      </summary>
      <div className="grid gap-1.5 border-t p-2">
        <Block label="Input" text={result.input} />
        <Block label="Expected" text={result.expected} />
        <Block label="Output" text={result.stdout} />
        <Block label="Errors" text={result.stderr} />
      </div>
    </details>
  );
}

function RunCard({ run, open }: { run: CandidateRun | InterviewerRun; open: boolean }) {
  const allPassed = run.compileError === null && run.passed === run.total;
  const hiddenCases = "hiddenCases" in run ? run.hiddenCases : null;
  return (
    <details open={open} className="group/run rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open/run:rotate-90" />
        <span className={cn("font-medium", allPassed ? "text-success" : "text-destructive")}>
          {run.compileError !== null ? "Didn't compile" : `${run.passed} of ${run.total} passed`}
        </span>
        {"by" in run && run.by && <span className="min-w-0 truncate text-muted-foreground">by {run.by}</span>}
        <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{formatRelativeTime(run.at)}</span>
      </summary>
      <div className="grid gap-1 border-t p-2">
        {run.compileError !== null && <Block label="Compiler output" text={run.compileError} />}
        {run.visible.map((result, index) => <CaseRow key={result.id} result={result} label={`Test ${index + 1}`} />)}
        {hiddenCases?.map((result, index) => <CaseRow key={result.id} result={result} label={`Hidden test ${index + 1}`} />)}
        {!hiddenCases && run.hidden.total > 0 && (
          <p className="flex items-center gap-1.5 px-1 py-0.5 text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" /> Hidden tests: {run.hidden.passed} of {run.hidden.total} passed
          </p>
        )}
      </div>
    </details>
  );
}

export function RunList({ runs }: { runs: ReadonlyArray<CandidateRun | InterviewerRun> }) {
  return (
    <div className="grid gap-1.5">
      {runs.map((run, index) => <RunCard key={run.id} run={run} open={index === 0} />)}
    </div>
  );
}
