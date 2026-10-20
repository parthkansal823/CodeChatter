// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asNumber, detectDelimiter, isNumericColumn, parseCsv, sortRows } from "./csv";

const cellsOf = (text: string, delimiter?: string) => parseCsv(text, delimiter).rows.map((r) => r.cells);

describe("parseCsv", () => {
  it("plain rows, with or without a final newline", () => {
    assert.deepEqual(cellsOf("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(cellsOf("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  });
  it("quoted fields: delimiters, doubled quotes and line breaks inside", () => {
    const parsed = parseCsv('name,note\n"Smith, J","said ""hi"""\n"two\nlines",x\nlast,y\n');
    assert.deepEqual(parsed.rows.map((r) => r.cells), [["name", "note"], ["Smith, J", 'said "hi"'], ["two\nlines", "x"], ["last", "y"]]);
    assert.deepEqual(parsed.rows.map((r) => r.line), [1, 2, 3, 5]);
  });
  it("CRLF line endings and empty fields", () => {
    assert.deepEqual(cellsOf("a,,c\r\n,2,\r\n"), [["a", "", "c"], ["", "2", ""]]);
  });
  it("blank lines are skipped but still counted", () => {
    const parsed = parseCsv("a\n\nb\n");
    assert.deepEqual(parsed.rows, [{ line: 1, cells: ["a"] }, { line: 3, cells: ["b"] }]);
  });
  it("ragged rows: columns is the widest", () => {
    assert.equal(parseCsv("a,b,c\n1\n").columns, 3);
  });
  it("an empty quoted field still makes a row", () => {
    assert.deepEqual(cellsOf('""\n'), [[""]]);
  });
});

describe("detectDelimiter", () => {
  it("picks the one the header uses, ignoring quoted ones", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a\tb\n"), "\t");
    assert.equal(detectDelimiter('"x;y;z",b,c\n'), ",");
    assert.equal(detectDelimiter("single\n"), ",");
  });
});

describe("numbers and sorting", () => {
  it("reads numbers people write", () => {
    assert.equal(asNumber("1,234.5"), 1234.5);
    assert.equal(asNumber("-3"), -3);
    assert.equal(asNumber("12%"), 12);
    assert.equal(asNumber("1e3"), 1000);
    assert.equal(asNumber("12 apples"), null);
    assert.equal(asNumber(""), null);
    assert.equal(asNumber("."), null);
  });
  const rows = parseCsv("10\n9\n\n100\nn/a\n").rows;
  it("a mostly numeric column is numeric", () => {
    assert.equal(isNumericColumn(rows, 0), true);
    assert.equal(isNumericColumn(parseCsv("a\nb\n1\n").rows, 0), false);
  });
  it("sorts numbers by value, text naturally, empties last", () => {
    const sorted = sortRows(parseCsv("10\n9\n\n100\n").rows.concat({ line: 9, cells: [""] }), 0, "asc", true);
    assert.deepEqual(sorted.map((r) => r.cells[0]), ["9", "10", "100", ""]);
    const desc = sortRows(parseCsv("file2\nfile10\nfile1\n").rows, 0, "desc", false);
    assert.deepEqual(desc.map((r) => r.cells[0]), ["file10", "file2", "file1"]);
  });
});
