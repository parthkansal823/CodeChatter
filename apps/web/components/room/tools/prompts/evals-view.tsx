/** Evals in the Prompts tool: a prompt's test cases with checks on the answer, run by promptfoo on its columns, a pass or fail for each, and what changed from the last run. */
"use client";

import { checkNeedsValue, EVAL_CHECK_TYPES, EVAL_LIMITS, promptfooConfig, promptVariables, type AiPromptModels, type EvalCell, type EvalCheckType } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { Check, Copy, Loader2, Play, Plus, Square, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { useYText } from "@/components/room/tools/api-studio/use-y-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  addCase,
  addCheck,
  addEvalRun,
  caseValue,
  cellKey,
  CHECKS,
  columnScore,
  compareEvals,
  ensureCaseValue,
  evalCalls,
  evalInput,
  readCases,
  readEvalRuns,
  removeCase,
  removeCheck,
  renameCase,
  setCheckType,
  whyNoEvals,
  type EvalCaseItem,
  type EvalCheckItem,
  type EvalRun,
} from "./evals-model";
import { readColumns, readPromptText, type PromptColumn } from "./model";
import { Field } from "./prompt-field";
import { useEvalRun } from "./use-eval-run";

type Node = Y.Map<unknown>;

const SMALL = "h-6 rounded-sm border bg-background px-1 text-xs disabled:opacity-70";
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const seconds = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const columnName = (column: PromptColumn) => [column.model, column.temperature !== null && `temperature ${column.temperature}`, column.maxTokens !== null && `at most ${column.maxTokens} tokens`, column.json && "JSON"].filter(Boolean).join(", ");

function CheckRow({ test, check, index, caseName, editable }: { test: Node; check: EvalCheckItem; index: number; caseName: string; editable: boolean }) {
  const { value, onChange, ref } = useYText<HTMLInputElement>(check.value);
  const wanted = checkNeedsValue(check.type);
  return (
    <div className="flex items-center gap-1">
      <select aria-label={`Kind of check ${index + 1} in ${caseName}`} value={check.type} disabled={!editable} onChange={(event) => setCheckType(test, check.id, event.target.value as EvalCheckType)} className={cn(SMALL, "w-40 shrink-0")}>
        {EVAL_CHECK_TYPES.map((type) => (
          <option key={type} value={type}>
            {CHECKS[type].label}
          </option>
        ))}
      </select>
      {wanted && (
        <input
          ref={ref}
          aria-label={`What check ${index + 1} in ${caseName} looks for`}
          value={value}
          disabled={!editable}
          spellCheck={false}
          maxLength={EVAL_LIMITS.checkChars}
          placeholder={CHECKS[check.type].placeholder}
          className={cn(SMALL, "min-w-0 flex-1 font-mono")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {editable && (
        <Button size="icon-xs" variant="ghost" className={wanted ? undefined : "ml-auto"} aria-label={`Remove check ${index + 1} in ${caseName}`} title="Remove this check" onClick={() => removeCheck(test, check.id)}>
          <X />
        </Button>
      )}
    </div>
  );
}

function CaseCard({ node, test, index, variables, promptValues, editable, onRun }: { node: Node; test: EvalCaseItem; index: number; variables: string[]; promptValues: Record<string, string>; editable: boolean; onRun: () => void }) {
  const name = test.name || `Case ${index + 1}`;
  return (
    <section aria-label={`Test case ${index + 1}`} className="grid gap-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1">
        <Input aria-label={`Name of test case ${index + 1}`} value={test.name} disabled={!editable} maxLength={EVAL_LIMITS.nameChars} className="h-6 min-w-0 flex-1 text-xs" onChange={(event) => renameCase(test.node, event.target.value)} />
        {editable && (
          <Button size="icon-xs" variant="ghost" aria-label={`Remove test case ${index + 1}`} title="Remove this test case" onClick={() => removeCase(node, test.id)}>
            <X />
          </Button>
        )}
      </div>
      {variables.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {variables.map((variable) => (
            <label key={variable} className="grid min-w-0 gap-0.5">
              <span className="font-mono text-xs">{variable}</span>
              <Field text={caseValue(test.node, variable)} label={`Value of ${variable} in ${name}`} editable={editable} rows={1} placeholder={promptValues[variable] ? `The prompt's: ${promptValues[variable]}` : "No value"} onRun={onRun} onFocus={() => void (editable && ensureCaseValue(test.node, variable))} />
            </label>
          ))}
        </div>
      )}
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">{test.checks.length ? "The answer passes if:" : "No checks: it passes if the model answers at all."}</span>
        {test.checks.map((check, checkIndex) => (
          <CheckRow key={check.id} test={test.node} check={check} index={checkIndex} caseName={name} editable={editable} />
        ))}
        {editable && test.checks.length < EVAL_LIMITS.checks && (
          <div>
            <Button size="xs" variant="ghost" onClick={() => addCheck(test.node)}>
              <Plus /> Add a check
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function CellDetail({ run, cell }: { run: EvalRun; cell: EvalCell }) {
  const test = run.cases.find((item) => item.id === cell.caseId);
  const column = run.columns.find((item) => item.id === cell.columnId);
  return (
    <section aria-label="This result" className="grid gap-1.5 rounded-md border p-2 text-xs">
      <p className="font-medium">
        {test?.name || "This case"}
        <span className="ml-2 font-mono font-normal text-muted-foreground">{column && columnName(column)}</span>
      </p>
      {cell.error && <p className="text-destructive">{cell.error}</p>}
      {cell.failed.map((check, index) => (
        <p key={index} className="text-destructive">
          {CHECKS[check.type as EvalCheckType]?.label ?? check.type}
          {check.value && <span className="font-mono"> {check.value}</span>}: {check.reason}
        </p>
      ))}
      {cell.pass && <p className="text-muted-foreground">Every check passed.</p>}
      {cell.output && <p className="max-h-60 overflow-auto rounded-sm bg-chrome p-1.5 font-mono leading-5 break-words whitespace-pre-wrap">{cell.output}</p>}
      <p className="text-muted-foreground tabular-nums">
        {cell.latencyMs !== null && `${seconds(cell.latencyMs)} · `}
        {cell.inputTokens.toLocaleString()} tokens in, {cell.outputTokens.toLocaleString()} out
      </p>
    </section>
  );
}

function Results({ run, before }: { run: EvalRun; before: EvalRun | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const { report } = run;
  const changes = compareEvals(run, before);
  const byKey = new Map(report.cells.map((cell) => [cellKey(cell), cell]));
  const selected = open ? byKey.get(open) : undefined;
  const total = report.cells.length;
  return (
    <section aria-label="Results" className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium">
          {report.passed} of {total} passed
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {clock(run.at)} by {run.by} · {seconds(report.ms)} · {(report.inputTokens + report.outputTokens).toLocaleString()} tokens
        </span>
      </div>
      {changes && (
        <p className="text-xs">
          Since the run at {clock(changes.at)}:{" "}
          {changes.newlyFailing.size === 0 && changes.fixed.size === 0 ? (
            "the same results"
          ) : (
            <>
              {changes.newlyFailing.size > 0 && <span className="font-medium text-destructive">{changes.newlyFailing.size} newly failing</span>}
              {changes.newlyFailing.size > 0 && changes.fixed.size > 0 && ", "}
              {changes.fixed.size > 0 && <span className="font-medium">{changes.fixed.size} fixed</span>}
            </>
          )}
          . {changes.promptChanged ? "The prompt was different." : "The prompt was the same."}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border" tabIndex={0} role="group" aria-label="Scores by column">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Each column&apos;s score</caption>
          <thead className="bg-chrome">
            <tr>
              {["Column", "Passed", "Average time", "Tokens in", "Tokens out"].map((name) => (
                <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.columns.map((column) => {
              const score = columnScore(report, column.id);
              return (
                <tr key={column.id}>
                  <th scope="row" className="border-b px-2 py-1 text-left font-mono font-normal">
                    {columnName(column)}
                  </th>
                  <td className="border-b px-2 py-1 tabular-nums whitespace-nowrap">
                    {score.passed} of {score.total}
                    {score.total > 0 && ` (${Math.round((score.passed / score.total) * 100)}%)`}
                  </td>
                  <td className="border-b px-2 py-1 tabular-nums">{score.averageMs === null ? "–" : seconds(score.averageMs)}</td>
                  <td className="border-b px-2 py-1 tabular-nums">{score.inputTokens.toLocaleString()}</td>
                  <td className="border-b px-2 py-1 tabular-nums">{score.outputTokens.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-md border" tabIndex={0} role="group" aria-label="Results by test case">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Each test case on each column. Open one to see its answer.</caption>
          <thead className="bg-chrome">
            <tr>
              <th scope="col" className="border-b px-2 py-1 text-left font-medium">
                Test case
              </th>
              {run.columns.map((column) => (
                <th key={column.id} scope="col" className="border-b px-2 py-1 text-left font-mono font-normal">
                  {columnName(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.cases.map((test, index) => (
              <tr key={test.id}>
                <th scope="row" className="border-b px-2 py-1 text-left font-normal">
                  {test.name || `Case ${index + 1}`}
                </th>
                {run.columns.map((column) => {
                  const key = `${test.id}:${column.id}`;
                  const cell = byKey.get(key);
                  if (!cell) {
                    return (
                      <td key={key} className="border-b px-2 py-1 text-muted-foreground">
                        –
                      </td>
                    );
                  }
                  const word = cell.error ? "Error" : cell.pass ? "Pass" : "Fail";
                  const change = changes?.newlyFailing.has(key) ? ", newly" : changes?.fixed.has(key) ? ", fixed" : "";
                  return (
                    <td key={key} className={cn("border-b px-2 py-1", open === key && "bg-accent")}>
                      <button type="button" aria-pressed={open === key} className={cn("flex min-h-6 items-center gap-1 rounded-sm underline-offset-2 hover:underline", !cell.pass && "font-medium text-destructive")} onClick={() => setOpen((current) => (current === key ? null : key))}>
                        {cell.pass ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                        {word}
                        {change}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <CellDetail run={run} cell={selected} />}
    </section>
  );
}

export function EvalsView({ node, models, version }: { node: Node; models: AiPromptModels | undefined; version: number }) {
  const { room, me, can } = useRoom();
  const editable = can("files.edit");
  const mayRun = can("code.run") && can("room.chat");
  const runner = useEvalRun(room.id);
  const [problem, setProblem] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [localRun, setLocalRun] = useState<EvalRun | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` moves when anything in the prompt does
  const cases = useMemo(() => readCases(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => readColumns(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => readEvalRuns(node), [node, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prompt = useMemo(() => readPromptText(node), [node, version]);
  const runs = localRun ? [localRun, ...saved] : saved;
  const shownIndex = openRun ? Math.max(0, runs.findIndex((run) => run.id === openRun)) : 0;
  const shown = runs[shownIndex] ?? null;
  const variables = promptVariables([prompt.system, ...prompt.messages.map((message) => message.content)]);
  const blocked = whyNoEvals(cases, columns);
  const options = { oneAtATime: models?.oneAtATime ?? false, grader: models?.default ?? null };
  const calls = blocked ? 0 : evalCalls(evalInput(node, options));

  const run = async () => {
    if (runner.running || blocked || !mayRun) return;
    const input = evalInput(node, options);
    setProblem(null);
    const outcome = await runner.start(input);
    if (!outcome || "stopped" in outcome) return;
    if ("error" in outcome) {
      setProblem(outcome.error);
      return;
    }
    const record: EvalRun = { id: randomId(), at: Date.now(), by: me.user.name, prompt: readPromptText(node), columns: input.columns, cases: input.cases.map(({ id, name }) => ({ id, name })), report: outcome.report };
    setOpenRun(null);
    if (!editable) setLocalRun(record);
    else if (node.doc && !node.doc.isDestroyed) addEvalRun(node, record);
  };

  const copyConfig = () => {
    const input = evalInput(node, options);
    void navigator.clipboard.writeText(`${JSON.stringify(promptfooConfig(input), null, 2)}\n`).then(
      () => toast.success("Copied. Save it as promptfooconfig.json, and promptfoo eval runs it in a terminal here."),
      () => toast.error("Couldn't copy it."),
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="mr-1 text-xs font-medium">Test cases</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cases.length} of {EVAL_LIMITS.cases}
        </span>
        {editable && cases.length < EVAL_LIMITS.cases && (
          <Button size="xs" variant="ghost" onClick={() => addCase(node, `Case ${cases.length + 1}`)}>
            <Plus /> Add a test case
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {blocked ? <span className="text-xs text-muted-foreground">{blocked}</span> : !runner.running && <span className="text-xs text-muted-foreground tabular-nums">{calls} calls to the AI</span>}
          {runner.running && (
            <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {runner.calls} of {calls} calls done
            </span>
          )}
          {!blocked && !runner.running && (
            <Button size="xs" variant="ghost" onClick={copyConfig}>
              <Copy /> Copy the promptfoo config
            </Button>
          )}
          {runner.running ? (
            <Button size="xs" variant="outline" onClick={runner.stop}>
              <Square /> Stop
            </Button>
          ) : (
            <Button size="xs" disabled={Boolean(blocked) || !mayRun} onClick={() => void run()}>
              <Play /> Run evals
            </Button>
          )}
        </div>
      </div>

      {cases.length === 0 && (
        <p className="max-w-prose text-xs text-muted-foreground">
          Say what a good answer looks like, and check it every time the prompt changes. Each test case fills in the prompt&apos;s variables and checks the answer on every column. It runs on promptfoo in this room&apos;s sandbox, through the room&apos;s AI, and shows what changed from the last run.
        </p>
      )}
      {!mayRun && <p className="text-xs text-muted-foreground">Your role in this room can&apos;t run code, so you can read these, but not run them.</p>}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}

      <div className="grid gap-2 xl:grid-cols-2">
        {cases.map((test, index) => (
          <CaseCard key={test.id} node={node} test={test} index={index} variables={variables} promptValues={prompt.values} editable={editable && !runner.running} onRun={() => void run()} />
        ))}
      </div>
      {cases.length > 0 && <p className="text-xs text-muted-foreground">Answers here use temperature 0 and at most 1,024 tokens unless a column says otherwise. A value left empty uses the prompt&apos;s. Closing this tool stops a run.</p>}

      {shown && <Results key={shown.id} run={shown} before={runs[shownIndex + 1] ?? null} />}

      {runs.length > 1 && (
        <section aria-label="Earlier runs" className="grid gap-1">
          <h3 className="text-xs font-medium">Runs</h3>
          <div className="flex flex-wrap gap-1">
            {runs.map((item) => {
              const total = item.report.cells.length;
              return (
                <Button key={item.id} size="xs" variant={item.id === shown?.id ? "secondary" : "ghost"} aria-pressed={item.id === shown?.id} className="tabular-nums" onClick={() => setOpenRun(item.id)}>
                  {clock(item.at)}: {item.report.passed} of {total}
                </Button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
