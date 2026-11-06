/** Interviews and assessments: everything scheduled, the organisation's question bank, and the form that schedules one interview. */
"use client";

import { QUESTION_DIFFICULTIES, QUESTION_KINDS, ScheduleInterviewInput, type BatchListItem, type InterviewListItem, type QuestionListItem, type ScheduledInterview } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ClipboardList, Copy, Pencil, Plus, Trash2, Upload } from "lucide-react";
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

import { candidateLink, DIFFICULTY_LABEL, isoFromLocalInput, KIND_LABEL, STATUS_LABEL } from "./format";
import { ImportQuestionsDialog } from "./import-questions";

const NOT_YET = "during";

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
  // The usual live interview: choose the questions as it goes.
  const [questionId, setQuestionId] = useState(NOT_YET);
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
      ...(questionId !== NOT_YET && { questionId }),
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
          <DialogDescription>
            This makes a private room and a link for the candidate. It happens on video, and nothing starts until you start it.{" "}
            <Link className="underline" href={"/interviews/new" as never}>Schedule many at once</Link>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Question</Label>
            <Select value={questionId} onValueChange={setQuestionId}>
              <SelectTrigger className="w-full" aria-label="Question"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_YET}>Choose during the interview</SelectItem>
                {questions.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}
              </SelectContent>
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

/** Rounds of interviews and assessments scheduled together: each opens its results table. */
function BatchesTable({ batches }: { batches: BatchListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Candidates</TableHead>
          <TableHead className="hidden sm:table-cell">Started</TableHead>
          <TableHead className="hidden sm:table-cell">Finished</TableHead>
          <TableHead className="hidden sm:table-cell">Length</TableHead>
          <TableHead className="hidden sm:table-cell">Made</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => (
          <TableRow key={batch.id}>
            <TableCell className="max-w-72 truncate font-medium"><Link className="hover:underline" href={`/interviews/batches/${batch.id}` as never}>{batch.title}</Link></TableCell>
            <TableCell className="tabular-nums">{batch.candidates}</TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">{batch.started}</TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">{batch.finished}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{batch.durationMinutes} min</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{formatRelativeTime(batch.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
          <TableHead>Kind</TableHead>
          <TableHead className="hidden sm:table-cell">Difficulty</TableHead>
          <TableHead className="hidden md:table-cell">Tags</TableHead>
          <TableHead className="hidden sm:table-cell">Marks</TableHead>
          <TableHead className="hidden sm:table-cell">Details</TableHead>
          <TableHead className="hidden lg:table-cell">Changed</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {questions.map((question) => (
          <TableRow key={question.id}>
            <TableCell className="max-w-72 truncate font-medium">
              <Link className="hover:underline" href={`/interviews/questions/${question.id}` as never}>{question.title}</Link>
            </TableCell>
            <TableCell>{KIND_LABEL[question.kind]}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{DIFFICULTY_LABEL[question.difficulty]}</TableCell>
            <TableCell className="hidden max-w-40 truncate text-muted-foreground md:table-cell">{question.tags.join(", ")}</TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">{question.marks}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {question.kind === "coding" ? `${question.tests} test${question.tests === 1 ? "" : "s"}${question.hiddenTests ? `, ${question.hiddenTests} hidden` : ""}` : question.kind === "mcq" ? `${question.choices} choices` : "Marked by a person"}
            </TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell">{formatRelativeTime(question.updatedAt)}</TableCell>
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
  const asked = params.get("tab");
  const [tab, setTab] = useState(asked === "questions" || asked === "assessments" ? asked : "interviews");
  const [kind, setKind] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [search, setSearch] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledInterview | null>(null);
  const [archiving, setArchiving] = useState<QuestionListItem | null>(null);
  const [importing, setImporting] = useState(false);
  const interviews = useQuery({ queryKey: ["interviews"], queryFn: ({ signal }) => api<InterviewListItem[]>("/api/interviews", { signal }), refetchInterval: 20_000 });
  const questions = useQuery({ queryKey: ["interview-questions"], queryFn: ({ signal }) => api<QuestionListItem[]>("/api/interview-questions", { signal }) });
  const batches = useQuery({ queryKey: ["interview-batches"], queryFn: ({ signal }) => api<BatchListItem[]>("/api/interview-batches", { signal }), refetchInterval: 20_000 });
  const assessments = batches.data?.filter((batch) => batch.mode === "assessment") ?? [];
  const rounds = batches.data?.filter((batch) => batch.mode === "interview") ?? [];
  const singles = interviews.data?.filter((interview) => !interview.batchId) ?? [];
  const words = search.trim().toLowerCase();
  const shownQuestions = (questions.data ?? []).filter(
    (question) =>
      (kind === "all" || question.kind === kind) &&
      (difficulty === "all" || question.difficulty === difficulty) &&
      (!words || question.title.toLowerCase().includes(words) || question.tags.some((tag) => tag.includes(words))),
  );

  const newQuestion = (
    <Button size="sm" variant={questions.data?.length ? "outline" : "brand"} asChild>
      <Link href={"/interviews/questions/new" as never}><Plus /> New question</Link>
    </Button>
  );
  const importButton = <Button size="sm" variant="outline" onClick={() => setImporting(true)}><Upload /> Import questions</Button>;
  const schedule = <Button size="sm" variant="brand" onClick={() => setScheduling(true)}><CalendarPlus /> Schedule an interview</Button>;
  const newAssessment = (
    <Button size="sm" variant="outline" asChild>
      <Link href={"/interviews/new?mode=assessment" as never}><ClipboardList /> New assessment</Link>
    </Button>
  );

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
        description="Live interviews on video, and assessments people take by themselves. Both share your question bank, a timer the server keeps, a replay and a record of anything unusual."
        actions={<>{newQuestion}{newAssessment}{schedule}</>}
      />
      <Tabs value={tab} onValueChange={setTab} className="px-6 py-4 sm:px-8">
        <TabsList>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="questions">Question bank</TabsTrigger>
        </TabsList>
        <TabsContent value="interviews">
          {interviews.isPending && <Skeleton className="h-32" />}
          {interviews.isError && <p className="py-6 text-muted-foreground">Interviews couldn&apos;t load. Try again in a moment.</p>}
          {interviews.isSuccess && singles.length === 0 && rounds.length === 0 && (
            <Empty title="No interviews yet" hint="Schedule one to get a room and a link for your candidate. You can choose the questions beforehand, or during it." action={schedule} />
          )}
          {rounds.length > 0 && (
            <section aria-label="Rounds of interviews" className="grid gap-1 pb-4">
              <h2 className="font-medium">Scheduled together</h2>
              <BatchesTable batches={rounds} />
            </section>
          )}
          {singles.length > 0 && <InterviewsTable interviews={singles} />}
          {interviews.isSuccess && (singles.length > 0 || rounds.length > 0) && (
            <p className="pt-3"><Link className="text-muted-foreground underline" href={"/interviews/new" as never}>Schedule many at once</Link></p>
          )}
        </TabsContent>
        <TabsContent value="assessments">
          {batches.isPending && <Skeleton className="h-32" />}
          {batches.isError && <p className="py-6 text-muted-foreground">Assessments couldn&apos;t load. Try again in a moment.</p>}
          {batches.isSuccess && assessments.length === 0 && (
            <Empty title="No assessments yet" hint="A test people take by themselves inside a time window. Each gets their own paper drawn from your bank, and you get a results table." action={newAssessment} />
          )}
          {assessments.length > 0 && <BatchesTable batches={assessments} />}
        </TabsContent>
        <TabsContent value="questions">
          {questions.isPending && <Skeleton className="h-32" />}
          {questions.isError && <p className="py-6 text-muted-foreground">Questions couldn&apos;t load. Try again in a moment.</p>}
          {questions.data?.length === 0 && <Empty title="No questions yet" hint="Coding with hidden tests, multiple choice marked for you, short answers and system designs." action={<div className="flex gap-2">{newQuestion}{importButton}</div>} />}
          {Boolean(questions.data?.length) && (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-7 w-56" aria-label="Search the bank" placeholder="Search by title or tag" value={search} onChange={(event) => setSearch(event.target.value)} />
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger size="sm" className="w-40" aria-label="Filter by kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every kind</SelectItem>
                    {QUESTION_KINDS.map((value) => <SelectItem key={value} value={value}>{KIND_LABEL[value]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Filter by difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any difficulty</SelectItem>
                    {QUESTION_DIFFICULTIES.map((value) => <SelectItem key={value} value={value}>{DIFFICULTY_LABEL[value]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span role="status" className="text-muted-foreground">{shownQuestions.length} of {questions.data!.length}</span>
                <div className="ml-auto">{importButton}</div>
              </div>
              <QuestionsTable questions={shownQuestions} onArchive={setArchiving} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {scheduling && (
        <ScheduleDialog
          questions={questions.data ?? []}
          onClose={() => setScheduling(false)}
          onScheduled={(interview) => {
            setScheduling(false);
            setScheduled(interview);
            void queryClient.invalidateQueries({ queryKey: ["interviews"] });
          }}
        />
      )}
      {importing && <ImportQuestionsDialog onClose={() => setImporting(false)} />}
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
            <AlertDialogDescription>&ldquo;{archiving?.title}&rdquo; leaves the bank. Interviews and assessments that used it keep their own copy.</AlertDialogDescription>
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
