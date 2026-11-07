import { describe, expect, it } from "vitest";

import { AiRetrieveInput, citationsNotShown, RagRunnerInput } from "./rag.js";

describe("what may be asked", () => {
  it("takes a question, with a limit", () => {
    expect(AiRetrieveInput.parse({ question: "  Where? " })).toEqual({ question: "Where?", limit: 8 });
  });

  it("refuses nothing, or too much", () => {
    for (const bad of [{ question: "   " }, { question: "x".repeat(2001) }, { question: "a", limit: 0 }, { question: "a", limit: 99 }]) {
      expect(AiRetrieveInput.safeParse(bad).success).toBe(false);
    }
  });

  it("says which embedding model, or none", () => {
    expect(RagRunnerInput.parse({ question: "a", model: null }).model).toBeNull();
    expect(RagRunnerInput.safeParse({ question: "a" }).success).toBe(false);
  });
});

describe("what an answer cites", () => {
  const shown = [{ path: "src/app/main.py", start: 10, end: 20 }, { path: "README.md", start: 1, end: 5 }];

  it("is fine when it's a place it was shown", () => {
    for (const fine of ["See `src/app/main.py:10`.", "`src/app/main.py:20`", "`./src/app/main.py:15`", "`main.py:12`", "`app/main.py:12`", "`README.md:1`", "`src/app/main.py:10-12`", "`src/app/main.py:12:4`"]) {
      expect(citationsNotShown(fine, shown)).toEqual([]);
    }
  });

  it("is flagged when it wasn't", () => {
    expect(citationsNotShown("`src/app/main.py:9` and `src/app/main.py:21`", shown)).toEqual(["src/app/main.py:9", "src/app/main.py:21"]);
    expect(citationsNotShown("`src/other.py:3`", shown)).toEqual(["src/other.py:3"]);
    expect(citationsNotShown("`ain.py:12`", shown)).toEqual(["ain.py:12"]);
  });

  it("only looks at places", () => {
    for (const other of ["`src/app/main.py`", "`x = 1`", "`host:8080 is up`", "no citations at all", "`a b:3`"]) {
      expect(citationsNotShown(other, shown)).toEqual([]);
    }
  });

  it("names each once", () => {
    expect(citationsNotShown("`a.py:1` `a.py:1`", shown)).toEqual(["a.py:1"]);
  });
});
