import { titleOf, type PageRecord } from "./pages-model";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A short run of text around the first match, or null. Link markup `[[…]]` doesn't count as a plain mention. */
export function snippetAround(text: string, needle: string, radius = 64): string | null {
  const clean = text.replace(/\[\[[^\]]*\]\]/g, (link) => " ".repeat(link.length));
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}(?![\\p{L}\\p{N}])`, "iu").exec(clean);
  if (!match) return null;
  const from = Math.max(0, match.index - radius);
  const to = Math.min(text.length, match.index + match[0].length + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/** The sentence around a [[link]] to this page, falling back to the start of the text. */
export function backlinkSnippet(text: string, title: string): string {
  const at = text.toLowerCase().indexOf(`[[${title.toLowerCase()}]]`);
  const index = at >= 0 ? at : text.indexOf("[[");
  if (index < 0) return text.slice(0, 120);
  const from = Math.max(0, index - 56);
  const to = Math.min(text.length, index + title.length + 60);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

const MIN_TITLE = 3;

/** Pages that say this page's title in plain text without linking to it. */
export function unlinkedMentions(target: PageRecord, pages: PageRecord[]): Array<{ page: PageRecord; snippet: string }> {
  const title = target.title.trim();
  if (title.length < MIN_TITLE) return [];
  const out: Array<{ page: PageRecord; snippet: string }> = [];
  for (const page of pages) {
    if (page.id === target.id || page.links.includes(target.id)) continue;
    const snippet = snippetAround(page.text, title) ?? (titleOf(page) !== title ? snippetAround(page.title, title) : null);
    if (snippet) out.push({ page, snippet });
  }
  return out.sort((a, b) => b.page.updatedAt - a.page.updatedAt);
}
