/** One sitting, for its interviewers: controls, the paper with its marks, the private scorecard, the integrity record, every test run, the replay and the report. */
"use client";

import type { InterviewerInterview, Scorecard } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCopy, Download, ExternalLink, Link2, Play, Plus, Square, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

import { AiReviewCard } from "./ai-review-card";
import { formatCountdown, MODE_LABEL, STATUS_LABEL } from "./format";
import { IntegrityBadge, IntegrityRecord } from "./integrity-record";
import { CandidateLinkDialog } from "./interviews-page";
import { PaperReview } from "./paper-review";
import { RecordingsView } from "./recordings-view";
import { interviewReport } from "./report";
import { ReplayView } from "./replay-view";
import { RunList } from "./run-list";
import { ScorecardForm } from "./scorecard-form";

type Confirm = { title: string; body: string; yes: string; run: () => Promise<void> };

function Countdown({ interview, fetchedAt }: { interview: InterviewerInterview; fetchedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (interview.status !== "live" || !interview.endsAt) return null;
  const skew = new Date(interview.now).getTime() - fetchedAt;
  const left = new Date(interview.endsAt).getTime() - (now + skew);
  return <span role="timer" className="font-mono tabular-nums">{left <= 0 ? "Time's up" : `${formatCountdown(left)} left`}</span>;
}

export function InterviewDetail({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = ["interview", id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<InterviewerInterview>(`/api/interviews/${id}`, { signal }),
    refetchInterval: (state) => (state.state.data?.status === "live" || state.state.data?.status === "scheduled" ? 5000 : false),
  });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.isPending) return <div className="grid gap-3 p-8"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-48" /></div>;
  if (query.isError || !query.data) {
    const denied = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);
    return <p className="p-8 text-muted-foreground">{denied ? "This interview doesn't exist, or you don't have access to it." : "This interview couldn't load. Try again in a moment."}</p>;
  }
  const interview = query.data;

  async function act(path: string, json?: unknown) {
    setBusy(true);
    try {
      const next = await api<InterviewerInterview>(`/api/interviews/${id}/${path}`, { method: "POST", ...(json !== undefined && { json }) });
      queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ["interviews"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    try {
      const { candidateToken } = await api<{ candidateToken: string }>(`/api/interviews/${id}/rotate-link`, { method: "POST" });
      setToken(candidateToken);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "A new link couldn't be made. Try again.");
    }
  }

  async function saveScorecard(next: Scorecard) {
    try {
      queryClient.setQueryData(key, await api<InterviewerInterview>(`/api/interviews/${id}/scorecard`, { method: "PUT", json: next }));
      toast.success("Scorecard saved.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "The scorecard couldn't be saved. Try again.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([interviewReport(interview)], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview-${interview.candidateName.replace(/[^\w-]+/g, "-").toLowerCase()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const live = interview.status === "live";
  const scheduled = interview.status === "scheduled";
  return (
    <>
      <PageHeader
        title={interview.candidateName}
        description={interview.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" asChild><Link href={(interview.batchId ? `/interviews/batches/${interview.batchId}` : "/interviews") as never}><ArrowLeft /> {interview.batchId ? "All candidates" : "All interviews"}</Link></Button>
            <Button size="sm" variant="outline" asChild><Link href={`/rooms/${interview.roomId}` as never}><ExternalLink /> Open the room</Link></Button>
            {scheduled && interview.mode === "interview" && <Button size="sm" variant="brand" disabled={busy} onClick={() => void act("start")}><Play /> Start</Button>}
            {live && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("extend", { minutes: 10 })}><Plus /> 10 minutes</Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm({ title: "Finish the interview?", body: `${interview.candidateName} can't edit or run anything after this. It can't be undone.`, yes: "Finish", run: () => act("finish") })}
                >
                  <Square /> Finish
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2 sm:px-8">
        <Badge variant={live ? "default" : "outline"}>{STATUS_LABEL[interview.status]}</Badge>
        {interview.mode === "assessment" && <span className="text-muted-foreground">{MODE_LABEL.assessment}</span>}
        {interview.paper.length > 0 && <span className="tabular-nums">{interview.score.marks} of {interview.score.max} marks</span>}
        {interview.status !== "scheduled" && <IntegrityBadge level={interview.integrity.level} />}
        <Countdown interview={interview} fetchedAt={query.dataUpdatedAt} />
        {scheduled && <span className="text-muted-foreground">{interview.candidateJoined ? `${interview.candidateName} is in the waiting room.` : "The candidate hasn't used their link yet."}</span>}
        {interview.candidateEmail && <span className="text-muted-foreground">{interview.candidateEmail}</span>}
        <div className="ml-auto flex flex-wrap gap-1">
          {scheduled && !interview.candidateJoined && <Button size="sm" variant="ghost" onClick={() => void rotate()}><Link2 /> New link</Button>}
          {scheduled && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ title: "Cancel the interview?", body: "The candidate's link stops working.", yes: "Cancel the interview", run: () => act("cancel") })}>
              <X /> Cancel
            </Button>
          )}
          {!live && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirm({
                title: "Delete this interview?",
                body: "Its room, files, runs, scorecard and replay are deleted for good.",
                yes: "Delete",
                run: async () => {
                  try {
                    await api(`/api/interviews/${id}`, { method: "DELETE" });
                    await queryClient.invalidateQueries({ queryKey: ["interviews"] });
                    router.push("/interviews" as never);
                  } catch (error) {
                    toast.error(error instanceof ApiError ? error.detail : "It couldn't be deleted. Try again.");
                  }
                },
              })}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue={interview.paper.length ? "answers" : "scorecard"} className="px-6 py-4 sm:px-8">
        {/* Several tabs: on a phone they scroll sideways rather than push the page wider. */}
        <TabsList className="max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
          {interview.paper.length > 0 && <TabsTrigger value="answers">Answers</TabsTrigger>}
          <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
          <TabsTrigger value="record">The record</TabsTrigger>
          {(interview.recordWebcam || interview.recordScreen) && <TabsTrigger value="recordings">Recordings</TabsTrigger>}
          <TabsTrigger value="ai">AI review</TabsTrigger>
          <TabsTrigger value="runs">Test runs ({interview.runs.length})</TabsTrigger>
          <TabsTrigger value="replay">Replay</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>
        {interview.paper.length > 0 && (
          <TabsContent value="answers" className="max-w-3xl pt-2">
            <PaperReview interview={interview} onChanged={(next) => queryClient.setQueryData(key, next)} />
          </TabsContent>
        )}
        {(interview.recordWebcam || interview.recordScreen) && (
          <TabsContent value="recordings" className="pt-2">
            <RecordingsView interview={interview} />
          </TabsContent>
        )}
        <TabsContent value="ai" className="max-w-3xl pt-2">
          <AiReviewCard interview={interview} onChanged={(next) => queryClient.setQueryData(key, next)} />
        </TabsContent>
        <TabsContent value="record" className="max-w-3xl pt-2">
          <IntegrityRecord integrity={interview.integrity} />
        </TabsContent>
        <TabsContent value="scorecard" className="pt-2">
          <ScorecardForm key={interview.id} rubric={interview.rubric} scorecard={interview.scorecard} onSave={saveScorecard} />
        </TabsContent>
        <TabsContent value="runs" className="max-w-3xl pt-2">
          {interview.runs.length === 0 ? <p className="text-muted-foreground">Nobody has run the tests yet.</p> : <RunList runs={interview.runs} />}
        </TabsContent>
        <TabsContent value="replay" className="pt-2">
          <ReplayView interviewId={interview.id} file={interview.file} />
        </TabsContent>
        <TabsContent value="report" className="grid max-w-3xl gap-2 pt-2">
          <p className="text-muted-foreground">It includes hidden test results and the scorecard, so it&apos;s for your team, not the candidate.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(interviewReport(interview)).then((ok) => (ok ? toast.success("Report copied.") : toast.error("Couldn't copy it. Try downloading it.")))}
            >
              <ClipboardCopy /> Copy as Markdown
            </Button>
            <Button size="sm" variant="outline" onClick={download}><Download /> Download</Button>
          </div>
          <pre tabIndex={0} aria-label="The report" className="max-h-[32rem] overflow-auto rounded-md border bg-panel p-3 font-mono text-xs whitespace-pre-wrap">{interviewReport(interview)}</pre>
        </TabsContent>
      </Tabs>

      {token && <CandidateLinkDialog token={token} onClose={() => setToken(null)} />}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm?.run()}>{confirm?.yes}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
