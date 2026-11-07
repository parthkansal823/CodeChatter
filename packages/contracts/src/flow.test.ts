import { describe, expect, it } from "vitest";

import { FlowInput } from "./flow.js";

describe("what may be asked", () => {
  it("takes each kind of request", () => {
    for (const op of ["graph", "status", "stop", "runs"]) expect(FlowInput.parse({ op })).toEqual({ op });
    expect(FlowInput.parse({ op: "preview", dataset: "clean_orders" })).toEqual({ op: "preview", dataset: "clean_orders" });
    expect(FlowInput.parse({ op: "profile", dataset: "shop.orders" })).toEqual({ op: "profile", dataset: "shop.orders" });
    expect(FlowInput.parse({ op: "failures", check: "test.flow.unique_a_id.f211298759" }).op).toBe("failures");
    expect(FlowInput.parse({ op: "run", id: "20261107-103919-a1b2c3" }).op).toBe("run");
  });

  it("builds the whole project unless it's told otherwise", () => {
    expect(FlowInput.parse({ op: "build" })).toEqual({ op: "build", dataset: null, scope: "needs", fresh: false });
    expect(FlowInput.parse({ op: "build", dataset: "a", scope: "after", fresh: true })).toEqual({ op: "build", dataset: "a", scope: "after", fresh: true });
  });

  it("keeps a dataset's name from being anything but a name: it's passed to dbt and looked up", () => {
    for (const dataset of ["", "--help", "-s", "+a", "a+", "path:models", "tag:x", "a b", "a,b", `x"; drop table a; --`, "../a", "a/b", "a".repeat(129)]) {
      expect(FlowInput.safeParse({ op: "build", dataset }).success, dataset).toBe(false);
      expect(FlowInput.safeParse({ op: "preview", dataset }).success, dataset).toBe(false);
    }
  });

  it("only builds in the ways it knows", () => {
    expect(FlowInput.safeParse({ op: "build", dataset: "a", scope: "everything" }).success).toBe(false);
  });

  it("keeps a run and a check from being some other file or thing", () => {
    for (const id of ["../live", "a/b", "a.json", ""]) expect(FlowInput.safeParse({ op: "run", id }).success, id).toBe(false);
    for (const check of ["model.a.b", "test.", "test.a/b", `test.a"b`]) expect(FlowInput.safeParse({ op: "failures", check }).success, check).toBe(false);
  });

  it("refuses what it doesn't know", () => {
    expect(FlowInput.safeParse({ op: "drop" }).success).toBe(false);
    expect(FlowInput.safeParse({}).success).toBe(false);
  });
});
