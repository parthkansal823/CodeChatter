"use client";

import { monaco } from "@/components/room/monaco-setup";

import { SNIPPETS, snippetPreview, type Snippet } from "./snippets";

let registered = false;

/** Offer the snippets (snippets.ts) among each language's completions, as VS Code does. */
export function registerSnippets(): void {
  if (registered) return;
  registered = true;
  for (const [language, list] of Object.entries(SNIPPETS)) {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        // Only the snippets the typed word starts: Monaco offers the file's own words only
        // when no provider has anything, so answering with every snippet would hide them.
        const typed = word.word.toLowerCase();
        const matching = typed ? list.filter((snippet) => snippet.prefix.toLowerCase().startsWith(typed)) : list;
        return {
          // Asked again as the word grows, since what matches changes.
          incomplete: Boolean(typed),
          suggestions: matching.map((snippet) => ({
            label: { label: snippet.prefix, description: snippet.label },
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `${snippet.label} (snippet)`,
            documentation: { value: `\`\`\`${language}\n${snippetPreview(snippet.body)}\n\`\`\`` },
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            // After the language's own words for the same prefix.
            sortText: `~${snippet.prefix}`,
          })),
        };
      },
    });
  }
}

type SnippetController = { insert(template: string): void };

/** Put a snippet in at the cursor, with Tab moving through its placeholders. */
export function insertSnippet(editor: monaco.editor.IStandaloneCodeEditor, snippet: Snippet): void {
  const controller = editor.getContribution<monaco.editor.IEditorContribution & SnippetController>("snippetController2");
  editor.focus();
  if (controller) controller.insert(snippet.body);
  else editor.trigger("snippet", "type", { text: snippetPreview(snippet.body) });
}
