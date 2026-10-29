"use client";

import {
  DATABASES,
  type DatabaseKind,
  type DatabaseTable,
  type QueryResult,
  type QueryResultSet,
} from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Database,
  Download,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/room/editor/file-picker";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const FIRST_QUERY: Record<DatabaseKind, string> = {
  postgres: "select now();",
  mysql: "select now();",
  mariadb: "select now();",
  mongo: "db.getCollectionNames()",
  redis: "PING",
};

const HINT: Record<DatabaseKind, string> = {
  postgres: "SQL. Several statements run in order.",
  mysql: "SQL. Several statements run in order.",
  mariadb: "SQL. Several statements run in order.",
  mongo: "One mongosh expression, like db.users.find({ age: { $gt: 30 } })",
  redis: "One command per line, like GET greeting",
};

const LIST_NAME: Record<DatabaseKind, string> = {
  postgres: "Tables",
  mysql: "Tables",
  mariadb: "Tables",
  mongo: "Collections",
  redis: "Keys",
};

/** What a file to load usually is, for the browser's file chooser (any file can still be picked). */
const LOADS: Record<DatabaseKind, string> = {
  postgres: ".sql,.txt",
  mysql: ".sql,.txt",
  mariadb: ".sql,.txt",
  mongo: ".gz,.archive,.js",
  redis: ".txt,.redis",
};

/** What each person was writing, per room and database, kept while the room is open. */
const drafts = new Map<string, string>();

/**
 * What the console opens: one of the room's database servers, one of its SQLite or
 * DuckDB files, or (a DuckDB target without a file) DuckDB over the room's data files.
 */
export type ConsoleTarget = { kind: DatabaseKind } | { sqlite: string } | { duckdb: string | null };

/**
 * One database's query console and table browser. Queries run through the API
 * and the runner, inside the database's own container (or, for a SQLite or DuckDB
 * file, in the room's sandbox); the browser never connects to it. Anyone in the
 * room can browse; writing queries needs terminal rights, like the database's
 * other changes. A SQLite file has backups and loading files too, but no reset
 * (delete the file); DuckDB has the console and the table browser.
 */
export function DatabaseConsole({
  target,
  onBack,
  onClose,
}: {
  target: ConsoleTarget;
  onBack: () => void;
  onClose: () => void;
}) {
  const { room, can } = useRoom();
  const queryClient = useQueryClient();
  const canQuery = can("terminal.open");
  const kind = "kind" in target ? target.kind : null;
  const sqlite = "sqlite" in target ? target.sqlite : null;
  // A file's engine and path (a DuckDB target without one is the room's data files).
  const file =
    "sqlite" in target
      ? { engine: "sqlite" as const, path: target.sqlite }
      : "duckdb" in target
        ? { engine: "duckdb" as const, path: target.duckdb }
        : null;
  const dataFiles = file?.engine === "duckdb" && !file.path;
  const id = kind ?? `${file!.engine}:${file!.path ?? ""}`;
  const title = kind ? DATABASES[kind].name : (file!.path ?? "The room's data files");
  const listName = kind ? LIST_NAME[kind] : dataFiles ? "Data files" : "Tables";
  const draftKey = `${room.id}:${id}`;
  const [query, setQueryState] = useState(
    () =>
      drafts.get(draftKey) ??
      (kind ? FIRST_QUERY[kind] : sqlite ? "select sqlite_version();" : "select version();"),
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const base = `/api/rooms/${room.id}/databases/${kind}` as const;
  const fileBase = `/api/rooms/${room.id}/${file?.engine ?? "sqlite"}` as const;
  const sqliteBase = `/api/rooms/${room.id}/sqlite` as const;
  /** Which file a request is about: nothing for the servers, or DuckDB over the data files. */
  const at = file?.path ? { path: file.path } : {};

  const setQuery = (text: string) => {
    drafts.set(draftKey, text);
    setQueryState(text);
  };
  const tables = useQuery({
    queryKey: ["database-tables", room.id, id],
    // Code in the sandbox changes tables too: ask again each time the console opens.
    staleTime: 0,
    queryFn: () =>
      file
        ? api<DatabaseTable[]>(`${fileBase}/tables`, { method: "POST", json: at })
        : api<DatabaseTable[]>(`${base}/tables`),
  });
  const failed = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.detail : "Couldn't reach the database.");
  const run = useMutation({
    mutationFn: (text: string) =>
      api<QueryResult>(`${file ? fileBase : base}/query`, { method: "POST", json: { ...at, query: text } }),
    onSuccess: (answer) => {
      setResult(answer);
      setSelected(null);
      void tables.refetch();
    },
    onError: failed,
  });
  const preview = useMutation({
    mutationFn: (table: DatabaseTable) =>
      file
        ? api<QueryResult>(`${fileBase}/preview`, { method: "POST", json: { ...at, name: table.name } })
        : api<QueryResult>(`${base}/preview`, {
            method: "POST",
            json: { name: table.name, schema: table.schema },
          }),
    onSuccess: (answer) => {
      setResult(answer);
      if (canQuery && answer.query) setQuery(answer.query);
    },
    onError: failed,
  });
  // Seeds and backups: one of the room's files, or one from this computer, run through the database's client.
  const [picking, setPicking] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  // A SQLite file is named in the query string, and a room file to load goes by ?file= then.
  const into: `/api/${string}` = sqlite ? `${sqliteBase}/load?path=${encodeURIComponent(sqlite)}` : `${base}/load`;
  const load = useMutation({
    mutationFn: (source: { path: string } | { file: File }) =>
      "path" in source
        ? api<QueryResult>(`${into}${sqlite ? "&file=" : "?path="}${encodeURIComponent(source.path)}`, {
            method: "POST",
          })
        : api<QueryResult>(into, {
            method: "POST",
            body: source.file,
            headers: { "content-type": "application/octet-stream" },
          }),
    onSuccess: (answer) => {
      setResult(answer);
      setSelected(null);
      void tables.refetch();
    },
    onError: failed,
  });
  const reset = useMutation({
    mutationFn: () => api(`${base}/reset`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`${title} was reset. It's starting again, empty.`);
      // What was in it is gone, and the list should say it is starting.
      queryClient.removeQueries({ queryKey: ["database-tables", room.id, kind] });
      void queryClient.invalidateQueries({ queryKey: ["databases", room.id] });
      onBack();
    },
    onError: failed,
  });
  const busy = run.isPending || preview.isPending || load.isPending;

  return (
    <div data-own-run-key className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-chrome px-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to databases" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <Database className="size-4 text-muted-foreground" />
        <h2 className={cn("truncate text-sm font-medium", file?.path && "font-mono")}>{title}</h2>
        {file && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {file.engine === "sqlite" ? "SQLite" : "DuckDB"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(kind || sqlite) && can("code.run") && (
            <Button asChild size="xs" variant="ghost">
              <a href={sqlite ? `${sqliteBase}/dump?path=${encodeURIComponent(sqlite)}` : `${base}/dump`} download>
                <Download /> Backup
              </a>
            </Button>
          )}
          {(kind || sqlite) && canQuery && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="ghost" disabled={busy}>
                    <Upload /> Load a file
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setPicking(true)}>
                    <FileText /> From this room…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => upload.current?.click()}>
                    <Upload /> From your computer…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {kind && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={reset.isPending}
                  onClick={() => {
                    if (window.confirm(`Reset ${title}? All its data is deleted, and it starts again empty.`))
                      reset.mutate();
                  }}
                >
                  <RotateCcw /> Reset
                </Button>
              )}
              <input
                ref={upload}
                type="file"
                hidden
                aria-label="File to load"
                accept={kind ? LOADS[kind] : ".sql,.txt"}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) load.mutate({ file });
                  e.target.value = "";
                }}
              />
            </>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>
      <FilePicker
        open={picking}
        onOpenChange={setPicking}
        title={`Run a file in ${title}`}
        onPick={(file) => load.mutate({ path: file.path })}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r" aria-label={listName}>
          <div className="flex h-8 shrink-0 items-center px-3 text-xs font-medium text-muted-foreground">
            {listName}
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label={`Refresh ${listName.toLowerCase()}`}
              onClick={() => void tables.refetch()}
            >
              <RefreshCw className={cn(tables.isFetching && "animate-spin")} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {tables.isPending ? (
              <div className="grid gap-1.5 px-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : tables.isError ? (
              <p className="px-3 text-xs text-destructive">
                {tables.error instanceof ApiError ? tables.error.detail : "Couldn't list them."}
              </p>
            ) : tables.data.length === 0 ? (
              <p className="px-3 text-xs text-muted-foreground">None yet.</p>
            ) : (
              <ul>
                {tables.data.map((table) => {
                  const key = `${table.schema ?? ""}.${table.name}`;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        aria-current={selected === key}
                        className={cn(
                          "flex h-6 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent",
                          selected === key && "bg-accent font-medium",
                        )}
                        onClick={() => {
                          setSelected(key);
                          preview.mutate(table);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {table.schema && <span className="text-muted-foreground">{table.schema}.</span>}
                          {table.name}
                        </span>
                        {table.detail && table.detail !== "key" && table.detail !== "collection" && (
                          <span className="text-muted-foreground">{table.detail}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {canQuery && (
            <div className="shrink-0 border-b p-2">
              <textarea
                aria-label="Query"
                value={query}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && query.trim()) {
                    e.preventDefault();
                    run.mutate(query);
                  }
                }}
                className="h-28 w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="xs" disabled={busy || !query.trim()} onClick={() => run.mutate(query)}>
                  {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run
                </Button>
                <span className="truncate text-xs text-muted-foreground">
                  Ctrl+Enter.{" "}
                  {kind
                    ? HINT[kind]
                    : dataFiles
                      ? "SQL over the room's files by path, like select * from 'data/sales.csv'."
                      : "SQL. Several statements run in order."}
                </span>
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2" aria-label="Results" role="region">
            <Results result={result} busy={busy} canQuery={canQuery} />
          </div>
        </main>
      </div>
    </div>
  );
}

function Results({
  result,
  busy,
  canQuery,
}: {
  result: QueryResult | null;
  busy: boolean;
  canQuery: boolean;
}) {
  if (busy) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Running
      </p>
    );
  }
  if (!result)
    return (
      <p className="text-xs text-muted-foreground">
        {canQuery
          ? "Run a query, or pick one on the left to look inside."
          : "Pick one on the left to look inside."}
      </p>
    );
  return (
    <div className="grid gap-3">
      {result.results.map((set, i) => (
        <ResultSet key={i} set={set} />
      ))}
      {result.error && (
        <pre className="rounded-md border border-destructive/40 bg-destructive/5 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {result.error}
        </pre>
      )}
      {!result.error && result.results.length === 0 && <p className="text-xs text-muted-foreground">Done.</p>}
      <p className="text-xs text-muted-foreground">{result.ms} ms</p>
    </div>
  );
}

function ResultSet({ set }: { set: QueryResultSet }) {
  if (set.type === "message") return <p className="font-mono text-xs text-muted-foreground">{set.text}</p>;
  if (set.type === "value")
    return (
      <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">{set.text}</pre>
    );
  if (set.columns.length === 0) return <p className="text-xs text-muted-foreground">No rows.</p>;
  const count = `${set.rows.length} ${set.rows.length === 1 ? "row" : "rows"}`;
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-max min-w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {set.columns.map((column, i) => (
                <th key={i} scope="col" className="border-b px-2 py-1 text-left font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {set.rows.map((row, r) => (
              <tr key={r} className="even:bg-muted/30">
                {row.map((value, c) => (
                  <td
                    key={c}
                    className="max-w-80 truncate border-b px-2 py-1 align-top"
                    title={value ?? "NULL"}
                  >
                    {value === null ? <span className="text-muted-foreground italic">NULL</span> : value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t bg-chrome px-2 py-1 text-xs text-muted-foreground">
        {set.truncated ? `The first ${count}; there are more.` : count}
      </p>
    </div>
  );
}
