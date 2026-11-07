/** "Explain this data", on a table of query results or a notebook's table: DuckDB works out the numbers in the sandbox, and the AI panel explains them. */
"use client";

import { DATA_LIMITS, sampleOf, type DataSummary, type ExplainDataContext } from "@codechatter/contracts";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

import { useAiRequests } from "./ai-requests";

export type DataTable = { columns: string[]; rows: Array<Array<string | null>>; source: ExplainDataContext["source"]; complete: boolean };

/** A table in a notebook's HTML output (a pandas DataFrame), as rows. Pandas leaves out the middle of a long one, with a row of "...". */
export function tableFromHtml(html: string): Pick<DataTable, "columns" | "rows" | "complete"> | null {
  const page = new DOMParser().parseFromString(html, "text/html");
  const table = page.querySelector("table");
  if (!table) return null;
  const heads = [...table.querySelectorAll("thead tr")];
  const header = heads.at(0);
  if (!header) return null;
  const columns = [...header.children].map((cell, index) => cell.textContent?.trim() || (index === 0 ? "index" : `column ${index + 1}`));
  const body = [...table.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent?.trim() ?? ""));
  const rows = body.filter((row) => !row.every((value) => value === "...") && row.length === columns.length).map((row) => row.map((value) => (value === "NaN" || value === "None" || value === "<NA>" ? null : value)));
  if (!rows.length) return null;
  const said = /(\d[\d,]*) rows? × (\d[\d,]*) columns?/.exec(page.body.textContent ?? "");
  const complete = rows.length === body.length && (!said || Number(said[1]!.replace(/,/g, "")) === rows.length);
  return { columns, rows, complete };
}

export function ExplainDataButton({ table }: { table: DataTable }) {
  const { room, can } = useRoom();
  const [busy, setBusy] = useState(false);
  // It works in the sandbox and calls the AI, and an interview isn't the place for it.
  if (!can("code.run") || !can("room.chat") || room.kind === "interview") return null;
  const explain = async () => {
    setBusy(true);
    const rows = table.rows.slice(0, DATA_LIMITS.rows);
    const complete = table.complete && rows.length === table.rows.length;
    try {
      const summary = await api<DataSummary>(`/api/rooms/${room.id}/data/summary`, { method: "POST", json: { columns: table.columns, rows } });
      useAiRequests.getState().ask({
        mode: "data",
        prompt: "Explain this data: what it is, what stands out, and what to check next.",
        data: { source: table.source, complete, summary, sample: sampleOf(table.columns, rows) },
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The numbers couldn't be worked out.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="xs" variant="ghost" disabled={busy} title="DuckDB works out the numbers, and the AI explains them. A few rows go to the AI too." onClick={() => void explain()}>
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Explain this data
    </Button>
  );
}

/** The numbers an answer was given, so it can be checked. */
export function NumbersItUsed({ summary }: { summary: DataSummary }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        The numbers it was given, from {summary.engine}: {summary.rows.toLocaleString()} {summary.rows === 1 ? "row" : "rows"}
        {summary.duplicates > 0 && `, ${summary.duplicates.toLocaleString()} duplicated`}
      </summary>
      <div tabIndex={0} role="group" aria-label="The numbers it was given" className="mt-1 overflow-x-auto rounded-sm border outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full border-collapse font-mono">
          <caption className="sr-only">Each column&apos;s numbers, worked out by DuckDB</caption>
          <thead className="bg-chrome">
            <tr>
              {["Column", "Type", "Empty", "Distinct", "Min", "Max", "Mean", "Median", "Outliers"].map((name) => (
                <th key={name} scope="col" className="border-b px-1.5 py-0.5 text-left font-medium whitespace-nowrap">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.columns.map((column) => (
              <tr key={column.name}>
                <th scope="row" className="border-b px-1.5 py-0.5 text-left font-normal whitespace-nowrap">
                  {column.name}
                </th>
                <td className="border-b px-1.5 py-0.5">{column.type}</td>
                <td className="border-b px-1.5 py-0.5 tabular-nums">{column.nullPercent}%</td>
                <td className="border-b px-1.5 py-0.5 tabular-nums">{column.unique}</td>
                <td className="max-w-40 truncate border-b px-1.5 py-0.5">{column.min ?? "–"}</td>
                <td className="max-w-40 truncate border-b px-1.5 py-0.5">{column.max ?? "–"}</td>
                <td className="border-b px-1.5 py-0.5 tabular-nums">{column.mean ?? "–"}</td>
                <td className="border-b px-1.5 py-0.5 tabular-nums">{column.q50 ?? "–"}</td>
                <td className="border-b px-1.5 py-0.5 tabular-nums">{column.mean === null ? "–" : column.outliers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.correlations.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          Moving together: {summary.correlations.map((item) => `${item.a} and ${item.b} (${item.r})`).join(", ")}
        </p>
      )}
    </details>
  );
}
