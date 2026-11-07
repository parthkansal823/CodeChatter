/** The Flow tool's side panel for what's selected on the chart: a dataset's rows, profile and checks, or a recipe and how it last went. */
"use client";

import type { FlowCheck, FlowDataset, FlowGraph, FlowInput, FlowProfile, FlowRows } from "@codechatter/contracts";
import { createFileAtPath, findByPath, trash } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, FileCode, Hammer, Loader2, Minus, Plus, SkipForward, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { DataRows } from "@/components/room/tools/data-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { checkLabel, checksOf, COLUMN_RULES, canRemoveCheck, hasRecipe, newCheck, statusOf, type CheckRule, type ChartStatus } from "./model";
import { FRESH, failure, field, when, type Ask } from "./shared";

const STATUS_ICONS: Record<ChartStatus, { icon: typeof Check; className: string; words: string }> = {
  idle: { icon: Minus, className: "text-muted-foreground", words: "Not run yet" },
  running: { icon: Loader2, className: "animate-spin text-brand-text", words: "Running" },
  ok: { icon: Check, className: "text-success", words: "Passed" },
  warning: { icon: AlertTriangle, className: "text-warning", words: "Warning" },
  failed: { icon: X, className: "text-destructive", words: "Failed" },
  skipped: { icon: SkipForward, className: "text-muted-foreground", words: "Skipped" },
};

const RUN_WORDS: Record<ChartStatus, string> = { idle: "Not built yet", running: "Running", ok: "Built", warning: "Built, with a warning", failed: "Failed", skipped: "Skipped, as something it needs failed" };

function LastRun({ dataset, building }: { dataset: FlowDataset; building: string | undefined }) {
  const status = statusOf(building ?? dataset.result?.status);
  return (
    <div className="grid gap-1 text-xs">
      <p className={cn("text-muted-foreground", status === "failed" && "font-medium text-destructive")}>
        {RUN_WORDS[status]}
        {!building && dataset.result?.at ? ` · ${when(dataset.result.at)}` : ""}
        {!building && dataset.result?.ms !== null && dataset.result?.ms !== undefined ? ` · ${dataset.result.ms} ms` : ""}
      </p>
      {status === "failed" && dataset.result?.message && <pre className="max-h-48 overflow-auto rounded-md border bg-chrome p-2 font-mono text-[11px] whitespace-pre-wrap">{dataset.result.message}</pre>}
    </div>
  );
}

function ProfileView({ dataset, ask, version }: { dataset: FlowDataset; ask: Ask; version: string }) {
  const { room } = useRoom();
  const profile = useQuery({ queryKey: ["flow", room.id, "profile", dataset.name, version], queryFn: () => ask<FlowProfile>({ op: "profile", dataset: dataset.name }), ...FRESH });
  if (profile.isPending) return <Skeleton className="h-32 w-full" />;
  if (profile.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {failure(profile.error)}
      </p>
    );
  }
  if (!profile.data.built) return <p className="text-xs text-muted-foreground">Build this dataset to see its profile.</p>;
  return (
    <section aria-label="Its profile" className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        {profile.data.rows?.toLocaleString()} {profile.data.rows === 1 ? "row" : "rows"}, {profile.data.columns.length} {profile.data.columns.length === 1 ? "column" : "columns"}. Worked out by DuckDB; numbers of distinct values are close estimates.
      </p>
      <ul className="grid gap-2">
        {profile.data.columns.map((column) => (
          <li key={column.name} className="grid gap-1 rounded-md border p-2 text-xs">
            <p>
              <span className="font-mono font-medium">{column.name}</span> <span className="text-muted-foreground">{column.type}</span>
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 tabular-nums">
              <dt className="text-muted-foreground">Empty</dt>
              <dd className={cn(column.nulls > 0 && "font-medium")}>{column.nulls}%</dd>
              <dt className="text-muted-foreground">Distinct</dt>
              <dd>{column.distinct.toLocaleString()}</dd>
              <dt className="text-muted-foreground">From</dt>
              <dd className="truncate">{column.min ?? "–"}</dd>
              <dt className="text-muted-foreground">To</dt>
              <dd className="truncate">{column.max ?? "–"}</dd>
              {column.mean !== null && (
                <>
                  <dt className="text-muted-foreground">Average</dt>
                  <dd className="truncate">{column.mean}</dd>
                  <dt className="text-muted-foreground">Middle half</dt>
                  <dd className="truncate">
                    {column.q25} to {column.q75}
                  </dd>
                </>
              )}
            </dl>
            {column.top.length > 0 && (
              <p>
                <span className="text-muted-foreground">Most common: </span>
                {column.top.map((item, index) => (
                  <span key={index}>
                    {index > 0 && ", "}
                    {item.value ?? <span className="italic">NULL</span>} <span className="text-muted-foreground">({item.count})</span>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddCheck({ dataset, columns, project, onDone }: { dataset: FlowDataset; columns: string[]; project: NonNullable<FlowGraph["project"]>; onDone: () => void }) {
  const { doc, me } = useRoom();
  const [rule, setRule] = useState<CheckRule>("not_null");
  const [typed, setColumn] = useState("");
  // The columns can come after this opens, and choosing none means the first.
  const column = typed || columns[0] || "";
  const [values, setValues] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      aria-label="Add a check"
      className="grid gap-2 rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const made = newCheck({ dataset, rule, column, values, min, max });
        if ("error" in made) return setProblem(made.error);
        const path = project.path === "." ? `tests/${made.fileName}` : `${project.path}/tests/${made.fileName}`;
        if (findByPath(doc, path)) return setProblem("This dataset already has that check. Remove it first to change it.");
        createFileAtPath(doc, path, made.content, me.user.id);
        onDone();
      }}
    >
      <label className="grid gap-1 text-xs">
        What should be true
        <select className={field} value={rule} onChange={(event) => setRule(event.target.value as CheckRule)}>
          {COLUMN_RULES.map((item) => (
            <option key={item.rule} value={item.rule}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {rule !== "has_rows" && (
        <label className="grid gap-1 text-xs">
          Of which column
          {columns.length ? (
            <select className={field} value={column} onChange={(event) => setColumn(event.target.value)}>
              {columns.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          ) : (
            <Input className="h-7 text-xs" value={column} onChange={(event) => setColumn(event.target.value)} />
          )}
        </label>
      )}
      {rule === "accepted" && (
        <label className="grid gap-1 text-xs">
          Allowed values, separated by commas
          <Input className="h-7 text-xs" value={values} onChange={(event) => setValues(event.target.value)} />
        </label>
      )}
      {rule === "range" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs">
            Lowest
            <Input className="h-7 text-xs" value={min} onChange={(event) => setMin(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            Highest
            <Input className="h-7 text-xs" value={max} onChange={(event) => setMax(event.target.value)} />
          </label>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-1">
        <Button size="xs" type="submit">
          Add it
        </Button>
        <Button size="xs" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FailingRows({ check, ask, version }: { check: FlowCheck; ask: Ask; version: string }) {
  const { room } = useRoom();
  const rows = useQuery({ queryKey: ["flow", room.id, "failures", check.id, version], queryFn: () => ask<FlowRows>({ op: "failures", check: check.id }), ...FRESH });
  if (rows.isPending) return <Skeleton className="h-16 w-full" />;
  if (rows.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {failure(rows.error)}
      </p>
    );
  }
  return <DataRows name={checkLabel(check)} columns={rows.data.columns} rows={rows.data.rows} truncated={rows.data.truncated} />;
}

function ChecksView({ dataset, graph, columns, building, ask, version, canEdit, canRun, onBuild, busy }: { dataset: FlowDataset; graph: FlowGraph; columns: string[]; building: Record<string, string>; ask: Ask; version: string; canEdit: boolean; canRun: boolean; onBuild: () => void; busy: boolean }) {
  const { doc } = useRoom();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const checks = checksOf(graph.checks, dataset.id);
  const unrun = checks.some((check) => !check.result && !building[check.id]);
  return (
    <section aria-label="Its checks" className="grid gap-2">
      {!checks.length && !adding && <p className="text-xs text-muted-foreground">No checks yet. A check is a rule the data has to keep, which dbt tests each time this dataset is built.</p>}
      <ul className="grid gap-1">
        {checks.map((check) => {
          const status = statusOf(building[check.id] ?? check.result?.status);
          const look = STATUS_ICONS[status];
          const Icon = look.icon;
          const label = checkLabel(check);
          const failed = !building[check.id] && (status === "failed" || status === "warning");
          return (
            <li key={check.id} className="grid gap-1 rounded-md border p-2 text-xs">
              <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", look.className)} aria-hidden />
                <div className="grid min-w-0 flex-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">
                    {look.words}
                    {failed && check.result?.failures ? `: ${check.result.failures} ${check.result.failures === 1 ? "row" : "rows"}` : ""}
                    {check.severity === "warn" && status !== "warning" ? " · only warns" : ""}
                  </span>
                </div>
                {failed && (
                  <Button size="xs" variant="ghost" aria-expanded={open === check.id} aria-label={`The rows that broke: ${label}`} onClick={() => setOpen(open === check.id ? null : check.id)}>
                    See them
                  </Button>
                )}
                {canEdit && canRemoveCheck(check) && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove the check: ${label}`}
                    title="Remove this check"
                    onClick={() => {
                      const node = check.file ? findByPath(doc, check.file) : null;
                      if (node) trash(doc, node.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {open === check.id && <FailingRows check={check} ask={ask} version={version} />}
            </li>
          );
        })}
      </ul>
      {adding && graph.project ? (
        <AddCheck dataset={dataset} columns={columns} project={graph.project} onDone={() => setAdding(false)} />
      ) : (
        <div className="flex flex-wrap gap-1">
          {canEdit && (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Add a check
            </Button>
          )}
          {canRun && unrun && (
            <Button size="xs" variant="outline" disabled={busy} onClick={onBuild}>
              <Hammer /> Build to run them
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function DatasetPanel({ dataset, graph, building, ask, version, canEdit, canRun, busy, onBuild, onOpenFile, onNewRecipe }: { dataset: FlowDataset; graph: FlowGraph; building: Record<string, string>; ask: Ask; version: string; canEdit: boolean; canRun: boolean; busy: boolean; onBuild: (input: Extract<FlowInput, { op: "build" }>) => void; onOpenFile: (path: string) => void; onNewRecipe: (from: FlowDataset) => void }) {
  const { room } = useRoom();
  const [view, setView] = useState<"rows" | "profile" | "checks">("rows");
  const rows = useQuery({ queryKey: ["flow", room.id, "preview", dataset.name, version], queryFn: () => ask<FlowRows>({ op: "preview", dataset: dataset.name }), ...FRESH, enabled: !busy });
  const columns = rows.data?.columns ?? [];
  const checks = checksOf(graph.checks, dataset.id);
  const build = (scope: "needs" | "after") => onBuild({ op: "build", dataset: dataset.name, scope, fresh: false });
  return (
    <section aria-label={`Dataset ${dataset.name}`} className="grid min-w-0 content-start gap-2">
      <div>
        <h3 className="font-mono font-medium break-all">{dataset.name}</h3>
        {dataset.description && <p className="text-xs text-muted-foreground">{dataset.description}</p>}
      </div>
      {dataset.kind !== "source" && <LastRun dataset={dataset} building={building[dataset.id]} />}
      <div className="flex flex-wrap gap-1">
        {dataset.kind !== "source" && canRun && (
          <>
            <Button size="xs" variant="outline" disabled={busy} title="Builds this, and whatever it's made from" onClick={() => build("needs")}>
              <Hammer /> Build this
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} title="Builds this, and whatever is made from it" onClick={() => build("after")}>
              And what&apos;s made from it
            </Button>
          </>
        )}
        {canEdit && (
          <Button size="xs" variant="ghost" onClick={() => onNewRecipe(dataset)}>
            <Plus /> New recipe from this
          </Button>
        )}
        {dataset.file && !hasRecipe(dataset) && (
          <Button size="xs" variant="ghost" onClick={() => onOpenFile(dataset.file!)}>
            <FileCode /> Open its file
          </Button>
        )}
      </div>
      <div role="group" aria-label="What to look at" className="flex gap-1 border-b pb-1">
        {(["rows", "profile", "checks"] as const).map((name) => (
          <Button key={name} size="xs" variant={view === name ? "secondary" : "ghost"} aria-pressed={view === name} onClick={() => setView(name)}>
            {name === "rows" ? "Rows" : name === "profile" ? "Profile" : `Checks${checks.length ? ` (${checks.length})` : ""}`}
          </Button>
        ))}
      </div>
      {view === "rows" &&
        (busy ? (
          <p className="text-xs text-muted-foreground">The data can be read when the build has finished.</p>
        ) : rows.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {failure(rows.error)}
          </p>
        ) : !rows.data.built ? (
          <p className="text-xs text-muted-foreground">Not built yet, so it has nothing to show.</p>
        ) : (
          <DataRows name={dataset.name} columns={rows.data.columns} rows={rows.data.rows} truncated={rows.data.truncated} />
        ))}
      {view === "profile" && (busy ? <p className="text-xs text-muted-foreground">The data can be read when the build has finished.</p> : <ProfileView dataset={dataset} ask={ask} version={version} />)}
      {view === "checks" && <ChecksView dataset={dataset} graph={graph} columns={columns} building={building} ask={ask} version={version} canEdit={canEdit} canRun={canRun} busy={busy} onBuild={() => build("needs")} />}
    </section>
  );
}

export function RecipePanel({ dataset, graph, building, onOpenFile }: { dataset: FlowDataset; graph: FlowGraph; building: Record<string, string>; onOpenFile: (path: string) => void }) {
  const inputs = dataset.dependsOn.map((id) => graph.datasets.find((item) => item.id === id)?.name ?? id);
  const kind = dataset.kind === "snapshot" ? "A snapshot" : dataset.language === "python" ? "A Python recipe" : "A SQL recipe";
  return (
    <section aria-label={`The recipe for ${dataset.name}`} className="grid min-w-0 content-start gap-2 text-xs">
      <div>
        <h3 className="text-[13px] font-medium">{kind}</h3>
        <p className="text-muted-foreground">
          Makes <span className="font-mono">{dataset.name}</span>
          {inputs.length > 0 && (
            <>
              {" "}
              from <span className="font-mono">{inputs.join(", ")}</span>
            </>
          )}
          .
        </p>
        {dataset.changed && <p className="text-muted-foreground">Its code has changed since it was last built.</p>}
      </div>
      <LastRun dataset={dataset} building={building[dataset.id]} />
      {dataset.file && (
        <div>
          <Button size="xs" variant="outline" onClick={() => onOpenFile(dataset.file!)}>
            <FileCode /> Open the code
          </Button>
          <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{dataset.file}</p>
        </div>
      )}
    </section>
  );
}
