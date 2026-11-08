/**
 * One flow: its chart, with what ran lit up, and beside it the step being changed, the step picker, or the runs. Editing it is n8n's: a + on every arrow and
 * wherever nothing comes next, a right-click menu and keys on a focused box (copy, cut, paste, duplicate, turn off, rename, add, remove, move between boxes),
 * undo and redo of one's own changes, and Ctrl+Enter to run. The flow is the room's file, so everyone edits it together.
 */
"use client";

import type { AutomationInput, AutomationLive, AutomationManifest, AutomationRun, AutomationRunSummary } from "@codechatter/contracts";
import { setFileText, textOf, type TreeNode } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, GitBranch, Loader2, Play, Puzzle, Redo2, Repeat, Square, Undo2, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { Flowchart, type FlowchartEdge, type FlowchartMenuItem, type FlowchartNode } from "@/components/flowchart/flowchart";
import { useRoom } from "@/components/room/room-context";
import { useYVersion } from "@/components/room/tools/api-studio/connection";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { copyStep, stepToPaste } from "./clipboard";
import { addStep, chartOfFlow, copyOfStep, duplicateStep, findStep, newCodeStep, newLoopStep, newPieceStep, newRouterStep, newStepName, newTrigger, parseFlow, pasteStep, removeStep, replaceStep, resultsOf, toggleStep, type ChartEdge, type Flow, type FlowStep, type Glyph, type Place } from "./model";
import { StepPanel } from "./step-panel";
import { StepPicker, type Picked } from "./step-picker";

const GLYPHS: Record<Glyph, FlowchartNode["icon"]> = { trigger: Zap, code: Code2, piece: Puzzle, router: GitBranch, loop: Repeat };
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }) : "–");
const STATUS_WORDS: Record<string, string> = { SUCCEEDED: "Finished", FAILED: "Failed", STOPPED: "Stopped", TIMEOUT: "Took too long", RUNNING: "Running", PAUSED: "Paused" };
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

type Picking = { mode: "add"; place: Place } | { mode: "replace"; name: string } | { mode: "trigger" };

function stateVectorOf(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function RunsList({ runs, shownId, onShow }: { runs: AutomationRunSummary[]; shownId: string | null; onShow: (id: string) => void }) {
  if (!runs.length) return <p className="text-muted-foreground">No runs yet.</p>;
  return (
    <ul aria-label="Runs of this flow" className="grid gap-0.5">
      {runs.map((run) => (
        <li key={run.id}>
          <button type="button" aria-current={shownId === run.id ? "true" : undefined} className={cn("flex min-h-6 w-full flex-wrap items-center gap-x-2 rounded-sm px-1 text-left hover:bg-accent", shownId === run.id && "bg-accent", run.status !== "SUCCEEDED" && "font-medium text-destructive")} onClick={() => onShow(run.id)}>
            <span>{STATUS_WORDS[run.status] ?? run.status}</span>
            <span className={cn(run.status === "SUCCEEDED" && "text-muted-foreground")}>
              {when(run.startedAt)}
              {run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : ""}
              {run.by ? ` · ${run.by}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where a + on an arrow puts a step, in words. */
function addLabelOf(edge: ChartEdge, flow: Flow): string {
  const name = (stepName: string) => findStep(flow, stepName)?.displayName || stepName;
  const place = edge.place!;
  if ("inBranch" in place) return `Add a step at the start of the ${edge.label ?? "branch"} branch of ${name(place.inBranch)}`;
  if ("insideLoop" in place) return `Add a step at the start of ${name(place.insideLoop)}`;
  return `Add a step after ${name(place.after)}`;
}

export function FlowFileView({ node, pieces, live, ask, version }: { node: TreeNode; pieces: AutomationManifest["pieces"]; live: AutomationLive | undefined; ask: <T>(input: AutomationInput) => Promise<T>; version: string }) {
  const { room, doc, can } = useRoom();
  const queryClient = useQueryClient();
  const text = textOf(doc, node.id);
  useYVersion(text);
  const parsed = parseFlow(text?.toString() ?? "");
  const canEdit = can("files.edit");
  const canRun = can("code.run");
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [shownRun, setShownRun] = useState<string | null>(null);
  const [payload, setPayload] = useState("{\n  \n}");
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [history, setHistory] = useState({ undo: false, redo: false });
  const undoer = useRef<Y.UndoManager | null>(null);
  const chartArea = useRef<HTMLDivElement>(null);
  const payloadHelp = useId();

  // Undo and redo take back one's own changes to this flow, not someone else's.
  useEffect(() => {
    if (!text) return;
    const manager = new Y.UndoManager(text, { captureTimeout: 600 });
    undoer.current = manager;
    const update = () => setHistory({ undo: manager.undoStack.length > 0, redo: manager.redoStack.length > 0 });
    manager.on("stack-item-added", update);
    manager.on("stack-item-popped", update);
    manager.on("stack-cleared", update);
    return () => {
      manager.destroy();
      undoer.current = null;
    };
  }, [text]);

  const runs = useQuery({ queryKey: ["automations", room.id, "runs", node.path, version], queryFn: () => ask<{ runs: AutomationRunSummary[] }>({ op: "runs", path: node.path }), staleTime: 0, retry: false });
  const latest = runs.data?.runs[0]?.id ?? null;
  const showId = shownRun ?? latest;
  const runDetails = useQuery({ queryKey: ["automations", room.id, "run", showId], queryFn: () => ask<AutomationRun>({ op: "run-details", id: showId! }), enabled: Boolean(showId), staleTime: Number.POSITIVE_INFINITY, retry: false });
  const runningHere = live?.state === "running" && live.path === node.path;
  const steps = runningHere ? live.steps : runDetails.data?.steps;
  const results = resultsOf(steps);

  if ("error" in parsed) {
    return (
      <p role="alert" className="max-w-prose p-3 text-xs text-destructive">
        {parsed.error}
      </p>
    );
  }
  const flow = parsed.flow;
  const save = (next: Flow) => setFileText(doc, node.id, `${JSON.stringify(next, null, 2)}\n`);
  const chart = chartOfFlow(flow, steps, pieces, { adds: canEdit });
  const isAdd = new Set(chart.items.filter((item) => item.shape === "add").map((item) => item.id));
  // An arrow into a + needs no + of its own when both put a step in the same place; from the end of a branch they don't, so it keeps one.
  const addPlaces = new Map(chart.items.filter((item) => item.shape === "add").map((item) => [item.id, JSON.stringify(item.place)]));
  const redundant = (edge: ChartEdge) => addPlaces.get(edge.to) === JSON.stringify(edge.place);
  const nodes = chart.items.map((item): FlowchartNode => ({ ...item, icon: item.shape === "add" ? undefined : GLYPHS[item.glyph] }));
  const edges = chart.edges.map(
    (edge): FlowchartEdge => ({
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      ...(canEdit && edge.place && !redundant(edge) ? { onAdd: () => setPicking({ mode: "add", place: edge.place! }), addLabel: addLabelOf(edge, flow) } : {}),
    }),
  );
  const step = selected ? findStep(flow, selected) : null;
  const shown = runDetails.data;
  const titleOf = (name: string) => findStep(flow, name)?.displayName || name;
  const isTrigger = (name: string) => name === flow.trigger.name;

  const focusBox = (name: string) => requestAnimationFrame(() => chartArea.current?.querySelector<HTMLElement>(`[data-chart-id="${CSS.escape(name)}"]`)?.focus());
  const run = async () => {
    if (!canRun || runningHere) return;
    setProblem(null);
    let body: unknown = {};
    if (payload.trim()) {
      try {
        body = JSON.parse(payload);
      } catch {
        setProblem("What to send isn't valid JSON.");
        return;
      }
    }
    setStarting(true);
    try {
      const started = await ask<{ id: string }>({ op: "run", path: node.path, payload: body, stateVector: stateVectorOf(doc) });
      setShownRun(started.id);
      queryClient.setQueryData(["automations", room.id, "status"], { state: "running", id: started.id, path: node.path, steps: {}, queued: 0 } satisfies AutomationLive);
      void queryClient.invalidateQueries({ queryKey: ["automations", room.id, "status"] });
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => {
    try {
      await ask({ op: "stop" });
    } catch (error) {
      setProblem(failure(error));
    }
  };

  // ---- What the menu and the keys do ----
  const remove = (name: string) => {
    if (isTrigger(name)) return;
    const before = chart.edges.find((edge) => edge.to === name && !isAdd.has(edge.from))?.from ?? flow.trigger.name;
    save(removeStep(flow, name));
    if (selected === name) setSelected(null);
    setAnnouncement(`Removed ${titleOf(name)}.`);
    focusBox(before);
  };
  const copy = (name: string) => {
    const step = copyOfStep(flow, name);
    if (!step) return false;
    copyStep(step);
    setAnnouncement(`Copied ${titleOf(name)}.`);
    return true;
  };
  const cut = (name: string) => {
    if (copy(name)) remove(name);
  };
  const paste = async (place: Place) => {
    const step = await stepToPaste();
    if (!step) {
      toast("Nothing to paste: copy a step first.");
      return;
    }
    const pasted = pasteStep(flow, place, step);
    save(pasted.flow);
    setSelected(pasted.name);
    setAnnouncement(`Pasted ${step.displayName || pasted.name}.`);
    focusBox(pasted.name);
  };
  const duplicate = (name: string) => {
    const made = duplicateStep(flow, name);
    if (!made) return;
    save(made.flow);
    setSelected(made.name);
    setAnnouncement(`Duplicated ${titleOf(name)}.`);
    focusBox(made.name);
  };
  const toggle = (name: string) => {
    const off = !findStep(flow, name)?.skip;
    save(toggleStep(flow, name));
    setAnnouncement(`${titleOf(name)} turned ${off ? "off" : "on"}.`);
  };
  const rename = (name: string) => {
    setPicking(null);
    setSelected(name);
    // The panel shows only the step selected, so its name field is the one.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>("[data-step-name]");
      input?.focus();
      input?.select();
    });
  };
  const undo = () => {
    undoer.current?.undo();
    setAnnouncement("Undone.");
  };
  const redo = () => {
    undoer.current?.redo();
    setAnnouncement("Done again.");
  };
  /** Moving between boxes: right and left follow the arrows, up and down go between branches. */
  const neighbour = (name: string, key: string): string | null => {
    const real = (id: string) => !isAdd.has(id);
    if (key === "ArrowRight") return chart.edges.find((edge) => edge.from === name && real(edge.to))?.to ?? null;
    if (key === "ArrowLeft") return chart.edges.find((edge) => edge.to === name && real(edge.from))?.from ?? null;
    const parent = chart.edges.find((edge) => edge.to === name)?.from;
    if (!parent) return null;
    const siblings = chart.edges.filter((edge) => edge.from === parent && real(edge.to)).map((edge) => edge.to);
    const at = siblings.indexOf(name);
    return siblings[at + (key === "ArrowDown" ? 1 : -1)] ?? null;
  };
  const onNodeKey = (name: string, event: KeyboardEvent<HTMLButtonElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let handled = true;
    if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(key) && !mod) {
      const to = neighbour(name, key);
      if (to) focusBox(to);
    } else if (mod && key === "Enter") void run();
    else if (mod && key === "c") copy(name);
    else if (!canEdit) handled = false;
    else if ((key === "Delete" || key === "Backspace") && !mod && !isTrigger(name)) remove(name);
    else if (mod && key === "x" && !isTrigger(name)) cut(name);
    else if (mod && key === "v") void paste({ after: name });
    else if (mod && key === "d" && !isTrigger(name)) duplicate(name);
    else if (!mod && key === "d" && !isTrigger(name)) toggle(name);
    else if (key === "F2") rename(name);
    else if (!mod && key === "n") setPicking({ mode: "add", place: { after: name } });
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const menuFor = (name: string): FlowchartMenuItem[] => {
    const current = findStep(flow, name);
    if (!current) return [];
    const trigger = isTrigger(name);
    const open: FlowchartMenuItem = { label: "Open", shortcut: "Enter", onSelect: () => setSelected(name) };
    if (!canEdit) return [open, { label: "Copy", shortcut: `${MOD}C`, disabled: trigger, onSelect: () => copy(name) }];
    return [
      open,
      { label: "Rename", shortcut: "F2", onSelect: () => rename(name) },
      ...(trigger ? [{ label: "Change the trigger", onSelect: () => setPicking({ mode: "trigger" }) }] : []),
      ...(current.type === "CODE" || current.type === "PIECE" ? [{ label: "Replace", onSelect: () => setPicking({ mode: "replace", name }) }] : []),
      ...(trigger ? [] : [{ label: current.skip ? "Turn on" : "Turn off", shortcut: "D", onSelect: () => toggle(name) }]),
      "separator",
      { label: "Add a step after", shortcut: "N", onSelect: () => setPicking({ mode: "add", place: { after: name } }) },
      ...(trigger ? [] : [{ label: "Duplicate", shortcut: `${MOD}D`, onSelect: () => duplicate(name) }]),
      { label: "Copy", shortcut: `${MOD}C`, disabled: trigger, onSelect: () => copy(name) },
      ...(trigger ? [] : [{ label: "Cut", shortcut: `${MOD}X`, onSelect: () => cut(name) }]),
      { label: "Paste after", shortcut: `${MOD}V`, onSelect: () => void paste({ after: name }) },
      ...(trigger ? [] : (["separator", { label: "Remove", shortcut: "Delete", destructive: true, onSelect: () => remove(name) }] as FlowchartMenuItem[])),
    ];
  };
  const pick = (picked: Picked) => {
    if (!picking) return;
    let made: FlowStep | null = null;
    if (picked.kind === "code") made = newCodeStep(newStepName(flow, "code"));
    else if (picked.kind === "router") made = newRouterStep(newStepName(flow, "router"));
    else if (picked.kind === "loop") made = newLoopStep(newStepName(flow, "loop"));
    else if (picked.kind === "action" && pieces[picked.pieceName]) made = newPieceStep(newStepName(flow, picked.actionName), picked.pieceName, pieces[picked.pieceName]!, picked.actionName);
    else if (picked.kind === "trigger" && pieces[picked.pieceName]) made = newTrigger(picked.pieceName, pieces[picked.pieceName]!, picked.triggerName);
    if (!made) return;
    if (picking.mode === "add") {
      save(addStep(flow, picking.place, made));
      setSelected(made.name);
      setAnnouncement(`Added ${made.displayName}.`);
    } else {
      const name = picking.mode === "replace" ? picking.name : flow.trigger.name;
      save(replaceStep(flow, name, made));
      setSelected(name);
      setAnnouncement(`Replaced with ${made.displayName}.`);
    }
    setPicking(null);
  };
  // Undo, redo and running from anywhere in the tool but a field, which has its own undo.
  const onToolKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (typing(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "enter") void run();
    else if (canEdit && key === "z" && !event.shiftKey) undo();
    else if (canEdit && (key === "y" || (key === "z" && event.shiftKey))) redo();
    else return;
    event.preventDefault();
  };

  const toolbar = canEdit ? (
    <>
      <Button size="icon-xs" variant="outline" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!history.undo} onClick={undo}>
        <Undo2 />
      </Button>
      <Button size="icon-xs" variant="outline" aria-label="Redo" title={`Redo (${MOD}${MAC ? "⇧Z" : "Y"})`} disabled={!history.redo} onClick={redo}>
        <Redo2 />
      </Button>
    </>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row" onKeyDown={onToolKey}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div ref={chartArea} className="min-h-64 min-w-0 flex-1 max-md:h-1/2">
        <Flowchart
          label="The steps of this automation"
          nodes={nodes}
          edges={edges}
          selected={selected}
          onSelect={(id) => {
            const add = chart.items.find((item) => item.id === id && item.shape === "add");
            if (add?.place) setPicking({ mode: "add", place: add.place });
            else {
              setPicking(null);
              setSelected((current) => (current === id ? null : id));
            }
          }}
          menuFor={menuFor}
          onNodeKey={onNodeKey}
          toolbar={toolbar}
        />
      </div>
      <aside aria-label="Details" className="min-h-0 w-full shrink-0 overflow-auto border-t p-3 md:w-96 md:border-t-0 md:border-l max-md:h-1/2">
        {picking ? (
          <StepPicker pieces={pieces} mode={picking.mode === "trigger" ? "trigger" : picking.mode === "replace" ? "replace" : "add"} title={picking.mode === "trigger" ? "Change the trigger" : picking.mode === "replace" ? `Replace ${titleOf(picking.name)}` : "Add a step"} onPick={pick} onCancel={() => setPicking(null)} />
        ) : step ? (
          <>
            <div className="mb-2 flex justify-end">
              <Button size="icon-xs" variant="ghost" aria-label="Back to the runs" title="Back to the runs" onClick={() => setSelected(null)}>
                <X />
              </Button>
            </div>
            <StepPanel
              key={step.name}
              flow={flow}
              step={step}
              pieces={pieces}
              result={results.get(step.name)}
              runSteps={steps && Object.keys(steps).length ? steps : undefined}
              canEdit={canEdit}
              onChange={save}
              onClose={() => setSelected(null)}
              onAdd={(place) => setPicking({ mode: "add", place })}
              onReplace={() => setPicking(isTrigger(step.name) ? { mode: "trigger" } : { mode: "replace", name: step.name })}
            />
          </>
        ) : (
          <section aria-label="Runs" className="grid content-start gap-3 text-xs">
            <div className="grid gap-1">
              <h3 className="text-[13px] font-medium">{flow.displayName}</h3>
              <p className="font-mono text-[11px] break-all text-muted-foreground">{node.path}</p>
              {canEdit ? (
                <label className="grid gap-1">
                  What it&apos;s for
                  <Textarea className="min-h-10 text-xs md:text-xs" placeholder="A sentence or two for whoever reads it next." value={flow.description ?? ""} onChange={(event) => save({ ...flow, description: event.target.value })} />
                </label>
              ) : (
                flow.description && <p className="whitespace-pre-wrap">{flow.description}</p>
              )}
            </div>
            {canRun && (
              <section aria-label="Run it" className="grid gap-1">
                <label className="grid gap-1">
                  What to send, as JSON
                  <Textarea aria-describedby={payloadHelp} className="min-h-16 font-mono text-[11px] md:text-[11px]" spellCheck={false} value={payload} onChange={(event) => setPayload(event.target.value)} />
                </label>
                <span id={payloadHelp} className="text-muted-foreground">
                  The first step gets this as {"{{trigger.output.body}}"}.
                </span>
                <div className="flex gap-1">
                  {runningHere ? (
                    <Button size="xs" variant="outline" onClick={() => void stop()}>
                      <Square /> Stop
                    </Button>
                  ) : (
                    <Button size="xs" disabled={starting} title={`Run it (${MOD}Enter)`} onClick={() => void run()}>
                      {starting ? <Loader2 className="animate-spin" /> : <Play />} Run it
                    </Button>
                  )}
                </div>
                {problem && (
                  <p role="alert" className="text-destructive">
                    {problem}
                  </p>
                )}
              </section>
            )}
            {runningHere && (
              <p role="status" className="text-muted-foreground">
                Running…{live.queued ? ` ${live.queued} more waiting.` : ""}
              </p>
            )}
            {!runningHere && shown && (
              <section aria-label="The run shown" className="grid gap-1">
                <p role="status" className={cn("font-medium", shown.status !== "SUCCEEDED" && "text-destructive")}>
                  {STATUS_WORDS[shown.status] ?? shown.status}
                  {shown.durationMs !== undefined ? ` in ${(shown.durationMs / 1000).toFixed(1)} s` : ""}
                </p>
                {shown.message && shown.status !== "SUCCEEDED" && (
                  <p className="break-words text-destructive">
                    {shown.failedStep?.displayName ? `${shown.failedStep.displayName}: ` : ""}
                    {(() => {
                      try {
                        return (JSON.parse(shown.message) as { message?: string }).message ?? shown.message;
                      } catch {
                        return shown.message;
                      }
                    })()}
                  </p>
                )}
                <p className="text-muted-foreground">Select a step to see what went in and what came out.</p>
              </section>
            )}
            <section aria-label="Earlier runs" className="grid gap-1">
              <h4 className="font-medium">Runs</h4>
              {runs.isError ? <p className="text-destructive">{failure(runs.error)}</p> : <RunsList runs={runs.data?.runs ?? []} shownId={showId} onShow={setShownRun} />}
            </section>
            <p className="text-muted-foreground">
              {canEdit ? "Select a box to change it, or use a + to add a step. Right-click a box, or focus it and press its keys: N adds, D turns off, F2 renames, Delete removes, and the arrows move between boxes." : "Select a box to see it, and what it did on a run."}
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
