/** Interviews: everything scheduled, the organisation's question bank, and the form that schedules one. */
"use client";

import { ScheduleInterviewInput, type InterviewListItem, type QuestionListItem, type ScheduledInterview } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatRelativeTime } from "@/lib/format";

import { candidateLink, isoFromLocalInput, STATUS_LABEL } from "./format";

/** The link, once: only its hash is kept, so it can't be shown again. */
export function CandidateLinkDialog({ token, emailed, onClose, onOpen }: { token: string; emailed?: boolean; onClose: () => void; onOpen?: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = candidateLink(window.location.origin, token);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="shadow-none">
        <DialogHeader>
          <DialogTitle>The candidate&apos;s link</DialogTitle>
          <DialogDescription>
            {emailed ? "We emailed it to them. " : ""}Copy it now: this is the only time it&apos;s shown, and it works for one person. If you lose it, you can make a new one until it&apos;s used.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={link} aria-label="The candidate's link" className="font-mono" onFocus={(event) => event.currentTarget.select()} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void copyText(link).then((ok) => {
                if (ok) setCopied(true);
                else toast.error("Couldn't copy it. Select the link and copy it by hand.");
              });
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          {onOpen && <Button type="button" size="sm" variant="outline" onClick={onOpen}>Open the interview</Button>}
          <Button type="button" size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ questions, onClose, onScheduled }: { questions: QuestionListItem[]; onClose: () => void; onScheduled: (interview: ScheduledInterview) => void }) {
  const id = useId();
  const [questionId, setQuestionId] = useState(questions[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [when, setWhen] = useState("");
  const question = questions.find((item) => item.id === questionId);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sendEmail && !email.trim()) return setError("Add their email to send them the link.");
    const parsed = ScheduleInterviewInput.safeParse({
      questionId,
      candidateName: name,
      ...(email.trim() && { candidateEmail: email.trim() }),
      ...(isoFromLocalInput(when) && { scheduledAt: isoFromLocalInput(when) }),
      ...(minutes !== null && { durationMinutes: minutes }),
      sendEmail,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form.");
    setBusy(true);
    setError(null);
    try {
      onScheduled(await api<ScheduledInterview>("/api/interviews", { method: "POST", json: parsed.data }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.detail : "It couldn't be scheduled. Try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto shadow-none">
        <DialogHeader>
          <DialogTitle>Schedule an interview</DialogTitle>
          <DialogDescription>This makes a private room and a link for the candidate. Nothing starts until you start it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Question</Label>
            <Select value={questionId} onValueChange={setQuestionId}>
              <SelectTrigger className="w-full" aria-label="Question"><SelectValue /></SelectTrigger>
              <SelectContent>{questions.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>Candidate&apos;s name</Label>
            <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-email`}>Candidate&apos;s email (optional)</Label>
            <Input id={`${id}-email`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <label className="flex items-center gap-1.5">
              <Checkbox checked={sendEmail} onCheckedChange={(checked) => setSendEmail(checked === true)} /> Email them the link
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-when`}>When (optional)</Label>
              <Input id={`${id}-when`} type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-minutes`}>Length, minutes</Label>
              <Input id={`${id}-minutes`} type="number" min={5} max={480} value={minutes ?? question?.durationMinutes ?? 60} onChange={(event) => setMinutes(event.target.valueAsNumber)} />
            </div>
          </div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Scheduling…" : "Schedule"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InterviewsTable({ interviews }: { interviews: InterviewListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          <TableHead>Question</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Interviewer</TableHead>
          <TableHead className="hidden sm:table-cell">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {interviews.map((interview) => {
          const moment = interview.finishedAt ?? interview.startedAt ?? interview.scheduledAt ?? interview.createdAt;
          return (
            <TableRow key={interview.id}>
              <TableCell className="max-w-48 truncate font-medium">
                <Link className="hover:underline" href={`/interviews/${interview.id}` as never}>{interview.candidateName}</Link>
              </TableCell>
              <TableCell className="max-w-64 truncate">{interview.title}</TableCell>
              <TableCell>
                <Badge variant={interview.status === "live" ? "default" : "outline"}>{STATUS_LABEL[interview.status]}</Badge>
                {interview.status === "scheduled" && interview.candidateJoined && <span className="ml-1.5 text-muted-foreground">Waiting</span>}
              </TableCell>
              <TableCell className="hidden max-w-40 truncate text-muted-foreground sm:table-cell">{interview.interviewer?.name ?? ""}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{formatRelativeTime(moment)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function QuestionsTable({ questions, onArchive }: { questions: QuestionListItem[]; onArchive: (question: QuestionListItem) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Tests</TableHead>
          <TableHead className="hidden sm:table-cell">Length</TableHead>
          <TableHead className="hidden sm:table-cell">Changed</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {questions.map((question) => (
          <TableRow key={question.id}>
            <TableCell className="max-w-72 truncate font-medium">
              <Link className="hover:underline" href={`/interviews/questions/${question.id}` as never}>{question.title}</Link>
            </TableCell>
            <TableCell>{question.tests}{question.hiddenTests > 0 && <span className="text-muted-foreground"> ({question.hiddenTests} hidden)</span>}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{question.durationMinutes} min</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{formatRelativeTime(question.updatedAt)}</TableCell>
            <TableCell className="text-right">
              <Button size="icon-sm" variant="ghost" asChild aria-label={`Edit ${question.title}`}>
                <Link href={`/interviews/questions/${question.id}` as never}><Pencil /></Link>
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${question.title}`} onClick={() => onArchive(question)}><Trash2 /></Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Empty({ title, hint, action }: { title: string; hint: string; action: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}

export function InterviewsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "questions" ? "questions" : "interviews");
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledInterview | null>(null);
  const [archiving, setArchiving] = useState<QuestionListItem | null>(null);
  const interviews = useQuery({ queryKey: ["interviews"], queryFn: ({ signal }) => api<InterviewListItem[]>("/api/interviews", { signal }), refetchInterval: 20_000 });
  const questions = useQuery({ queryKey: ["interview-questions"], queryFn: ({ signal }) => api<QuestionListItem[]>("/api/interview-questions", { signal }) });

  const newQuestion = (
    <Button size="sm" variant={questions.data?.length ? "outline" : "brand"} asChild>
      <Link href={"/interviews/questions/new" as never}><Plus /> New question</Link>
    </Button>
  );
  const schedule = <Button size="sm" variant="brand" onClick={() => setScheduling(true)}><CalendarPlus /> Schedule an interview</Button>;

  async function archive(question: QuestionListItem) {
    setArchiving(null);
    try {
      await api(`/api/interview-questions/${question.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["interview-questions"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "It couldn't be removed. Try again.");
    }
  }

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Coding interviews with a server-side timer, hidden tests, a private scorecard and a replay."
        actions={<>{newQuestion}{questions.data?.length ? schedule : null}</>}
      />
      <Tabs value={tab} onValueChange={setTab} className="px-6 py-4 sm:px-8">
        <TabsList>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="questions">Question bank</TabsTrigger>
        </TabsList>
        <TabsContent value="interviews">
          {interviews.isPending && <Skeleton className="h-32" />}
          {interviews.isError && <p className="py-6 text-muted-foreground">Interviews couldn&apos;t load. Try again in a moment.</p>}
          {interviews.data?.length === 0 && (
            <Empty
              title="No interviews yet"
              hint={questions.data?.length ? "Schedule one to get a room and a link for your candidate." : "Add a question to your bank first, then schedule an interview with it."}
              action={questions.data?.length ? schedule : newQuestion}
            />
          )}
          {Boolean(interviews.data?.length) && <InterviewsTable interviews={interviews.data!} />}
        </TabsContent>
        <TabsContent value="questions">
          {questions.isPending && <Skeleton className="h-32" />}
          {questions.isError && <p className="py-6 text-muted-foreground">Questions couldn&apos;t load. Try again in a moment.</p>}
          {questions.data?.length === 0 && <Empty title="No questions yet" hint="A question has starter code, tests (some hidden) and what you'll score." action={newQuestion} />}
          {Boolean(questions.data?.length) && <QuestionsTable questions={questions.data!} onArchive={setArchiving} />}
        </TabsContent>
      </Tabs>

      {scheduling && questions.data && (
        <ScheduleDialog
          questions={questions.data}
          onClose={() => setScheduling(false)}
          onScheduled={(interview) => {
            setScheduling(false);
            setScheduled(interview);
            void queryClient.invalidateQueries({ queryKey: ["interviews"] });
          }}
        />
      )}
      {scheduled && (
        <CandidateLinkDialog
          token={scheduled.candidateToken}
          emailed={scheduled.emailed}
          onClose={() => setScheduled(null)}
          onOpen={() => router.push(`/interviews/${scheduled.id}` as never)}
        />
      )}
      <AlertDialog open={archiving !== null} onOpenChange={(open) => { if (!open) setArchiving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this question?</AlertDialogTitle>
            <AlertDialogDescription>&ldquo;{archiving?.title}&rdquo; leaves the bank. Interviews that used it keep their own copy.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiving && void archive(archiving)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
