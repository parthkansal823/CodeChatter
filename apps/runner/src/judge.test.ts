import { describe, expect, it } from "vitest";

import { judgePlanFor, normalizeOutput } from "./judge.js";

describe("judge", () => {
  it("builds compiled languages once and runs the binary per test", () => {
    expect(judgePlanFor("a.cpp")).toEqual({ build: 'g++ -std=c++20 -O2 -Wall -o /tmp/cc-judge "$1"', run: "/tmp/cc-judge" });
    expect(judgePlanFor("sol.py")).toEqual({ run: 'python3 -u "$1"' });
    expect(judgePlanFor("notes.md")).toBeNull();
  });

  it("compares outputs the way online judges do", () => {
    expect(normalizeOutput("1 2 3  \n4\n\n\n")).toBe(normalizeOutput("1 2 3\n4"));
    expect(normalizeOutput("a\r\nb\r\n")).toBe("a\nb");
    expect(normalizeOutput("1 2")).not.toBe(normalizeOutput("1  2"));
  });
});
