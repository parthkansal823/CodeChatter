"use client";

import { runnableLanguage, type JudgeEvent, type JudgeVerdict } from "@codechatter/contracts";
import { randomId, type TreeNode } from "@codechatter/workspace-model";
import { Download, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Case = { id: string; input: string; expected: string };
type Result = { verdict: JudgeVerdict | "running"; stdout?: string; stderr?: string; timeMs?: number; exitCode?: number | null };

const VERDICT: Record<Result["verdict"], { label: string; className: string }> = {
  passed: { label: "Passed", className: "text-success" },
  failed: { label: "Wrong answer", className: "text-destructive" },
  error: { label: "Runtime error", className: "text-destructive" },
  timeout: { label: "Time limit", className: "text-warning" },
  ran: { label: "Ran", className: "text-muted-foreground" },
  running: { label: "Running…", className: "text-muted-foreground" },
};

/**
 * A file's test cases live in the room's files document (map "tests", keyed
 * by file id), so everyone in the room sees and edits the same tests.
 */
function useCases(doc: Y.Doc, fileId: string) {
  const tests = doc.getMap<Y.Array<Y.Map<string>>>("tests");
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current += 1;
        onChange();
      };
      tests.observeDeep(handler);
      return () => tests.unobserveDeep(handler);
    },
    [tests],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  const cases = useMemo<Case[]>(
    () => (tests.get(fileId)?.toArray() ?? []).map((m) => ({ id: m.get("id") ?? "", input: m.get("input") ?? "", expected: m.get("expected") ?? "" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tests, fileId, tick],
  );
  const list = () => {
    let array = tests.get(fileId);
    if (!array) {
      array = new Y.Array<Y.Map<string>>();
      tests.set(fileId, array);
    }
    return array;
  };
  return {
    cases,
    add: (input = "", expected = "") =>
      doc.transact(() => {
        const entry = new Y.Map<string>();
        entry.set("id", randomId());
        entry.set("input", input);
        entry.set("expected", expected);
        list().push([entry]);
      }),
    update: (id: string, field: "input" | "expected", value: string) => {
      const array = tests.get(fileId);
      array?.toArray().find((m) => m.get("id") === id)?.set(field, value);
    },
    remove: (id: string) => {
      const array = tests.get(fileId);
      const index = array?.toArray().findIndex((m) => m.get("id") === id) ?? -1;
      if (array && index >= 0) array.delete(index, 1);
    },
  };
}

/** Streams NDJSON events from the judge endpoint. */
async function* judgeStream(roomId: string, body: unknown): AsyncGenerator<JudgeEvent> {
  const response = await fetch(`/api/rooms/${roomId}/judge`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    yield { type: "error", message: problem?.detail ?? "The tests couldn't start." };
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) yield JSON.parse(line) as JudgeEvent;
    }
  }
}

/**
 * Competitive-programming helper for the open file: shared test cases,
 * Run tests (compile once, every case with a time limit), custom input, and
 * sample import from Codeforces, AtCoder or CSES.
 */
export function TestsPanel({ file }: { file: TreeNode | null }) {
  const { room, doc, can } = useRoom();
  const runnable = file ? Boolean(runnableLanguage(file.path)) : false;
  if (!file || !runnable) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Open a Python, JavaScript, TypeScript, C, C++, Java or Bash file to add test cases for it.
      </p>
    );
  }
  return <FileTests key={file.id} file={file} roomId={room.id} doc={doc} canEdit={can("files.edit")} canRun={can("code.run")} />;
}

function FileTests({ file, roomId, doc, canEdit, canRun }: { file: TreeNode; roomId: string; doc: Y.Doc; canEdit: boolean; canRun: boolean }) {
  const { cases, add, update, remove } = useCases(doc, file.id);
  const [timeLimit, setTimeLimit] = useState("2000");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [compileError, setCompileError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [custom, setCustom] = useState("");
  const [customResult, setCustomResult] = useState<Result | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const stateVector = () => btoa(String.fromCharCode(...Y.encodeStateVector(doc)));

  async function run(targets: Array<{ key: string; input: string; expected?: string }>, onResult: (key: string, result: Result) => void) {
    setRunning(true);
    setCompileError(null);
    targets.forEach((t) => onResult(t.key, { verdict: "running" }));
    try {
      const body = {
        path: file.path,
        stateVector: stateVector(),
        timeLimitMs: Number(timeLimit),
        cases: targets.map((t) => (t.expected === undefined ? { input: t.input } : { input: t.input, expected: t.expected })),
      };
      for await (const event of judgeStream(roomId, body)) {
        if (event.type === "case") {
          const target = targets[event.index];
          if (target) onResult(target.key, { verdict: event.verdict, stdout: event.stdout, stderr: event.stderr, timeMs: event.timeMs, exitCode: event.exitCode });
        } else if (event.type === "compile-error") {
          setCompileError(event.output || "The compiler reported an error.");
          targets.forEach((t) => onResult(t.key, { verdict: "error" }));
        } else if (event.type === "error") {
          toast.error(event.message);
        }
      }
    } catch {
      toast.error("Couldn't reach the sandbox. Try again.");
    } finally {
      setRunning(false);
    }
  }

  const runAll = () => {
    setResults({});
    void run(
      cases.map((c) => ({ key: c.id, input: c.input, expected: c.expected })),
      (key, result) => setResults((all) => ({ ...all, [key]: result })),
    );
  };

  const runCustom = () => void run([{ key: "custom", input: custom }], (_key, result) => setCustomResult(result));

  async function importSamples() {
    setImporting(true);
    try {
      const problem = await api<{ title: string; samples: Array<{ input: string; output: string }> }>("/api/judge/import", {
        method: "POST",
        json: { url: importUrl },
      });
      doc.transact(() => problem.samples.forEach((s) => add(s.input, s.output)));
      toast.success(`Imported ${problem.samples.length} sample${problem.samples.length === 1 ? "" : "s"} from ${problem.title}`);
      setImportUrl("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Couldn't import from that link.");
    } finally {
      setImporting(false);
    }
  }

  const judged = cases.filter((c) => results[c.id] && results[c.id]!.verdict !== "running");
  const passed = judged.filter((c) => results[c.id]!.verdict === "passed").length;

  return (
    <section aria-label="Test cases" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{file.path}</span>
        {judged.length > 0 && (
          <span className={cn("text-xs font-medium tabular-nums", passed === judged.length ? "text-success" : "text-destructive")}>
            {passed}/{judged.length} passed
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={timeLimit} onValueChange={setTimeLimit}>
            <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label="Time limit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["1000", "2000", "5000", "10000"].map((ms) => (
                <SelectItem key={ms} value={ms} className="text-xs">
                  {Number(ms) / 1000} s limit
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canEdit && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="xs" variant="ghost">
                  <Download /> Import samples
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void importSamples();
                  }}
                  className="grid gap-2"
                >
                  <p className="text-sm font-medium">Import sample tests</p>
                  <p className="text-xs text-muted-foreground">Paste a problem link from Codeforces, AtCoder or CSES.</p>
                  <Input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://codeforces.com/contest/4/problem/A" aria-label="Problem link" />
                  <Button type="submit" size="sm" disabled={!importUrl.trim() || importing}>
                    {importing && <Loader2 className="animate-spin" />} Import
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          )}
          {canEdit && (
            <Button size="xs" variant="ghost" onClick={() => add()}>
              <Plus /> Add test
            </Button>
          )}
          {canRun && (
            <Button size="xs" variant="brand" disabled={running || cases.length === 0} onClick={runAll}>
              {running ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} Run tests
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {compileError && (
          <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <p className="mb-1 text-xs font-medium text-destructive">Compile error</p>
            <pre className="max-h-40 overflow-auto font-mono text-2xs whitespace-pre-wrap">{compileError}</pre>
          </div>
        )}

        {cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tests for this file yet. {canEdit ? "Add one, or import the samples from a problem link." : "Someone with edit access can add them."}
          </p>
        ) : (
          <ol className="grid gap-3">
            {cases.map((c, i) => {
              const result = results[c.id];
              return (
                <li key={c.id} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
                    <span className="font-medium">Test {i + 1}</span>
                    {result && (
                      <span className={cn("font-medium", VERDICT[result.verdict].className)}>
                        {VERDICT[result.verdict].label}
                        {result.timeMs !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{result.timeMs} ms</span>}
                      </span>
                    )}
                    {canEdit && (
                      <button type="button" aria-label={`Delete test ${i + 1}`} onClick={() => remove(c.id)} className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className={cn("grid gap-px bg-border", result?.stdout !== undefined ? "grid-cols-3" : "grid-cols-2")}>
                    <CaseText label="Input" value={c.input} readOnly={!canEdit} onChange={(v) => update(c.id, "input", v)} />
                    <CaseText label="Expected output" value={c.expected} readOnly={!canEdit} onChange={(v) => update(c.id, "expected", v)} />
                    {result?.stdout !== undefined && (
                      <CaseText
                        label="Your output"
                        value={result.stdout + (result.stderr ? `\n${result.stderr}` : "")}
                        readOnly
                        tone={result.verdict === "passed" ? "success" : result.verdict === "ran" ? undefined : "destructive"}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {canRun && (
          <section className="mt-5">
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Custom input</h3>
              <Button size="xs" variant="outline" className="ml-auto" disabled={running} onClick={runCustom}>
                <Play className="fill-current" /> Run with input
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border">
              <CaseText label="Input" value={custom} onChange={setCustom} />
              <CaseText
                label={customResult ? `Output${customResult.timeMs !== undefined ? ` (${customResult.timeMs} ms)` : ""}` : "Output"}
                value={customResult ? (customResult.verdict === "running" ? "Running…" : `${customResult.stdout ?? ""}${customResult.stderr ? `\n${customResult.stderr}` : ""}`) : ""}
                readOnly
                tone={customResult && (customResult.verdict === "error" || customResult.verdict === "timeout") ? "destructive" : undefined}
              />
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function CaseText({ label, value, onChange, readOnly, tone }: { label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean; tone?: "success" | "destructive" }) {
  return (
    <label className="flex min-w-0 flex-col bg-background">
      <span className={cn("px-2 pt-1 text-2xs text-muted-foreground", tone === "success" && "text-success", tone === "destructive" && "text-destructive")}>{label}</span>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        spellCheck={false}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        className="w-full resize-y bg-transparent px-2 pb-1.5 font-mono text-xs outline-none"
      />
    </label>
  );
}
