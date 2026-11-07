import { describe, expect, it } from "vitest";

import { parseHits, RagError } from "./rag.js";

const passage = { path: "a.py", start: 1, end: 9, name: "f", text: "def f(): pass", score: 0.03, found: "both" };
const hits = { passages: [passage], index: { files: 2, chunks: 5, changed: 1, embedded: 5, waiting: 0, ms: 12, model: "m" }, note: null };

describe("what the search said", () => {
  it("reads back", () => {
    expect(parseHits(JSON.stringify(hits))).toEqual(hits);
  });

  it("passes on what it refused, in its words", () => {
    expect(() => parseHits(JSON.stringify({ error: "Couldn't check the files for secrets." }))).toThrow(RagError);
    expect(() => parseHits(JSON.stringify({ error: "Couldn't check the files for secrets." }))).toThrow(/secrets/);
  });

  it("leaves out a passage that isn't what it should be", () => {
    const out = parseHits(JSON.stringify({ ...hits, passages: [passage, { ...passage, start: 0 }, { ...passage, found: "magic" }, { ...passage, text: "x".repeat(7000) }, "nonsense"] }));
    expect(out.passages).toHaveLength(1);
  });

  it("keeps only what's named", () => {
    const out = parseHits(JSON.stringify({ ...hits, extra: "x", index: { ...hits.index, secret: "y" } }));
    expect(JSON.stringify(out)).not.toMatch(/extra|secret/);
  });

  it("copes with something missing", () => {
    expect(parseHits("{}")).toEqual({ passages: [], index: { files: 0, chunks: 0, changed: 0, embedded: 0, waiting: 0, ms: 0, model: null }, note: null });
    expect(() => parseHits("not json")).toThrow();
  });
});
