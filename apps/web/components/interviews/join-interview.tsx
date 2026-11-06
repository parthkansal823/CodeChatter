/** The candidate's link: join with or without an account, then wait for the interviewer, or start an assessment themselves. Shows nothing of the questions. */
"use client";

import type { InterviewInvitation, JoinedInterview } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import type { Me } from "@/lib/me";

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo />
      <div className="grid w-full max-w-md gap-3">
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {children}
      </div>
    </main>
  );
}

const COUNT_WORDS: Record<string, [string, string]> = { mcq: ["multiple choice", "multiple choice"], coding: ["coding question", "coding questions"], short: ["short answer", "short answers"], design: ["system design", "system designs"] };

/** "5 multiple choice, 1 coding question". */
function paperWords(questions: NonNullable<InterviewInvitation["questions"]>): string {
  return Object.entries(questions)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${COUNT_WORDS[kind]![count === 1 ? 0 : 1]}`)
    .join(", ");
}

/** What's recorded and what's asked of them. They should know before they start. */
function Rules({ invite }: { invite: InterviewInvitation }) {
  const assessment = invite.mode === "assessment";
  return (
    <ul className="mx-auto max-w-sm list-disc pl-5 text-left text-muted-foreground">
      {assessment ? (
        <li>The timer runs on the server and starts when you press Start. It keeps running if you close the page.</li>
      ) : (
        <>
          <li>It happens on video, in the room: have your camera and microphone ready.</li>
          <li>The timer runs on the server and starts when your interviewer starts it.</li>
        </>
      )}
      <li>{assessment ? "AI help is off, and the sandbox has no internet." : "AI help is off unless your interviewer turns it on. The sandbox has no internet."}</li>
      <li>{assessment ? "Whoever marks it sees your answers, edits and test runs, and can replay them." : "Your interviewer sees your edits and test runs, and can replay them later."}</li>
      <li>Leaving this tab, pasting from outside and opening it on a second device go on a record they can see.</li>
      {invite.fullscreen && <li>It runs in full screen.</li>}
      {invite.lockClipboard && <li>Pasting from outside and copying the questions are off.</li>}
    </ul>
  );
}

function when(scheduledAt: string | null): string | null {
  return scheduledAt ? new Date(scheduledAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) : null;
}

export function JoinInterview({ token }: { token: string }) {
  const router = useRouter();
  const [joined, setJoined] = useState<JoinedInterview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const invitation = useQuery({
    queryKey: ["interview-invitation", token],
    queryFn: ({ signal }) => api<InterviewInvitation>(`/api/interview-invites/${token}`, { signal }),
    retry: false,
    // While someone waits, this is how they find out it started.
    refetchInterval: (query) => (query.state.data?.status === "scheduled" && joined ? 3000 : false),
  });
  const me = useQuery({
    queryKey: ["interview-me"],
    queryFn: async ({ signal }) => {
      try {
        return await api<Me>("/api/me", { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });

  const request = useCallback((path: "claim" | "guest") => api<JoinedInterview>(`/api/interview-invites/${token}/${path}`, { method: "POST" }), [token]);
  const accept = useCallback(
    (result: JoinedInterview) => {
      setProblem(null);
      setJoined(result);
      if (!result.waiting) router.replace(`/rooms/${result.roomId}` as never);
    },
    [router],
  );
  const refuse = useCallback((error: unknown) => setProblem(error instanceof ApiError ? error.detail : "That didn't work. Try again."), []);
  const press = (path: "claim" | "guest" | "start") => {
    setBusy(true);
    void api<JoinedInterview>(`/api/interview-invites/${token}/${path}`, { method: "POST" }).then(accept, refuse).finally(() => setBusy(false));
  };

  // Coming back to a link you already used: carry on without asking. Once per page.
  const status = invitation.data?.status;
  const used = invitation.data?.used;
  const signedIn = Boolean(me.data);
  const resumed = useRef(false);
  useEffect(() => {
    if (!signedIn || !used || resumed.current || status === "finished" || status === "cancelled") return;
    resumed.current = true;
    void request("claim").then(accept, refuse);
  }, [signedIn, used, status, request, accept, refuse]);

  // It started while they waited.
  const waiting = joined?.waiting === true;
  useEffect(() => {
    if (waiting && status === "live") void request("claim").then(accept, refuse);
  }, [waiting, status, request, accept, refuse]);

  if (invitation.isPending || me.isPending) {
    return <Page title="Your interview"><Skeleton className="mx-auto h-5 w-2/3" /></Page>;
  }
  if (invitation.isError || !invitation.data) {
    const expired = invitation.error instanceof ApiError && invitation.error.status === 404;
    return (
      <Page title={expired ? "This link doesn't work" : "Something went wrong"}>
        <p className="text-muted-foreground">{expired ? "It may have been replaced. Ask your interviewer for a new one." : "Try reloading the page."}</p>
      </Page>
    );
  }

  const invite = invitation.data;
  if (invite.status === "cancelled") return <Page title="This interview was cancelled"><p className="text-muted-foreground">Contact your interviewer if you think that&apos;s a mistake.</p></Page>;
  if (invite.status === "finished") return <Page title={`This ${invite.mode} has finished`}><p className="text-muted-foreground">Thanks for taking part.</p></Page>;
  if (invite.status === "missed") return <Page title="This assessment has closed"><p className="text-muted-foreground">It had to be started by {when(invite.closesAt)}. Contact whoever sent it if you think that&apos;s a mistake.</p></Page>;

  const assessment = invite.mode === "assessment";
  const opensLater = Boolean(invite.opensAt && new Date(invite.opensAt) > new Date(invite.now));
  const details = [`${invite.durationMinutes} minutes`, assessment ? null : when(invite.scheduledAt)].filter(Boolean).join(" · ");
  const windowWords = assessment && (invite.opensAt || invite.closesAt) ? [invite.opensAt && `Opens ${when(invite.opensAt)}`, invite.closesAt && `start by ${when(invite.closesAt)}`].filter(Boolean).join(", ") : null;
  if (joined?.waiting && assessment) {
    return (
      <Page title={invite.title}>
        <p className="text-muted-foreground">Hi {invite.candidateName}. {invite.questions ? `${paperWords(invite.questions)}. ` : ""}You have {invite.durationMinutes} minutes from when you start.</p>
        {windowWords && <p className="flex items-center justify-center gap-2 text-muted-foreground"><Clock className="size-4" /> {windowWords}</p>}
        <Rules invite={invite} />
        {problem && <p role="alert" className="text-destructive">{problem}</p>}
        <Button disabled={busy || opensLater} onClick={() => press("start")}>{busy && <Loader2 className="animate-spin" />} {opensLater ? "It hasn't opened yet" : "I understand. Start the assessment"}</Button>
        <p className="text-muted-foreground">You can&apos;t pause it once it starts.</p>
      </Page>
    );
  }
  if (joined?.waiting) {
    return (
      <Page title="You're in the waiting room">
        <p className="text-muted-foreground">
          {invite.interviewerName ?? "Your interviewer"} will start the interview. This page opens it by itself, so keep it open.
        </p>
        <p className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Waiting to start · {details}
        </p>
      </Page>
    );
  }

  return (
    <Page title={invite.title}>
      <p className="text-muted-foreground">
        Hi {invite.candidateName}. {assessment ? `This is an assessment you take by yourself${invite.questions ? `: ${paperWords(invite.questions)}` : ""}. Nothing starts until you press Start.` : "This is a live coding interview on video, in a shared editor, with a real terminal to run your code."}
      </p>
      <p className="flex items-center justify-center gap-2 text-muted-foreground"><Clock className="size-4" /> {windowWords ? `${details} · ${windowWords}` : details}</p>
      <Rules invite={invite} />
      {problem && <p role="alert" className="text-destructive">{problem}</p>}
      {me.data ? (
        <div className="grid gap-2">
          <Button disabled={busy} onClick={() => press("claim")}>{busy && <Loader2 className="animate-spin" />} Continue as {me.data.user.name}</Button>
          <p className="text-muted-foreground">Not you? Open this link in a private window to join without an account.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button disabled={busy || invite.used} onClick={() => press("guest")}>{busy && <Loader2 className="animate-spin" />} Join as {invite.candidateName}</Button>
          {invite.used && <p className="text-muted-foreground">This link has been used. Sign in with the account that used it to get back in.</p>}
          <Button variant="ghost" asChild>
            <Link href={`/sign-in?returnTo=${encodeURIComponent(`/interview/${token}`)}` as never}>I have an account</Link>
          </Button>
        </div>
      )}
    </Page>
  );
}
