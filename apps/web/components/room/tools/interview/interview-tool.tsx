/** The Interview panel in a room: the question, its tests and the results. Interviewers also get the controls and hidden tests. */
"use client";

import type { CandidateRun, InterviewerInterview, InterviewerRun, RoomInterview } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, EyeOff, FlaskConical, Loader2, Play, Plus, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { STATUS_LABEL } from "@/components/interviews/format";
import { RunList } from "@/components/interviews/run-list";
import { MarkdownBody } from "@/components/room/editor/markdown-preview";
import { useRoom } from "@/components/room/room-context";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";

import type { RoomToolProps } from "../registry";

import { interviewKey, useRoomInterview } from "./use-interview";

function stateVectorOf(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const failed = (error: unknown, fallback: string) => toast.error(error instanceof ApiError ? error.detail : fallback);

function TestCase({ label, input, expected, hidden }: { label: string; input: string; expected: string; hidden?: boolean }) {
  return (
    <div className="rounded-sm border p-1.5">
      <div className="flex items-center gap-1 text-2xs text-muted-foreground">
        {hidden && <EyeOff className="size-3" />} {label}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <div className="min-w-0">
          <div className="text-2xs text-muted-foreground">Input</div>
          <pre className="max-h-24 overflow-auto rounded-sm bg-background p-1 font-mono text-xs whitespace-pre-wrap">{input || "(none)"}</pre>
        </div>
        <div className="min-w-0">
          <div className="text-2xs text-muted-foreground">Expected</div>
          <pre className="max-h-24 overflow-auto rounded-sm bg-background p-1 font-mono text-xs whitespace-pre-wrap">{expected || "(none)"}</pre>
        </div>
      </div>
    </div>
  );
}

function Controls({ interview, onChanged }: { interview: InterviewerInterview; onChanged: (next: RoomInterview) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function act(action: "start" | "finish", extend?: number) {
    setBusy(true);
    try {
      const next = extend
        ? await api<InterviewerInterview>(`/api/interviews/${interview.id}/extend`, { method: "POST", json: { minutes: extend } })
        : await api<InterviewerInterview>(`/api/interviews/${interview.id}/${action}`, { method: "POST" });
      onChanged(next);
    } catch (error) {
      failed(error, "That didn't work. Try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {interview.status === "scheduled" && (
        <Button size="sm" variant="brand" disabled={busy} onClick={() => void act("start")}>
          <Play /> Start the interview
        </Button>
      )}
      {interview.status === "live" && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("start", 10)}><Plus /> 10 minutes</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}><Square /> Finish</Button>
        </>
      )}
      <Button size="sm" variant="ghost" asChild>
        <Link href={`/interviews/${interview.id}` as never} target="_blank"><ExternalLink /> Scorecard</Link>
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish the interview?</AlertDialogTitle>
            <AlertDialogDescription>{interview.candidateName} can&apos;t edit or run anything after this. It can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act("finish")}>Finish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function InterviewTool(_props: RoomToolProps) {
  const { room, doc, can } = useRoom();
  const queryClient = useQueryClient();
  const { data: interview, isPending, isError } = useRoomInterview();
  const [running, setRunning] = useState(false);
  const key = interviewKey(room.id);

  async function runTests() {
    setRunning(true);
    try {
      await api<{ run: CandidateRun | InterviewerRun }>(`/api/rooms/${room.id}/interview/run-tests`, { method: "POST", json: { stateVector: stateVectorOf(doc) } });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      failed(error, "The tests couldn't run. Try again.");
    } finally {
      setRunning(false);
    }
  }

  if (isPending) return <div className="grid gap-2 p-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24" /></div>;
  if (isError || !interview) return <p className="p-3 text-muted-foreground">The interview couldn&apos;t load. Try reloading the page.</p>;

  const live = interview.status === "live";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="grid gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate font-medium">{interview.title}</h2>
          <Badge variant={live ? "default" : "outline"} className="ml-auto">{STATUS_LABEL[interview.status]}</Badge>
        </div>
        {interview.role === "interviewer" && <Controls interview={interview} onChanged={(next) => queryClient.setQueryData(key, next)} />}
      </div>

      {interview.prompt ? (
        <section className="border-b" aria-label="The question">
          <MarkdownBody text={interview.prompt} compact />
        </section>
      ) : (
        <p className="border-b p-3 text-muted-foreground">
          {interview.role === "candidate" ? "The question appears here when the interview starts." : "This question has no description."}
        </p>
      )}

      <section className="grid gap-2 p-3" aria-label="Tests">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Tests</h3>
          <span className="text-muted-foreground">
            {interview.visibleTests.length} visible{interview.hiddenTestCount > 0 && `, ${interview.hiddenTestCount} hidden`}
          </span>
          {can("code.run") && (
            <Button size="sm" variant="outline" className="ml-auto" disabled={!live || running} onClick={() => void runTests()}>
              {running ? <Loader2 className="animate-spin" /> : <FlaskConical />} {running ? "Running…" : "Run tests"}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground">
          Runs <code className="font-mono">{interview.file}</code>, reading each test&apos;s input and printing its output.
          {interview.role === "candidate" && " Your interviewer sees every run."}
        </p>
        {interview.visibleTests.map((test, index) => <TestCase key={test.id} label={`Test ${index + 1}`} input={test.input} expected={test.expected} />)}
        {interview.role === "interviewer" && interview.hiddenTests.map((test, index) => <TestCase key={test.id} label={`Hidden test ${index + 1}. The candidate only sees whether it passed.`} input={test.input} expected={test.expected} hidden />)}
      </section>

      {interview.runs.length > 0 && (
        <section className="grid gap-2 border-t p-3" aria-label="Test runs">
          <h3 className="font-medium">Runs</h3>
          <RunList runs={interview.runs} />
        </section>
      )}
    </div>
  );
}
