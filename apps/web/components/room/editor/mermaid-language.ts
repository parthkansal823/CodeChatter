/** Give Mermaid room files readable colours and matching brackets without loading the diagram renderer. */
"use client";

import { monaco } from "@/components/room/monaco-setup";

let registered = false;

export function registerMermaid(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "mermaid", extensions: [".mmd", ".mermaid"], aliases: ["Mermaid"] });
  monaco.languages.setMonarchTokensProvider("mermaid", {
    keywords: [
      "graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram",
      "gantt", "pie", "journey", "mindmap", "timeline", "subgraph", "end", "style", "classDef", "click",
    ],
    directions: ["TD", "TB", "LR", "RL", "BT"],
    tokenizer: {
      root: [
        [/%%.*$/, "comment"],
        [/-->>|->>|-\.->|-->|---|==>/, "operator"],
        [/stateDiagram-v2\b/, "keyword"],
        [/[A-Za-z_]\w*/, { cases: { "@keywords": "keyword", "@directions": "type", "@default": "identifier" } }],
        [/"/, "string.quote", "@doubleQuoted"],
        [/'/, "string.quote", "@singleQuoted"],
        [/[([{]/, "@brackets", "@nodeText"],
        [/[)\]}]/, "@brackets"],
        [/\d+(?:\.\d+)?/, "number"],
        [/[;:,|]/, "delimiter"],
        [/\s+/, "white"],
      ],
      // A label's words are text, even when they happen to spell a diagram keyword.
      nodeText: [
        [/"/, "string.quote", "@doubleQuoted"],
        [/'/, "string.quote", "@singleQuoted"],
        [/[([{]/, "@brackets", "@push"],
        [/[)\]}]/, "@brackets", "@pop"],
        [/[^()[\]{}"']+/, "string"],
      ],
      doubleQuoted: [
        [/\\./, "string.escape"],
        [/[^\\"]+/, "string"],
        [/"/, "string.quote", "@pop"],
      ],
      singleQuoted: [
        [/\\./, "string.escape"],
        [/[^\\']+/, "string"],
        [/'/, "string.quote", "@pop"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("mermaid", {
    comments: { lineComment: "%%" },
    brackets: [["[", "]"], ["(", ")"], ["{", "}"]],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "{", close: "}" },
      { open: "\"", close: "\"", notIn: ["string", "comment"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
  });
}
