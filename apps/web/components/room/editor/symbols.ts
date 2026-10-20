"use client";

import {
  getJavaScriptWorker,
  getTypeScriptWorker,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";

import type { monaco } from "@/components/room/monaco-setup";

import { outlineFor, type SymbolItem } from "./outline";

export { siblingsOf, symbolsAt, type SymbolItem } from "./outline";

type NavigationTree = {
  text: string;
  kind: string;
  spans: { start: number; length: number }[];
  childItems?: NavigationTree[];
};

/** Kinds that name a place in the file; imports and the like would only be noise in an outline. */
const SKIPPED = new Set(["alias", "script", "module-less"]);

function collect(items: NavigationTree[], depth: number, out: SymbolItem[]) {
  for (const item of items) {
    const span = item.spans[0];
    if (span && !SKIPPED.has(item.kind))
      out.push({ name: item.text, kind: item.kind, start: span.start, end: span.start + span.length, depth });
    if (item.childItems) collect(item.childItems, depth + 1, out);
  }
}

/**
 * Functions, classes, methods and variables of a TypeScript or JavaScript
 * file, in source order, from the same worker that gives IntelliSense. Python,
 * Markdown, Go, Rust and shell get a lighter outline read from the text
 * (outline.ts); null for languages with neither.
 */
export async function getSymbols(model: monaco.editor.ITextModel): Promise<SymbolItem[] | null> {
  const language = model.getLanguageId();
  if (language !== "typescript" && language !== "javascript") return outlineFor(language, model.getValue());
  const forModel = await (language === "typescript" ? getTypeScriptWorker() : getJavaScriptWorker());
  const worker = await forModel(model.uri);
  const tree = (await worker.getNavigationTree(model.uri.toString())) as NavigationTree | undefined;
  const out: SymbolItem[] = [];
  if (tree?.childItems) collect(tree.childItems, 0, out);
  return out;
}
