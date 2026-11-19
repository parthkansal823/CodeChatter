/** Check short Mermaid diagnostics and local line bounds without loading its browser renderer. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertNoMermaidHtml, MermaidSourceError, mermaidSourceLine, problemOf } from "./mermaid-problem";

describe("Mermaid HTML preflight", () => {
  it("rejects active and formatting tags before the renderer sees them", () => {
    for (const label of ['<img src=x onerror="alert(1)">', "<script>alert(1)</script>", "<svg onload=alert(1)>", "<br/>", "<IMG src=x"]) {
      assert.throws(() => assertNoMermaidHtml(`graph TD\n A["${label}"]`), MermaidSourceError);
    }
  });

  it("rejects encoded tags and encoded tag names without losing the original source line", () => {
    for (const label of ["&lt;img src=x&gt;", "&ltimg src=x&gt", "&#60;img src=x&#62;", "&#x3c;img src=x&#x3e;", "#60;img src=x#62;", "#lt;img src=x#gt;", "#x3c;img src=x#x3e;", "#lt;#x49;mg src=x#gt;", "&amp;lt;img src=x&amp;gt;", "<#73;mg src=x>"]) {
      try {
        assertNoMermaidHtml(`\ngraph TD\n A["${label}"]`);
        assert.fail("HTML-looking label was accepted");
      } catch (error) {
        assert.ok(error instanceof MermaidSourceError);
        assert.equal(error.sourceLine, 3);
      }
    }
  });

  it("keeps original blank, comment and metadata lines without applying parser offsets twice", () => {
    const text = '\n%% Heading\n---\ntitle: Test\n---\n%%{init: {"theme":"base"}}%%\ngraph TD\n A["<img src=x onerror=alert(1)>"]';
    try {
      assertNoMermaidHtml(text);
      assert.fail("HTML-looking label was accepted");
    } catch (error) {
      assert.deepEqual(problemOf(error, text), { line: 8, message: "HTML tags are not supported in diagram labels." });
    }
  });

  it("allows Mermaid arrows, inheritance markers and ordinary labels", () => {
    for (const text of ["graph LR; A <--> B", "classDiagram\n Animal <|-- Duck", "graph TD\n A[Start] --> B[Done]", 'graph TD\n A["x < y"]', "sequenceDiagram\n Alice->>Bob: Hello"]) {
      assert.doesNotThrow(() => assertNoMermaidHtml(text));
    }
  });
});

describe("Mermaid source lines", () => {
  it("includes leading blank lines and comments as the person reads them", () => {
    const text = "\n%% Heading\n\n graph TD\n %% Note\n A --> B[broken";
    assert.equal(mermaidSourceLine(1, text), 4);
    assert.equal(mermaidSourceLine(2, text), 6);
  });

  it("maps past valid front matter and preserves the closing delimiter's indentation", () => {
    assert.equal(mermaidSourceLine(2, "---\ntitle: Example\n---\ngraph TD\n A --> B[broken"), 5);
    assert.equal(mermaidSourceLine(2, "  ---\n  title: Example\n  ---\ngraph TD\n A --> B[broken"), 5);
  });

  it("maps multiline directives and internal removed comments", () => {
    assert.equal(mermaidSourceLine(2, '%%{init:\n {"theme":"base"}\n}%%\ngraph TD\n A --> B[broken'), 5);
    assert.equal(mermaidSourceLine(2, "graph TD\n%% Note\n A --> B[broken"), 3);
  });

  it("preserves blank lines left by an internal directive and ignores comment-looking labels", () => {
    assert.equal(mermaidSourceLine(3, 'graph TD\n%%{init: {"theme":"base"}}%%\n A --> B[broken'), 3);
    assert.equal(mermaidSourceLine(2, 'graph TD\n A["%% text"] --> B[broken'), 2);
  });

  it("normalizes CRLF and bounds an appended EOF line to the supplied block", () => {
    const text = "\r\n%% Note\r\ngraph TD\r\n A --> B[broken";
    assert.equal(mermaidSourceLine(2, text), 4);
    assert.equal(mermaidSourceLine(99, text), 4);
  });

  it("declines to invent positions for empty source or invalid reported lines", () => {
    for (const line of [null, 0, -1, 1.5, Infinity]) assert.equal(mermaidSourceLine(line, "graph TD"), null);
    assert.equal(mermaidSourceLine(1, " \n%% comment"), null);
  });
});

describe("Mermaid problems", () => {
  const text = "graph TD\n  A --> B[broken";

  it("keeps a parse heading's block-local line and useful bracket hint", () => {
    assert.deepEqual(problemOf({ message: "Parse error on line 2:\nExpecting 'SQE', got 'EOF'" }, text), {
      line: 2, message: "Mermaid expected a closing bracket or a node label here.",
    });
  });

  it("uses structured locations when there is no line in the heading", () => {
    assert.equal(problemOf({ message: "Syntax error", hash: { loc: { first_line: 2 } } }, text).line, 2);
    assert.equal(problemOf({ message: "Syntax error", hash: { line: 0 } }, text).line, 1);
  });

  it("bounds a renderer's EOF line to the actual source", () => {
    assert.equal(problemOf({ str: "Parse error on line 99:" }, text).line, 2);
  });

  it("rejects invalid locations and does not mistake source labels for headings", () => {
    assert.equal(problemOf({ message: "Syntax error\nA[Line 99]", hash: { line: -2 } }, text).line, null);
    assert.equal(problemOf({ message: "Syntax error", hash: { loc: { first_line: 1.5 } } }, text).line, null);
  });

  it("gives an actionable missing-type or size-limit message", () => {
    assert.deepEqual(problemOf(new Error("No diagram type detected"), "not a diagram"), {
      line: 1, message: "Start with a diagram type, for example graph TD.",
    });
    assert.equal(problemOf(new Error("No diagram type detected"), "\n%% Note\nnot a diagram").line, 3);
    assert.deepEqual(problemOf(new Error("Maximum diagram size exceeded."), text), {
      line: null, message: "This diagram is too large to draw. Try fewer nodes and arrows.",
    });
  });

  it("gives a safe fallback for arbitrary failures without echoing diagram contents", () => {
    assert.deepEqual(problemOf(null, text), {
      line: null, message: "Mermaid couldn't draw this yet. Check the diagram type, arrows and brackets.",
    });
    assert.equal(problemOf({ message: "Expecting 'ARROW', got 'EOF'" }, text).message, "Mermaid expected an arrow or a node label here.");
  });
});
