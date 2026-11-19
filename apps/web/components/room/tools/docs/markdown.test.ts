/** Check toggle Markdown export without a browser, including nested content and escaped HTML summaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JSONContent } from "@tiptap/react";

import { toMarkdown } from "./markdown";

const resolve = { pageTitle: () => "Linked page", filePath: () => "src/main.ts" };
const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const toggle = (summary: string, content: JSONContent[]): JSONContent => ({ type: "toggle", attrs: { id: "toggle-1" }, content: [{ type: "toggleSummary", content: [{ type: "text", text: summary }] }, { type: "toggleBody", content }] });

test("nested toggles export details with Markdown blocks and no shared open state", () => {
  const content = toggle("Outer", [paragraph("First paragraph"), toggle("Inner", [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("Nested item")] }] }]), paragraph("Last paragraph")]);
  assert.equal(toMarkdown("Page", { type: "doc", content: [content] }, resolve), "# Page\n\n<details>\n<summary>Outer</summary>\n\nFirst paragraph\n\n<details>\n<summary>Inner</summary>\n\n- Nested item\n\n</details>\n\nLast paragraph\n\n</details>\n");
});

test("summary HTML escapes text and link attributes while retaining safe formatting", () => {
  const content = toggle("", [paragraph("Body")]);
  content.content![0]!.content = [
    { type: "text", text: '<summary> & "title"', marks: [{ type: "bold" }] },
    { type: "text", text: " safe", marks: [{ type: "link", attrs: { href: 'https://example.test/?q="x"&a=1' } }] },
    { type: "text", text: " unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
    { type: "wikiLink", attrs: { kind: "page", target: "page-1", label: "Old title" } },
  ];
  const markdown = toMarkdown("Page", { type: "doc", content: [content] }, resolve);
  assert.ok(markdown.includes('<strong>&lt;summary&gt; &amp; &quot;title&quot;</strong>'));
  assert.ok(markdown.includes('<a href="https://example.test/?q=&quot;x&quot;&amp;a=1"> safe</a>'));
  assert.ok(markdown.includes(" unsafe[[Linked page]]"));
  assert.ok(!markdown.includes("javascript:"));
});

test("a toggle keeps code, tables and empty summaries in its export", () => {
  const content = toggle("", [{ type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const value = 1;" }] }, { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("Column")] }] }] }]);
  const markdown = toMarkdown("Page", { type: "doc", content: [content] }, resolve);
  assert.ok(markdown.includes("<summary></summary>"));
  assert.ok(markdown.includes("```ts\nconst value = 1;\n```"));
  assert.ok(markdown.includes("| Column |\n| --- |"));
});
