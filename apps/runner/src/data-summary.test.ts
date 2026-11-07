import { describe, expect, it } from "vitest";

import { DataSummaryError, parseSummary } from "./data-summary.js";

const column = { name: "a", type: "BIGINT", nullPercent: 0, unique: 3, min: "1", max: "3", mean: "2", std: "1", q25: "1", q50: "2", q75: "3", outliers: 0, top: [{ value: "1", count: 1 }] };
const summary = { engine: "DuckDB 1.5.6", rows: 3, duplicates: 0, columns: [column], correlations: [{ a: "a", b: "b", r: 0.9 }] };

describe("what the summary said", () => {
  it("reads back", () => {
    expect(parseSummary(JSON.stringify(summary))).toEqual(summary);
  });

  it("keeps only what's named", () => {
    expect(JSON.stringify(parseSummary(JSON.stringify({ ...summary, extra: "x" })))).not.toContain("extra");
  });

  it("passes on what DuckDB couldn't do, in its words", () => {
    expect(() => parseSummary(JSON.stringify({ error: "DuckDB couldn't read this table: bad" }))).toThrow(DataSummaryError);
    expect(() => parseSummary(JSON.stringify({ error: "DuckDB couldn't read this table: bad" }))).toThrow(/couldn't read/);
  });

  it("refuses numbers it can't vouch for", () => {
    expect(() => parseSummary(JSON.stringify({ ...summary, rows: "many" }))).toThrow(DataSummaryError);
    expect(() => parseSummary(JSON.stringify({ ...summary, columns: [{ ...column, outliers: "2" }] }))).toThrow(DataSummaryError);
    expect(() => parseSummary("{}")).toThrow(DataSummaryError);
  });
});
