/** The Automations tool: flows as a chart of boxes and arrows, with what ran and failed lit up on it and the data at every step, as n8n shows them. Each flow is a file in the room in Activepieces' own format, run in the room's sandbox by Activepieces' real engine and pieces. */
"use client";

import { isFlowFile, type AutomationInput, type AutomationLive, type AutomationManifest, type AutomationRun, type AutomationRunSummary } from "@codechatter/contracts";
import { createFileAtPath, findByPath, flatten, setFileText, textOf, type TreeNode } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, FileCode, GitBranch, Loader2, Play, Plus, Puzzle, Repeat, Square, Workflow, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import * as Y from "yjs";

import { Flowchart, type FlowchartNode } from "@/components/flowchart/flowchart";
import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { useYVersion } from "@/components/room/tools/api-studio/connection";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { ExamplesView } from "./examples-view";
import { chartOfFlow, findStep, newTrigger, parseFlow, resultsOf, SCHEMA_VERSION, type Flow, type Glyph } from "./model";
import { StepPanel } from "./step-panel";

const GLYPHS: Record<Glyph, FlowchartNode["icon"]> = { trigger: Zap, code: Code2, piece: Puzzle, router: GitBranch, loop: Repeat };
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }) : "–");
const STATUS_WORDS: Record<string, string> = { SUCCEEDED: "Finished", FAILED: "Failed", STOPPED: "Stopped", TIMEOUT: "Took too long", RUNNING: "Running", PAUSED: "Paused" };
const WEBHOOK = "@activepieces/piece-webhook";

function stateVectorOf(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A file name from a name someone chose. */
const fileNameOf = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "automation"}.flow.json`;

export function newFlowFile(doc: Y.Doc, by: string, flow: Flow, taken: (path: string) => boolean): string {
  const base = fileNameOf(flow.displayName);
  let path = `automations/${base}`;
  for (let copy = 2; taken(path); copy++) path = `automations/${base.replace(/\.flow\.json$/, `-${copy}.flow.json`)}`;
  createFileAtPath(doc, path, `${JSON.stringify({ id: `flow_${crypto.randomUUID()}`, ...flow }, null, 2)}\n`, by);
  return path;
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

function FlowFileView({ node, pieces, live, ask, version }: { node: TreeNode; pieces: AutomationManifest["pieces"]; live: AutomationLive | undefined; ask: <T>(input: AutomationInput) => Promise<T>; version: string }) {
  const { room, doc, can } = useRoom();
  const queryClient = useQueryClient();
  const text = textOf(doc, node.id);
  useYVersion(text);
  const parsed = parseFlow(text?.toString() ?? "");
  const canEdit = can("files.edit");
  const canRun = can("code.run");
  const [selected, setSelected] = useState<string | null>(null);
  const [shownRun, setShownRun] = useState<string | null>(null);
  const [payload, setPayload] = useState("{\n  \n}");
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const payloadHelp = useId();

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
  const chart = chartOfFlow(flow, steps, pieces);
  const nodes = chart.items.map((item): FlowchartNode => ({ ...item, icon: GLYPHS[item.glyph] }));
  const step = selected ? findStep(flow, selected) : null;
  const shown = runDetails.data;

  const run = async () => {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="min-h-64 min-w-0 flex-1 max-md:h-1/2">
        <Flowchart label="The steps of this automation" nodes={nodes} edges={chart.edges} selected={selected} onSelect={(id) => setSelected((current) => (current === id ? null : id))} />
      </div>
      <aside aria-label="Details" className="min-h-0 w-full shrink-0 overflow-auto border-t p-3 md:w-96 md:border-t-0 md:border-l max-md:h-1/2">
        {step ? (
          <>
            <div className="mb-2 flex justify-end">
              <Button size="icon-xs" variant="ghost" aria-label="Back to the runs" title="Back to the runs" onClick={() => setSelected(null)}>
                <X />
              </Button>
            </div>
            <StepPanel key={step.name} flow={flow} step={step} pieces={pieces} result={results.get(step.name)} canEdit={canEdit} onChange={save} onClose={() => setSelected(null)} />
          </>
        ) : (
          <section aria-label="Runs" className="grid content-start gap-3 text-xs">
            <div>
              <h3 className="text-[13px] font-medium">{flow.displayName}</h3>
              <p className="font-mono text-[11px] break-all text-muted-foreground">{node.path}</p>
            </div>
            {canRun && (
              <section aria-label="Run it" className="grid gap-1">
                <label className="grid gap-1">
                  What to send, as JSON
                  <Textarea aria-describedby={payloadHelp} className="min-h-16 font-mono text-[11px] md:text-[11px]" spellCheck={false} value={payload} onChange={(event) => setPayload(event.target.value)} />
                </label>
                <span id={payloadHelp} className="text-muted-foreground">The first step gets this as {"{{trigger.output.body}}"}.</span>
                <div className="flex gap-1">
                  {runningHere ? (
                    <Button size="xs" variant="outline" onClick={() => void stop()}>
                      <Square /> Stop
                    </Button>
                  ) : (
                    <Button size="xs" disabled={starting} onClick={() => void run()}>
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
                {shown.message && shown.status !== "SUCCEEDED" && <p className="break-words text-destructive">{shown.failedStep?.displayName ? `${shown.failedStep.displayName}: ` : ""}{(() => { try { return (JSON.parse(shown.message) as { message?: string }).message ?? shown.message; } catch { return shown.message; } })()}</p>}
                <p className="text-muted-foreground">Select a step to see what went in and what came out.</p>
              </section>
            )}
            <section aria-label="Earlier runs" className="grid gap-1">
              <h4 className="font-medium">Runs</h4>
              {runs.isError ? <p className="text-destructive">{failure(runs.error)}</p> : <RunsList runs={runs.data?.runs ?? []} shownId={showId} onShow={setShownRun} />}
            </section>
            <p className="text-muted-foreground">
              Select any box to change it, and add what comes next. This flow is a file in the room, so everyone edits it together.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

export default function AutomationsTool({ openFile }: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const tree = useFileTree();
  const queryClient = useQueryClient();
  const canEdit = can("files.edit");
  const ask = <T,>(input: AutomationInput) => api<T>(`/api/rooms/${room.id}/automations`, { method: "POST", json: input });

  const manifest = useQuery({ queryKey: ["automations", "manifest", room.id], queryFn: () => ask<AutomationManifest>({ op: "manifest" }), staleTime: Number.POSITIVE_INFINITY, retry: false });
  const status = useQuery({
    queryKey: ["automations", room.id, "status"],
    queryFn: () => ask<AutomationLive>({ op: "status" }),
    staleTime: 0,
    retry: false,
    // While something's running, each step shows as it happens; anyone with this open sees it.
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1000 : 8000),
  });
  const live = status.data;
  const version = `${live?.id ?? "none"}-${live?.state ?? "idle"}`;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    if (live?.state !== "running") void queryClient.invalidateQueries({ queryKey: ["automations", room.id, "run"] });
  }, [version, live?.state, queryClient, room.id]);

  const flows = flatten(tree).filter((node) => node.kind === "file" && !node.blob && isFlowFile(node.name));
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "examples">("flow");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [wanted, setWanted] = useState<string | null>(null);
  const current = flows.find((node) => node.path === (wanted ?? chosen)) ?? flows.find((node) => node.path === chosen) ?? flows[0] ?? null;
  // A file just made isn't in the list until the tree has caught up.
  if (wanted && flows.some((node) => node.path === wanted)) {
    setChosen(wanted);
    setWanted(null);
  }

  const pieces = manifest.data?.pieces;
  const taken = (path: string) => Boolean(findByPath(doc, path));
  const addFlow = (flow: Flow) => {
    setWanted(newFlowFile(doc, me.user.id, flow, taken));
    setView("flow");
  };
  const create = () => {
    const webhook = pieces?.[WEBHOOK];
    if (!webhook || !name.trim()) return;
    addFlow({ displayName: name.trim(), schemaVersion: SCHEMA_VERSION, trigger: newTrigger(WEBHOOK, webhook, "catch_webhook") });
    setName("");
    setNaming(false);
  };

  return (
    <section aria-label="Automations" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <Workflow className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Automations</h2>
        {flows.length > 0 && view === "flow" && (
          <select aria-label="Automation to show" className="h-7 max-w-64 rounded-md border bg-background px-2 text-xs" value={current?.path ?? ""} onChange={(event) => setChosen(event.target.value)}>
            {flows.map((node) => (
              <option key={node.id} value={node.path}>
                {node.name.replace(/\.flow\.json$/i, "")}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canEdit && current && view === "flow" && (
            <Button size="xs" variant="ghost" onClick={() => openFile(current.id)}>
              <FileCode /> Its file
            </Button>
          )}
          <Button size="xs" variant={view === "examples" ? "secondary" : "ghost"} aria-pressed={view === "examples"} onClick={() => setView(view === "examples" ? "flow" : "examples")}>
            Examples
          </Button>
          {canEdit && pieces &&
            (naming ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  create();
                }}
              >
                <Input autoFocus aria-label="Name of the new automation" className="h-7 w-48 text-xs" value={name} onChange={(event) => setName(event.target.value)} />
                <Button size="xs" type="submit">
                  Make it
                </Button>
                <Button size="xs" type="button" variant="ghost" onClick={() => setNaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button size="xs" onClick={() => setNaming(true)}>
                <Plus /> New automation
              </Button>
            ))}
        </div>
      </header>

      {manifest.isPending ? (
        <div role="status" aria-label="Reading what's available" aria-busy className="grid gap-2 p-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : manifest.isError ? (
        <p role="alert" className="max-w-prose p-3 text-xs text-destructive">
          {failure(manifest.error)}
        </p>
      ) : view === "examples" ? (
        <ExamplesView pieces={pieces ?? {}} canEdit={canEdit} onUse={addFlow} />
      ) : !current ? (
        <div className="grid max-w-prose gap-2 p-3">
          <h3 className="font-medium">Make things happen by themselves</h3>
          <p className="text-xs text-muted-foreground">An automation is a chart of steps: something starts it, and each step passes on what it found. Steps can be code, or real services like GitHub and Slack, and they run in this room&apos;s sandbox, so what one room keeps stays in that room.</p>
          <p className="text-xs text-muted-foreground">Each is a file in this room, and you can see what every step took in and gave out on every run.</p>
          <div>
            <Button size="xs" onClick={() => setView("examples")}>
              See the examples
            </Button>
          </div>
        </div>
      ) : pieces ? (
        <FlowFileView key={current.id} node={current} pieces={pieces} live={live} ask={ask} version={version} />
      ) : null}
    </section>
  );
}
