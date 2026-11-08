/**
 * One step of an automation: its fields, made from what its piece says it needs, what it took in and gave out on the run being looked at, and the data of the
 * steps before it, any field of which "Use" puts in the field being filled in. Adding a step, replacing one or changing the trigger opens the step picker.
 */
"use client";

import type { AutomationStepResult, PieceField, PieceInfo } from "@codechatter/contracts";
import { Plus, Replace, Trash2, Zap } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { DataView, SchemaOf } from "./data-view";
import { insertAt, previewOf } from "./expressions";
import { addBranch, expressionsFor, kindOf, removeBranch, removeStep, setStepNote, toggleStep, updateStep, type Flow, type FlowStep, type Place } from "./model";
import { RouterFields } from "./router-fields";

const shown = (value: unknown) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2));
type FieldTarget = { element: HTMLInputElement | HTMLTextAreaElement; write: (text: string) => void };
type FocusField = (element: HTMLInputElement | HTMLTextAreaElement, write: (text: string) => void) => void;

/** What an expression in a field comes to on the run being looked at. */
function PreviewLine({ text, data }: { text: unknown; data: Record<string, unknown> | null }) {
  if (!data || typeof text !== "string" || !text.includes("{{")) return null;
  const preview = previewOf(text, data);
  const words = preview.kind === "value" ? JSON.stringify(preview.value) : preview.kind === "text" ? preview.text : preview.reason;
  return (
    <span className="truncate font-mono text-[11px] text-muted-foreground" title={words}>
      {preview.kind === "none" ? words : `On this run: ${words}`}
    </span>
  );
}

/** One field. Any can take an expression like {{step_1.output.x}}, so text is always allowed, and what can't have a form here is typed as JSON. */
function PieceFieldEditor({ name, spec, value, onChange, readOnly, onFocusField, data }: { name: string; spec: PieceField; value: unknown; onChange: (next: unknown) => void; readOnly: boolean; onFocusField: FocusField; data: Record<string, unknown> | null }) {
  const helpId = useId();
  const label = `${spec.label || name}${spec.required ? " (required)" : ""}`;
  if (spec.type === "MARKDOWN") return spec.description ? <p className="text-muted-foreground whitespace-pre-wrap">{spec.description}</p> : null;
  // Beside the field and tied to it, rather than in its label, so a field's name stays short for anyone listening.
  const help = spec.description ? <span id={helpId} className="text-muted-foreground">{spec.description}</span> : null;
  const describedBy = spec.description ? helpId : undefined;
  const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (spec.type === "CHECKBOX") {
    return (
      <div className="grid gap-1">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" aria-describedby={describedBy} disabled={readOnly} checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>{label}</span>
        </label>
        {help}
      </div>
    );
  }
  if (spec.options?.length) {
    return (
      <div className="grid gap-1">
        <label className="grid gap-1">
          {label}
          <select className={field} aria-describedby={describedBy} disabled={readOnly} value={JSON.stringify(value ?? "")} onChange={(event) => onChange(JSON.parse(event.target.value))}>
            {!spec.required && <option value={JSON.stringify("")}>Nothing</option>}
            {spec.required && value === undefined && <option value={JSON.stringify("")}>Choose one</option>}
            {spec.options.map((option) => (
              <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {help}
      </div>
    );
  }
  const long = spec.type === "LONG_TEXT" || spec.type === "JSON" || spec.type === "OBJECT" || spec.type === "ARRAY" || spec.type === "DYNAMIC";
  const fromText = (text: string) => {
    if (spec.type === "LONG_TEXT" || !long) return text;
    // JSON when it is, and text otherwise, as it may be an expression, or still being typed.
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
  return (
    <div className="grid gap-1">
      <label className="grid gap-1">
        {label}
        {long ? (
          <Textarea className="min-h-16 font-mono text-[11px] md:text-[11px]" spellCheck={false} aria-describedby={describedBy} readOnly={readOnly} value={shown(value)} onFocus={(event) => onFocusField(event.currentTarget, (text) => onChange(fromText(text)))} onChange={(event) => onChange(fromText(event.target.value))} />
        ) : (
          <Input className="h-7 font-mono text-xs" aria-describedby={describedBy} readOnly={readOnly} value={shown(value)} onFocus={(event) => onFocusField(event.currentTarget, (text) => onChange(text))} onChange={(event) => onChange(event.target.value)} />
        )}
      </label>
      <PreviewLine text={value} data={data} />
      {help}
    </div>
  );
}

function errorText(message: string): string {
  try {
    return (JSON.parse(message) as { message?: string }).message ?? message;
  } catch {
    return message;
  }
}

export function StepPanel({
  flow,
  step,
  pieces,
  result,
  runSteps,
  canEdit,
  onChange,
  onClose,
  onAdd,
  onReplace,
}: {
  flow: Flow;
  step: FlowStep;
  pieces: Record<string, PieceInfo>;
  result: { times: number; results: AutomationStepResult[] } | undefined;
  /** Every step's result on the run being looked at, for the data before this one. */
  runSteps: Record<string, AutomationStepResult> | undefined;
  canEdit: boolean;
  onChange: (flow: Flow) => void;
  onClose: () => void;
  onAdd: (place: Place) => void;
  /** Open the picker to put something else in this step's place (for the trigger, another trigger). */
  onReplace: () => void;
}) {
  const codeHelp = useId();
  const noteId = useId();
  const target = useRef<FieldTarget | null>(null);
  const [inputsText, setInputsText] = useState<string | null>(null);
  const edit = (change: (step: FlowStep) => void) => onChange(updateStep(flow, step.name, change));
  const settings = step.settings as { pieceName?: string; actionName?: string; triggerName?: string; input?: Record<string, unknown>; sourceCode?: { code?: string }; items?: unknown; errorHandlingOptions?: { continueOnFailure?: { value?: boolean }; retryOnFailure?: { value?: boolean } } };
  const piece = settings.pieceName ? pieces[settings.pieceName] : undefined;
  const pieceStep = step.type === "PIECE" ? piece?.actions[settings.actionName ?? ""] : step.type === "PIECE_TRIGGER" ? piece?.triggers[settings.triggerName ?? ""] : undefined;
  const input = settings.input ?? {};
  const setInput = (name: string, value: unknown) =>
    edit((current) => {
      const into = current.settings as { input?: Record<string, unknown> };
      into.input = { ...(into.input ?? {}), [name]: value };
    });
  const isTrigger = step.type === "PIECE_TRIGGER" || step.type === "EMPTY";
  const last = result?.results.at(-1);
  const handling = settings.errorHandlingOptions;
  const data = runSteps ? Object.fromEntries(Object.entries(runSteps).map(([name, each]) => [name, { output: each.output }])) : null;
  const earlier = expressionsFor(flow, step.name)
    .map((expression) => /^\{\{([A-Za-z0-9_]+)\./.exec(expression)?.[1])
    .filter((name, index, all): name is string => Boolean(name) && all.indexOf(name) === index);
  const focusField: FocusField = (element, write) => {
    target.current = { element, write };
  };
  /** Puts an expression where the cursor was in the last field filled in, or copies it when there wasn't one. */
  const use = (expression: string) => {
    const field = target.current;
    if (!field || !field.element.isConnected || field.element.readOnly) {
      void navigator.clipboard?.writeText(expression).catch(() => {});
      toast(`Copied ${expression}. Click into a field first to put it there.`);
      return;
    }
    const { element } = field;
    const quoted = element.dataset.json === "true" ? JSON.stringify(expression) : expression;
    const next = insertAt(element.value, element.selectionStart ?? element.value.length, element.selectionEnd ?? element.value.length, quoted);
    field.write(next.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <section aria-label={`Step ${step.displayName || step.name}`} className="grid min-w-0 content-start gap-3 text-xs">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label className="grid gap-1">
            Name
            <Input data-step-name className="h-7 text-xs" readOnly={!canEdit} value={step.displayName} onChange={(event) => edit((current) => void (current.displayName = event.target.value))} />
          </label>
          <p className="text-muted-foreground">
            {kindOf(step, pieces)} · <span className="font-mono">{step.name}</span>
          </p>
        </div>
        {canEdit && !isTrigger && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${step.displayName || step.name}`}
            title="Remove this step (Delete)"
            onClick={() => {
              onChange(removeStep(flow, step.name));
              onClose();
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-1">
          {isTrigger ? (
            <Button size="xs" variant="outline" onClick={onReplace}>
              <Zap /> Change the trigger
            </Button>
          ) : (
            <>
              {(step.type === "CODE" || step.type === "PIECE") && (
                <Button size="xs" variant="outline" onClick={onReplace}>
                  <Replace /> Replace
                </Button>
              )}
              <label className="flex items-center gap-1.5 px-1">
                <input type="checkbox" checked={step.skip === true} onChange={() => onChange(toggleStep(flow, step.name))} />
                Turned off
              </label>
            </>
          )}
        </div>
      )}
      {step.skip && <p className="rounded-md border border-dashed p-2 text-muted-foreground">Turned off: the flow passes over it, and what comes after still runs.</p>}
      {isTrigger && settings.pieceName !== "@activepieces/piece-webhook" && <p className="rounded-md border p-2 text-muted-foreground">A flow starts by itself once triggers are on, which comes next. Until then it runs when you press Run it, with what you send standing in for what this trigger would give.</p>}
      {pieceStep?.needsAuth && piece?.auth && <p className="rounded-md border p-2 text-muted-foreground">This step needs a {piece.label} connection, and rooms have no internet yet. Both are coming next, so it can&apos;t reach {piece.label} for now.</p>}
      {settings.pieceName && !piece && <p role="alert" className="text-destructive">This room&apos;s image doesn&apos;t have {settings.pieceName}.</p>}

      {step.type === "CODE" && (
        <>
          <div className="grid gap-1">
            <label className="grid gap-1">
              Code
              <Textarea aria-describedby={codeHelp} className="min-h-40 font-mono text-[11px] md:text-[11px]" spellCheck={false} readOnly={!canEdit} value={settings.sourceCode?.code ?? ""} onChange={(event) => edit((current) => void ((current.settings.sourceCode as { code: string }).code = event.target.value))} />
            </label>
            <span id={codeHelp} className="text-muted-foreground">JavaScript or TypeScript, in this room&apos;s sandbox. It exports `code`, and what that returns is this step&apos;s output.</span>
          </div>
          <label className="grid gap-1">
            What it&apos;s given (inputs), as JSON
            <Textarea
              data-json="true"
              className="min-h-16 font-mono text-[11px] md:text-[11px]"
              spellCheck={false}
              readOnly={!canEdit}
              value={inputsText ?? JSON.stringify(input, null, 2)}
              onFocus={(event) =>
                focusField(event.currentTarget, (text) => {
                  setInputsText(text);
                  try {
                    const parsed = JSON.parse(text) as Record<string, unknown>;
                    edit((current) => void (current.settings.input = parsed));
                  } catch {
                    // Still being typed.
                  }
                })
              }
              onChange={(event) => {
                setInputsText(event.target.value);
                try {
                  const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                  edit((current) => void (current.settings.input = parsed));
                } catch {
                  // Still being typed.
                }
              }}
              onBlur={() => setInputsText(null)}
            />
          </label>
        </>
      )}
      {step.type === "LOOP_ON_ITEMS" && (
        <div className="grid gap-1">
          <label className="grid gap-1">
            Go through each of
            <Input className="h-7 font-mono text-xs" placeholder="{{step_1.output.items}}" readOnly={!canEdit} value={shown(settings.items)} onFocus={(event) => focusField(event.currentTarget, (text) => edit((current) => void (current.settings.items = text)))} onChange={(event) => edit((current) => void (current.settings.items = event.target.value))} />
          </label>
          <PreviewLine text={settings.items} data={data} />
        </div>
      )}
      {step.type === "ROUTER" && <RouterFields step={step} canEdit={canEdit} onStep={edit} onAddBranch={() => onChange(addBranch(flow, step.name))} onRemoveBranch={(index) => onChange(removeBranch(flow, step.name, index))} onFieldFocus={focusField} />}
      {pieceStep && (
        <section aria-label="Its fields" className="grid gap-2">
          {Object.entries(pieceStep.fields).map(([name, spec]) => (
            <PieceFieldEditor key={name} name={name} spec={spec} value={input[name]} readOnly={!canEdit} onChange={(value) => setInput(name, value)} onFocusField={focusField} data={data} />
          ))}
        </section>
      )}
      {(step.type === "PIECE" || step.type === "CODE") && (
        <section aria-label="If it fails" className="grid gap-1">
          <h4 className="font-medium">If it fails</h4>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={handling?.retryOnFailure?.value === true} onChange={(event) => edit((current) => void ((current.settings.errorHandlingOptions as { retryOnFailure: { value: boolean } }).retryOnFailure = { value: event.target.checked }))} />
            Try again a few times
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={handling?.continueOnFailure?.value === true} onChange={(event) => edit((current) => void ((current.settings.errorHandlingOptions as { continueOnFailure: { value: boolean } }).continueOnFailure = { value: event.target.checked }))} />
            Carry on with the next step
          </label>
        </section>
      )}
      <label className="grid gap-1" htmlFor={noteId}>
        Note
        <Textarea id={noteId} className="min-h-12 text-xs md:text-xs" readOnly={!canEdit} placeholder="Shown under its box, for whoever reads this flow next." value={flow.stepNotes?.[step.name] ?? ""} onChange={(event) => onChange(setStepNote(flow, step.name, event.target.value))} />
      </label>

      {earlier.length > 0 && (
        <section aria-label="Data from the steps before" className="grid gap-1 border-t pt-2">
          <h4 className="font-medium">Data from the steps before</h4>
          {!runSteps ? (
            <>
              <p className="text-muted-foreground">Run it once to see their data here. Until then, what this step can use:</p>
              <ul className="grid gap-0.5 font-mono text-[11px]">
                {expressionsFor(flow, step.name).map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">Click into a field, then Use to put that piece of data there.</p>
              {earlier.map((name) => (
                <details key={name} className="rounded-md border px-2 py-1">
                  <summary className="min-h-6 cursor-pointer py-1 font-mono">{name}</summary>
                  {runSteps[name] ? <SchemaOf value={runSteps[name]!.output} base={`${name}.output`} onUse={canEdit ? use : undefined} /> : <p className="text-muted-foreground">It didn&apos;t run on this run.</p>}
                </details>
              ))}
            </>
          )}
        </section>
      )}

      {last && (
        <section aria-label="On this run" className="grid gap-2 border-t pt-2">
          <h4 className="font-medium">
            On this run{result && result.times > 1 ? `, the last of ${result.times} times` : ""}
            {last.duration !== undefined ? ` · ${Math.round(last.duration)} ms` : ""}
          </h4>
          {last.errorMessage && (
            <p role="alert" className="break-words text-destructive">
              {errorText(last.errorMessage)}
            </p>
          )}
          <DataView label="What went in" value={last.input} />
          <DataView label="What came out" value={last.output} base={`${step.name}.output`} />
        </section>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-1 border-t pt-2">
          <Button size="xs" variant="outline" onClick={() => onAdd({ after: step.name })}>
            <Plus /> Add a step after this
          </Button>
          {step.type === "LOOP_ON_ITEMS" && (
            <Button size="xs" variant="outline" onClick={() => onAdd({ insideLoop: step.name })}>
              <Plus /> Add a step inside
            </Button>
          )}
          {step.type === "ROUTER" &&
            ((step.settings.branches ?? []) as Array<{ branchName: string }>).map((branch, index) => (
              <Button key={index} size="xs" variant="outline" onClick={() => onAdd({ inBranch: step.name, branch: index })}>
                <Plus /> Add to {branch.branchName}
              </Button>
            ))}
        </div>
      )}
    </section>
  );
}
