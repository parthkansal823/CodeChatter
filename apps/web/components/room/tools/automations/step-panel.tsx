/** One step of an automation: its fields, made from what its piece says it needs, what it took in and gave out on the run being looked at, and adding what comes next. */
"use client";

import type { AutomationStepResult, PieceField, PieceInfo } from "@codechatter/contracts";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { addStep, expressionsFor, kindOf, newCodeStep, newLoopStep, newPieceStep, newRouterStep, newStepName, removeStep, updateStep, type Flow, type FlowStep, type Place } from "./model";

const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CONDITIONS: Array<[string, string]> = [
  ["TEXT_CONTAINS", "contains"],
  ["TEXT_DOES_NOT_CONTAIN", "doesn't contain"],
  ["TEXT_EXACTLY_MATCHES", "is exactly"],
  ["TEXT_DOES_NOT_EXACTLY_MATCH", "isn't exactly"],
  ["NUMBER_IS_GREATER_THAN", "is more than"],
  ["NUMBER_IS_LESS_THAN", "is less than"],
  ["NUMBER_IS_EQUAL_TO", "is the number"],
  ["BOOLEAN_IS_TRUE", "is true"],
  ["BOOLEAN_IS_FALSE", "is false"],
  ["EXISTS", "has a value"],
  ["DOES_NOT_EXIST", "has no value"],
];
const NO_SECOND = new Set(["BOOLEAN_IS_TRUE", "BOOLEAN_IS_FALSE", "EXISTS", "DOES_NOT_EXIST"]);
const shown = (value: unknown) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** One field. Any can take an expression like {{step_1.output.x}}, so text is always allowed, and what can't have a form here is typed as JSON. */
function PieceFieldEditor({ name, spec, value, onChange, readOnly }: { name: string; spec: PieceField; value: unknown; onChange: (next: unknown) => void; readOnly: boolean }) {
  const helpId = useId();
  const label = `${spec.label || name}${spec.required ? " (required)" : ""}`;
  if (spec.type === "MARKDOWN") return spec.description ? <p className="text-muted-foreground whitespace-pre-wrap">{spec.description}</p> : null;
  // Beside the field and tied to it, rather than in its label, so a field's name stays short for anyone listening.
  const help = spec.description ? <span id={helpId} className="text-muted-foreground">{spec.description}</span> : null;
  const describedBy = spec.description ? helpId : undefined;
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
  return (
    <div className="grid gap-1">
      <label className="grid gap-1">
        {label}
        {long ? (
          <Textarea
            className="min-h-16 font-mono text-[11px] md:text-[11px]"
            spellCheck={false}
            aria-describedby={describedBy}
            readOnly={readOnly}
            value={shown(value)}
            onChange={(event) => {
              const text = event.target.value;
              if (spec.type === "LONG_TEXT") return onChange(text);
              // JSON when it is, and text otherwise, as it may be an expression, or still being typed.
              try {
                onChange(JSON.parse(text));
              } catch {
                onChange(text);
              }
            }}
          />
        ) : (
          <Input className="h-7 font-mono text-xs" aria-describedby={describedBy} readOnly={readOnly} value={shown(value)} onChange={(event) => onChange(event.target.value)} />
        )}
      </label>
      {help}
    </div>
  );
}

function Data({ label, value }: { label: string; value: unknown }) {
  return (
    <section aria-label={label} className="grid gap-1">
      <h4 className="font-medium">{label}</h4>
      <pre tabIndex={0} className="max-h-56 overflow-auto rounded-md border bg-chrome p-2 font-mono text-[11px] whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {value === undefined ? "Nothing" : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function errorText(message: string): string {
  try {
    return (JSON.parse(message) as { message?: string }).message ?? message;
  } catch {
    return message;
  }
}

function AddStep({ flow, place, pieces, onChange, label }: { flow: Flow; place: Place; pieces: Record<string, PieceInfo>; onChange: (flow: Flow) => void; label: string }) {
  const [choosing, setChoosing] = useState(false);
  const [pieceName, setPieceName] = useState("");
  const [actionName, setActionName] = useState("");
  const piece = pieces[pieceName];
  const actions = Object.entries(piece?.actions ?? {}).filter(([name]) => name !== "custom_api_call");
  const add = (step: FlowStep) => {
    onChange(addStep(flow, place, step));
    setChoosing(false);
    setPieceName("");
    setActionName("");
  };
  if (!choosing) {
    return (
      <Button size="xs" variant="outline" onClick={() => setChoosing(true)}>
        <Plus /> {label}
      </Button>
    );
  }
  return (
    <section aria-label={label} className="grid gap-2 rounded-md border p-2">
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="outline" onClick={() => add(newCodeStep(newStepName(flow, "code")))}>
          Code
        </Button>
        <Button size="xs" variant="outline" onClick={() => add(newRouterStep(newStepName(flow, "router")))}>
          Router
        </Button>
        <Button size="xs" variant="outline" onClick={() => add(newLoopStep(newStepName(flow, "loop")))}>
          Loop
        </Button>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setChoosing(false)}>
          Cancel
        </Button>
      </div>
      <label className="grid gap-1">
        Or a service
        <select
          className={field}
          value={pieceName}
          onChange={(event) => {
            setPieceName(event.target.value);
            setActionName("");
          }}
        >
          <option value="">Choose one</option>
          {Object.entries(pieces)
            .filter(([, info]) => Object.keys(info.actions).length > 0)
            .sort((a, b) => a[1].label.localeCompare(b[1].label))
            .map(([name, info]) => (
              <option key={name} value={name}>
                {info.label}
              </option>
            ))}
        </select>
      </label>
      {piece && (
        <label className="grid gap-1">
          What it does
          <select className={field} value={actionName} onChange={(event) => setActionName(event.target.value)}>
            <option value="">Choose one</option>
            {actions.map(([name, action]) => (
              <option key={name} value={name}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {piece && actionName && (
        <Button size="xs" onClick={() => add(newPieceStep(newStepName(flow, actionName), pieceName, piece, actionName))}>
          Add it
        </Button>
      )}
    </section>
  );
}

function RouterFields({ step, canEdit, onStep }: { step: FlowStep; canEdit: boolean; onStep: (change: (step: FlowStep) => void) => void }) {
  const branches = (step.settings.branches ?? []) as Array<{ branchName: string; branchType: string; conditions?: Array<Array<{ operator: string; firstValue: string; secondValue?: string; caseSensitive?: boolean }>> }>;
  return (
    <section aria-label="Branches" className="grid gap-2">
      <h4 className="font-medium">Branches</h4>
      <p className="text-muted-foreground">The first that matches runs, and then what comes after the router.</p>
      {branches.map((branch, index) => {
        const condition = branch.conditions?.[0]?.[0];
        return (
          <div key={index} className="grid gap-1 rounded-md border p-2">
            <Input aria-label={`Name of branch ${index + 1}`} className="h-7 text-xs" readOnly={!canEdit} value={branch.branchName} onChange={(event) => onStep((current) => void (((current.settings.branches as typeof branches)[index]!.branchName = event.target.value)))} />
            {branch.branchType === "FALLBACK" ? (
              <p className="text-muted-foreground">When nothing above matches.</p>
            ) : (
              condition && (
                <>
                  <Input aria-label={`Value to test, branch ${index + 1}`} className="h-7 font-mono text-xs" placeholder="{{step_1.output.x}}" readOnly={!canEdit} value={condition.firstValue} onChange={(event) => onStep((current) => void (((current.settings.branches as typeof branches)[index]!.conditions![0]![0]!.firstValue = event.target.value)))} />
                  <select aria-label={`Test, branch ${index + 1}`} className={field} disabled={!canEdit} value={condition.operator} onChange={(event) => onStep((current) => void (((current.settings.branches as typeof branches)[index]!.conditions![0]![0]!.operator = event.target.value)))}>
                    {CONDITIONS.map(([value, words]) => (
                      <option key={value} value={value}>
                        {words}
                      </option>
                    ))}
                  </select>
                  {!NO_SECOND.has(condition.operator) && <Input aria-label={`Compared with, branch ${index + 1}`} className="h-7 font-mono text-xs" readOnly={!canEdit} value={condition.secondValue ?? ""} onChange={(event) => onStep((current) => void (((current.settings.branches as typeof branches)[index]!.conditions![0]![0]!.secondValue = event.target.value)))} />}
                </>
              )
            )}
          </div>
        );
      })}
    </section>
  );
}

export function StepPanel({ flow, step, pieces, result, canEdit, onChange, onClose }: { flow: Flow; step: FlowStep; pieces: Record<string, PieceInfo>; result: { times: number; results: AutomationStepResult[] } | undefined; canEdit: boolean; onChange: (flow: Flow) => void; onClose: () => void }) {
  const codeHelp = useId();
  const edit = (change: (step: FlowStep) => void) => onChange(updateStep(flow, step.name, change));
  const settings = step.settings as { pieceName?: string; actionName?: string; triggerName?: string; input?: Record<string, unknown>; sourceCode?: { code?: string }; items?: unknown; errorHandlingOptions?: { continueOnFailure?: { value?: boolean }; retryOnFailure?: { value?: boolean } } };
  const piece = settings.pieceName ? pieces[settings.pieceName] : undefined;
  const pieceStep = step.type === "PIECE" ? piece?.actions[settings.actionName ?? ""] : step.type === "PIECE_TRIGGER" ? piece?.triggers[settings.triggerName ?? ""] : undefined;
  const input = settings.input ?? {};
  const setInput = (name: string, value: unknown) =>
    edit((current) => {
      const target = current.settings as { input?: Record<string, unknown> };
      target.input = { ...(target.input ?? {}), [name]: value };
    });
  const known = expressionsFor(flow, step.name);
  const last = result?.results.at(-1);
  const handling = settings.errorHandlingOptions;

  return (
    <section aria-label={`Step ${step.displayName || step.name}`} className="grid min-w-0 content-start gap-3 text-xs">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label className="grid gap-1">
            Name
            <Input className="h-7 text-xs" readOnly={!canEdit} value={step.displayName} onChange={(event) => edit((current) => void (current.displayName = event.target.value))} />
          </label>
          <p className="text-muted-foreground">
            {kindOf(step, pieces)} · <span className="font-mono">{step.name}</span>
          </p>
        </div>
        {canEdit && step.type !== "PIECE_TRIGGER" && step.type !== "EMPTY" && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${step.displayName || step.name}`}
            title="Remove this step"
            onClick={() => {
              onChange(removeStep(flow, step.name));
              onClose();
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>

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
              className="min-h-16 font-mono text-[11px] md:text-[11px]"
              spellCheck={false}
              readOnly={!canEdit}
              defaultValue={JSON.stringify(input, null, 2)}
              onChange={(event) => {
                try {
                  const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                  edit((current) => void (current.settings.input = parsed));
                } catch {
                  // Still being typed.
                }
              }}
            />
          </label>
        </>
      )}
      {step.type === "LOOP_ON_ITEMS" && (
        <label className="grid gap-1">
          Go through each of
          <Input className="h-7 font-mono text-xs" placeholder="{{step_1.output.items}}" readOnly={!canEdit} value={shown(settings.items)} onChange={(event) => edit((current) => void (current.settings.items = event.target.value))} />
        </label>
      )}
      {step.type === "ROUTER" && <RouterFields step={step} canEdit={canEdit} onStep={edit} />}
      {pieceStep && (
        <section aria-label="Its fields" className="grid gap-2">
          {Object.entries(pieceStep.fields).map(([name, spec]) => (
            <PieceFieldEditor key={name} name={name} spec={spec} value={input[name]} readOnly={!canEdit} onChange={(value) => setInput(name, value)} />
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
      {known.length > 0 && (
        <details>
          <summary className="min-h-6 cursor-pointer py-1 text-muted-foreground">What this step can use</summary>
          <ul className="grid gap-0.5 font-mono text-[11px]">
            {known.map((item) => (
              <li key={item} className="break-all">
                {item}
              </li>
            ))}
          </ul>
        </details>
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
          <Data label="What went in" value={last.input} />
          <Data label="What came out" value={last.output} />
        </section>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-1 border-t pt-2">
          <AddStep flow={flow} place={{ after: step.name }} pieces={pieces} onChange={onChange} label="Add a step after this" />
          {step.type === "LOOP_ON_ITEMS" && <AddStep flow={flow} place={{ insideLoop: step.name }} pieces={pieces} onChange={onChange} label="Add a step inside" />}
          {step.type === "ROUTER" && ((step.settings.branches ?? []) as Array<{ branchName: string }>).map((branch, index) => <AddStep key={index} flow={flow} place={{ inBranch: step.name, branch: index }} pieces={pieces} onChange={onChange} label={`Add to ${branch.branchName}`} />)}
        </div>
      )}
    </section>
  );
}
