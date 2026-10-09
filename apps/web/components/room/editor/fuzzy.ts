export type FuzzyMatch = {
  score: number;
  /** Positions in the text of the matched characters. */ indices: number[];
};

// Adjacent characters outweigh word starts, so "main" prefers main.py to m_a_i_n.py.
const CONSECUTIVE = 7;
const WORD_START = 6;
const CAMEL_HUMP = 5;
const GAP = 0.4;
const LEAD = 0.05;
const SEPARATORS = "/ _-.";

/** Extra credit for a match at the start of a word: after a separator or on a camelCase hump. */
function boundary(text: string, at: number): number {
  if (at === 0) return WORD_START;
  const before = text[at - 1]!;
  if (SEPARATORS.includes(before)) return WORD_START;
  const here = text[at]!;
  return before === before.toLowerCase() && here !== here.toLowerCase() ? CAMEL_HUMP : 0;
}

/**
 * Case-insensitive subsequence match of `query` in `text`, scored so that runs of
 * adjacent characters and word starts win (the usual file-finder feel). It finds the
 * best alignment, not the first: "cs" in "components/search.ts" lands on the c and s
 * of "search", not on the end of "components".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n === 0) return { score: 0, indices: [] };
  if (n > m) return null;

  // best[i][j]: the best score with query char i matched at text position j.
  const best = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  for (let i = 0; i < n; i++) {
    let gap = -Infinity; // best predecessor at least two positions back, decayed by the skipped characters
    let gapAt = -1;
    for (let j = i; j < m; j++) {
      if (i > 0 && j >= 2 && best[i - 1]![j - 2]! > gap) {
        gap = best[i - 1]![j - 2]!;
        gapAt = j - 2;
      }
      if (i > 0) gap -= GAP;
      if (q[i] !== t[j]) continue;
      const own = 1 + boundary(text, j);
      if (i === 0) {
        best[i]![j] = own - j * LEAD;
        continue;
      }
      const run = best[i - 1]![j - 1] ?? -Infinity;
      const joined = run + CONSECUTIVE;
      if (joined >= gap && joined > -Infinity) {
        best[i]![j] = own + joined;
        from[i]![j] = j - 1;
      } else if (gap > -Infinity) {
        best[i]![j] = own + gap;
        from[i]![j] = gapAt;
      }
    }
  }

  let end = -1;
  let score = -Infinity;
  for (let j = 0; j < m; j++) {
    if (best[n - 1]![j]! > score) {
      score = best[n - 1]![j]!;
      end = j;
    }
  }
  if (end < 0) return null;
  const indices: number[] = [];
  for (let i = n - 1, j = end; i >= 0; j = from[i]![j]!, i--) indices.unshift(j);
  return { score, indices };
}

export type FileEntry = { id: string; path: string; name: string };
export type RankedFile<T extends FileEntry> = { file: T; indices: number[] };

const NAME_BONUS = 24;

/** Match against the file name first (what people type), then the whole path. */
function matchFile(query: string, file: FileEntry): { score: number; indices: number[] } | null {
  const offset = file.path.length - file.name.length;
  const inName = fuzzyMatch(query, file.name);
  const inPath = fuzzyMatch(query, file.path);
  const typed = query.toLowerCase().replace(/s+/g, "");
  const name = file.name.toLowerCase();
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const named = inName && {
    // A name that starts with what you typed, or is exactly it, beats one that merely contains it.
    score:
      inName.score +
      NAME_BONUS +
      (name.startsWith(typed) ? 20 : 0) +
      (stem === typed || name === typed ? 10 : 0) -
      name.length * 0.1,
    indices: inName.indices.map((i) => i + offset),
  };
  if (named && (!inPath || named.score >= inPath.score)) return named;
  return inPath;
}

/**
 * Files for Quick Open. With nothing typed: most recently opened first, then the rest by path.
 * With a query: best match first, recent files breaking ties.
 */
export function rankFiles<T extends FileEntry>(
  files: T[],
  query: string,
  recent: string[] = [],
  limit = 100,
): RankedFile<T>[] {
  const rank = new Map(recent.map((id, index) => [id, index]));
  const recency = (file: T) => rank.get(file.id) ?? Infinity;
  const byPath = (a: T, b: T) => a.path.localeCompare(b.path, undefined, { numeric: true });
  if (!query.trim()) {
    return [...files]
      .sort((a, b) => recency(a) - recency(b) || byPath(a, b))
      .slice(0, limit)
      .map((file) => ({ file, indices: [] }));
  }
  const scored: { file: T; score: number; indices: number[] }[] = [];
  for (const file of files) {
    const match = matchFile(query, file);
    if (match) scored.push({ file, ...match });
  }
  return scored
    .sort((a, b) => b.score - a.score || recency(a.file) - recency(b.file) || byPath(a.file, b.file))
    .slice(0, limit)
    .map(({ file, indices }) => ({ file, indices }));
}
