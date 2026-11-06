/** Schedule many at once: interviews, with questions ready or none at all, or an assessment with a paper drawn for each candidate. Then their links, shown once. */
"use client";

import { parseCandidates, QUESTION_DIFFICULTIES, QUESTION_KINDS, ScheduleBatchInput, type BatchCandidate, type PaperRule, type QuestionDifficulty, type QuestionKind, type QuestionListItem, type ScheduledBatch } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

import { candidateLink, csvRow, DIFFICULTY_LABEL, downloadText, isoFromLocalInput, KIND_LABEL } from "./format";

const ANY = "any";
type RuleDraft = { key: number; count: number; kind: QuestionKind | typeof ANY; difficulty: QuestionDifficulty | typeof ANY; tag: string };

const matches = (question: QuestionListItem, rule: RuleDraft) =>
  (rule.kind === ANY || question.kind === rule.kind) && (rule.difficulty === ANY || question.difficulty === rule.difficulty) && (!rule.tag.trim() || question.tags.includes(rule.tag.trim().toLowerCase()));

function Links({ batch, onDone }: { batch: ScheduledBatch; onDone: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = window.location.origin;
  const all = batch.links.map((link) => ({ ...link, url: candidateLink(origin, link.candidateToken) }));
  const csv = [csvRow(["Name", "Email", "Link", "Emailed"]), ...all.map((link) => csvRow([link.candidateName, link.candidateEmail ?? "", link.url, link.emailed ? "yes" : "no"]))].join("\r\n");
  return (
    <div className="grid max-w-4xl gap-3 px-6 py-6 sm:px-8">
      <h2 className="font-medium">{batch.links.length} link{batch.links.length === 1 ? "" : "s"} ready</h2>
      <p className="text-muted-foreground">Save these now: each is shown this once and works for one person. Only their hashes are kept, though you can make a new one for anyone who hasn&apos;t used theirs.</p>
      {batch.failed.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-destructive">
          {batch.failed.map((failure) => <li key={failure.candidateName}>{failure.candidateName}: {failure.reason}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => downloadText(`${batch.title.replace(/[^\w-]+/g, "-").toLowerCase()}-links.csv`, csv, "text/csv")}><Download /> Download as CSV</Button>
        <Button size="sm" asChild><Link href={onDone as never}>See the results page</Link></Button>
      </div>
      <ul className="grid gap-1" aria-label="Candidates' links">
        {all.map((link) => (
          <li key={link.interviewId} className="flex items-center gap-2 rounded-sm border p-1.5">
            <span className="w-40 shrink-0 truncate font-medium">{link.candidateName}</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{link.url}</code>
            {link.emailed && <span className="shrink-0 text-2xs text-muted-foreground">Emailed</span>}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Copy ${link.candidateName}'s link`}
              onClick={() => void copyText(link.url).then((ok) => (ok ? setCopied(link.interviewId) : toast.error("Couldn't copy it. Select it by hand.")))}
            >
              {copied === link.interviewId ? <Check /> : <Copy />}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BatchForm({ mode }: { mode: "interview" | "assessment" }) {
  const id = useId();
  const queryClient = useQueryClient();
  const assessment = mode === "assessment";
  const bank = useQuery({ queryKey: ["interview-questions"], queryFn: ({ signal }) => api<QuestionListItem[]>("/api/interview-questions", { signal }) });
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState("");
  const [fixed, setFixed] = useState<string[]>([]);
  const [rules, setRules] = useState<RuleDraft[]>(assessment ? [{ key: 1, count: 5, kind: "mcq", difficulty: ANY, tag: "" }] : []);
  const [minutes, setMinutes] = useState(assessment ? 45 : 60);
  const [startsAt, setStartsAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [lockClipboard, setLockClipboard] = useState(false);
  const [recordWebcam, setRecordWebcam] = useState(false);
  const [recordScreen, setRecordScreen] = useState(false);
  const [aiReviewRecording, setAiReviewRecording] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<ScheduledBatch | null>(null);

  const parsedPeople = useMemo(() => parseCandidates(people), [people]);
  const questions = bank.data ?? [];
  const patchRule = (key: number, next: Partial<RuleDraft>) => setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...next } : rule)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (parsedPeople.problems.length) return setError(`Couldn't read: ${parsedPeople.problems.slice(0, 3).join("; ")}`);
    const candidates: BatchCandidate[] = parsedPeople.candidates;
    const random: PaperRule[] = rules.map((rule) => ({ count: rule.count, ...(rule.kind !== ANY && { kind: rule.kind }), ...(rule.difficulty !== ANY && { difficulty: rule.difficulty }), ...(rule.tag.trim() && { tag: rule.tag.trim() }) }));
    const parsed = ScheduleBatchInput.safeParse({
      mode,
      title,
      candidates,
      paper: { fixed, random },
      durationMinutes: minutes,
      ...(isoFromLocalInput(startsAt) && { startsAt: isoFromLocalInput(startsAt) }),
      ...(assessment && isoFromLocalInput(closesAt) && { closesAt: isoFromLocalInput(closesAt) }),
      fullscreen,
      lockClipboard,
      ...(assessment && { recordWebcam, recordScreen, aiReviewRecording: aiReviewRecording && (recordWebcam || recordScreen) }),
      sendEmail,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form.");
    setBusy(true);
    setError(null);
    try {
      setMade(await api<ScheduledBatch>("/api/interview-batches", { method: "POST", json: parsed.data }));
      void queryClient.invalidateQueries({ queryKey: ["interview-batches"] });
      void queryClient.invalidateQueries({ queryKey: ["interviews"] });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.detail : "It couldn't be scheduled. Try again.");
      setBusy(false);
    }
  }

  const heading = assessment ? "New assessment" : "Schedule many interviews";
  if (made) {
    return (
      <>
        <PageHeader title={made.title} description={assessment ? "The assessment is ready." : "The interviews are ready."} />
        <Links batch={made} onDone={`/interviews/batches/${made.id}`} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={heading}
        description={assessment ? "A test people take by themselves, inside a time window. Everyone gets their own paper, and it marks what it can." : "A room and a link for each candidate. You start each one, on video, and can ask questions as you go."}
      />
      <form onSubmit={(event) => void submit(event)} className="grid max-w-3xl gap-5 px-6 py-6 sm:px-8">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-title`}>{assessment ? "Name of the assessment" : "Name of this round"}</Label>
          <Input id={`${id}-title`} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={assessment ? "Backend screening, June" : "First round"} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-people`}>Candidates, one a line</Label>
          <Textarea id={`${id}-people`} rows={5} className="font-mono" spellCheck={false} value={people} onChange={(event) => setPeople(event.target.value)} placeholder={"Ana Ruiz, ana@example.com\nBen Lee <ben@example.com>\nsomeone@example.com"} />
          <p role="status" className="text-muted-foreground">
            {parsedPeople.candidates.length} candidate{parsedPeople.candidates.length === 1 ? "" : "s"}
            {parsedPeople.problems.length > 0 && <span className="text-destructive"> · {parsedPeople.problems.length} line{parsedPeople.problems.length === 1 ? "" : "s"} couldn&apos;t be read: {parsedPeople.problems.slice(0, 2).join("; ")}</span>}
          </p>
          <label className="flex items-center gap-1.5"><Checkbox checked={sendEmail} onCheckedChange={(on) => setSendEmail(on === true)} /> Email everyone their link</label>
        </div>

        <section className="grid gap-2 border-t pt-4" aria-label="The questions">
          <div>
            <h2 className="font-medium">The questions</h2>
            <p className="text-muted-foreground">
              {assessment ? "Each candidate gets these draws of their own, so papers differ, and choices come in a different order." : "Ready for you to ask when you choose. You can leave this empty, and pick or write questions during the interview."}
            </p>
          </div>
          {rules.map((rule) => {
            const available = questions.filter((question) => matches(question, rule)).length;
            return (
              <div key={rule.key} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[4.5rem_1fr_1fr_1fr_auto]">
                <Input aria-label="How many" className="h-7" type="number" min={1} max={100} value={rule.count} onChange={(event) => patchRule(rule.key, { count: event.target.valueAsNumber })} />
                <Select value={rule.kind} onValueChange={(kind) => patchRule(rule.key, { kind: kind as RuleDraft["kind"] })}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any kind</SelectItem>
                    {QUESTION_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{KIND_LABEL[kind]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={rule.difficulty} onValueChange={(difficulty) => patchRule(rule.key, { difficulty: difficulty as RuleDraft["difficulty"] })}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any difficulty</SelectItem>
                    {QUESTION_DIFFICULTIES.map((difficulty) => <SelectItem key={difficulty} value={difficulty}>{DIFFICULTY_LABEL[difficulty]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input aria-label="Tag" className="h-7" placeholder="Tag (optional)" value={rule.tag} onChange={(event) => patchRule(rule.key, { tag: event.target.value })} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove this draw" onClick={() => setRules(rules.filter((other) => other.key !== rule.key))}><Trash2 /></Button>
                <p role="status" className={available < rule.count ? "text-destructive sm:col-span-5" : "text-2xs text-muted-foreground sm:col-span-5"}>{available} in the bank match this.</p>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setRules([...rules, { key: Date.now(), count: 1, kind: ANY, difficulty: ANY, tag: "" }])}><Plus /> Draw at random</Button>
            <Select value="" onValueChange={(question) => setFixed((current) => (current.includes(question) ? current : [...current, question]))}>
              <SelectTrigger size="sm" className="w-64" aria-label="Add a question for everyone"><SelectValue placeholder="Add a question for everyone" /></SelectTrigger>
              <SelectContent>{questions.filter((question) => !fixed.includes(question.id)).map((question) => <SelectItem key={question.id} value={question.id}>{question.title}</SelectItem>)}</SelectContent>
            </Select>
            {questions.length === 0 && bank.isSuccess && <Link className="text-muted-foreground underline" href={"/interviews/questions/new" as never}>The bank is empty: add a question</Link>}
          </div>
          {fixed.length > 0 && (
            <ul className="grid gap-1" aria-label="Questions for everyone">
              {fixed.map((question) => (
                <li key={question} className="flex items-center gap-2 rounded-sm border p-1.5">
                  <span className="min-w-0 flex-1 truncate">{questions.find((item) => item.id === question)?.title ?? question}</span>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove this question" onClick={() => setFixed(fixed.filter((other) => other !== question))}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3 border-t pt-4 sm:grid-cols-3" aria-label="When">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-minutes`}>Length, minutes</Label>
            <Input id={`${id}-minutes`} type="number" min={5} max={480} value={minutes} onChange={(event) => setMinutes(event.target.valueAsNumber)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-starts`}>{assessment ? "Opens (now if empty)" : "When (optional)"}</Label>
            <Input id={`${id}-starts`} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </div>
          {assessment && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-closes`}>Last moment to start (optional)</Label>
              <Input id={`${id}-closes`} type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
            </div>
          )}
        </section>

        <section className="grid gap-1.5 border-t pt-4" aria-label="Protection">
          <h2 className="font-medium">Making it harder to cheat</h2>
          <p className="text-muted-foreground">Always on: the server keeps the time, there&apos;s no internet from the sandbox, AI is off{assessment ? "" : " until you allow it"}, and leaving the tab, pasting from outside and second devices go on a record for you. Candidates are told before they start.</p>
          <label className="flex items-center gap-1.5"><Checkbox checked={fullscreen} onCheckedChange={(on) => setFullscreen(on === true)} /> Ask for full screen</label>
          <label className="flex items-center gap-1.5"><Checkbox checked={lockClipboard} onCheckedChange={(on) => setLockClipboard(on === true)} /> Block pasting from outside and copying the questions</label>
          {assessment && (
            <>
              <label className="flex items-center gap-1.5"><Checkbox checked={recordWebcam} onCheckedChange={(on) => setRecordWebcam(on === true)} /> Record their webcam</label>
              <label className="flex items-center gap-1.5"><Checkbox checked={recordScreen} onCheckedChange={(on) => setRecordScreen(on === true)} /> Record their whole screen</label>
              {(recordWebcam || recordScreen) && (
                <label className="flex items-center gap-1.5"><Checkbox checked={aiReviewRecording} onCheckedChange={(on) => setAiReviewRecording(on === true)} /> Let the AI look at stills from the recording, when someone asks it to</label>
              )}
              {aiReviewRecording && (recordWebcam || recordScreen) && (
                <p role="note" className="text-muted-foreground">
                  It looks for another person, a phone or other apps on screen, and never identifies anyone or judges faces. Candidates are told. The stills go to whichever AI this server uses, so check you&apos;re happy with that: a local model keeps them here.
                </p>
              )}
              {(recordWebcam || recordScreen) && (
                <p role="note" className="text-muted-foreground">
                  They have to agree before they start, and can&apos;t take it otherwise. No sound is recorded. Only you and your organisation&apos;s admins can watch, each time is logged, and recordings are deleted automatically (after 30 days, unless your server says otherwise). Recording people has legal rules that differ by country: check it&apos;s allowed where your candidates are, and offer another way to anyone who can&apos;t agree.
                </p>
              )}
            </>
          )}
        </section>

        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex gap-2 border-t pt-4">
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Scheduling…" : `Schedule ${parsedPeople.candidates.length || ""} ${assessment ? "" : "interviews"}`.replace(/\s+/g, " ").trim()}</Button>
          <Button type="button" size="sm" variant="ghost" asChild><Link href={"/interviews" as never}>Cancel</Link></Button>
        </div>
      </form>
    </>
  );
}
