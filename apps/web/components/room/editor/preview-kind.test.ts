/** Check preview discovery and error locations so file previews keep their existing shortcuts and reveal the right code. */
// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mermaidErrorLine, PREVIEW_LABEL, previewKindOf } from "./preview-kind";

describe("previewKindOf", () => {
  it("recognises both Mermaid extensions without case sensitivity", () => {
    for (const name of ["flow.mmd", "flow.mermaid", "FLOW.MMD", "FLOW.MERMAID", "diagrams/flow.MmD"]) {
      assert.equal(previewKindOf(name), "diagram", name);
    }
    assert.equal(PREVIEW_LABEL.diagram, "Diagram preview");
  });

  it("keeps the existing Markdown, table and image previews", () => {
    for (const name of ["notes.md", "NOTES.MARKDOWN"]) assert.equal(previewKindOf(name), "markdown");
    for (const name of ["rows.csv", "ROWS.TSV"]) assert.equal(previewKindOf(name), "table");
    assert.equal(previewKindOf("picture.SVG"), "image");
    assert.equal(PREVIEW_LABEL.markdown, "Markdown preview");
    assert.equal(PREVIEW_LABEL.table, "Table view");
    assert.equal(PREVIEW_LABEL.image, "Image preview");
  });

  it("does not mistake another extension or a backup for a diagram", () => {
    for (const name of ["flow.mmd.bak", "flow.mermaidx", "mmd", "flow.ts", "diagram", ""]) {
      assert.equal(previewKindOf(name), null, name);
    }
  });
});

describe("mermaidErrorLine", () => {
  it("reads Mermaid parse errors and common line headings", () => {
    assert.equal(mermaidErrorLine("Parse error on line 3:\n  A --> B[\nExpecting 'SQE', got 'EOF'"), 3);
    assert.equal(mermaidErrorLine("Syntax error at line 12, column 4"), 12);
    assert.equal(mermaidErrorLine("Error at line: 2\r\nUnexpected token"), 2);
    assert.equal(mermaidErrorLine("LINE 8: unexpected input"), 8);
  });

  it("does not invent a line for unknown diagram types or quoted source", () => {
    assert.equal(mermaidErrorLine("No diagram type detected matching given configuration"), null);
    assert.equal(mermaidErrorLine("Syntax error\n  A[Line 99] -->"), null);
    assert.equal(mermaidErrorLine(""), null);
  });

  it("rejects zero, negative, fractional and unreasonably large lines", () => {
    for (const message of ["line 0", "line -1", "line 1.5", "line 9007199254740992"]) {
      assert.equal(mermaidErrorLine(message), null);
    }
  });
});
