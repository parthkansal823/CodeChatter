/** Colours for LaTeX and BibTeX files, and \cite{ completing from the room's .bib files. Monaco has neither language built in. */
"use client";

import { monaco } from "@/components/room/monaco-setup";
import { placeOf, shortAuthors } from "@/components/room/tools/references/bibtex";

import { referencesNow } from "./reference-source";

let registered = false;

const CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\])*\{[^{}]*$/;

export function registerLatex(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "latex", extensions: [".tex", ".sty", ".cls", ".ltx"], aliases: ["LaTeX"] });
  monaco.languages.setMonarchTokensProvider("latex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/\\(?:begin|end)(?=\s*\{)/, "keyword", "@environment"],
        [/\\(?:documentclass|usepackage|input|include|bibliography|addbibresource|printbibliography|title|author|date|maketitle|section|subsection|subsubsection|chapter|paragraph|part|label|ref|cite|caption|includegraphics)\b\*?/, "keyword"],
        [/\\[A-Za-z@]+\*?/, "type"],
        [/\\./, "type"],
        [/\$\$/, "string", "@displayMath"],
        [/\$/, "string", "@inlineMath"],
        [/[{}[\]]/, "@brackets"],
      ],
      environment: [
        [/\{/, "@brackets"],
        [/[A-Za-z*]+/, "string"],
        [/\}/, "@brackets", "@pop"],
      ],
      inlineMath: [
        [/\\\$/, "string"],
        [/\$/, "string", "@pop"],
        [/[^$\\]+/, "string"],
        [/\\./, "string"],
      ],
      displayMath: [
        [/\$\$/, "string", "@pop"],
        [/[^$]+/, "string"],
        [/\$/, "string"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("latex", {
    comments: { lineComment: "%" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: "$", close: "$" }],
    surroundingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: "$", close: "$" }],
  });
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ","],
    provideCompletionItems(model, position) {
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      if (!CITE.test(before)) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      return {
        suggestions: referencesNow().map((entry) => ({
          label: { label: entry.key, description: [shortAuthors(entry), entry.fields.year].filter(Boolean).join(" ") },
          kind: monaco.languages.CompletionItemKind.Reference,
          insertText: entry.key,
          range,
          detail: entry.fields.title,
          documentation: placeOf(entry) || undefined,
          filterText: `${entry.key} ${entry.fields.title ?? ""} ${entry.fields.author ?? ""}`,
        })),
      };
    },
  });

  monaco.languages.register({ id: "bibtex", extensions: [".bib"], aliases: ["BibTeX"] });
  monaco.languages.setMonarchTokensProvider("bibtex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/@[A-Za-z]+/, "keyword"],
        [/[A-Za-z_-]+(?=\s*=)/, "type"],
        [/"/, "string", "@quoted"],
        [/\{/, "@brackets", "@braces"],
        [/\d+/, "number"],
      ],
      braces: [
        [/\{/, "@brackets", "@push"],
        [/\}/, "@brackets", "@pop"],
        [/[A-Za-z_-]+(?=\s*=)/, "type"],
        [/"/, "string", "@quoted"],
        [/\d+/, "number"],
      ],
      quoted: [
        [/[^"]+/, "string"],
        [/"/, "string", "@pop"],
      ],
    },
  });
}
