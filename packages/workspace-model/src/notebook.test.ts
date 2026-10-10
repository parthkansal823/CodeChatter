import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createFile, textOf } from "./model.js";
import {
  appendOutput,
  cellCount,
  cellId,
  cellOutputs,
  cellsOf,
  cellSource,
  cellType,
  deleteCell,
  ensureNotebook,
  insertCell,
  MAX_RICH_CHARS,
  MAX_STREAM_CHARS,
  moveCell,
  notebookOf,
  parseIpynb,
  setCellType,
  toIpynb,
} from "./notebook.js";

const JUPYTER = JSON.stringify({
  cells: [
    { cell_type: "markdown", id: "intro", metadata: {}, source: ["# Sales\n", "By month."] },
    {
      cell_type: "code",
      id: "load",
      metadata: {},
      execution_count: 3,
      source: ["import pandas as pd\n", "df = pd.read_csv('sales.csv')\n", "df.head()"],
      outputs: [
        { output_type: "stream", name: "stdout", text: ["loaded\n", "12 rows\n"] },
        { output_type: "execute_result", execution_count: 3, metadata: {}, data: { "text/plain": ["   month  total\n", "0  Jan    10"] } },
      ],
    },
    { cell_type: "raw", id: "note", metadata: {}, source: "kept as text" },
  ],
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" } },
  nbformat: 4,
  nbformat_minor: 5,
});

function fileWith(content: string) {
  const doc = new Y.Doc();
  const id = createFile(doc, { name: "analysis.ipynb", content });
  return { doc, id };
}

describe("notebooks", () => {
  it("starts an empty .ipynb file as one empty code cell", () => {
    const { doc, id } = fileWith("");
    const nb = ensureNotebook(doc, id);
    const cells = cellsOf(nb).toArray();
    expect(cells).toHaveLength(1);
    expect(cellType(cells[0]!)).toBe("code");
    expect(cellSource(cells[0]!).toString()).toBe("");
    expect(ensureNotebook(doc, id)).toBe(nb);
  });

  it("reads a Jupyter notebook's cells, sources, outputs and counts", () => {
    const { doc, id } = fileWith(JUPYTER);
    const cells = cellsOf(ensureNotebook(doc, id)).toArray();
    expect(cells.map(cellType)).toEqual(["markdown", "code", "markdown"]);
    expect(cells.map(cellId).slice(0, 2)).toEqual(["intro", "load"]);
    expect(cellSource(cells[1]!).toString()).toBe("import pandas as pd\ndf = pd.read_csv('sales.csv')\ndf.head()");
    expect(cellCount(cells[1]!)).toBe(3);
    expect(cellOutputs(cells[1]!).toArray()).toEqual([
      { output_type: "stream", name: "stdout", text: "loaded\n12 rows\n" },
      { output_type: "execute_result", execution_count: 3, metadata: {}, data: { "text/plain": "   month  total\n0  Jan    10" } },
    ]);
  });

  it("keeps text that isn't a notebook, in a code cell", () => {
    const { doc, id } = fileWith("print('not json')\n");
    const cells = cellsOf(ensureNotebook(doc, id)).toArray();
    expect(cells).toHaveLength(1);
    expect(cellSource(cells[0]!).toString()).toBe("print('not json')");
  });

  it("writes .ipynb the way Jupyter reads it, and reads it back the same", () => {
    const { doc, id } = fileWith(JUPYTER);
    const nb = ensureNotebook(doc, id);
    const written = toIpynb(nb);
    const json = JSON.parse(written);
    expect(json.nbformat).toBe(4);
    expect(json.nbformat_minor).toBe(5);
    expect(json.cells[1].source).toEqual(["import pandas as pd\n", "df = pd.read_csv('sales.csv')\n", "df.head()"]);
    expect(json.cells[0]).not.toHaveProperty("outputs");
    expect(json.metadata.kernelspec.name).toBe("python3");

    const again = new Y.Doc();
    const copy = createFile(again, { name: "copy.ipynb", content: written });
    expect(toIpynb(ensureNotebook(again, copy))).toBe(written);
    expect(parseIpynb("not json")).toBeNull();
    expect(parseIpynb('{"cells": "nope"}')).toBeNull();
  });

  it("joins printed text into one block, and keeps outputs within their caps", () => {
    const { doc, id } = fileWith("");
    const cell = cellsOf(ensureNotebook(doc, id)).get(0);
    for (let i = 0; i < 5; i++) appendOutput(cell, { output_type: "stream", name: "stdout", text: `line ${i}\n` });
    appendOutput(cell, { output_type: "stream", name: "stderr", text: "warning\n" });
    expect(cellOutputs(cell).toArray()).toEqual([
      { output_type: "stream", name: "stdout", text: "line 0\nline 1\nline 2\nline 3\nline 4\n" },
      { output_type: "stream", name: "stderr", text: "warning\n" },
    ]);

    appendOutput(cell, { output_type: "stream", name: "stderr", text: "x".repeat(MAX_STREAM_CHARS) });
    const printed = cellOutputs(cell).toArray().reduce((n, o) => n + (o.output_type === "stream" ? o.text.length : 0), 0);
    expect(printed).toBeLessThan(MAX_STREAM_CHARS + 100);
    expect(JSON.stringify(cellOutputs(cell).toArray())).toContain("[output cut at");

    appendOutput(cell, { output_type: "display_data", data: { "image/png": "A".repeat(MAX_RICH_CHARS + 1), "text/plain": "<Figure>" } });
    const plot = cellOutputs(cell).toArray().at(-1)!;
    expect(plot.output_type === "display_data" && plot.data["image/png"]).toBeFalsy();
    expect(plot.output_type === "display_data" && String(plot.data["text/plain"])).toContain("too large to show");
  });

  it("adds, moves, retypes and deletes cells, and a move keeps the cell's source and outputs", () => {
    const { doc, id } = fileWith("");
    const nb = ensureNotebook(doc, id);
    const first = cellId(cellsOf(nb).get(0));
    const second = insertCell(nb, 1, "markdown", "# Notes");
    const third = insertCell(nb, 2, "code", "print(2)");
    appendOutput(cellsOf(nb).get(2), { output_type: "stream", name: "stdout", text: "2\n" });

    moveCell(nb, third, 0);
    const order = cellsOf(nb).toArray();
    expect(order.map(cellId)).toEqual([third, first, second]);
    expect(cellSource(order[0]!).toString()).toBe("print(2)");
    expect(cellOutputs(order[0]!).toArray()).toHaveLength(1);

    setCellType(nb, third, "markdown");
    expect(cellType(cellsOf(nb).get(0))).toBe("markdown");
    expect(cellOutputs(cellsOf(nb).get(0)).length).toBe(0);

    deleteCell(nb, first);
    expect(cellsOf(nb).toArray().map(cellId)).toEqual([third, second]);
    expect(notebookOf(doc, id)).toBe(nb);
    expect(textOf(doc, id)?.toString()).toBe(""); // the file's text is the runner's to write
  });
});
