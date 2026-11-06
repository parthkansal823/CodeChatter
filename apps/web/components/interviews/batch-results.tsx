/** The results of an assessment or a round of interviews: one line a candidate, a CSV, and comparing their code. */
"use client";

import { INTEGRITY_LABEL, type BatchResultRow, type BatchResults, type IntegrityKind } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, ArrowLeft, Download, ExternalLink, Loader2, ScanSearch, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api } from "@/lib/api";

import { csvRow, downloadText, MODE_LABEL, RECOMMENDATION_LABEL, STATUS_LABEL } from "./format";
import { IntegrityBadge, LEVEL_LABEL } from "./integrity-record";
import { filesAt, parseReplayFrames } from "./replay";
import { similarPairs, type CodeEntry, type SimilarPair } from "./similarity";

type Sort = "name" | "score";
const percent = (row: BatchResultRow) => (row.score.max ? Math.round((row.score.marks / row.score.max) * 100) : 0);

/** A candidate's code: what they ended with and what they started with, from the edit log. */
async function codeOf(row: BatchResultRow): Promise<CodeEntry | null> {
  const response = await fetch(`/api/interviews/${row.interviewId}/replay/updates`, { credentials: "same-origin" });
  if (!response.ok) return null;
  const frames = parseReplayFrames(new Uint8Array(await response.arrayBuffer()));
  if (!frames.length) return null;
  const join = (at: number) => filesAt(frames, at).map((file) => (file.text ?? "")).join("\n");
  return { id: row.interviewId, name: row.candidateName, code: join(Number.POSITIVE_INFINITY), starter: join(frames[0]!.at) };
}

function Flags({ row }: { row: BatchResultRow }) {
  const counts = Object.entries(row.integrity.counts) as Array<[IntegrityKind, number]>;
  const badge = <IntegrityBadge level={row.integrity.level} />;
  if (counts.length === 0 && row.integrity.bigEdits === 0) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0}>{badge}</span></TooltipTrigger>
      <TooltipContent>
        <ul>
          {counts.map(([kind, count]) => <li key={kind}>{INTEGRITY_LABEL[kind] ?? kind}: {count}</li>)}
          {row.integrity.bigEdits > 0 && <li>Big edits at once: {row.integrity.bigEdits}</li>}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function BatchResultsPage({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const results = useQuery({
    queryKey: ["interview-batch", id],
    queryFn: ({ signal }) => api<BatchResults>(`/api/interview-batches/${id}`, { signal }),
    refetchInterval: 15_000,
  });
  const [sort, setSort] = useState<Sort>("score");
  const [deleting, setDeleting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [pairs, setPairs] = useState<{ found: SimilarPair[]; compared: number } | null>(null);

  if (results.isPending) return <div className="grid gap-3 p-8"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-48" /></div>;
  if (results.isError || !results.data) {
    const denied = results.error instanceof ApiError && (results.error.status === 403 || results.error.status === 404);
    return <p className="p-8 text-muted-foreground">{denied ? "This doesn't exist, or you don't have access to it." : "The results couldn't load. Try again in a moment."}</p>;
  }
  const batch = results.data;
  const rows = [...batch.rows].sort((a, b) => (sort === "score" ? percent(b) - percent(a) || a.candidateName.localeCompare(b.candidateName) : a.candidateName.localeCompare(b.candidateName)));

  function exportCsv() {
    const lines = [
      csvRow(["Candidate", "Email", "Status", "Marks", "Out of", "Percent", "Waiting to be marked", "Multiple choice", "Coding", "Short answer", "System design", "Answered", "Questions", "Integrity", "Recommendation", "Started", "Finished"]),
      ...rows.map((row) =>
        csvRow([
          row.candidateName,
          row.candidateEmail ?? "",
          STATUS_LABEL[row.status],
          row.score.marks,
          row.score.max,
          percent(row),
          row.score.unmarked,
          `${row.score.byKind.mcq.marks}/${row.score.byKind.mcq.max}`,
          `${row.score.byKind.coding.marks}/${row.score.byKind.coding.max}`,
          `${row.score.byKind.short.marks}/${row.score.byKind.short.max}`,
          `${row.score.byKind.design.marks}/${row.score.byKind.design.max}`,
          row.answered,
          row.questions,
          LEVEL_LABEL[row.integrity.level],
          row.recommendation ?? "",
          row.startedAt ?? "",
          row.finishedAt ?? "",
        ]),
      ),
    ];
    downloadText(`${batch.title.replace(/[^\w-]+/g, "-").toLowerCase()}-results.csv`, lines.join("\r\n"), "text/csv");
  }

  async function compare() {
    setComparing(true);
    try {
      const started = rows.filter((row) => row.startedAt);
      const entries = (await Promise.all(started.map(codeOf))).filter((entry): entry is CodeEntry => entry !== null);
      setPairs({ found: similarPairs(entries), compared: entries.length });
    } catch {
      toast.error("The code couldn't be compared. Try again.");
    } finally {
      setComparing(false);
    }
  }

  async function remove() {
    try {
      await api(`/api/interview-batches/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["interview-batches"] });
      await queryClient.invalidateQueries({ queryKey: ["interviews"] });
      router.push("/interviews" as never);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "It couldn't be deleted. Try again.");
    }
  }

  const dates = [batch.opensAt && `Opens ${new Date(batch.opensAt).toLocaleString()}`, batch.closesAt && `closes ${new Date(batch.closesAt).toLocaleString()}`].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader
        title={batch.title}
        description={`${MODE_LABEL[batch.mode]} · ${batch.durationMinutes} minutes · ${batch.started} of ${batch.candidates} started · ${batch.finished} finished${dates ? ` · ${dates}` : ""}${batch.recordWebcam || batch.recordScreen ? ` · Records ${[batch.recordWebcam && "camera", batch.recordScreen && "screen"].filter(Boolean).join(" and ")}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" asChild><Link href={`/interviews${batch.mode === "assessment" ? "?tab=assessments" : ""}` as never}><ArrowLeft /> Back</Link></Button>
            <Button size="sm" variant="outline" disabled={comparing || batch.started < 2} onClick={() => void compare()}>{comparing ? <Loader2 className="animate-spin" /> : <ScanSearch />} Compare their code</Button>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button>
          </div>
        }
      />
      <div className="grid gap-4 px-6 py-4 sm:px-8">
        {pairs && (
          <section aria-label="Code that looks alike" className="grid gap-1 rounded-md border p-3">
            <h2 className="font-medium">Code that looks alike</h2>
            {pairs.found.length === 0 ? (
              <p role="status" className="text-muted-foreground">Compared {pairs.compared} candidates. No two look alike.</p>
            ) : (
              <ul className="grid gap-0.5">
                {pairs.found.map((pair) => (
                  <li key={`${pair.a}-${pair.b}`}>
                    <span className="font-medium">{pair.names[0]}</span> and <span className="font-medium">{pair.names[1]}</span>: {Math.round(pair.overlap * 100)}% of the smaller one&apos;s own code matches
                  </li>
                ))}
              </ul>
            )}
            <p className="text-2xs text-muted-foreground">Renaming things doesn&apos;t hide a match, and starter code doesn&apos;t count. It&apos;s a pointer for you to look at, not proof: short answers to the same small problem do look alike.</p>
          </section>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button size="xs" variant="ghost" className="-ml-2" aria-label="Sort by name" onClick={() => setSort("name")}>Candidate {sort === "name" && <ArrowDownUp />}</Button>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <Button size="xs" variant="ghost" className="-ml-2" aria-label="Sort by score" onClick={() => setSort("score")}>Score {sort === "score" && <ArrowDownUp />}</Button>
              </TableHead>
              <TableHead className="hidden md:table-cell">Answered</TableHead>
              <TableHead>Record</TableHead>
              <TableHead className="hidden sm:table-cell">Verdict</TableHead>
              <TableHead><span className="sr-only">Room</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.interviewId}>
                <TableCell className="max-w-56 truncate font-medium">
                  <Link className="hover:underline" href={`/interviews/${row.interviewId}` as never}>{row.candidateName}</Link>
                  {row.candidateEmail && <div className="truncate text-2xs font-normal text-muted-foreground">{row.candidateEmail}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={row.status === "live" ? "default" : "outline"}>{STATUS_LABEL[row.status]}</Badge>
                  {row.status === "scheduled" && row.joined && <span className="ml-1.5 text-muted-foreground">Ready</span>}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.startedAt ? (
                    <>
                      <span className="font-medium">{row.score.marks}</span> / {row.score.max} <span className="text-muted-foreground">({percent(row)}%)</span>
                      {row.score.unmarked > 0 && <div className="text-2xs text-muted-foreground">{row.score.unmarked} to mark</div>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not started</span>
                  )}
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{row.answered} of {row.questions}</TableCell>
                <TableCell>{row.startedAt ? <Flags row={row} /> : null}</TableCell>
                <TableCell className="hidden sm:table-cell">{row.recommendation ? RECOMMENDATION_LABEL[row.recommendation] : ""}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" asChild aria-label={`Open ${row.candidateName}'s room`}><Link href={`/rooms/${row.roomId}` as never}><ExternalLink /></Link></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all of this?</AlertDialogTitle>
            <AlertDialogDescription>Every candidate&apos;s room, answers, runs, scorecard and replay are deleted for good, and their links stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
