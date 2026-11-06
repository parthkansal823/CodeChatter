/**
 * The Interview panel in a room. A candidate gets their questions. An interviewer runs it from
 * here, on video: asks questions as it goes, decides about the AI, sees answers come in, marks
 * them and fills in the scorecard there and then.
 */
"use client";

import type { CandidateRun, InterviewerInterview, InterviewerRun, PaperQuestion, RoomInterview, Scorecard, AskedQuestion } from "@codechatter/contracts";
import { createFileAtPath, findByPath } from "@codechatter/workspace-model";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, EyeOff, FlaskConical, Loader2, Play, Plus, Send, Sparkles, Square, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { AiReviewCard } from "@/components/interviews/ai-review-card";
import { MODE_LABEL, STATUS_LABEL } from "@/components/interviews/format";
import { IntegrityRecord } from "@/components/interviews/integrity-record";
import { PaperReview } from "@/components/interviews/paper-review";
import { RunList } from "@/components/interviews/run-list";
import { ScorecardForm } from "@/components/interviews/scorecard-form";
import { useCall } from "@/components/room/call/call-store";
import { MarkdownBody } from "@/components/room/editor/markdown-preview";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";

import type { RoomToolProps } from "../registry";

import { AskQuestionDialog, toldFiles } from "./ask-question";
import { CandidatePaper } from "./candidate-paper";
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

/** A live interview happens on video. This is the same call as the title bar's, where people will look for it. */
function VideoCall() {
  const { room } = useRoom();
  const status = useCall((state) => state.status);
  const callRoom = useCall((state) => state.roomId);
  const others = usePeers().filter((peer) => peer.inCall).length;
  if (status === "joined" && callRoom === room.id) {
    return <span role="status" className="flex items-center gap-1.5 text-muted-foreground"><Video className="size-3.5 text-brand" /> {others ? "You're on video together" : "You're on video, and waiting for the other person"}</span>;
  }
  return (
    <Button size="sm" variant="outline" disabled={status === "joining"} onClick={() => void useCall.getState().join(room.id)}>
      <Video /> {status === "joining" ? "Joining…" : others ? "Join the video call" : "Start the video call"}
    </Button>
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
      {interview.status === "scheduled" && interview.mode === "interview" && (
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
        <Link href={`/interviews/${interview.id}` as never} target="_blank"><ExternalLink /> Full page</Link>
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

/** What only a live interview's interviewer has: video, the AI switch, and asking questions. */
function LiveControls({ interview, onChanged, onAsk }: { interview: InterviewerInterview; onChanged: (next: RoomInterview) => void; onAsk: () => void }) {
  const [saving, setSaving] = useState(false);
  async function setAi(allowed: boolean) {
    setSaving(true);
    try {
      onChanged(await api<InterviewerInterview>(`/api/interviews/${interview.id}/ai`, { method: "POST", json: { allowed } }));
      toast.message(allowed ? `${interview.candidateName} can use the AI now.` : `The AI is off for ${interview.candidateName}.`);
    } catch (error) {
      failed(error, "That didn't work. Try again.");
    } finally {
      setSaving(false);
    }
  }
  const open = interview.status === "live" || interview.status === "scheduled";
  if (!open) return null;
  const used = interview.integrity.counts["ai-used"] ?? 0;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <VideoCall />
        <Button size="sm" variant={interview.status === "live" ? "brand" : "outline"} onClick={onAsk}>
          <Send /> {interview.status === "live" ? "Ask a question" : "Add a question"}
        </Button>
      </div>
      <label className="flex items-center gap-2">
        <Switch checked={interview.aiAllowed} disabled={saving} aria-label="Let the candidate use the AI" onCheckedChange={(on) => void setAi(on)} />
        <Sparkles className="size-3.5 text-muted-foreground" />
        Let the candidate use the AI
        {used > 0 && <span className="text-muted-foreground">(used {used} time{used === 1 ? "" : "s"})</span>}
      </label>
    </div>
  );
}

export default function InterviewTool(_props: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const queryClient = useQueryClient();
  const { data: interview, isPending, isError } = useRoomInterview();
  const [running, setRunning] = useState(false);
  const [asking, setAsking] = useState(false);
  const key = interviewKey(room.id);
  const setInterview = (next: RoomInterview) => queryClient.setQueryData(key, next);

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

  /** A question has been asked: it may bring files into the room, which this browser adds (the API doesn't touch live documents). */
  function asked({ interview: next, question }: AskedQuestion) {
    setInterview(next);
    setAsking(false);
    if (!question.askedAt) return;
    const added = question.starterFiles.filter((file) => !findByPath(doc, file.path));
    for (const file of added) createFileAtPath(doc, file.path, file.content, me.user.id);
    toldFiles(added.map((file) => file.path));
  }

  async function askNow(question: PaperQuestion) {
    if (!interview) return;
    try {
      asked(await api<AskedQuestion>(`/api/interviews/${interview.id}/questions/${question.id}/ask`, { method: "POST" }));
    } catch (error) {
      failed(error, "It couldn't be asked. Try again.");
    }
  }

  async function saveScorecard(next: Scorecard) {
    if (!interview) return;
    try {
      setInterview(await api<InterviewerInterview>(`/api/interviews/${interview.id}/scorecard`, { method: "PUT", json: next }));
      toast.success("Scorecard saved.");
    } catch (error) {
      failed(error, "The scorecard couldn't be saved. Try again.");
    }
  }

  if (isPending) return <div className="grid gap-2 p-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24" /></div>;
  if (isError || !interview) return <p className="p-3 text-muted-foreground">The interview couldn&apos;t load. Try reloading the page.</p>;

  const live = interview.status === "live";
  // An interview scheduled from one coding question has it here as it always did. Anything else is on the paper.
  const single = Boolean(interview.file);
  const hasPaper = interview.paper.length > 0;
  const interviewer = interview.role === "interviewer";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="grid gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate font-medium">{interview.title}</h2>
          <Badge variant={live ? "default" : "outline"} className="ml-auto">{STATUS_LABEL[interview.status]}</Badge>
        </div>
        {interview.mode === "assessment" && <p className="text-2xs text-muted-foreground">{MODE_LABEL.assessment}</p>}
        {interviewer && <Controls interview={interview} onChanged={setInterview} />}
        {interviewer && interview.mode === "interview" && <LiveControls interview={interview} onChanged={setInterview} onAsk={() => setAsking(true)} />}
        {!interviewer && interview.mode === "interview" && live && (
          <div className="grid gap-1.5">
            <VideoCall />
            <p className="text-muted-foreground">
              {interview.aiAllowed ? <span className="font-medium text-foreground">Your interviewer has allowed the AI. They can see when you use it.</span> : "AI help is off unless your interviewer turns it on."}
            </p>
          </div>
        )}
      </div>

      {single && (
        <>
          {interview.prompt ? (
            <section className="border-b" aria-label="The question" data-question={interview.lockClipboard ? "" : undefined}>
              <MarkdownBody text={interview.prompt} compact />
            </section>
          ) : (
            <p className="border-b p-3 text-muted-foreground">
              {!interviewer ? "The question appears here when the interview starts." : "This question has no description."}
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
              {!interviewer && " Your interviewer sees every run."}
            </p>
            {interview.visibleTests.map((test, index) => <TestCase key={test.id} label={`Test ${index + 1}`} input={test.input} expected={test.expected} />)}
            {interviewer && interview.hiddenTests.map((test, index) => <TestCase key={test.id} label={`Hidden test ${index + 1}. The candidate only sees whether it passed.`} input={test.input} expected={test.expected} hidden />)}
          </section>

          {interview.runs.some((run) => run.questionId === null) && (
            <section className="grid gap-2 border-t p-3" aria-label="Test runs">
              <h3 className="font-medium">Runs</h3>
              <RunList runs={interview.runs.filter((run) => run.questionId === null)} />
            </section>
          )}
        </>
      )}

      {!interviewer && (hasPaper || !single) && <CandidatePaper interview={interview} stateVector={() => stateVectorOf(doc)} />}

      {interviewer && (hasPaper || !single) && (
        <section className="border-t p-3" aria-label="The questions">
          {hasPaper ? (
            <PaperReview interview={interview} onChanged={setInterview} onAsk={(question) => void askNow(question)} />
          ) : (
            <p className="text-muted-foreground">No questions yet. {live ? "Ask one above: from the bank, at random, or your own." : "You can add some now, or choose as you go."}</p>
          )}
        </section>
      )}

      {interviewer && (
        <>
          <section className="grid gap-2 border-t p-3" aria-label="Your evaluation">
            <h3 className="font-medium">Your evaluation</h3>
            <ScorecardForm key={interview.id} rubric={interview.rubric} scorecard={interview.scorecard} onSave={saveScorecard} />
          </section>
          {interview.status !== "scheduled" && (
            <>
              <section className="grid gap-2 border-t p-3" aria-label="Ask the AI">
                <h3 className="font-medium">Ask the AI what to check</h3>
                <AiReviewCard interview={interview} onChanged={setInterview} />
              </section>
              <section className="grid gap-2 border-t p-3" aria-label="The record">
                <h3 className="font-medium">The record</h3>
                <IntegrityRecord integrity={interview.integrity} />
              </section>
            </>
          )}
        </>
      )}

      {asking && interviewer && <AskQuestionDialog interviewId={interview.id} used={new Set(interview.paper.flatMap((question) => (question.bankId ? [question.bankId] : [])))} onAsked={asked} onClose={() => setAsking(false)} />}
    </div>
  );
}
