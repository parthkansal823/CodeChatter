/** The Prompt Playground: a prompt the room writes together, tried on several models and settings side by side, with tokens and speed for each, and its last runs kept. */
"use client";

import { PROMPT_LIMITS, promptVariables, type AiPromptModels, type AiStatus } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FlaskConical, Loader2, Play, Plus, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { useRoomDoc, useYVersion } from "@/components/room/tools/api-studio/connection";
import { AiMarkdown } from "@/components/room/tools/ai/ai-markdown";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { EvalsView } from "./evals-view";
import {
  addColumn,
  addMessage,
  addRun,
  CODE_LANGUAGES,
  createPrompt,
  deletePrompt,
  ensureValue,
  isValidJson,
  MOST_COLUMNS,
  nextColumn,
  promptAsCode,
  promptsOf,
  readColumns,
  readMessages,
  readPrompts,
  readPromptText,
  readRuns,
  removeColumn,
  removeMessage,
  renamePrompt,
  renderedPrompt,
  restorePrompt,
  samePrompt,
  setMessageRole,
  systemOf,
  tokensPerSecond,
  updateColumn,
  usedValues,
  valueText,
  whyNotRunnable,
  type CodeLanguage,
  type ColumnResult,
  type PromptColumn,
  type PromptRole,
  type PromptRun,
  type PromptText,
} from "./model";
import { Field } from "./prompt-field";
import { TracesView } from "./traces-view";
import { usePromptRun } from "./use-prompt-run";

type Node = Y.Map<unknown>;

const SMALL = "h-6 rounded-sm border bg-background px-1 text-xs disabled:opacity-70";

const seconds = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const tokens = (result: ColumnResult) => (result.usage ? (result.usage.estimated ? "about " : "") + `${result.usage.inputTokens.toLocaleString()} in, ${result.usage.outputTokens.toLocaleString()} out` : null);
const settingsOf = (column: PromptColumn) =>
  [column.model, column.temperature !== null && `temperature ${column.temperature}`, column.maxTokens !== null && `at most ${column.maxTokens} tokens`, column.json && "JSON"].filter(Boolean).join(", ");

function PromptEditor({ node, editable, version, onRun }: { node: Node; editable: boolean; version: number; onRun: () => void }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` moves when anything in the prompt does
  const messages = useMemo(() => readMessages(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prompt = useMemo(() => readPromptText(node), [node, version]);
  const variables = promptVariables([prompt.system, ...prompt.messages.map((message) => message.content)]);
  const empty = variables.filter((name) => !prompt.values[name]);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 content-start gap-2">
        <div className="grid gap-1">
          <span className="text-xs font-medium">System</span>
          <Field text={systemOf(node)} label="System prompt" editable={editable} rows={2} placeholder="What the model should always do. You can leave this empty." onRun={onRun} />
        </div>
        {messages.map((message, index) => (
          <div key={message.id} className="grid gap-1">
            <div className="flex items-center gap-1">
              <select
                aria-label={`Who says message ${index + 1}`}
                value={message.role}
                disabled={!editable}
                onChange={(event) => setMessageRole(node, message.id, event.target.value as PromptRole)}
                className={SMALL}
              >
                <option value="user">User</option>
                <option value="assistant">Assistant</option>
              </select>
              {editable && messages.length > 1 && (
                <Button size="icon-xs" variant="ghost" aria-label={`Remove message ${index + 1}`} title="Remove this message" onClick={() => removeMessage(node, message.id)}>
                  <X />
                </Button>
              )}
            </div>
            <Field text={message.text} label={`Message ${index + 1}`} editable={editable} rows={3} placeholder={message.role === "user" ? "What's asked. {{name}} makes a variable." : "An example answer, to show the model what you want."} onRun={onRun} />
          </div>
        ))}
        {editable && (
          <div>
            <Button size="xs" variant="ghost" onClick={() => addMessage(node)}>
              <Plus /> Add a message
            </Button>
          </div>
        )}
      </div>
      <section aria-label="Variables" className="grid min-w-0 content-start gap-2">
        <span className="text-xs font-medium">Variables</span>
        {variables.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Write <code className="font-mono">{"{{topic}}"}</code> in the prompt to make one, then try the prompt with different values.
          </p>
        )}
        {variables.map((name) => (
          <label key={name} className="grid gap-1">
            <span className="font-mono text-xs">{name}</span>
            <Field text={valueText(node, name)} label={`Value of ${name}`} editable={editable} rows={2} onRun={onRun} onFocus={() => void (editable && ensureValue(node, name))} />
          </label>
        ))}
        {empty.length > 0 && <p className="text-xs text-brand-text">No value yet for {empty.join(", ")}, so it goes as it&apos;s written.</p>}
      </section>
    </div>
  );
}

function Metrics({ result }: { result: ColumnResult }) {
  const speed = tokensPerSecond(result);
  const parts = [
    result.firstMs !== null && `${seconds(result.firstMs)} to the first word`,
    result.totalMs !== null && `${seconds(result.totalMs)} in all`,
    tokens(result),
    speed !== null && `${speed.toFixed(speed < 10 ? 1 : 0)} tokens a second`,
  ].filter(Boolean);
  const said: Partial<Record<ColumnResult["status"], string>> = {
    cut: "It hit the token limit, so the answer stops short.",
    refused: "The model refused.",
    stopped: "Stopped.",
  };
  return (
    <div className="grid gap-0.5 border-t px-2 py-1.5 text-xs text-muted-foreground">
      {parts.length > 0 && <p className="tabular-nums">{parts.join(" · ")}</p>}
      {result.usage?.estimated && <p>The server didn&apos;t report tokens, so these are counted from the characters.</p>}
      {said[result.status] && <p className="text-brand-text">{said[result.status]}</p>}
      {result.status === "done" && result.column.json && <p className={isValidJson(result.text) ? undefined : "text-destructive"}>{isValidJson(result.text) ? "Valid JSON." : "Not valid JSON."}</p>}
      {result.shortened && <p>Only the start of this answer was kept.</p>}
    </div>
  );
}

function Answer({ result, formatted }: { result: ColumnResult | null; formatted: boolean }) {
  const busy = result?.status === "running" || result?.status === "waiting";
  return (
    <>
      <div tabIndex={0} role="group" aria-label="Answer" aria-busy={busy} className="max-h-[32rem] min-h-28 flex-1 overflow-auto px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {!result && <p className="text-xs text-muted-foreground">Nothing yet. Press Run.</p>}
        {result?.status === "waiting" && <p className="text-xs text-muted-foreground">Waiting its turn: the models here share one machine.</p>}
        {result?.status === "running" && !result.text && <p className="animate-pulse text-xs text-muted-foreground">Waiting for the first word…</p>}
        {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
        {result?.text && (formatted ? <AiMarkdown text={result.text} applyBlocked={null} /> : <p className="font-mono text-xs leading-5 break-words whitespace-pre-wrap">{result.text}</p>)}
      </div>
      {result && !busy && <Metrics result={result} />}
    </>
  );
}

function NumberField({ label, value, min, max, step, disabled, onChange }: { label: string; value: number | null; min: number; max: number; step: number; disabled: boolean; onChange: (next: number | null) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder="Default"
        disabled={disabled}
        className={cn(SMALL, "w-16 text-foreground tabular-nums")}
        onChange={(event) => {
          const next = event.target.value === "" ? null : Number(event.target.value);
          onChange(next === null || Number.isNaN(next) ? null : Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

function Column({ node, column, index, count, result, models, editable, formatted }: { node: Node; column: PromptColumn; index: number; count: number; result: ColumnResult | null; models: AiPromptModels | undefined; editable: boolean; formatted: boolean }) {
  const offered = models?.models ?? [];
  const changed = result && settingsOf(result.column) !== settingsOf(column);
  return (
    <section aria-label={`Column ${index + 1}`} className="flex min-w-0 flex-col rounded-md border">
      <div className="grid gap-1 border-b bg-chrome px-2 py-1.5">
        <div className="flex items-center gap-1">
          <select aria-label={`Model in column ${index + 1}`} value={column.model} disabled={!editable} onChange={(event) => updateColumn(node, column.id, { model: event.target.value })} className={cn(SMALL, "min-w-0 flex-1 font-mono")}>
            {!offered.includes(column.model) && <option value={column.model}>{column.model} (not offered here)</option>}
            {offered.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {editable && count > 1 && (
            <Button size="icon-xs" variant="ghost" aria-label={`Remove column ${index + 1}`} title="Remove this column" onClick={() => removeColumn(node, column.id)}>
              <X />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {models?.temperature !== false && <NumberField label="Temperature" value={column.temperature} min={0} max={2} step={0.1} disabled={!editable} onChange={(temperature) => updateColumn(node, column.id, { temperature })} />}
          <NumberField label="Max tokens" value={column.maxTokens} min={1} max={PROMPT_LIMITS.maxTokens} step={100} disabled={!editable} onChange={(maxTokens) => updateColumn(node, column.id, { maxTokens: maxTokens === null ? null : Math.round(maxTokens) })} />
          {models?.json !== false && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={column.json} disabled={!editable} onChange={(event) => updateColumn(node, column.id, { json: event.target.checked })} />
              JSON
            </label>
          )}
        </div>
      </div>
      {changed && <p className="border-b px-2 py-1 text-xs text-muted-foreground">This answer is from before the settings changed: {settingsOf(result.column)}.</p>}
      <Answer result={result} formatted={formatted} />
    </section>
  );
}

/** What was sent in an earlier run. */
function EarlierPrompt({ run }: { run: PromptRun }) {
  const values = Object.entries(usedValues(run));
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">The prompt in that run</summary>
      <div className="mt-1 grid gap-1 rounded-md border p-2 font-mono break-words whitespace-pre-wrap">
        {run.system && (
          <p>
            <span className="text-muted-foreground">System: </span>
            {run.system}
          </p>
        )}
        {run.messages.map((message, index) => (
          <p key={index}>
            <span className="text-muted-foreground capitalize">{message.role}: </span>
            {message.content}
          </p>
        ))}
        {values.map(([name, value]) => (
          <p key={name}>
            <span className="text-muted-foreground">{name} = </span>
            {value}
          </p>
        ))}
      </div>
    </details>
  );
}

function RunList({ runs, current, open, onOpen }: { runs: PromptRun[]; current: PromptText; open: string | null; onOpen: (id: string) => void }) {
  return (
    <section aria-label="Runs" className="grid gap-1">
      <h3 className="text-xs font-medium">Runs</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">This prompt&apos;s last runs, newest first</caption>
          <thead className="bg-chrome">
            <tr>
              {["When", "Who", "Tried on", "Tokens out", "Longest", "Prompt"].map((name) => (
                <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className={cn(open === run.id && "bg-accent")}>
                <td className="border-b px-2 py-1 whitespace-nowrap last:border-b-0">
                  <button type="button" className="min-h-6 rounded-sm tabular-nums underline-offset-2 hover:underline" aria-pressed={open === run.id} onClick={() => onOpen(run.id)}>
                    {clock(run.at)}
                  </button>
                </td>
                <td className="border-b px-2 py-1 whitespace-nowrap">{run.by}</td>
                <td className="border-b px-2 py-1 font-mono">{[...new Set(run.results.map((result) => result.column.model))].join(", ")}</td>
                <td className="border-b px-2 py-1 tabular-nums">{run.results.map((result) => result.usage?.outputTokens ?? "–").join(" / ")}</td>
                <td className="border-b px-2 py-1 tabular-nums whitespace-nowrap">{seconds(Math.max(0, ...run.results.map((result) => result.totalMs ?? 0)))}</td>
                <td className="border-b px-2 py-1 whitespace-nowrap text-muted-foreground">{samePrompt(run, current) ? "As it is now" : "Different"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The prompt as code that runs in this room's sandbox: the AI gateway means it needs no key. */
function FromCode({ prompt, column, gateway }: { prompt: PromptText; column: PromptColumn; gateway: AiPromptModels["gateway"] }) {
  const [language, setLanguage] = useState<CodeLanguage>("Python");
  const [copied, setCopied] = useState(false);
  const code = promptAsCode(prompt, column, language);
  const minutes = Math.round(gateway.windowSeconds / 60);
  return (
    <section aria-label="Use it from code" className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="mr-1 text-xs font-medium">Use it from code</h3>
        {CODE_LANGUAGES.map((name) => (
          <Button key={name} size="xs" variant={language === name ? "secondary" : "ghost"} aria-pressed={language === name} onClick={() => setLanguage(name)}>
            {name}
          </Button>
        ))}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre tabIndex={0} role="group" aria-label={`The prompt as ${language}`} className="max-h-72 overflow-auto rounded-md border bg-chrome p-2 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {code}
      </pre>
      <p className="text-xs text-muted-foreground">
        It runs in this room&apos;s terminals and Run with no key: the address is already set as <code className="font-mono">OPENAI_BASE_URL</code>, so any tool that speaks OpenAI&apos;s format works. The real key stays on the server. The room&apos;s code can make {gateway.requests} requests every {minutes} minutes. To install <code className="font-mono">openai</code>, turn on package installs in the Ports panel.
      </p>
    </section>
  );
}

function PromptView({ doc, id, models, onDeleted }: { doc: Y.Doc; id: string; models: AiPromptModels | undefined; onDeleted: () => void }) {
  const { room, me, can } = useRoom();
  const editable = can("files.edit");
  const runner = usePromptRun(room.id);
  const node = promptsOf(doc).get(id)!;
  const version = useYVersion(promptsOf(doc));
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [localRun, setLocalRun] = useState<PromptRun | null>(null);
  const [formatted, setFormatted] = useState(false);
  const [view, setView] = useState<"answers" | "evals">("answers");
  const [deleting, setDeleting] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` moves when anything in the prompt does
  const columns = useMemo(() => readColumns(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => readRuns(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prompt = useMemo(() => readPromptText(node), [node, version]);
  // Someone who can't edit the prompt can still try it: their run is only theirs.
  const runs = localRun ? [localRun, ...saved] : saved;
  const earlier = openRun ? (runs.find((run) => run.id === openRun) ?? null) : null;
  const latest = runs[0] ?? null;
  const blocked = whyNotRunnable(prompt, columns);
  const rendered = renderedPrompt(prompt);
  const length = rendered.system.length + rendered.messages.reduce((sum, message) => sum + message.content.length, 0);

  const run = async () => {
    if (runner.running || blocked || !can("room.chat")) return;
    const sent = readPromptText(node);
    const results = await runner.start(renderedPrompt(sent), readColumns(node), models?.oneAtATime ?? false);
    if (!results || !results.some((result) => result.text || result.error)) return;
    const record: PromptRun = { ...sent, id: randomId(), at: Date.now(), by: me.user.name, results };
    setOpenRun(null);
    if (!editable) setLocalRun(record);
    else if (!doc.isDestroyed && promptsOf(doc).get(id) === node) addRun(node, record);
  };

  const resultFor = (column: PromptColumn): ColumnResult | null => runner.live?.[column.id] ?? latest?.results.find((result) => result.column.id === column.id) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <Input aria-label="Prompt name" value={String(node.get("name") ?? "")} disabled={!editable} maxLength={80} className="h-6 w-44 min-w-0 flex-1 text-xs sm:flex-none" onChange={(event) => renamePrompt(node, event.target.value)} />
        {editable && !deleting && (
          <Button size="icon-xs" variant="ghost" aria-label="Delete this prompt" title="Delete this prompt" onClick={() => setDeleting(true)}>
            <Trash2 />
          </Button>
        )}
        {deleting && (
          <span className="flex items-center gap-1 text-xs">
            Delete it and its runs, for everyone?
            <Button
              size="xs"
              variant="destructive"
              onClick={() => {
                runner.stop();
                deletePrompt(doc, id);
                onDeleted();
              }}
            >
              Delete
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDeleting(false)}>
              Keep
            </Button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {blocked && !runner.running && <span className="text-xs text-muted-foreground">{blocked}</span>}
          {runner.running ? (
            <Button size="xs" variant="outline" onClick={runner.stop}>
              <Square /> Stop
            </Button>
          ) : (
            <Button size="xs" disabled={Boolean(blocked) || !models?.default} title="Run (Ctrl+Enter)" onClick={() => void run()}>
              <Play /> Run
            </Button>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-auto p-3">
        <PromptEditor node={node} editable={editable} version={version} onRun={() => void run()} />
        {models?.oneAtATime && length > models.contextChars && (
          <p className="text-xs text-brand-text">This prompt is longer than this server&apos;s AI context setting ({models.contextChars.toLocaleString()} characters), so a local model may lose its start without saying so.</p>
        )}
        {!editable && <p className="text-xs text-muted-foreground">You can try this prompt, but your role in this room can&apos;t change it, and your runs aren&apos;t kept.</p>}

        <div role="group" aria-label="What to do with this prompt" className="flex items-center gap-1 border-b pb-1.5">
          {(
            [
              ["answers", "Try it"],
              ["evals", "Test it"],
            ] as const
          ).map(([name, label]) => (
            <Button key={name} size="xs" variant={view === name ? "secondary" : "ghost"} aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </Button>
          ))}
        </div>

        {view === "evals" && <EvalsView node={node} models={models} version={version} />}

        {view === "answers" && (
        <section aria-label="Answers" className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium">{earlier ? `The run at ${clock(earlier.at)} by ${earlier.by}` : "Answers"}</h3>
            {runner.running && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />}
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={formatted} onChange={(event) => setFormatted(event.target.checked)} />
                Formatted
              </label>
              {earlier && (
                <>
                  {editable && !samePrompt(earlier, prompt) && (
                    <Button size="xs" variant="outline" onClick={() => restorePrompt(node, earlier)}>
                      Use this prompt
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => setOpenRun(null)}>
                    Back to the latest
                  </Button>
                </>
              )}
              {!earlier && editable && columns.length < MOST_COLUMNS && (
                <Button size="xs" variant="ghost" onClick={() => addColumn(node, nextColumn(columns, models?.models ?? [], models?.default ?? ""))}>
                  <Plus /> Add a column
                </Button>
              )}
            </div>
          </div>
          {earlier && <EarlierPrompt run={earlier} />}
          {earlier ? (
            <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-2 overflow-x-auto">
              {earlier.results.map((result, index) => (
                <section key={result.column.id} aria-label={`Column ${index + 1}`} className="flex min-w-0 flex-col rounded-md border">
                  <p className="border-b bg-chrome px-2 py-1.5 font-mono text-xs break-words">{settingsOf(result.column)}</p>
                  <Answer result={result} formatted={formatted} />
                </section>
              ))}
            </div>
          ) : (
            <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-2 overflow-x-auto">
              {columns.map((column, index) => (
                <Column key={column.id} node={node} column={column} index={index} count={columns.length} result={resultFor(column)} models={models} editable={editable && !runner.running} formatted={formatted} />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {models?.oneAtATime ? "Columns run one after another, so each gets the machine to itself and their speeds can be compared." : "Columns run together."} Each column counts as one request against your AI limit. Closing this tool stops a run.
          </p>
        </section>
        )}

        {view === "answers" && models?.gateway?.on && columns[0] && <FromCode prompt={prompt} column={columns[0]} gateway={models.gateway} />}

        {view === "answers" && runs.length > 0 && <RunList runs={runs} current={prompt} open={openRun} onOpen={(runId) => setOpenRun((open) => (open === runId ? null : runId))} />}
      </div>
    </div>
  );
}

function Workspace({ doc, models, problem, close }: { doc: Y.Doc; models: AiPromptModels | undefined; problem: string | null; close: () => void }) {
  const { can } = useRoom();
  const editable = can("files.edit");
  const version = useYVersion(promptsOf(doc));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` moves when the list does
  const prompts = useMemo(() => readPrompts(doc), [doc, version]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = prompts.find((prompt) => prompt.id === selected)?.id ?? prompts[0]?.id ?? null;

  const newPrompt = () => {
    const name = `Prompt ${prompts.length + 1}`;
    setSelected(
      createPrompt(doc, {
        name,
        system: "You are a helpful assistant. Keep answers short.",
        messages: [{ role: "user", content: "Explain {{topic}} to a beginner." }],
        values: { topic: "recursion" },
        columns: [{ id: randomId(), model: models?.default ?? "", temperature: null, maxTokens: null, json: false }],
      }),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {current && (
        <nav aria-label="Prompts in this room" className="flex shrink-0 gap-1 overflow-x-auto border-b p-1.5 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              aria-current={prompt.id === current ? "true" : undefined}
              title={prompt.name}
              className={cn("min-h-6 shrink-0 truncate rounded-sm px-2 text-left text-xs hover:bg-accent md:w-full", prompt.id === current && "bg-accent font-medium")}
              onClick={() => setSelected(prompt.id)}
            >
              {prompt.name || "Untitled"}
            </button>
          ))}
          {editable && (
            <Button size="xs" variant="ghost" className="shrink-0 justify-start" disabled={!models} onClick={newPrompt}>
              <Plus /> New prompt
            </Button>
          )}
        </nav>
      )}
      {current ? (
        <PromptView key={current} doc={doc} id={current} models={models} onDeleted={() => setSelected(null)} />
      ) : (
        <div className="grid flex-1 content-start gap-2 overflow-auto p-4">
          <h3 className="font-medium">Try a prompt on several models, side by side</h3>
          <p className="max-w-prose text-xs text-muted-foreground">Write a prompt together, with variables for the parts that change. Run it, and each column shows its model&apos;s answer with the tokens it used and how fast it wrote. Every run is kept here, with the prompt it used, so you can see what made an answer better and go back to it.</p>
          {editable ? (
            <div>
              <Button size="xs" disabled={!models} onClick={newPrompt}>
                <Plus /> New prompt
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nobody has written one in this room yet.</p>
          )}
          <div>
            <Button size="xs" variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      )}
      {problem && <p className="sr-only">{problem}</p>}
    </div>
  );
}

export default function PromptsTool({ close }: RoomToolProps) {
  const { room, me } = useRoom();
  const connection = useRoomDoc(room.id, "prompts", me.user);
  const models = useQuery({ queryKey: ["ai-prompt-models", room.id], queryFn: () => api<AiPromptModels>(`/api/rooms/${room.id}/ai/models`), staleTime: 30_000 });
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/api/ai/status"), staleTime: 60_000 });
  const off = status.data && !status.data.configured ? status.data.problem : null;
  const [view, setView] = useState<"prompts" | "calls">("prompts");
  return (
    // Ctrl+Enter runs the prompt here, not the room's open file.
    <section aria-label="Prompts" data-own-run-key className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <FlaskConical className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Prompts</h2>
        {models.data?.default && <span className="truncate font-mono text-xs text-muted-foreground">{models.data.models.length === 1 ? models.data.default : `${models.data.models.length} models`}</span>}
        <div role="group" aria-label="What to look at" className="ml-auto flex items-center gap-1">
          <Button size="xs" variant={view === "prompts" ? "secondary" : "ghost"} aria-pressed={view === "prompts"} onClick={() => setView("prompts")}>
            Prompts
          </Button>
          <Button size="xs" variant={view === "calls" ? "secondary" : "ghost"} aria-pressed={view === "calls"} onClick={() => setView("calls")}>
            AI calls
          </Button>
        </div>
      </header>
      {off && <p className="border-b px-3 py-1.5 text-xs text-brand-text">{off}</p>}
      {view === "calls" ? (
        <TracesView />
      ) : connection?.synced ? (
        <Workspace doc={connection.doc} models={models.data} problem={off} close={close} />
      ) : (
        <div role="status" className="grid gap-2 p-4" aria-label="Opening Prompts" aria-busy>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </section>
  );
}
