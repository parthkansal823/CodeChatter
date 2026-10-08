import type { Node as PMNode } from "@tiptap/pm/model";

import type { WikiAttrs } from "./extensions/wiki-link";
import { TEXT_EXCERPT, type PageSummary } from "./pages-model";
import { findTags } from "./tags";

/**
 * What a page's content says about the room, for the index: the page ids and
 * file paths it links to (sorted, so an unchanged set never rewrites the
 * index), its #tags, and an excerpt of its text. File links store the file id;
 * the path is read fresh so a renamed file keeps its edges in the graph.
 */
export type SummaryLookup = { filePath: (fileId: string) => string | null; pageTitle: (pageId: string) => string | null };

export function summarize(doc: PMNode, lookup: SummaryLookup): PageSummary {
  const links = new Set<string>();
  const tags = new Set<string>();
  doc.descendants((node, _pos, parent) => {
    if (node.type.name === "wikiLink") {
      const { kind, target, path } = node.attrs as WikiAttrs;
      if (kind === "page" && target) links.add(target);
      else if (kind === "file") {
        const current = (target && lookup.filePath(target)) || path;
        if (current) links.add(current);
      }
    } else if (node.isText && node.text && parent?.type.name !== "codeBlock" && !node.marks.some((mark) => mark.type.name === "code")) {
      for (const match of findTags(node.text)) tags.add(match.tag);
    }
  });
  const text = doc
    .textBetween(0, doc.content.size, " ", (leaf) => {
      if (leaf.type.name !== "wikiLink") return "";
      const { kind, target, label } = leaf.attrs as WikiAttrs;
      return `[[${(kind === "page" ? lookup.pageTitle(target) : lookup.filePath(target)) ?? label}]]`;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXT_EXCERPT);
  return { links: [...links].sort(), tags: [...tags].sort(), text };
}
