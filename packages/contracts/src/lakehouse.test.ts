import { describe, expect, it } from "vitest";

import { LakehouseInput, runColumns, type LakehouseRun } from "./lakehouse.js";

describe("what may be asked", () => {
  it("takes each kind of request", () => {
    expect(LakehouseInput.parse({ op: "overview" })).toEqual({ op: "overview" });
    expect(LakehouseInput.parse({ op: "runs" })).toEqual({ op: "runs" });
    expect(LakehouseInput.parse({ op: "history", table: "gold_orders" })).toEqual({ op: "history", table: "gold_orders" });
    expect(LakehouseInput.parse({ op: "preview", table: "a.b-c" })).toEqual({ op: "preview", table: "a.b-c", version: null });
    expect(LakehouseInput.parse({ op: "preview", table: "a", version: 3 }).op).toBe("preview");
  });

  it("refuses a table's name that could go somewhere else", () => {
    for (const table of ["../secrets", "..", "a/b", "a\\b", "", ".hidden", "a b", "a'b", "x".repeat(129)]) {
      expect(LakehouseInput.safeParse({ op: "history", table }).success).toBe(false);
      expect(LakehouseInput.safeParse({ op: "preview", table }).success).toBe(false);
    }
  });

  it("refuses a version that isn't one", () => {
    for (const version of [-1, 1.5, "1; DROP TABLE t"]) expect(LakehouseInput.safeParse({ op: "preview", table: "a", version }).success).toBe(false);
  });

  it("refuses anything else", () => {
    expect(LakehouseInput.safeParse({ op: "delete", table: "a" }).success).toBe(false);
  });
});

describe("comparing runs", () => {
  const run = (over: Partial<LakehouseRun>): LakehouseRun => ({ id: "1", name: "a", experiment: "e", status: "FINISHED", at: 1, ms: 1, params: {}, metrics: {}, ...over });

  it("has a column for anything any of them logged, once", () => {
    expect(runColumns([run({ params: { b: "1", a: "2" }, metrics: { rmse: 1 } }), run({ params: { a: "3" }, metrics: { mae: 2, rmse: 3 } })])).toEqual({ params: ["a", "b"], metrics: ["mae", "rmse"] });
  });

  it("is empty with nothing to compare", () => {
    expect(runColumns([])).toEqual({ params: [], metrics: [] });
  });
});
