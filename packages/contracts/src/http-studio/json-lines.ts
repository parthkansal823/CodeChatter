/**
 * Pure helpers behind the response viewer: pretty-printed JSON as lines with
 * fold regions, a tokenizer for one line, and search. Kept free of React so
 * the folding and matching rules are unit-tested.
 */

/** Pretty-printed JSON, or null when the text isn't JSON (objects, arrays and scalars all count). */
export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

/**
 * Lines that open a block mapped to the line that closes it. Only the
 * pretty-printed shape is understood, which is exactly what prettyJson makes:
 * one bracket per line, `{}` and `[]` kept on a single line.
 */
export function foldRegions(lines: string[]): Map<number, number> {
  const regions = new Map<number, number>();
  const open: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^[}\]]/.test(trimmed)) {
      const start = open.pop();
      if (start !== undefined && index > start) regions.set(start, index);
    } else if (/[{[]$/.test(trimmed)) {
      open.push(index);
    }
  });
  return regions;
}

/** The line indexes shown when some blocks are folded (a folded block keeps only its first line). */
export function visibleLines(count: number, regions: Map<number, number>, folded: ReadonlySet<number>): number[] {
  const shown: number[] = [];
  for (let i = 0; i < count; i++) {
    shown.push(i);
    const end = folded.has(i) ? regions.get(i) : undefined;
    if (end !== undefined) i = end;
  }
  return shown;
}

/** Folded blocks that hide a given line, so a search hit inside one can open it. */
export function foldsHiding(line: number, regions: Map<number, number>, folded: ReadonlySet<number>): number[] {
  const hiding: number[] = [];
  for (const start of folded) {
    const end = regions.get(start);
    if (end !== undefined && line > start && line <= end) hiding.push(start);
  }
  return hiding;
}

export type JsonTokenKind = "key" | "string" | "number" | "keyword" | "punct" | "plain";
export type JsonToken = { text: string; kind: JsonTokenKind };

const LINE = /^(\s*)(?:("(?:[^"\\]|\\.)*")(\s*:\s*))?(.*)$/s;

export function tokenizeJsonLine(line: string): JsonToken[] {
  const match = LINE.exec(line);
  if (!match) return [{ text: line, kind: "plain" }];
  const [, indent = "", key, colon = "", rest = ""] = match;
  const tokens: JsonToken[] = [];
  if (indent) tokens.push({ text: indent, kind: "plain" });
  if (key !== undefined) tokens.push({ text: key, kind: "key" }, { text: colon, kind: "punct" });
  const comma = rest.endsWith(",") ? "," : "";
  const value = comma ? rest.slice(0, -1) : rest;
  if (value) {
    const kind: JsonTokenKind = value.startsWith('"')
      ? "string"
      : /^-?\d/.test(value)
        ? "number"
        : /^(true|false|null)$/.test(value)
          ? "keyword"
          : "punct";
    tokens.push({ text: value, kind });
  }
  if (comma) tokens.push({ text: comma, kind: "punct" });
  return tokens;
}

export type Match = { line: number; start: number; end: number };

/** Every case-insensitive occurrence of the query, in reading order (capped, so a one-letter search stays fast). */
export function findMatches(lines: string[], query: string, cap = 5000): Match[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: Match[] = [];
  for (let line = 0; line < lines.length && matches.length < cap; line++) {
    const haystack = lines[line]!.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1 && matches.length < cap; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ line, start: at, end: at + needle.length });
    }
  }
  return matches;
}

/** Cut a token list into pieces at the given ranges, marking the pieces inside a range. */
export function splitTokens<T extends { text: string }>(tokens: T[], ranges: Array<{ start: number; end: number }>): Array<T & { hit: number }> {
  const out: Array<T & { hit: number }> = [];
  let offset = 0;
  for (const token of tokens) {
    const from = offset;
    const to = offset + token.text.length;
    let cursor = from;
    for (const [index, range] of ranges.entries()) {
      if (range.end <= cursor || range.start >= to) continue;
      const start = Math.max(range.start, cursor);
      const end = Math.min(range.end, to);
      if (start > cursor) out.push({ ...token, text: token.text.slice(cursor - from, start - from), hit: -1 });
      out.push({ ...token, text: token.text.slice(start - from, end - from), hit: index });
      cursor = end;
    }
    if (cursor < to) out.push({ ...token, text: token.text.slice(cursor - from), hit: -1 });
    offset = to;
  }
  return out;
}
