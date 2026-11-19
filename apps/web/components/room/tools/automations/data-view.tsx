/** A step's data on a run, as a table, as JSON, or as its fields with the expression that reads each, and "Use" to put one in the field being filled in, as n8n maps data. */
"use client";

import { Download, FileIcon, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";

import { fieldsOf } from "./expressions";

/** A step's file, as the sandbox's worker gives it (sandbox/image/automation/files.mjs): its run, its id and its name are in its address. */
const STEP_FILE = /^http:\/\/127\.0\.0\.1:\d+\/v1\/step-files\/([\w-]{1,64})\/([\w-]{1,64})\/([^/?#]+)$/;
const MOST_FILES = 20;
type StepFile = { run: string; file: string; name: string };

/** The steps' files in some data, each once: File Helper's, a CSV file, Read files'. */
export function filesIn(value: unknown): StepFile[] {
  const found = new Map<string, StepFile>();
  const walk = (current: unknown, depth: number) => {
    if (found.size >= MOST_FILES || depth > 8) return;
    if (typeof current === "string") {
      const [, run, file, given] = STEP_FILE.exec(current) ?? [];
      if (run && file && given) {
        let name = given;
        try {
          name = decodeURIComponent(given);
        } catch {
          // Shown as it is.
        }
        found.set(`${run}/${file}`, { run, file, name });
      }
    } else if (current && typeof current === "object") for (const each of Object.values(current)) walk(each, depth + 1);
  };
  walk(value, 0);
  return [...found.values()];
}

/** A step's file, downloaded through the API from the sandbox it's kept in, while its run is kept. */
function FileRow({ file }: { file: StepFile }) {
  const { room } = useRoom();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const got = await api<{ name: string; data: string }>(`/api/rooms/${room.id}/automations`, { method: "POST", json: { op: "run-file", id: file.run, file: file.file } });
      const bytes = Uint8Array.from(atob(got.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = got.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The file couldn't be downloaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex min-h-6 items-center gap-1.5">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.name}>
        {file.name}
      </span>
      <Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5" disabled={busy} aria-label={`Download ${file.name}`} onClick={() => void download()}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Download
      </Button>
    </li>
  );
}

const MOST_ROWS = 50;
const MOST_COLUMNS = 12;
const cell = (value: unknown) => (value === undefined ? "" : value === null || typeof value !== "object" ? String(value) : JSON.stringify(value));

function TableOf({ value }: { value: unknown }) {
  if (value === undefined) return <p className="text-muted-foreground">Nothing</p>;
  if (value === null || typeof value !== "object") return <p className="font-mono text-[11px] break-all whitespace-pre-wrap">{String(value)}</p>;
  const rows = Array.isArray(value) ? value : null;
  if (rows && rows.length && rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const columns = [...new Set(rows.slice(0, MOST_ROWS).flatMap((row) => Object.keys(row as object)))].slice(0, MOST_COLUMNS);
    return (
      <div tabIndex={0} role="region" aria-label="As a table" className="max-h-56 overflow-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="border-b px-1.5 py-1 font-medium whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MOST_ROWS).map((row, index) => (
              <tr key={index} className="border-b last:border-0">
                {columns.map((column) => (
                  <td key={column} className="max-w-48 truncate px-1.5 py-0.5" title={cell((row as Record<string, unknown>)[column])}>
                    {cell((row as Record<string, unknown>)[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > MOST_ROWS && <p className="px-1.5 py-1 text-muted-foreground">The first {MOST_ROWS} of {rows.length}.</p>}
      </div>
    );
  }
  const entries = rows ? rows.map((item, index) => [String(index), item] as const) : Object.entries(value);
  return (
    <div tabIndex={0} role="region" aria-label="As a table" className="max-h-56 overflow-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full text-left font-mono text-[11px]">
        <thead className="sticky top-0 bg-chrome">
          <tr>
            <th scope="col" className="border-b px-1.5 py-1 font-medium">
              {rows ? "Item" : "Field"}
            </th>
            <th scope="col" className="border-b px-1.5 py-1 font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, MOST_ROWS).map(([key, item]) => (
            <tr key={key} className="border-b last:border-0">
              <th scope="row" className="px-1.5 py-0.5 font-normal whitespace-nowrap">
                {key}
              </th>
              <td className="max-w-56 truncate px-1.5 py-0.5" title={cell(item)}>
                {cell(item)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each field, with the expression that reads it. With `onUse`, a button puts it in the field being filled in. */
export function SchemaOf({ value, base, onUse }: { value: unknown; base: string; onUse?: (expression: string) => void }) {
  const fields = fieldsOf(value, base);
  if (!fields.length) return <p className="text-muted-foreground">{value === undefined ? "Nothing" : `Just a value: {{${base}}} reads it.`}</p>;
  return (
    <ul aria-label={`Fields of ${base}`} className="grid max-h-56 gap-0.5 overflow-auto font-mono text-[11px]">
      {fields.map((field) => (
        <li key={field.path} className="flex min-h-6 items-center gap-1.5" style={{ paddingLeft: `${(field.depth - 1) * 10}px` }}>
          <span className="min-w-0 flex-1 truncate" title={field.expression}>
            {field.path.slice(base.length).replace(/^\./, "") || base}
          </span>
          <span className="shrink-0 text-muted-foreground">{field.type}</span>
          <span className="max-w-24 shrink-0 truncate text-muted-foreground" title={field.sample}>
            {field.sample}
          </span>
          {onUse && (
            <Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5" aria-label={`Use ${field.expression}`} title={`Put ${field.expression} in the field you were filling in`} onClick={() => onUse(field.expression)}>
              Use
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Data as a table, as JSON, or as its fields. `base` is the expression that reads it, such as `step_1.output`. */
export function DataView({ label, value, base, onUse }: { label: string; value: unknown; base?: string; onUse?: (expression: string) => void }) {
  const [view, setView] = useState("json");
  const files = filesIn(value);
  return (
    <section aria-label={label} className="grid gap-1">
      {files.length > 0 && (
        <ul aria-label={`Files in ${label.toLowerCase()}`} className="grid gap-0.5 rounded-md border px-1.5 py-1">
          {files.map((file) => (
            <FileRow key={`${file.run}/${file.file}`} file={file} />
          ))}
        </ul>
      )}
      <Tabs value={view} onValueChange={setView} className="gap-1">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 font-medium">{label}</h4>
          <TabsList aria-label={`Show ${label.toLowerCase()} as`} className="h-6 p-0.5">
            <TabsTrigger value="table" className="px-1.5 text-[11px]">
              Table
            </TabsTrigger>
            <TabsTrigger value="json" className="px-1.5 text-[11px]">
              JSON
            </TabsTrigger>
            {base && (
              <TabsTrigger value="schema" className="px-1.5 text-[11px]">
                Schema
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="table">
          <TableOf value={value} />
        </TabsContent>
        <TabsContent value="json">
          <pre tabIndex={0} className="max-h-56 overflow-auto rounded-md border bg-chrome p-2 font-mono text-[11px] whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {value === undefined ? "Nothing" : JSON.stringify(value, null, 2)}
          </pre>
        </TabsContent>
        {base && (
          <TabsContent value="schema">
            <SchemaOf value={value} base={base} onUse={onUse} />
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
