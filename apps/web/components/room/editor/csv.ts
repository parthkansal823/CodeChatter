/**
 * CSV and TSV as rows of cells (RFC 4180: quoted fields, "" for a quote, line breaks
 * inside quotes), each row with the line it starts on so the table can jump to the code.
 * The delimiter is a tab for .tsv, else whichever of , ; | or tab the first line uses most.
 */
export type CsvRow = { line: number; cells: string[] };
export type ParsedCsv = { delimiter: string; rows: CsvRow[]; columns: number };

const CANDIDATES = [",", ";", "\t", "|"];

/** The delimiter the first line (outside quotes) uses most; a comma when none appears. */
export function detectDelimiter(text: string): string {
  const counts = new Map(CANDIDATES.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  for (const [d, n] of counts) if (n > counts.get(best)!) best = d;
  return best;
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): ParsedCsv {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let fieldStarted = false;
  // Anything on this row at all (a quote, a delimiter, a character): only an untouched line is blank.
  let touched = false;
  const endCell = () => {
    cells.push(cell);
    cell = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endCell();
    if (touched) rows.push({ line: rowLine, cells });
    cells = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      touched = true;
    } else if (ch === delimiter) {
      endCell();
      touched = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += ch;
      fieldStarted = true;
      touched = true;
    }
  }
  if (touched) endRow();
  const columns = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  return { delimiter, rows, columns };
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

/** A cell as a number when it reads as one ("1,234.5", "-3", "12%"), else null. */
export function asNumber(cell: string): number | null {
  const text = cell.trim();
  if (!text || !NUMBER.test(text) || !/\d/.test(text)) return null;
  const value = Number(text.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(value) ? value : null;
}

/** Most of a column's (non-empty) cells are numbers: it's right-aligned and sorts as numbers. */
export function isNumericColumn(rows: CsvRow[], column: number): boolean {
  let numbers = 0;
  let filled = 0;
  for (const row of rows) {
    const cell = row.cells[column];
    if (!cell?.trim()) continue;
    filled += 1;
    if (asNumber(cell) !== null) numbers += 1;
  }
  return filled > 0 && numbers / filled >= 0.7;
}

/** Rows sorted by one column: numbers by value, text in natural order, empty cells last. */
export function sortRows(rows: CsvRow[], column: number, direction: "asc" | "desc", numeric: boolean): CsvRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const x = a.cells[column] ?? "";
    const y = b.cells[column] ?? "";
    if (!x.trim() || !y.trim()) return !x.trim() && !y.trim() ? 0 : !x.trim() ? 1 : -1;
    if (numeric) {
      const nx = asNumber(x);
      const ny = asNumber(y);
      if (nx !== null && ny !== null) return (nx - ny) * sign;
    }
    return collator.compare(x, y) * sign;
  });
}
