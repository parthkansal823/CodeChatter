"use client";

import {
  DATABASE_KINDS,
  DATABASES,
  type DatabaseConnection,
  type DatabaseKind,
  type DatabaseStatus,
  type DuckdbListing,
  type SqliteFile,
} from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Database, FileText, Loader2, Play, RefreshCw, Sheet, Square, Table2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { formatBytes } from "@/components/room/tools/api-studio/format";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DatabaseConsole, type ConsoleTarget } from "./database-console";

type Change = "start" | "stop" | "delete";

/** Which database each room had open, so closing and reopening the tool returns to it. */
const lastOpened = new Map<string, ConsoleTarget>();

const STATE: Record<DatabaseStatus["state"], { label: string; dot: string }> = {
  off: { label: "Off", dot: "bg-muted-foreground/40" },
  starting: { label: "Starting", dot: "animate-pulse bg-warning" },
  running: { label: "Running", dot: "bg-success" },
  stopped: { label: "Stopped, data kept", dot: "bg-muted-foreground/40" },
  failed: { label: "Didn't start", dot: "bg-destructive" },
};

/**
 * One-click databases (roadmap §14 D): PostgreSQL, MySQL, MariaDB, MongoDB and
 * Redis, each next to the room's sandbox on its private network. Code in
 * terminals and Run reaches them by name, with the connection already in its
 * environment; nothing outside the room can. Below them, the room's SQLite and DuckDB
 * files, and its data files for DuckDB, which need no server: the console opens them
 * in the sandbox.
 */
export default function DatabasesTool({ close }: RoomToolProps) {
  const { room, can } = useRoom();
  const queryClient = useQueryClient();
  const key = ["databases", room.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<DatabaseStatus[]>(`/api/rooms/${room.id}/databases`),
    // Quick while one starts, then slow.
    refetchInterval: (query) => (query.state.data?.some((d) => d.state === "starting") ? 1500 : 5000),
  });
  const change = useMutation({
    mutationFn: ({ kind, to }: { kind: DatabaseKind; to: Change }) =>
      api<DatabaseStatus[]>(`/api/rooms/${room.id}/databases/${kind}${to === "stop" ? "/stop" : ""}`, {
        method: to === "delete" ? "DELETE" : "POST",
      }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Couldn't change the database."),
  });
  const manage = can("terminal.open");
  const byKind = new Map(list.data?.map((status) => [status.kind, status]));
  const [target, setTarget] = useState<ConsoleTarget | null>(() => lastOpened.get(room.id) ?? null);
  const open = (next: ConsoleTarget | null) => {
    if (next) lastOpened.set(room.id, next);
    else lastOpened.delete(room.id);
    setTarget(next);
  };

  if (target) return <DatabaseConsole target={target} onBack={() => open(null)} onClose={close} />;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-chrome px-3">
        <Database className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Databases</h2>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Each database runs next to this room&apos;s sandbox, on its private network. Code in terminals and
            Run reaches it by name, with the connection already in its environment; nothing outside the room
            can. Databases sleep when the room is idle and wake with it.
          </p>
          {list.isPending ? (
            <div className="grid gap-2" aria-label="Loading databases">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : list.isError ? (
            <p className="text-sm text-destructive">
              {list.error instanceof ApiError ? list.error.detail : "Couldn't load the databases."}
            </p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {DATABASE_KINDS.map((kind) => (
                <DatabaseRow
                  key={kind}
                  status={byKind.get(kind) ?? { kind, state: "off" }}
                  manage={manage}
                  busy={change.isPending && change.variables?.kind === kind}
                  onChange={(to) => change.mutate({ kind, to })}
                  onOpen={() => open({ kind })}
                />
              ))}
            </ul>
          )}
          <DatabaseFiles onOpen={open} />
          {!can("code.run") && (
            <p className="mt-3 text-xs text-muted-foreground">
              People who can run code in this room see how to connect.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The room's database files, found in its sandbox: SQLite's (Django's db.sqlite3, an
 * app's own) and DuckDB's by their headers, and its CSV, Parquet and JSON files, which
 * DuckDB queries by path.
 */
function DatabaseFiles({ onOpen }: { onOpen: (target: ConsoleTarget) => void }) {
  const { room } = useRoom();
  // Looking means walking the sandbox's files: on opening the tool, and when asked.
  const sqlite = useQuery({
    queryKey: ["sqlite-files", room.id],
    queryFn: () => api<SqliteFile[]>(`/api/rooms/${room.id}/sqlite`),
    staleTime: 30_000,
  });
  const duckdb = useQuery({
    queryKey: ["duckdb-files", room.id],
    queryFn: () => api<DuckdbListing>(`/api/rooms/${room.id}/duckdb`),
    staleTime: 30_000,
  });
  const files = [
    ...(sqlite.data ?? []).map((file) => ({ ...file, engine: "sqlite" as const })),
    ...(duckdb.data?.files ?? []).map((file) => ({ ...file, engine: "duckdb" as const })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const error = sqlite.error ?? duckdb.error;
  const data = duckdb.data?.data.length ?? 0;
  return (
    <section className="mt-6" aria-label="Database files">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium">Database files</h3>
        <span className="text-xs text-muted-foreground">No server needed: opened as they are in the sandbox.</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Look for database files again"
          onClick={() => {
            void sqlite.refetch();
            void duckdb.refetch();
          }}
        >
          <RefreshCw className={cn((sqlite.isFetching || duckdb.isFetching) && "animate-spin")} />
        </Button>
      </div>
      {sqlite.isPending || duckdb.isPending ? (
        <p className="text-xs text-muted-foreground">Looking in the sandbox…</p>
      ) : error ? (
        <p className="text-xs text-destructive">
          {error instanceof ApiError ? error.detail : "Couldn't look for them."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          <li className="flex items-center gap-3 px-3 py-2" aria-label="The room's data files">
            <Sheet className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs">
              CSV, Parquet and JSON files, queried with DuckDB
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {data} {data === 1 ? "file" : "files"}
            </span>
            <Button size="xs" variant="outline" onClick={() => onOpen({ duckdb: null })}>
              <Table2 /> Open
            </Button>
          </li>
          {files.map((file) => (
            <li key={file.path} className="flex items-center gap-3 px-3 py-2" aria-label={file.path}>
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {file.engine === "sqlite" ? "SQLite" : "DuckDB"} · {formatBytes(file.bytes)}
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => onOpen(file.engine === "sqlite" ? { sqlite: file.path } : { duckdb: file.path })}
              >
                <Table2 /> Open
              </Button>
            </li>
          ))}
          {files.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              No SQLite or DuckDB files yet. An app makes one when it first saves (Django&apos;s db.sqlite3, for
              one).
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function DatabaseRow({
  status,
  manage,
  busy,
  onChange,
  onOpen,
}: {
  status: DatabaseStatus;
  manage: boolean;
  busy: boolean;
  onChange: (to: Change) => void;
  onOpen: () => void;
}) {
  const info = DATABASES[status.kind];
  const state = STATE[status.state];
  const live = status.state === "running" || status.state === "starting";
  return (
    <li className="px-3 py-2.5" aria-label={info.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", state.dot)} />
        <span className="font-medium">{info.name}</span>
        <span className="text-xs text-muted-foreground">
          {state.label}
          {status.state === "starting" && status.detail ? `: ${status.detail}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {status.state === "running" && (
            <Button size="xs" variant="outline" onClick={onOpen}>
              <Table2 /> Open
            </Button>
          )}
          {manage && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => onChange(live ? "stop" : "start")}
            >
              {busy ? <Loader2 className="animate-spin" /> : live ? <Square /> : <Play />}
              {live ? "Stop" : "Start"}
            </Button>
          )}
          {manage && status.state !== "off" && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Delete ${info.name} and its data`}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${info.name} and all its data? This can't be undone.`))
                  onChange("delete");
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {status.state === "failed" && status.detail && (
        <p className="mt-1 pl-5 text-xs text-destructive">{status.detail}</p>
      )}
      {live && status.connection && <Connection connection={status.connection} terminal={info.terminal} />}
    </li>
  );
}

function Connection({ connection, terminal }: { connection: DatabaseConnection; terminal: string }) {
  const masked = connection.url.replace(connection.password, "••••••");
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 pl-5 text-xs">
      <dt className="text-muted-foreground">Address</dt>
      <dd className="font-mono">
        {connection.host}:{connection.port}
        <span className="font-sans text-muted-foreground">
          {" "}
          · user {connection.user} · database {connection.database}
        </span>
      </dd>
      <dt className="text-muted-foreground">URL</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono">{masked}</span>
        <CopyButton text={connection.url} label="Copy the URL" />
        <CopyButton text={connection.password} label="Copy the password" />
      </dd>
      <dt className="text-muted-foreground">In code</dt>
      <dd className="font-mono">{connection.env.map((name) => `$${name}`).join(", ")}</dd>
      <dt className="text-muted-foreground">In a terminal</dt>
      <dd className="font-mono">{terminal}</dd>
    </dl>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => toast.success("Copied"),
          () => toast.error("Couldn't copy."),
        )
      }
    >
      <Copy />
    </Button>
  );
}
