/** Rows of a table of data, with Explain this data under them. The Lakehouse and Flow tools show their data this way. */
"use client";

import { ExplainDataButton } from "@/components/room/tools/ai/explain-data";

export function DataRows({ name, caption, columns, rows, truncated, note }: { name: string; caption?: string; columns: string[]; rows: Array<Array<string | null>>; truncated: boolean; note?: string }) {
  return (
    <section aria-label="Its rows" className="grid gap-1">
      <div tabIndex={0} role="group" aria-label={`Rows of ${name}`} className="max-h-96 overflow-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-max min-w-full border-collapse font-mono text-xs">
          <caption className="sr-only">{caption ?? name}</caption>
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="border-b px-2 py-1 text-left font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
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
          {truncated ? `The first ${rows.length} rows.` : `${rows.length} ${rows.length === 1 ? "row" : "rows"}.`}
          {note && ` ${note}`}
        </p>
        {rows.length > 0 && <ExplainDataButton table={{ columns, rows, source: "query", complete: !truncated }} />}
      </div>
    </section>
  );
}
