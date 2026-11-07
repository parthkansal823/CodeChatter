import { describe, expect, it } from "vitest";

import { DATA_LIMITS, DataSummaryInput, describeColumn, sampleOf, type DataColumn } from "./data-summary.js";

const column: DataColumn = { name: "age", type: "BIGINT", nullPercent: 10, unique: 40, min: "1", max: "99", mean: "33.5", std: "12.1", q25: "20", q50: "30", q75: "45", outliers: 2, top: [] };

describe("what may be summarized", () => {
  it("takes a table of text and nothing", () => {
    expect(DataSummaryInput.safeParse({ columns: ["a"], rows: [["1"], [null]] }).success).toBe(true);
  });

  it("needs something to summarize", () => {
    expect(DataSummaryInput.safeParse({ columns: [], rows: [["1"]] }).success).toBe(false);
    expect(DataSummaryInput.safeParse({ columns: ["a"], rows: [] }).success).toBe(false);
  });

  it("stops at the limits", () => {
    expect(DataSummaryInput.safeParse({ columns: ["a"], rows: Array(DATA_LIMITS.rows + 1).fill(["1"]) }).success).toBe(false);
    expect(DataSummaryInput.safeParse({ columns: Array(DATA_LIMITS.columns + 1).fill("a"), rows: [["1"]] }).success).toBe(false);
    expect(DataSummaryInput.safeParse({ columns: ["a"], rows: [["x".repeat(DATA_LIMITS.cellChars + 1)]] }).success).toBe(false);
  });

  it("refuses what isn't text", () => {
    expect(DataSummaryInput.safeParse({ columns: ["a"], rows: [[5]] }).success).toBe(false);
  });
});

describe("the sample", () => {
  it("is the first few rows, with long values cut", () => {
    const sample = sampleOf(["a"], [["x".repeat(900)], [null], ["3"], ["4"], ["5"], ["6"], ["7"]]);
    expect(sample.rows).toHaveLength(DATA_LIMITS.sampleRows);
    expect(sample.rows[0]![0]).toHaveLength(DATA_LIMITS.sampleCellChars);
    expect(sample.rows[1]![0]).toBeNull();
  });
});

describe("a column in words", () => {
  it("gives a number's spread", () => {
    expect(describeColumn(column)).toBe("age (BIGINT): 10% empty; about 40 distinct; from 1 to 99; mean 33.5; std 12.1; quartiles 20, 30, 45; 2 outliers");
  });

  it("gives text its common values, and no spread", () => {
    expect(describeColumn({ ...column, name: "city", type: "VARCHAR", mean: null, std: null, top: [{ value: "Pune", count: 5 }, { value: "Delhi", count: 2 }] })).toBe("city (VARCHAR): 10% empty; about 40 distinct; from 1 to 99; most common: Pune (5), Delhi (2)");
  });

  it("copes with a column that's all empty", () => {
    expect(describeColumn({ ...column, nullPercent: 100, unique: 0, min: null, max: null, mean: null, std: null })).toBe("age (BIGINT): 100% empty; about 0 distinct");
  });
});
