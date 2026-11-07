/** The Lakehouse tool: a room's Delta Lake tables with every version readable, and its MLflow runs side by side. Spark, Delta Lake and MLflow are what Databricks is built on; here they run in the room's sandbox. */
"use client";

import { runColumns, type LakehouseCommit, type LakehouseInput, type LakehousePreview, type LakehouseRun, type LakehouseTable } from "@codechatter/contracts";
import { flatten } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, RotateCw, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";

import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { ExplainDataButton } from "@/components/room/tools/ai/explain-data";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { createExampleNotebook, EXAMPLE_NOTEBOOK } from "./example";

const whole = (value: number) => value.toLocaleString();
const when = (at: number | null) => (at ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }) : "–");
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
// What's in the lakehouse changes outside this tool, when a notebook runs: it looks again each time it's opened.
const FRESH = { staleTime: 0, refetchOnMount: "always", retry: false } as const;
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");

function useAsk() {
  const { room } = useRoom();
  return <T,>(input: LakehouseInput) => api<T>(`/api/rooms/${room.id}/lakehouse`, { method: "POST", json: input });
}

function Rows({ preview }: { preview: LakehousePreview }) {
  return (
    <section aria-label="Its rows" className="grid gap-1">
      <div tabIndex={0} role="group" aria-label={`Rows of ${preview.table}`} className="max-h-96 overflow-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-max min-w-full border-collapse font-mono text-xs">
          <caption className="sr-only">
            {preview.table}
            {preview.version !== null && `, version ${preview.version}`}
          </caption>
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {preview.columns.map((column) => (
                <th key={column} scope="col" className="border-b px-2 py-1 text-left font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index} className="even:bg-muted/30">
                {row.map((value, cell) => (
                  <td key={cell} className="max-w-80 truncate border-b px-2 py-1">
                    {value === null ? <span className="text-muted-foreground italic">NULL</span> : value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {preview.truncated ? `The first ${preview.rows.length} rows.` : `${preview.rows.length} ${preview.rows.length === 1 ? "row" : "rows"}.`}
          {preview.version !== null && ` As it was at version ${preview.version}.`}
        </p>
        {preview.rows.length > 0 && <ExplainDataButton table={{ columns: preview.columns, rows: preview.rows, source: "query", complete: !preview.truncated }} />}
      </div>
    </section>
  );
}

function TableView({ table }: { table: LakehouseTable }) {
  const ask = useAsk();
  const { room } = useRoom();
  const [version, setVersion] = useState<number | null>(null);
  const commits = useQuery({ queryKey: ["lakehouse", room.id, "history", table.name, table.version], queryFn: () => ask<{ commits: LakehouseCommit[] }>({ op: "history", table: table.name }), ...FRESH });
  const rows = useQuery({ queryKey: ["lakehouse", room.id, "preview", table.name, version ?? `latest-${table.version}`], queryFn: () => ask<LakehousePreview>({ op: "preview", table: table.name, version }), ...FRESH });
  return (
    <section aria-label={`Table ${table.name}`} className="grid min-w-0 content-start gap-3">
      <div>
        <h3 className="font-mono font-medium">{table.name}</h3>
        <p className="text-xs text-muted-foreground">
          {table.rows === null ? "Rows not known" : `${whole(table.rows)} ${table.rows === 1 ? "row" : "rows"}`} · {table.versions} {table.versions === 1 ? "version" : "versions"} · {size(table.bytes)} · changed {when(table.at)}
        </p>
        {table.problem && <p className="text-xs text-destructive">{table.problem}</p>}
      </div>
      {table.columns.length > 0 && (
        <p className="text-xs">
          {table.columns.map((column, index) => (
            <span key={column.name}>
              {index > 0 && ", "}
              <span className="font-mono">{column.name}</span> <span className="text-muted-foreground">{column.type}</span>
            </span>
          ))}
        </p>
      )}
      {rows.isPending && <Skeleton className="h-32 w-full" />}
      {rows.isError && (
        <p role="alert" className="text-xs text-destructive">
          {failure(rows.error)}
        </p>
      )}
      {rows.data && <Rows preview={rows.data} />}
      <section aria-label="Its versions" className="grid gap-1">
        <h4 className="text-xs font-medium">Versions</h4>
        <p className="text-xs text-muted-foreground">Every change is a version, and each can still be read. Open one to see the table as it was.</p>
        {commits.isError && <p className="text-xs text-destructive">{failure(commits.error)}</p>}
        {commits.data && (
          <div tabIndex={0} role="group" aria-label={`Versions of ${table.name}`} className="overflow-x-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">Each version of {table.name}, newest first</caption>
              <thead className="bg-chrome">
                <tr>
                  {["Version", "When", "What", "Rows written", "Rows changed"].map((name) => (
                    <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commits.data.commits.map((commit, index) => {
                  const shown = version === commit.version || (version === null && index === 0);
                  return (
                    <tr key={commit.version} className={cn(shown && "bg-accent")}>
                      <td className="border-b px-2 py-1">
                        <button type="button" aria-pressed={shown} aria-label={`Open version ${commit.version}`} className="min-h-6 rounded-sm tabular-nums underline-offset-2 hover:underline" onClick={() => setVersion(index === 0 ? null : commit.version)}>
                          {commit.version}
                        </button>
                      </td>
                      <td className="border-b px-2 py-1 whitespace-nowrap">{when(commit.at)}</td>
                      <td className="border-b px-2 py-1">{commit.operation}</td>
                      <td className="border-b px-2 py-1 tabular-nums">{commit.rowsWritten ?? "–"}</td>
                      <td className="border-b px-2 py-1 tabular-nums">{commit.rowsChanged ?? "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function Tables({ tables, onExample, canCreate }: { tables: LakehouseTable[]; onExample: () => void; canCreate: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = tables.find((table) => table.name === selected) ?? tables[0] ?? null;
  if (!current) {
    return (
      <div className="grid max-w-prose gap-2">
        <h3 className="font-medium">A lakehouse, in this room</h3>
        <p className="text-xs text-muted-foreground">Process data with Apache Spark, keep it in Delta Lake tables with every version readable, and track experiments with MLflow: the open-source tools Databricks is built on. Tables made in this room&apos;s notebooks and scripts show up here.</p>
        <pre className="w-fit rounded-md border bg-chrome p-2 font-mono text-xs">{`from lakehouse import session\nspark = session()`}</pre>
        {canCreate && (
          <div>
            <Button size="xs" onClick={onExample}>
              <Play /> Open an example notebook
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Tables in this room" className="flex flex-wrap content-start gap-1 md:flex-col md:flex-nowrap">
        {tables.map((table) => (
          <button key={table.name} type="button" aria-current={table.name === current.name ? "true" : undefined} className={cn("min-h-6 truncate rounded-sm px-2 text-left font-mono text-xs hover:bg-accent", table.name === current.name && "bg-accent font-medium")} onClick={() => setSelected(table.name)}>
            {table.name}
          </button>
        ))}
      </nav>
      <TableView key={current.name} table={current} />
    </div>
  );
}

function Experiments() {
  const ask = useAsk();
  const { room } = useRoom();
  const runs = useQuery({ queryKey: ["lakehouse", room.id, "runs"], queryFn: () => ask<{ runs: LakehouseRun[] }>({ op: "runs" }), ...FRESH });
  if (runs.isPending) return <Skeleton className="h-32 w-full" />;
  if (runs.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {failure(runs.error)}
      </p>
    );
  }
  const list = runs.data.runs;
  if (!list.length) {
    return (
      <div className="grid max-w-prose gap-2">
        <p className="text-xs text-muted-foreground">No runs yet. Whatever code in this room logs with MLflow shows up here, side by side.</p>
        <pre className="w-fit rounded-md border bg-chrome p-2 font-mono text-xs">{`import mlflow\nwith mlflow.start_run(run_name="first try"):\n    mlflow.log_param("alpha", 0.5)\n    mlflow.log_metric("rmse", 0.12)`}</pre>
      </div>
    );
  }
  const { params, metrics } = runColumns(list);
  return (
    <div tabIndex={0} role="group" aria-label="MLflow runs" className="overflow-x-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">This room&apos;s MLflow runs, newest first, with what each tried and what came of it</caption>
        <thead className="bg-chrome">
          <tr>
            {["Run", "Experiment", "When", "Result"].map((name) => (
              <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                {name}
              </th>
            ))}
            {params.map((name) => (
              <th key={`p-${name}`} scope="col" className="border-b px-2 py-1 text-left font-mono font-normal whitespace-nowrap">
                {name}
              </th>
            ))}
            {metrics.map((name) => (
              <th key={`m-${name}`} scope="col" className="border-b px-2 py-1 text-left font-mono font-medium whitespace-nowrap">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((run) => (
            <tr key={run.id}>
              <th scope="row" className="border-b px-2 py-1 text-left font-normal whitespace-nowrap">
                {run.name}
              </th>
              <td className="border-b px-2 py-1 whitespace-nowrap">{run.experiment}</td>
              <td className="border-b px-2 py-1 whitespace-nowrap">{when(run.at)}</td>
              <td className={cn("border-b px-2 py-1 whitespace-nowrap", run.status === "FAILED" && "font-medium text-destructive")}>{run.status === "FINISHED" ? "Finished" : run.status === "FAILED" ? "Failed" : run.status === "RUNNING" ? "Running" : run.status}</td>
              {params.map((name) => (
                <td key={`p-${name}`} className="border-b px-2 py-1 font-mono">
                  {run.params[name] ?? "–"}
                </td>
              ))}
              {metrics.map((name) => (
                <td key={`m-${name}`} className="border-b px-2 py-1 font-mono tabular-nums">
                  {run.metrics[name] ?? "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LakehouseTool({ openFile }: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const tree = useFileTree();
  const ask = useAsk();
  const [view, setView] = useState<"tables" | "experiments">("tables");
  const tables = useQuery({ queryKey: ["lakehouse", room.id, "overview"], queryFn: () => ask<{ tables: LakehouseTable[] }>({ op: "overview" }), ...FRESH });

  // A file just made isn't in the workspace's list until the tree has caught up, and opening it closes this tool.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    if (wanted && flatten(tree).some((node) => node.id === wanted)) openFile(wanted);
  }, [wanted, tree, openFile]);

  const openExample = () => {
    const existing = flatten(tree).find((node) => node.path === EXAMPLE_NOTEBOOK);
    setWanted(existing?.id ?? createExampleNotebook(doc, me.user.id));
  };

  return (
    <section aria-label="Lakehouse" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Warehouse className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Lakehouse</h2>
        <div role="group" aria-label="What to look at" className="flex items-center gap-1">
          <Button size="xs" variant={view === "tables" ? "secondary" : "ghost"} aria-pressed={view === "tables"} onClick={() => setView("tables")}>
            Tables
          </Button>
          <Button size="xs" variant={view === "experiments" ? "secondary" : "ghost"} aria-pressed={view === "experiments"} onClick={() => setView("experiments")}>
            Experiments
          </Button>
        </div>
        <Button size="xs" variant="ghost" className="ml-auto" disabled={tables.isFetching} onClick={() => void tables.refetch()}>
          {tables.isFetching ? <Loader2 className="animate-spin" /> : <RotateCw />} Look again
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {view === "experiments" ? (
          <Experiments />
        ) : tables.isPending ? (
          <div role="status" className="grid gap-2" aria-label="Reading the lakehouse" aria-busy>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : tables.isError ? (
          <p role="alert" className="max-w-prose text-xs text-destructive">
            {failure(tables.error)}
          </p>
        ) : (
          <Tables tables={tables.data.tables} onExample={openExample} canCreate={can("files.edit")} />
        )}
      </div>
    </section>
  );
}
