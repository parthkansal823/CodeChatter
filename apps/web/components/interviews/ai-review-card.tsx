/** Ask the AI about a sitting: what's worth checking, and questions only the author of the work could answer. It points; a person decides. */
"use client";

import type { AiReviewFinding, AiReviewInput, InterviewerInterview, InterviewRecordings } from "@codechatter/contracts";
import { CircleAlert, Info, Loader2, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";

import { contactSheet } from "./contact-sheet";
import { filesAt, parseReplayFrames } from "./replay";

const MOST_FILES = 100;
const MOST_FILE_CHARS = 200_000;
const SOURCE_LABEL: Record<AiReviewFinding["source"], string> = { signals: "Worked out from the record, not by the AI", activity: "Their activity", camera: "Camera, so watch this moment: stills are often misread", screen: "Screen, so watch this moment: stills are often misread" };
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What they ended with, from the edit log. The API doesn't read live documents. */
export async function theirFiles(interviewId: string): Promise<AiReviewInput["files"]> {
  const response = await fetch(`/api/interviews/${interviewId}/replay/updates`, { credentials: "same-origin" });
  if (!response.ok) return [];
  const frames = parseReplayFrames(new Uint8Array(await response.arrayBuffer()));
  return filesAt(frames, Number.POSITIVE_INFINITY)
    .filter((file) => file.text !== null)
    .slice(0, MOST_FILES)
    .map((file) => ({ path: file.path, text: file.text!.slice(0, MOST_FILE_CHARS) }));
}

export function AiReviewCard({ interview, onChanged }: { interview: InterviewerInterview; onChanged: (next: InterviewerInterview) => void }) {
  const [step, setStep] = useState<string | null>(null);
  const review = interview.aiReview;

  async function ask() {
    try {
      setStep("Reading their work…");
      const input: AiReviewInput = { files: await theirFiles(interview.id) };
      if (interview.aiReviewRecording && (interview.recordWebcam || interview.recordScreen)) {
        setStep("Taking stills from the recording…");
        const { clips } = await api<InterviewRecordings>(`/api/interviews/${interview.id}/recordings`);
        const webcam = interview.recordWebcam ? await contactSheet(interview.id, clips.filter((clip) => clip.stream === "webcam"), "C") : null;
        const screen = interview.recordScreen ? await contactSheet(interview.id, clips.filter((clip) => clip.stream === "screen"), "S") : null;
        if (webcam) input.webcam = webcam;
        if (screen) input.screen = screen;
      }
      setStep("Asking the AI. This can take a minute…");
      onChanged(await api<InterviewerInterview>(`/api/interviews/${interview.id}/ai-review`, { method: "POST", json: input }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "The AI couldn't review this. Try again.");
    } finally {
      setStep(null);
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground">
        It reads the record, how their code came about and what they wrote, and suggests what to check and what to ask them{interview.aiReviewRecording ? ", and looks at stills from the recording" : ""}. Their name and email aren&apos;t sent. It can be wrong, and it can&apos;t tell whether code was written by an AI: <span className="font-medium text-foreground">you decide</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={step !== null || !interview.startedAt} onClick={() => void ask()}>
          {step ? <Loader2 className="animate-spin" /> : <Sparkles />} {review ? "Ask again" : "Ask the AI"}
        </Button>
        {step && <span role="status" className="text-muted-foreground">{step}</span>}
      </div>

      {review && (
        <section aria-label="What the AI said" className="grid gap-2 rounded-md border p-2.5">
          {review.summary && <p className="break-words">{review.summary}</p>}
          {review.findings.length > 0 && (
            <ul className="grid gap-1.5" aria-label="What to check">
              {review.findings.map((finding, index) => (
                <li key={`${finding.title}-${index}`} className="flex items-start gap-1.5">
                  {finding.level === "look" ? <CircleAlert aria-label="Worth checking" className="mt-0.5 size-3.5 shrink-0 text-brand" /> : <Info aria-label="A note" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{finding.title}</span>
                    {finding.detail && <span className="text-muted-foreground"> {finding.detail}</span>}
                    <span className="block text-2xs text-muted-foreground">{SOURCE_LABEL[finding.source]}{finding.at ? `, ${time(finding.at)}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {review.findings.length === 0 && <p className="text-muted-foreground">It found nothing to point out.</p>}
          {review.questions.length > 0 && (
            <div className="grid gap-1">
              <h4 className="flex items-center gap-1.5 font-medium"><MessageCircleQuestion className="size-3.5" /> Questions to ask them</h4>
              <ol className="grid list-decimal gap-1 pl-5" aria-label="Questions to ask them">
                {review.questions.map((question, index) => (
                  <li key={`${question.question}-${index}`} className="break-words">
                    {question.question}
                    {question.about && <span className="text-2xs text-muted-foreground"> ({question.about})</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {review.note && <p className="text-muted-foreground">{review.note}</p>}
          <p className="text-2xs text-muted-foreground">
            From {review.model}, at {time(review.at)}.{(review.looked.camera || review.looked.screen) && ` It looked at stills from the ${[review.looked.camera && "camera", review.looked.screen && "screen"].filter(Boolean).join(" and ")}.`} This doesn&apos;t change their marks or the record.
          </p>
        </section>
      )}
    </div>
  );
}
