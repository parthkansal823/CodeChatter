import { describe, expect, it } from "vitest";

import { LatexInput, parseReferenceId } from "./latex.js";

describe("what may be built", () => {
  it("takes a .tex file in the room", () => {
    expect(LatexInput.parse({ op: "build", file: "paper/main.tex" })).toEqual({ op: "build", file: "paper/main.tex", fresh: false });
    expect(LatexInput.parse({ op: "status", file: "My Paper.TEX" }).op).toBe("status");
    expect(LatexInput.parse({ op: "pdf", file: "a/b/c.tex" }).op).toBe("pdf");
  });

  it("refuses anything else: this path reaches the sandbox", () => {
    for (const file of ["", "/etc/passwd.tex", "../a.tex", "a/../../b.tex", "./a.tex", "a//b.tex", "a\\b.tex", "a.txt", "a.tex.pdf", "a\0.tex", `${"a".repeat(1024)}.tex`]) {
      expect(LatexInput.safeParse({ op: "build", file }).success, file).toBe(false);
    }
  });

  it("refuses what it doesn't know", () => {
    expect(LatexInput.safeParse({ op: "clean", file: "a.tex" }).success).toBe(false);
  });
});

describe("finding a DOI or arXiv id in what's pasted", () => {
  it("reads DOIs, with or without their link", () => {
    for (const input of ["10.1038/nature14539", "doi:10.1038/nature14539", " https://doi.org/10.1038/nature14539 ", "http://dx.doi.org/10.1038/nature14539"]) {
      expect(parseReferenceId(input), input).toEqual({ kind: "doi", id: "10.1038/nature14539" });
    }
    expect(parseReferenceId("10.1000/a.b_c-d;(e)/f:g")?.kind).toBe("doi");
  });

  it("reads arXiv ids, new and old, with or without their link", () => {
    for (const input of ["1706.03762", "arXiv:1706.03762", "https://arxiv.org/abs/1706.03762", "arxiv.org/pdf/1706.03762.pdf"]) {
      expect(parseReferenceId(input), input).toEqual({ kind: "arxiv", id: "1706.03762" });
    }
    expect(parseReferenceId("1706.03762v7")).toEqual({ kind: "arxiv", id: "1706.03762v7" });
    expect(parseReferenceId("hep-th/9901001")).toEqual({ kind: "arxiv", id: "hep-th/9901001" });
    expect(parseReferenceId("math.GT/0309136")).toEqual({ kind: "arxiv", id: "math.GT/0309136" });
  });

  it("refuses anything else, so nothing else can make a request", () => {
    for (const input of ["", "hello", "10.1038", "10.1/short", "http://169.254.169.254/latest", "https://evil.example/10.1038/x", "10.1038/x y", "10.1038/x?a=b", "10.1038/x#frag", "1706.037", "../../etc/passwd", "10.1038/x\nHost: evil"]) {
      expect(parseReferenceId(input), input).toBeNull();
    }
  });
});
