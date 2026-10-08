/**
 * `#tag` syntax: a hash that starts a word, followed by a letter and then
 * letters, digits, "_" or "-". "#123", "a#b" and "https://x/#anchor" are not tags.
 */
const TAG = /(?<![\p{L}\p{N}_&#/=-])#(\p{L}[\p{L}\p{N}_-]{0,39})(?![\p{L}\p{N}_-])/gu;

export type TagMatch = { index: number; length: number; tag: string };

/** Every tag in a run of text, with where it sits (the tag is lowercased). */
export function findTags(text: string): TagMatch[] {
  return [...text.matchAll(TAG)].map((m) => ({ index: m.index, length: m[0].length, tag: m[1]!.toLowerCase() }));
}

export const extractTags = (text: string): string[] => [...new Set(findTags(text).map((m) => m.tag))].sort();

/** How many live pages carry each tag, most used first. */
export function tagCounts(pages: Array<{ tags: string[] }>): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
