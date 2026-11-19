/** Check parsed fence identification, nesting and exact source preservation without needing the browser or Mermaid. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markMermaidBlocks, mermaidBlockOf, remarkMermaidBlocks } from "./markdown-mermaid-utils";

type Code = { type: string; lang?: string; value: string; data?: { hProperties?: Record<string, unknown> } };
const code = (lang: string, value: string): Code => ({ type: "code", lang, value });
const pre = (node: Code) => ({ tagName: "pre", children: [{ tagName: "code", properties: node.data?.hProperties }] });

describe("Markdown Mermaid fences", () => {
  it("marks only Mermaid fenced code and numbers duplicate diagrams separately", () => {
    const one = code("mermaid", "graph TD; A-->B");
    const other = code("js", "alert('ordinary code')");
    const two = code("MERMAID", one.value);
    const inline = { type: "inlineCode", lang: "mermaid", value: one.value };
    remarkMermaidBlocks()({ type: "root", children: [one, other, inline, two] });
    assert.deepEqual(mermaidBlockOf(pre(one)), { text: one.value, index: 1 });
    assert.deepEqual(mermaidBlockOf(pre(two)), { text: one.value, index: 2 });
    assert.equal(mermaidBlockOf(pre(other)), null);
    assert.equal("data" in inline, false);
  });

  it("finds fences inside lists and block quotes in document order", () => {
    const one = code("mermaid", "graph TD; A-->B");
    const two = code("mermaid", "sequenceDiagram\nA->>B: Hello");
    markMermaidBlocks({ type: "root", children: [
      { type: "list", children: [{ type: "listItem", children: [one] }] },
      { type: "blockquote", children: [two] },
    ] });
    assert.equal(mermaidBlockOf(pre(one))?.index, 1);
    assert.equal(mermaidBlockOf(pre(two))?.index, 2);
  });

  it("preserves empty, whitespace and leading/trailing blank lines exactly", () => {
    for (const value of ["", " \n \t", "\ngraph TD\nA[Broken\n\n"]) {
      const node = code("mermaid", value);
      markMermaidBlocks(node);
      assert.equal(mermaidBlockOf(pre(node))?.text, value);
    }
  });

  it("keeps existing metadata and does not mistake Mermaid-looking text for a fence", () => {
    const node = code("mermaid", "graph TD; A-->B");
    node.data = { hProperties: { title: "A diagram" } };
    markMermaidBlocks(node);
    assert.equal(node.data.hProperties?.title, "A diagram");
    assert.equal(mermaidBlockOf({ tagName: "code", properties: node.data.hProperties }), null);
    assert.equal(mermaidBlockOf({ tagName: "pre", children: [{ tagName: "code", properties: { className: ["language-mermaid"] } }] }), null);
    assert.equal(mermaidBlockOf(null), null);
  });
});
