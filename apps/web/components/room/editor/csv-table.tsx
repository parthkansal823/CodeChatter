"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { isNumericColumn, parseCsv, sortRows, type CsvRow } from "./csv";

/** Most rows drawn at once; the filter finds the rest. */
const MAX_ROWS = 1000;

type Sort = { column: number; direction: "asc" | "desc" } | null;

/**
 * A CSV or TSV file as a table, live as anyone edits it: a sticky header (the first row,
 * unless you say otherwise), click a heading to sort, a filter across every cell, and
 * double-click a row to see it in the code.
 */
export function CsvTable({ text, name, onShowLine }: { text: string; name: string; onShowLine: (line: number) => void }) {
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => parseCsv(deferred, /\.tsv$/i.test(name) ? "\t" : undefined), [deferred, name]);
  const [header, setHeader] = useState(true);
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState("");
  const filterId = useId();
  const headerId = useId();

  const body = useMemo(() => (header ? parsed.rows.slice(1) : parsed.rows), [parsed, header]);
  const headings = header ? (parsed.rows[0]?.cells ?? []) : [];
  const columns = Array.from({ length: parsed.columns }, (_, i) => headings[i]?.trim() || `Column ${i + 1}`);
  const numeric = useMemo(() => Array.from({ length: parsed.columns }, (_, i) => isNumericColumn(body, i)), [body, parsed.columns]);
  const query = useDeferredValue(filter.trim().toLowerCase());
  const rows = useMemo(() => {
    let out: CsvRow[] = query ? body.filter((row) => row.cells.some((cell) => cell.toLowerCase().includes(query))) : body;
    if (sort) out = sortRows(out, sort.column, sort.direction, numeric[sort.column] ?? false);
    return out;
  }, [body, query, sort, numeric]);
  const shown = rows.slice(0, MAX_ROWS);

  const cycleSort = (column: number) =>
    setSort((current) =>
      current?.column !== column ? { column, direction: "asc" } : current.direction === "asc" ? { column, direction: "desc" } : null,
    );
  const delimiterName = { ",": "commas", ";": "semicolons", "\t": "tabs", "|": "bars" }[parsed.delimiter] ?? parsed.delimiter;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex h-7 w-56 min-w-0 items-center rounded-md border border-input bg-background has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-ring">
          <label htmlFor={filterId} className="sr-only">
            Filter rows
          </label>
          <input
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter) {
                e.preventDefault();
                setFilter("");
              }
            }}
            placeholder="Filter rows"
            type="text"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          {filter && (
            <Button size="icon-xs" variant="ghost" aria-label="Clear the filter" className="mr-0.5" onClick={() => setFilter("")}>
              <X />
            </Button>
          )}
        </div>
        <label htmlFor={headerId} className="flex items-center gap-1.5">
          <Switch id={headerId} size="sm" checked={header} onCheckedChange={setHeader} />
          First row is the header
        </label>
        <span role="status" className="ml-auto tabular-nums">
          {query ? `${rows.length.toLocaleString("en")} of ${body.length.toLocaleString("en")} rows` : `${body.length.toLocaleString("en")} rows`} ·{" "}
          {parsed.columns} {parsed.columns === 1 ? "column" : "columns"} · split by {delimiterName}
        </span>
      </div>
      {parsed.rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">This file is empty.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table aria-label={`${name} as a table`} className="border-separate border-spacing-0 font-mono text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th scope="col" className="sticky left-0 z-20 border-r border-b bg-chrome px-2 py-1 text-right font-normal text-muted-foreground">
                  <span className="sr-only">Line</span>
                </th>
                {columns.map((title, i) => {
                  const sorted = sort?.column === i ? sort.direction : null;
                  return (
                    <th
                      key={i}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                      className="border-r border-b bg-chrome p-0 font-sans font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => cycleSort(i)}
                        title={`Sort by ${title}`}
                        className={cn("flex h-6 w-full max-w-72 items-center gap-1 px-2 text-left whitespace-nowrap hover:bg-accent", numeric[i] && "justify-end")}
                      >
                        <span className="truncate">{title}</span>
                        {sorted === "asc" && <ArrowUp aria-hidden className="size-3 shrink-0" />}
                        {sorted === "desc" && <ArrowDown aria-hidden className="size-3 shrink-0" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.line} onDoubleClick={() => onShowLine(row.line)} title="Double-click to see it in the code" className="group">
                  <th scope="row" className="sticky left-0 border-r border-b bg-chrome px-2 py-0.5 text-right font-normal text-muted-foreground tabular-nums group-hover:text-foreground">
                    {row.line}
                  </th>
                  {columns.map((_, i) => (
                    <td
                      key={i}
                      className={cn(
                        "max-w-72 truncate border-r border-b px-2 py-0.5 whitespace-pre group-hover:bg-accent/50",
                        numeric[i] && "text-right tabular-nums",
                      )}
                      title={(row.cells[i]?.length ?? 0) > 40 ? row.cells[i] : undefined}
                    >
                      {row.cells[i] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Showing the first {MAX_ROWS.toLocaleString("en")} of {rows.length.toLocaleString("en")} rows. Filter to find the others.
            </p>
          )}
          {query && rows.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No row matches the filter.</p>}
        </div>
      )}
    </div>
  );
}
