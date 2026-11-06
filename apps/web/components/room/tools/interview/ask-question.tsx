/** Ask a question during a live interview: pick one from the bank, draw one at random, or write your own on the spot. */
"use client";

import { AdhocQuestion, QUESTION_DIFFICULTIES, QUESTION_KINDS, type AskQuestionInput, type AskedQuestion, type QuestionDifficulty, type QuestionKind, type QuestionListItem } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { DIFFICULTY_LABEL, KIND_LABEL } from "@/components/interviews/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";

const ANY = "any";

export function AskQuestionDialog({ interviewId, used, onAsked, onClose }: { interviewId: string; used: ReadonlySet<string>; onAsked: (asked: AskedQuestion) => void; onClose: () => void }) {
  const id = useId();
  const bank = useQuery({ queryKey: ["interview-questions"], queryFn: ({ signal }) => api<QuestionListItem[]>("/api/interview-questions", { signal }) });
  const [tab, setTab] = useState(bank.data?.length === 0 ? "write" : "bank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<QuestionKind | typeof ANY>(ANY);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | typeof ANY>(ANY);
  const [tag, setTag] = useState("");

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [writtenKind, setWrittenKind] = useState<QuestionKind>("coding");
  const [marks, setMarks] = useState(10);
  const [file, setFile] = useState("main.py");
  const [choices, setChoices] = useState([
    { id: "choice-1", text: "", correct: true },
    { id: "choice-2", text: "", correct: false },
  ]);

  const matching = (bank.data ?? []).filter((question) => {
    if (kind !== ANY && question.kind !== kind) return false;
    if (difficulty !== ANY && question.difficulty !== difficulty) return false;
    if (tag.trim() && !question.tags.includes(tag.trim().toLowerCase())) return false;
    return !search.trim() || question.title.toLowerCase().includes(search.trim().toLowerCase());
  });
  const drawable = matching.filter((question) => !used.has(question.id));

  async function ask(body: AskQuestionInput) {
    setBusy(true);
    setError(null);
    try {
      onAsked(await api<AskedQuestion>(`/api/interviews/${interviewId}/questions`, { method: "POST", json: body }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.detail : "It couldn't be asked. Try again.");
      setBusy(false);
    }
  }

  function askWritten(event: React.FormEvent) {
    event.preventDefault();
    const parsed = AdhocQuestion.safeParse({ kind: writtenKind, title, prompt, marks, file: writtenKind === "coding" ? file : "", choices: writtenKind === "mcq" ? choices : [] });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the question.");
    void ask({ adhoc: parsed.data });
  }

  const filters = (
    <div className="grid gap-2 sm:grid-cols-3">
      <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
        <SelectTrigger size="sm" className="w-full" aria-label="Kind"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any kind</SelectItem>
          {QUESTION_KINDS.map((value) => <SelectItem key={value} value={value}>{KIND_LABEL[value]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={difficulty} onValueChange={(value) => setDifficulty(value as typeof difficulty)}>
        <SelectTrigger size="sm" className="w-full" aria-label="Difficulty"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any difficulty</SelectItem>
          {QUESTION_DIFFICULTIES.map((value) => <SelectItem key={value} value={value}>{DIFFICULTY_LABEL[value]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input className="h-7" aria-label="Tag" placeholder="Tag" value={tag} onChange={(event) => setTag(event.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto shadow-none">
        <DialogHeader>
          <DialogTitle>Ask a question</DialogTitle>
          <DialogDescription>The candidate sees it as soon as you ask.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="bank">From the bank</TabsTrigger>
            <TabsTrigger value="random">At random</TabsTrigger>
            <TabsTrigger value="write">Write your own</TabsTrigger>
          </TabsList>

          <TabsContent value="bank" className="grid gap-2 pt-2">
            {filters}
            <Input className="h-7" aria-label="Search questions" placeholder="Search by title" value={search} onChange={(event) => setSearch(event.target.value)} />
            <ul className="grid max-h-64 gap-1 overflow-y-auto">
              {matching.length === 0 && <li className="p-2 text-muted-foreground">{bank.isPending ? "Loading…" : "Nothing matches."}</li>}
              {matching.map((question) => (
                <li key={question.id} className="flex items-center gap-2 rounded-sm border p-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{question.title}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{KIND_LABEL[question.kind]} · {DIFFICULTY_LABEL[question.difficulty]} · {question.marks} marks{question.tags.length ? ` · ${question.tags.join(", ")}` : ""}</span>
                  </span>
                  <Button size="xs" disabled={busy || used.has(question.id)} aria-label={`Ask ${question.title}`} onClick={() => void ask({ bankId: question.id })}>{used.has(question.id) ? "On the paper" : "Ask"}</Button>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="random" className="grid gap-2 pt-2">
            <p className="text-muted-foreground">One question they haven&apos;t had, drawn at random from these.</p>
            {filters}
            <p role="status" className="text-muted-foreground">{drawable.length} question{drawable.length === 1 ? "" : "s"} to draw from.</p>
            <DialogFooter>
              <Button
                size="sm"
                disabled={busy || drawable.length === 0}
                onClick={() => void ask({ random: { ...(kind !== ANY && { kind }), ...(difficulty !== ANY && { difficulty }), ...(tag.trim() && { tag: tag.trim() }) } })}
              >
                Draw and ask
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="write" className="pt-2">
            <form onSubmit={askWritten} className="grid gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-title`}>Title</Label>
                <Input id={`${id}-title`} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Reverse a linked list" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-prompt`}>What they read</Label>
                <Textarea id={`${id}-prompt`} rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Markdown works. Leave it short if you're explaining out loud." />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label>Kind</Label>
                  <Select value={writtenKind} onValueChange={(value) => setWrittenKind(value as QuestionKind)}>
                    <SelectTrigger size="sm" className="w-full" aria-label="Kind of question"><SelectValue /></SelectTrigger>
                    <SelectContent>{QUESTION_KINDS.map((value) => <SelectItem key={value} value={value}>{KIND_LABEL[value]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-marks`}>Marks</Label>
                  <Input id={`${id}-marks`} className="h-7" type="number" min={1} max={100} value={marks} onChange={(event) => setMarks(event.target.valueAsNumber)} />
                </div>
                {writtenKind === "coding" && (
                  <div className="grid gap-1">
                    <Label htmlFor={`${id}-file`}>File</Label>
                    <Input id={`${id}-file`} className="h-7 font-mono" value={file} onChange={(event) => setFile(event.target.value)} />
                  </div>
                )}
              </div>
              {writtenKind === "mcq" && (
                <div className="grid gap-1">
                  <Label>Choices (tick the right ones)</Label>
                  {choices.map((choice, index) => (
                    <div key={choice.id} className="flex items-center gap-1.5">
                      <Checkbox aria-label={`Choice ${index + 1} is right`} checked={choice.correct} onCheckedChange={(on) => setChoices(choices.map((other) => (other.id === choice.id ? { ...other, correct: on === true } : other)))} />
                      <Input className="h-7" aria-label={`Choice ${index + 1}`} value={choice.text} onChange={(event) => setChoices(choices.map((other) => (other.id === choice.id ? { ...other, text: event.target.value } : other)))} />
                      <Button type="button" size="icon-xs" variant="ghost" disabled={choices.length <= 2} aria-label={`Remove choice ${index + 1}`} onClick={() => setChoices(choices.filter((other) => other.id !== choice.id))}><Trash2 /></Button>
                    </div>
                  ))}
                  <Button type="button" size="xs" variant="outline" className="justify-self-start" disabled={choices.length >= 10} onClick={() => setChoices([...choices, { id: randomId().slice(0, 12), text: "", correct: false }])}><Plus /> Add a choice</Button>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" size="sm" disabled={busy}>Ask it</Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Toast when a bank question brought files: the candidate may need telling where to look. */
export function toldFiles(paths: readonly string[]): void {
  if (paths.length) toast.message(`Added to the room: ${paths.join(", ")}`);
}
