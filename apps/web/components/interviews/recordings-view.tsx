/** An assessment's recordings, for an interviewer: a player for each stream, jumping to what's on the record, and deleting them. Opening this goes in the audit log. */
"use client";

import { INTEGRITY_LABEL, RECORDING_STREAM_LABEL, RECORDING_STREAMS, type InterviewerInterview, type InterviewRecordings, type RecordingClip, type RecordingStream } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const size = (bytes: number) => (bytes > 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The clip showing that moment: the last one to start at or before it. */
export function clipAt(clips: readonly Pick<RecordingClip, "startedAt">[], at: number | null): number {
  if (at === null) return 0;
  let found = 0;
  clips.forEach((clip, index) => {
    if (new Date(clip.startedAt).getTime() <= at) found = index;
  });
  return found;
}

function Player({ interviewId, stream, clips, at }: { interviewId: string; stream: RecordingStream; clips: RecordingClip[]; at: number | null }) {
  const [index, setIndex] = useState(() => clipAt(clips, at));
  const clip = clips[index];
  if (!clip) return <p className="text-muted-foreground">No {RECORDING_STREAM_LABEL[stream].toLowerCase()} recording arrived.</p>;
  return (
    <div className="grid gap-1">
      {/* No captions to offer: no sound is recorded. */}
      <video
        key={clip.id}
        aria-label={`${RECORDING_STREAM_LABEL[stream]} recording`}
        src={`/api/interviews/${interviewId}/recordings/${clip.id}`}
        controls
        muted
        playsInline
        autoPlay={at !== null || index > 0}
        className="aspect-video w-full rounded-sm bg-panel"
        onEnded={() => setIndex((current) => Math.min(current + 1, clips.length - 1))}
      />
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button size="icon-xs" variant="ghost" aria-label={`Previous ${stream} clip`} disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft /></Button>
        <span role="status" className="tabular-nums">Clip {index + 1} of {clips.length}, from {time(clip.startedAt)}</span>
        <Button size="icon-xs" variant="ghost" aria-label={`Next ${stream} clip`} disabled={index === clips.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}

export function RecordingsView({ interview }: { interview: InterviewerInterview }) {
  const queryClient = useQueryClient();
  const key = ["interview-recordings", interview.id];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<InterviewRecordings>(`/api/interviews/${interview.id}/recordings`, { signal }) });
  const [at, setAt] = useState<{ time: number; token: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (query.isPending) return <Skeleton className="h-48" />;
  if (query.isError || !query.data) return <p className="text-muted-foreground">The recordings couldn&apos;t load. Try again in a moment.</p>;
  const { clips, bytes, consentAt, keptDays } = query.data;
  const streams = RECORDING_STREAMS.filter((stream) => (stream === "webcam" ? interview.recordWebcam : interview.recordScreen));

  async function remove() {
    try {
      await api(`/api/interviews/${interview.id}/recordings`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success("The recordings are deleted.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "They couldn't be deleted. Try again.");
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground">
        {consentAt ? `${interview.candidateName} agreed to this at ${new Date(consentAt).toLocaleString()}.` : "They haven't started, so nothing is recorded."} Only interviewers and your organisation&apos;s admins can watch, and each time goes in the audit log. Deleted automatically {keptDays} days after recording. {clips.length > 0 && `${clips.length} clips, ${size(bytes)}.`}
      </p>
      {clips.length > 0 && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {streams.map((stream) => (
              <section key={stream} aria-label={`${RECORDING_STREAM_LABEL[stream]} recording`} className="grid gap-1">
                <h3 className="font-medium">{RECORDING_STREAM_LABEL[stream]}</h3>
                <Player key={`${stream}-${at?.token ?? "start"}`} interviewId={interview.id} stream={stream} clips={clips.filter((clip) => clip.stream === stream)} at={at?.time ?? null} />
              </section>
            ))}
          </div>
          {interview.integrity.events.length > 0 && (
            <section aria-label="Jump to what's on the record" className="grid gap-1">
              <h3 className="font-medium">Jump to what&apos;s on the record</h3>
              <ol className="grid max-h-56 gap-0.5 overflow-y-auto">
                {interview.integrity.events.map((event) => (
                  <li key={event.id} className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{time(event.at)}</span>
                    <span className="min-w-0 truncate">{INTEGRITY_LABEL[event.kind] ?? event.kind}</span>
                    <Button size="xs" variant="ghost" className="ml-auto" aria-label={`Watch ${INTEGRITY_LABEL[event.kind] ?? event.kind} at ${time(event.at)}`} onClick={() => setAt({ time: new Date(event.at).getTime(), token: Date.now() })}>Watch</Button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setDeleting(true)}><Trash2 /> Delete the recordings</Button>
        </>
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete these recordings?</AlertDialogTitle>
            <AlertDialogDescription>They&apos;re gone for good. The rest of the sitting stays, and the audit log says who deleted them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
