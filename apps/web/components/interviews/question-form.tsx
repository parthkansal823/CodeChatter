/** Add or edit a question of any kind: coding with starter files and tests, multiple choice, a short answer or a system design. */
"use client";

import { QUESTION_DIFFICULTIES, QUESTION_KINDS, QuestionInput, type QuestionDifficulty, type QuestionItem, type QuestionKind } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";

import { DIFFICULTY_LABEL, KIND_LABEL } from "./format";

type Draft = {
  kind: QuestionKind;
  difficulty: QuestionDifficulty;
  /** As typed: commas between tags. */
  tags: string;
  marks: number;
  choices: Array<{ id: string; text: string; correct: boolean }>;
  modelAnswer: string;
  title: string;
  prompt: string;
  file: string;
  starterFiles: Array<{ key: string; path: string; content: string }>;
  tests: Array<{ id: string; input: string; expected: string; hidden: boolean }>;
  rubric: Array<{ id: string; label: string }>;
  durationMinutes: number;
  timeLimitMs: number;
};

const shortId = () => randomId().slice(0, 12);

/**
 * A new question starts as a working example: one file, one visible test, one hidden, two
 * criteria. Fixed ids, because the server renders this too; rows added later get random ones.
 */
const blank = (): Draft => ({
  kind: "coding",
  difficulty: "medium",
  tags: "",
  marks: 10,
  choices: [
    { id: "choice-1", text: "", correct: true },
    { id: "choice-2", text: "", correct: false },
    { id: "choice-3", text: "", correct: false },
    { id: "choice-4", text: "", correct: false },
  ],
  modelAnswer: "",
  title: "",
  prompt: "",
  file: "main.py",
  starterFiles: [{ key: "file-1", path: "main.py", content: "# Read the input and print the answer.\n" }],
  tests: [
    { id: "test-1", input: "", expected: "", hidden: false },
    { id: "test-2", input: "", expected: "", hidden: true },
  ],
  rubric: [
    { id: "criterion-1", label: "Problem solving" },
    { id: "criterion-2", label: "Code quality" },
  ],
  durationMinutes: 60,
  timeLimitMs: 2000,
});

const fromItem = (item: QuestionItem): Draft => ({
  kind: item.kind,
  difficulty: item.difficulty,
  tags: item.tags.join(", "),
  marks: item.marks,
  choices: item.kind === "mcq" ? item.choices : blank().choices,
  modelAnswer: item.modelAnswer,
  title: item.title,
  prompt: item.prompt,
  file: item.file || "main.py",
  starterFiles: item.kind === "coding" ? item.starterFiles.map((file) => ({ ...file, key: shortId() })) : blank().starterFiles,
  tests: item.kind === "coding" ? item.tests : blank().tests,
  rubric: item.rubric,
  durationMinutes: item.durationMinutes,
  timeLimitMs: item.timeLimitMs,
});

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t pt-4">
      <div className="flex items-center gap-2">
        <div>
          <h2 className="font-medium">{title}</h2>
          {hint && <p className="text-muted-foreground">{hint}</p>}
        </div>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function QuestionForm({ question }: { question?: QuestionItem }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => (question ? fromItem(question) : blank()));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const paths = draft.starterFiles.map((file) => file.path).filter(Boolean);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const coding = draft.kind === "coding";
    const parsed = QuestionInput.safeParse({
      ...draft,
      tags: [...new Set(draft.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
      // Only what this kind uses, so switching kinds while writing leaves nothing behind.
      choices: draft.kind === "mcq" ? draft.choices.filter((choice) => choice.text.trim()) : [],
      modelAnswer: draft.kind === "short" || draft.kind === "design" ? draft.modelAnswer : "",
      file: coding ? draft.file : "",
      starterFiles: coding ? draft.starterFiles.map(({ path, content }) => ({ path, content })) : [],
      tests: coding ? draft.tests : [],
      rubric: draft.kind === "mcq" ? [] : draft.rubric,
    });
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await (question
        ? api(`/api/interview-questions/${question.id}`, { method: "PUT", json: parsed.data })
        : api("/api/interview-questions", { method: "POST", json: parsed.data }));
      await queryClient.invalidateQueries({ queryKey: ["interview-questions"] });
      if (question) await queryClient.invalidateQueries({ queryKey: ["interview-question", question.id] });
      toast.success(question ? "Question saved." : "Question added.");
      router.push("/interviews?tab=questions" as never);
    } catch (error) {
      setErrors([error instanceof ApiError ? error.detail : "The question couldn't be saved. Try again."]);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="grid max-w-3xl gap-4 px-6 py-6 sm:px-8">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input id={`${id}-title`} value={draft.title} maxLength={200} onChange={(event) => patch({ title: event.target.value })} placeholder={draft.kind === "design" ? "Design a URL shortener" : "Add two numbers"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="grid gap-1.5">
          <Label>Kind</Label>
          <Select value={draft.kind} onValueChange={(kind) => patch({ kind: kind as QuestionKind })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Kind of question"><SelectValue /></SelectTrigger>
            <SelectContent>{QUESTION_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{KIND_LABEL[kind]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Difficulty</Label>
          <Select value={draft.difficulty} onValueChange={(difficulty) => patch({ difficulty: difficulty as QuestionDifficulty })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Difficulty"><SelectValue /></SelectTrigger>
            <SelectContent>{QUESTION_DIFFICULTIES.map((difficulty) => <SelectItem key={difficulty} value={difficulty}>{DIFFICULTY_LABEL[difficulty]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-marks`}>Marks</Label>
          <Input id={`${id}-marks`} className="h-7" type="number" min={1} max={100} value={draft.marks} onChange={(event) => patch({ marks: event.target.valueAsNumber })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-tags`}>Tags, with commas</Label>
          <Input id={`${id}-tags`} className="h-7" value={draft.tags} onChange={(event) => patch({ tags: event.target.value })} placeholder="sql, backend" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-prompt`}>What the candidate reads</Label>
        <Textarea id={`${id}-prompt`} rows={8} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} placeholder="Describe the problem. Markdown works." />
      </div>

      {draft.kind === "mcq" && (
        <Section
          title="Choices"
          hint="Tick the right ones. With more than one, candidates are told to choose all that apply, and need them all. Their order is shuffled for each person."
          action={<Button type="button" size="sm" variant="outline" disabled={draft.choices.length >= 10} onClick={() => patch({ choices: [...draft.choices, { id: shortId(), text: "", correct: false }] })}><Plus /> Add a choice</Button>}
        >
          {draft.choices.map((choice, index) => {
            const update = (next: Partial<Draft["choices"][number]>) => patch({ choices: draft.choices.map((other) => (other.id === choice.id ? { ...other, ...next } : other)) });
            return (
              <div key={choice.id} className="flex items-center gap-2">
                <Checkbox aria-label={`Choice ${index + 1} is right`} checked={choice.correct} onCheckedChange={(on) => update({ correct: on === true })} />
                <Input aria-label={`Choice ${index + 1}`} className="h-7" value={choice.text} onChange={(event) => update({ text: event.target.value })} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove choice ${index + 1}`} disabled={draft.choices.length <= 2} onClick={() => patch({ choices: draft.choices.filter((other) => other.id !== choice.id) })}><Trash2 /></Button>
              </div>
            );
          })}
        </Section>
      )}

      {(draft.kind === "short" || draft.kind === "design") && (
        <Section
          title="What a good answer says"
          hint={draft.kind === "design" ? "For whoever marks it: components, trade-offs, scale. The candidate draws in the room's Diagrams or Board and explains in writing." : "For whoever marks it. The candidate never sees this."}
        >
          <Textarea aria-label="What a good answer says" rows={5} value={draft.modelAnswer} onChange={(event) => patch({ modelAnswer: event.target.value })} />
        </Section>
      )}

      {draft.kind === "coding" && (
        <>
      <Section
        title="Starter files"
        hint="The room starts with these. The tests run the file you pick."
        action={<Button type="button" size="sm" variant="outline" onClick={() => patch({ starterFiles: [...draft.starterFiles, { key: shortId(), path: "", content: "" }] })}><Plus /> Add a file</Button>}
      >
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label>The file the tests run</Label>
          <Select value={paths.includes(draft.file) ? draft.file : ""} onValueChange={(file) => patch({ file })}>
            <SelectTrigger size="sm" aria-label="The file the tests run"><SelectValue placeholder="Pick a file" /></SelectTrigger>
            <SelectContent>{[...new Set(paths)].map((path) => <SelectItem key={path} value={path}>{path}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {draft.starterFiles.map((file, index) => (
          <div key={file.key} className="grid gap-1.5 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`File ${index + 1} path`}
                className="h-7 font-mono"
                value={file.path}
                placeholder="main.py"
                onChange={(event) => {
                  const path = event.target.value;
                  patch({
                    starterFiles: draft.starterFiles.map((other) => (other.key === file.key ? { ...other, path } : other)),
                    ...(draft.file === file.path && { file: path }),
                  });
                }}
              />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${file.path || "this file"}`} disabled={draft.starterFiles.length === 1} onClick={() => patch({ starterFiles: draft.starterFiles.filter((other) => other.key !== file.key) })}><Trash2 /></Button>
            </div>
            <Textarea
              aria-label={`Contents of ${file.path || `file ${index + 1}`}`}
              rows={5}
              className="font-mono"
              spellCheck={false}
              value={file.content}
              onChange={(event) => patch({ starterFiles: draft.starterFiles.map((other) => (other.key === file.key ? { ...other, content: event.target.value } : other)) })}
            />
          </div>
        ))}
      </Section>

      <Section
        title="Tests"
        hint="Each gives the program an input and compares what it prints. Candidates only see whether hidden tests passed: never their input or output."
        action={<Button type="button" size="sm" variant="outline" disabled={draft.tests.length >= 30} onClick={() => patch({ tests: [...draft.tests, { id: shortId(), input: "", expected: "", hidden: true }] })}><Plus /> Add a test</Button>}
      >
        {draft.tests.length === 0 && <p className="text-muted-foreground">No tests. The interview still works, without Run tests.</p>}
        {draft.tests.map((test, index) => {
          const update = (next: Partial<Draft["tests"][number]>) => patch({ tests: draft.tests.map((other) => (other.id === test.id ? { ...other, ...next } : other)) });
          return (
            <div key={test.id} className="grid gap-1.5 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Test {index + 1}</span>
                <label className="ml-auto flex items-center gap-1.5">
                  <Checkbox checked={test.hidden} onCheckedChange={(checked) => update({ hidden: checked === true })} /> Hidden
                </label>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove test ${index + 1}`} onClick={() => patch({ tests: draft.tests.filter((other) => other.id !== test.id) })}><Trash2 /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label className="text-muted-foreground" htmlFor={`${id}-in-${test.id}`}>Input</Label>
                  <Textarea id={`${id}-in-${test.id}`} rows={3} className="font-mono" spellCheck={false} value={test.input} onChange={(event) => update({ input: event.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-muted-foreground" htmlFor={`${id}-out-${test.id}`}>Expected output</Label>
                  <Textarea id={`${id}-out-${test.id}`} rows={3} className="font-mono" spellCheck={false} value={test.expected} onChange={(event) => update({ expected: event.target.value })} />
                </div>
              </div>
            </div>
          );
        })}
      </Section>

        </>
      )}

      {draft.kind !== "mcq" && (
      <Section
        title="Scoring criteria"
        hint="What you'll score from 1 to 5. Only interviewers see these."
        action={<Button type="button" size="sm" variant="outline" disabled={draft.rubric.length >= 20} onClick={() => patch({ rubric: [...draft.rubric, { id: shortId(), label: "" }] })}><Plus /> Add a criterion</Button>}
      >
        {draft.rubric.map((criterion, index) => (
          <div key={criterion.id} className="flex items-center gap-2">
            <Input aria-label={`Criterion ${index + 1}`} className="h-7" value={criterion.label} maxLength={200} onChange={(event) => patch({ rubric: draft.rubric.map((other) => (other.id === criterion.id ? { ...other, label: event.target.value } : other)) })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove criterion ${index + 1}`} onClick={() => patch({ rubric: draft.rubric.filter((other) => other.id !== criterion.id) })}><Trash2 /></Button>
          </div>
        ))}
      </Section>

      )}

      {draft.kind === "coding" && (
      <Section title="Time">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-minutes`}>Interview length, minutes</Label>
            <Input id={`${id}-minutes`} type="number" min={5} max={480} value={draft.durationMinutes} onChange={(event) => patch({ durationMinutes: event.target.valueAsNumber })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-limit`}>Time limit per test, seconds</Label>
            <Input id={`${id}-limit`} type="number" min={0.5} max={20} step={0.5} value={draft.timeLimitMs / 1000} onChange={(event) => patch({ timeLimitMs: Math.round(event.target.valueAsNumber * 1000) })} />
          </div>
        </div>
      </Section>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-destructive">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="flex gap-2 border-t pt-4">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : question ? "Save question" : "Add question"}</Button>
        <Button type="button" size="sm" variant="ghost" asChild><Link href={"/interviews?tab=questions" as never}>Cancel</Link></Button>
      </div>
    </form>
  );
}
