/** The Flow tool: a room's data as a chart of datasets and the recipes that make them, as Dataiku shows it. It's a real dbt project in the room's files, which dbt Core reads and builds on DuckDB in the sandbox, so what's made here runs anywhere dbt does. */
"use client";

import type { FlowDataset, FlowGraph, FlowInput, FlowLive, FlowRunSummary } from "@codechatter/contracts";
import { createFileAtPath, findByPath, flatten } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FileSpreadsheet, GitFork, Hammer, Loader2, Play, RotateCw, Square, Table2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Flowchart, type FlowchartNode } from "@/components/flowchart/flowchart";
import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DatasetPanel, RecipePanel } from "./dataset-panel";
import { createExampleProject } from "./example";
import { chartOf, datasetIdOf, inProject, isRecipeId, recipesFolder, type Glyph } from "./model";
import { NewRecipe } from "./new-recipe";
import { FRESH, failure, when, type Ask } from "./shared";

const GLYPHS: Record<Glyph, FlowchartNode["icon"]> = { seed: FileSpreadsheet, source: Database, table: Table2 };
const STATE_WORDS: Record<FlowLive["state"], string> = { idle: "Nothing built yet", running: "Building", succeeded: "Built", warned: "Built, with warnings", failed: "The build failed", stopped: "The build was stopped" };
const MOST_CSV_BYTES = 2 * 1024 * 1024;
const NOTHING_BUILDING: Record<string, string> = {};
// A new file takes a moment to reach the sandbox, and dbt a few seconds to read it: this looks again until it has.
const LOOK_AGAIN_MS = [1200, 4000, 8000];

function Counts({ live }: { live: Pick<FlowLive, "counts"> }) {
  if (!live.counts) return null;
  const { done, warned, failed, skipped } = live.counts;
  return (
    <span className="tabular-nums">
      {[`${done} fine`, warned ? `${warned} warned` : "", failed ? `${failed} failed` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join(", ")}
    </span>
  );
}

function Log({ lines, label }: { lines: string[]; label: string }) {
  const end = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (end.current) end.current.scrollTop = end.current.scrollHeight;
  }, [lines.length]);
  return (
    <pre ref={end} tabIndex={0} role="group" aria-label={label} className="max-h-72 overflow-auto rounded-md border bg-chrome p-2 font-mono text-[11px] whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {lines.join("\n") || "Nothing yet."}
    </pre>
  );
}

function BuildsPanel({ live, ask, canRun }: { live: FlowLive | undefined; ask: Ask; canRun: boolean }) {
  const { room } = useRoom();
  const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["flow", room.id, "runs", live?.id, live?.state], queryFn: () => ask<{ runs: FlowRunSummary[] }>({ op: "runs" }), ...FRESH });
  const run = useQuery({ queryKey: ["flow", room.id, "run", open], queryFn: () => ask<FlowLive>({ op: "run", id: open! }), ...FRESH, enabled: Boolean(open) });
  return (
    <section aria-label="Builds" className="grid min-w-0 content-start gap-2 text-xs">
      <div>
        <h3 className="text-[13px] font-medium">{STATE_WORDS[live?.state ?? "idle"]}</h3>
        {live?.id && (
          <p className="text-muted-foreground">
            {live.by ? `${live.by}, ` : ""}
            {when(live.startedAt)}
            {live.counts ? " · " : ""}
            <Counts live={live} />
          </p>
        )}
        {!live?.id && <p className="text-muted-foreground">{canRun ? "Press Build all, or select something on the chart to see it and build just that." : "Select something on the chart to see it."}</p>}
      </div>
      {live?.message && (
        <p role="alert" className="whitespace-pre-wrap text-destructive">
          {live.message}
        </p>
      )}
      {live?.id && <Log lines={live.log} label="What dbt said" />}
      {Boolean(runs.data?.runs.length) && (
        <section aria-label="Earlier builds" className="grid gap-1">
          <h4 className="font-medium">Earlier builds</h4>
          <ul className="grid gap-1">
            {runs.data!.runs.map((item) => (
              <li key={item.id}>
                <button type="button" aria-expanded={open === item.id} className={cn("flex min-h-6 w-full flex-wrap items-center gap-x-2 rounded-sm px-1 text-left hover:bg-accent", open === item.id && "bg-accent", item.state === "failed" && "font-medium text-destructive")} onClick={() => setOpen(open === item.id ? null : item.id)}>
                  <span>{STATE_WORDS[item.state]}</span>
                  <span className={cn(item.state !== "failed" && "text-muted-foreground")}>
                    {item.dataset ? `${item.dataset} · ` : ""}
                    {when(item.startedAt)}
                    {item.by ? ` · ${item.by}` : ""}
                  </span>
                </button>
                {open === item.id && run.data && <Log lines={run.data.log} label={`What dbt said, ${when(item.startedAt)}`} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function Empty({ canEdit, onExample }: { canEdit: boolean; onExample: () => void }) {
  return (
    <div className="grid max-w-prose gap-2 p-3">
      <h3 className="font-medium">See how your data is made</h3>
      <p className="text-xs text-muted-foreground">A chart of your datasets and the recipes that make them: SQL or Python, with checks that keep the data honest and a profile of each dataset. It runs on dbt and DuckDB in this room&apos;s sandbox, so a project made here works anywhere dbt does.</p>
      <p className="text-xs text-muted-foreground">
        Any folder with a <span className="font-mono">dbt_project.yml</span> shows up here.
      </p>
      {canEdit && (
        <div>
          <Button size="xs" onClick={onExample}>
            <Play /> Make an example project
          </Button>
        </div>
      )}
    </div>
  );
}

export default function FlowTool({ openFile }: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const tree = useFileTree();
  const queryClient = useQueryClient();
  const canEdit = can("files.edit");
  const canRun = can("code.run");
  const ask = useCallback<Ask>(<T,>(input: FlowInput) => api<T>(`/api/rooms/${room.id}/flow`, { method: "POST", json: input }), [room.id]);

  const graph = useQuery({ queryKey: ["flow", room.id, "graph"], queryFn: () => ask<FlowGraph>({ op: "graph" }), ...FRESH });
  const status = useQuery({
    queryKey: ["flow", room.id, "status"],
    queryFn: () => ask<FlowLive>({ op: "status" }),
    staleTime: 0,
    retry: false,
    // While someone's building, what's happening shows as it happens; anyone with this open sees it start.
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1000 : 8000),
  });
  const live = status.data ?? graph.data?.live;
  const running = live?.state === "running";
  const building = running ? live.nodes : NOTHING_BUILDING;
  const version = `${live?.id ?? "none"}-${live?.state ?? "idle"}`;

  // A build has ended: what's on the chart and in the panels is out of date.
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    if (!running) void queryClient.invalidateQueries({ queryKey: ["flow", room.id, "graph"] });
  }, [version, running, queryClient, room.id]);

  // Files were added or taken away under the project, by this tool or anyone else.
  const project = graph.data?.project ?? null;
  const shape = useMemo(() => {
    const prefix = !project ? null : project.path === "." ? "" : `${project.path}/`;
    return flatten(tree)
      .filter((node) => node.kind === "file" && (prefix === null ? node.name === "dbt_project.yml" : node.path.startsWith(prefix)))
      .map((node) => node.path)
      .sort()
      .join("\n");
  }, [tree, project]);
  const seenShape = useRef(shape);
  useEffect(() => {
    if (seenShape.current === shape) return;
    seenShape.current = shape;
    const timers = LOOK_AGAIN_MS.map((ms) => setTimeout(() => void graph.refetch({ cancelRefetch: false }), ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable enough; only the files say when.
  }, [shape]);

  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ from: FlowDataset | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);

  // A file just made isn't in the workspace's list until the tree has caught up, and opening it closes this tool.
  useEffect(() => {
    if (!wanted) return;
    const node = flatten(tree).find((item) => item.path === wanted);
    if (node) openFile(node.id);
  }, [wanted, tree, openFile]);

  const build = async (input: Extract<FlowInput, { op: "build" }>) => {
    setProblem(null);
    try {
      const started = await ask<FlowLive>(input);
      queryClient.setQueryData(["flow", room.id, "status"], started);
    } catch (error) {
      setProblem(failure(error));
    }
  };
  const stop = async () => {
    try {
      await ask<FlowLive>({ op: "stop" });
    } catch (error) {
      setProblem(failure(error));
    }
  };

  const select = useCallback((id: string) => {
    setCreating(null);
    setSelected((current) => (current === id ? null : id));
  }, []);

  const data = graph.data;
  const chart = useMemo(() => {
    if (!data) return { nodes: [] as FlowchartNode[], edges: [] };
    const { items, edges } = chartOf(data, live);
    return { nodes: items.map((item): FlowchartNode => ({ ...item, icon: item.glyph ? GLYPHS[item.glyph] : undefined })), edges };
  }, [data, live]);

  const chosen = selected && data ? (data.datasets.find((dataset) => dataset.id === datasetIdOf(selected)) ?? null) : null;
  const folder = project && data ? recipesFolder(project, data.datasets) : "models";
  const csvInput = useRef<HTMLInputElement>(null);

  const addCsv = async (file: File) => {
    setProblem(null);
    if (!project) return;
    if (file.size > MOST_CSV_BYTES) return setProblem("That file is over 2 MB. Files this size are for small tables: larger ones are better read from where they are, with a source.");
    const safe = file.name.toLowerCase().replace(/\.csv$/, "").replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z_]+/, "") || "data";
    const path = inProject(project, `seeds/${safe}.csv`);
    if (findByPath(doc, path)) return setProblem(`This project already has ${path}.`);
    createFileAtPath(doc, path, await file.text(), me.user.id);
  };

  return (
    <section aria-label="Flow" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <GitFork className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Flow</h2>
        {project && (
          <span className="truncate font-mono text-xs text-muted-foreground" title={project.path}>
            {project.name}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {project && canEdit && !creating && (
            <>
              <Button size="xs" variant="ghost" onClick={() => csvInput.current?.click()}>
                <Upload /> Add a CSV
              </Button>
              <input
                ref={csvInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="A CSV file to add"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void addCsv(file);
                }}
              />
              <Button size="xs" variant="ghost" onClick={() => setCreating({ from: null })}>
                New recipe
              </Button>
            </>
          )}
          {project &&
            canRun &&
            (running ? (
              <Button size="xs" variant="outline" onClick={() => void stop()}>
                <Square /> Stop
              </Button>
            ) : (
              <Button size="xs" onClick={() => void build({ op: "build", dataset: null, scope: "needs", fresh: false })}>
                <Hammer /> Build all
              </Button>
            ))}
          <Button size="xs" variant="ghost" disabled={graph.isFetching} onClick={() => void graph.refetch()}>
            {graph.isFetching ? <Loader2 className="animate-spin" /> : <RotateCw />} Look again
          </Button>
        </div>
      </header>

      {problem && (
        <p role="alert" className="shrink-0 border-b px-3 py-1 text-xs text-destructive">
          {problem}
        </p>
      )}

      {graph.isPending ? (
        <div role="status" aria-label="Reading the project" aria-busy className="grid gap-2 p-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : graph.isError ? (
        <p role="alert" className="max-w-prose p-3 text-xs text-destructive">
          {failure(graph.error)}
        </p>
      ) : !data?.project ? (
        <Empty canEdit={canEdit} onExample={() => createExampleProject(doc, me.user.id)} />
      ) : (
        <>
          {data.problem && (
            <div role="alert" className="shrink-0 border-b px-3 py-1 text-xs">
              <p className="font-medium text-destructive">dbt can&apos;t read this project{data.datasets.length ? ", so this is how it last was" : ""}:</p>
              <pre className="max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{data.problem}</pre>
            </div>
          )}
          {data.project.others > 0 && <p className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">This room has {data.project.others + 1} dbt projects. This shows the one nearest the top, in {data.project.path}.</p>}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="min-h-64 min-w-0 flex-1 max-md:h-1/2">
              {chart.nodes.length ? (
                <Flowchart label="Datasets and the recipes that make them" nodes={chart.nodes} edges={chart.edges} selected={selected} onSelect={select} />
              ) : (
                <p className="p-3 text-xs text-muted-foreground">
                  Nothing in this project yet. Put a CSV in <span className="font-mono">seeds/</span>, or a recipe in <span className="font-mono">models/</span>.
                </p>
              )}
            </div>
            <aside aria-label="Details" className="min-h-0 w-full shrink-0 overflow-auto border-t p-3 md:w-80 md:border-t-0 md:border-l max-md:h-1/2">
              {(chosen || creating) && (
                <div className="mb-2 flex justify-end">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Back to the builds"
                    title="Back to the builds"
                    onClick={() => {
                      setSelected(null);
                      setCreating(null);
                    }}
                  >
                    <X />
                  </Button>
                </div>
              )}
              {creating ? (
                <NewRecipe
                  key={creating.from?.id ?? "blank"}
                  from={creating.from}
                  datasets={data.datasets}
                  folder={folder}
                  ask={ask}
                  onCancel={() => setCreating(null)}
                  onMade={(path, openCode) => {
                    setCreating(null);
                    if (openCode) setWanted(path);
                  }}
                />
              ) : chosen ? (
                selected && isRecipeId(selected) ? (
                  <RecipePanel dataset={chosen} graph={data} building={building} onOpenFile={setWanted} />
                ) : (
                  <DatasetPanel key={chosen.id} dataset={chosen} graph={data} building={building} ask={ask} version={version} canEdit={canEdit} canRun={canRun} busy={running} onBuild={(input) => void build(input)} onOpenFile={setWanted} onNewRecipe={(from) => setCreating({ from })} />
                )
              ) : (
                <BuildsPanel live={live} ask={ask} canRun={canRun} />
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
