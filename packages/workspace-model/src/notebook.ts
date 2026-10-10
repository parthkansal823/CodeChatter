import * as Y from "yjs";

import { randomId, textOf } from "./model.js";

/**
 * Notebooks (.ipynb), cell by cell, in the room's files document: people edit different
 * cells at once, and one JSON text can't merge that. Outputs live here too, so everyone
 * sees a run's results and plots arrive.
 *
 *   notebooks: Y.Map<fileId, Y.Map{
 *     cells:    Y.Array<Y.Map{ id, type, source: Y.Text, outputs: Y.Array<NotebookOutput>, count }>,
 *     metadata: the notebook's own (kernelspec and the rest), kept as it was read,
 *     kernel:   KernelStatus, written by the runner,
 *   }>
 *
 * The file's text is the same notebook as .ipynb JSON, for everything that reads files
 * (the sandbox, search, downloads). Only the runner writes it (notebookText), so it has
 * one writer and nothing to merge.
 */
export type CellType = "code" | "markdown";

/** nbformat 4 outputs, stored as the kernel sends them. */
export type NotebookOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | { output_type: "display_data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { output_type: "execute_result"; data: Record<string, unknown>; metadata?: Record<string, unknown>; execution_count: number | null }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

/** The notebook's kernel, as the runner last saw it. */
export type KernelStatus = {
  state: "off" | "starting" | "idle" | "busy" | "dead";
  /** The cell running now, and the ones waiting their turn. */
  running: string | null;
  queued: string[];
  /** Why it's dead or off, when something went wrong. */
  detail?: string;
};

export type ParsedCell = { id?: string; type: CellType; source: string; outputs: NotebookOutput[]; count: number | null };
export type ParsedNotebook = { cells: ParsedCell[]; metadata: Record<string, unknown> };

/** Most a cell's printed text keeps; the rest is cut with a note. */
export const MAX_STREAM_CHARS = 100_000;
/** Biggest single rich output (a plot as base64 PNG, an HTML table). */
export const MAX_RICH_CHARS = 768_000;
/** Most outputs one cell keeps. */
export const MAX_OUTPUTS = 200;

const DEFAULT_METADATA = {
  kernelspec: { name: "python3", display_name: "Python 3 (ipykernel)", language: "python" },
  language_info: { name: "python" },
};

export const isNotebookName = (name: string) => name.toLowerCase().endsWith(".ipynb");
export const notebooks = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("notebooks");
export const notebookOf = (doc: Y.Doc, fileId: string): Y.Map<unknown> | undefined => notebooks(doc).get(fileId);

export const cellsOf = (nb: Y.Map<unknown>) => nb.get("cells") as Y.Array<Y.Map<unknown>>;
export const cellId = (cell: Y.Map<unknown>) => cell.get("id") as string;
export const cellType = (cell: Y.Map<unknown>) => cell.get("type") as CellType;
export const cellSource = (cell: Y.Map<unknown>) => cell.get("source") as Y.Text;
export const cellOutputs = (cell: Y.Map<unknown>) => cell.get("outputs") as Y.Array<NotebookOutput>;
export const cellCount = (cell: Y.Map<unknown>) => (cell.get("count") as number | null | undefined) ?? null;

export function findCell(nb: Y.Map<unknown>, id: string): { cell: Y.Map<unknown>; index: number } | null {
  const cells = cellsOf(nb).toArray();
  const index = cells.findIndex((cell) => cellId(cell) === id);
  return index === -1 ? null : { cell: cells[index]!, index };
}

export function kernelOf(nb: Y.Map<unknown>): KernelStatus {
  return (nb.get("kernel") as KernelStatus | undefined) ?? { state: "off", running: null, queued: [] };
}

export function setKernel(nb: Y.Map<unknown>, status: KernelStatus): void {
  nb.set("kernel", status);
}

function makeCell(parsed: ParsedCell): Y.Map<unknown> {
  const cell = new Y.Map<unknown>();
  cell.set("id", parsed.id && /^[a-zA-Z0-9_-]{1,64}$/.test(parsed.id) ? parsed.id : randomId());
  cell.set("type", parsed.type);
  cell.set("source", new Y.Text(parsed.source));
  const outputs = new Y.Array<NotebookOutput>();
  if (parsed.type === "code" && parsed.outputs.length) outputs.push(parsed.outputs.slice(0, MAX_OUTPUTS));
  cell.set("outputs", outputs);
  cell.set("count", parsed.type === "code" ? parsed.count : null);
  return cell;
}

/**
 * The notebook for a .ipynb file, made the first time from the file's text: its cells
 * when that's a notebook, else one code cell holding whatever text it had (nothing lost),
 * or an empty one.
 */
export function ensureNotebook(doc: Y.Doc, fileId: string): Y.Map<unknown> {
  const existing = notebookOf(doc, fileId);
  if (existing) return existing;
  const text = textOf(doc, fileId)?.toString() ?? "";
  const parsed = parseIpynb(text) ?? { cells: [{ type: "code" as const, source: text.trim(), outputs: [], count: null }], metadata: {} };
  const nb = new Y.Map<unknown>();
  doc.transact(() => {
    const cells = new Y.Array<Y.Map<unknown>>();
    cells.push((parsed.cells.length ? parsed.cells : [{ type: "code" as const, source: "", outputs: [], count: null }]).map(makeCell));
    nb.set("cells", cells);
    nb.set("metadata", { ...DEFAULT_METADATA, ...parsed.metadata });
    nb.set("kernel", { state: "off", running: null, queued: [] } satisfies KernelStatus);
    notebooks(doc).set(fileId, nb);
  });
  return nb;
}

/** A new cell at `index`; returns its id. */
export function insertCell(nb: Y.Map<unknown>, index: number, type: CellType, source = ""): string {
  const cell = makeCell({ type, source, outputs: [], count: null });
  const cells = cellsOf(nb);
  cells.insert(Math.max(0, Math.min(index, cells.length)), [cell]);
  return cellId(cell);
}

export function deleteCell(nb: Y.Map<unknown>, id: string): void {
  const found = findCell(nb, id);
  if (found) cellsOf(nb).delete(found.index, 1);
}

/** Move a cell to `to` (its index once moved). Its source and outputs go with it. */
export function moveCell(nb: Y.Map<unknown>, id: string, to: number): void {
  const found = findCell(nb, id);
  const cells = cellsOf(nb);
  if (!found || to < 0 || to >= cells.length || to === found.index) return;
  const snapshot = toParsedCell(found.cell);
  nb.doc!.transact(() => {
    cells.delete(found.index, 1);
    cells.insert(to, [makeCell(snapshot)]);
  });
}

/** Code to markdown or back: the source stays, outputs and the run count go. */
export function setCellType(nb: Y.Map<unknown>, id: string, type: CellType): void {
  const found = findCell(nb, id);
  if (!found || cellType(found.cell) === type) return;
  nb.doc!.transact(() => {
    found.cell.set("type", type);
    clearOutputs(found.cell);
  });
}

export function clearOutputs(cell: Y.Map<unknown>): void {
  const outputs = cellOutputs(cell);
  if (outputs.length) outputs.delete(0, outputs.length);
  cell.set("count", null);
}

/**
 * Add an output as a kernel sends it: printed text joins the text just before it (a
 * loop of prints is one block, not thousands), and everything is kept within the caps.
 */
export function appendOutput(cell: Y.Map<unknown>, output: NotebookOutput): void {
  const outputs = cellOutputs(cell);
  if (output.output_type === "stream") {
    const last = outputs.length ? outputs.get(outputs.length - 1) : undefined;
    const before = last?.output_type === "stream" && last.name === output.name ? last.text : null;
    const printed = outputs.toArray().reduce((n, o) => n + (o.output_type === "stream" ? o.text.length : 0), 0);
    if (printed >= MAX_STREAM_CHARS) return;
    let text = output.text;
    if (printed + text.length > MAX_STREAM_CHARS) text = `${text.slice(0, MAX_STREAM_CHARS - printed)}\n[output cut at ${MAX_STREAM_CHARS.toLocaleString("en")} characters]\n`;
    if (before !== null) {
      outputs.delete(outputs.length - 1, 1);
      outputs.push([{ ...output, text: before + text }]);
    } else {
      outputs.push([{ ...output, text }]);
    }
    return;
  }
  if (outputs.length >= MAX_OUTPUTS) return;
  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const data = Object.fromEntries(
      Object.entries(output.data).map(([mime, value]) => {
        const size = typeof value === "string" ? value.length : JSON.stringify(value).length;
        return size > MAX_RICH_CHARS && mime !== "text/plain" ? [mime, null] : [mime, value];
      }),
    );
    // Too big to keep (a huge plot): say so in its text form instead.
    const dropped = Object.entries(data).some(([, value]) => value === null);
    const kept = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));
    if (dropped) kept["text/plain"] = `${String(kept["text/plain"] ?? "")}\n[too large to show here: save it to a file instead]`.trim();
    outputs.push([{ ...output, data: kept }]);
    return;
  }
  outputs.push([output]);
}

function toParsedCell(cell: Y.Map<unknown>): ParsedCell {
  return { id: cellId(cell), type: cellType(cell), source: cellSource(cell).toString(), outputs: cellOutputs(cell).toArray(), count: cellCount(cell) };
}

/** Lines as Jupyter writes them: each keeps its newline but the last. */
function lines(text: string): string[] {
  const parts = text.split("\n");
  return parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line)).filter((line) => line !== "");
}

const joined = (value: unknown) => (Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "");

/** The notebook as .ipynb JSON (nbformat 4.5), the way Jupyter writes it. */
export function toIpynb(nb: Y.Map<unknown>): string {
  const cells = cellsOf(nb)
    .toArray()
    .map((cell) => {
      const base = { cell_type: cellType(cell), id: cellId(cell), metadata: {}, source: lines(cellSource(cell).toString()) };
      if (cellType(cell) !== "code") return base;
      return { ...base, execution_count: cellCount(cell), outputs: cellOutputs(cell).toArray() };
    });
  const metadata = (nb.get("metadata") as Record<string, unknown> | undefined) ?? DEFAULT_METADATA;
  return `${JSON.stringify({ cells, metadata, nbformat: 4, nbformat_minor: 5 }, null, 1)}\n`;
}

/** A .ipynb file's cells and metadata, or null when the text isn't a notebook. */
export function parseIpynb(text: string): ParsedNotebook | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || !Array.isArray((json as { cells?: unknown }).cells)) return null;
  const notebook = json as { cells: Array<Record<string, unknown>>; metadata?: Record<string, unknown> };
  const cells = notebook.cells
    .filter((cell) => cell && (cell.cell_type === "code" || cell.cell_type === "markdown" || cell.cell_type === "raw"))
    .map((cell): ParsedCell => {
      const type: CellType = cell.cell_type === "code" ? "code" : "markdown";
      const outputs = type === "code" && Array.isArray(cell.outputs) ? (cell.outputs as Array<Record<string, unknown>>).map(normaliseOutput).filter((o): o is NotebookOutput => o !== null) : [];
      return {
        id: typeof cell.id === "string" ? cell.id : undefined,
        type,
        source: joined(cell.source),
        outputs,
        count: typeof cell.execution_count === "number" ? cell.execution_count : null,
      };
    });
  return { cells, metadata: notebook.metadata && typeof notebook.metadata === "object" ? notebook.metadata : {} };
}

/** An output from a file, with multi-line strings joined (Jupyter writes them as lists). */
function normaliseOutput(output: Record<string, unknown>): NotebookOutput | null {
  switch (output.output_type) {
    case "stream":
      return { output_type: "stream", name: output.name === "stderr" ? "stderr" : "stdout", text: joined(output.text) };
    case "display_data":
    case "execute_result": {
      const data = Object.fromEntries(Object.entries((output.data as Record<string, unknown>) ?? {}).map(([mime, value]) => [mime, Array.isArray(value) ? value.join("") : value]));
      const metadata = (output.metadata as Record<string, unknown>) ?? {};
      return output.output_type === "display_data"
        ? { output_type: "display_data", data, metadata }
        : { output_type: "execute_result", data, metadata, execution_count: typeof output.execution_count === "number" ? output.execution_count : null };
    }
    case "error":
      return {
        output_type: "error",
        ename: String(output.ename ?? "Error"),
        evalue: String(output.evalue ?? ""),
        traceback: Array.isArray(output.traceback) ? output.traceback.map(String) : [],
      };
    default:
      return null;
  }
}
